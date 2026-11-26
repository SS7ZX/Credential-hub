import { z } from "npm:zod@4";
import {
  assertDriveFileInFolderTree,
  downloadDrivePdf,
  getDriveAccessToken,
  getDriveFileMetadata,
  GoogleDriveError,
} from "../_shared/google-drive.ts";
import { handleOptions, jsonResponse, readJson, RequestBodyError } from "../_shared/http.ts";
import { StampPdfError, sha256PdfBytes, stampPdf, type QrLayout } from "../_shared/stamping-pdf.ts";
import { authenticateRequest, getAdminClient, requireOrganizationRole } from "../_shared/supabase.ts";
import { getPublicSiteUrl } from "../_shared/site-config.ts";

const requestSchema = z.object({ stampFileId: z.string().uuid() }).strict();
const BUCKET_NAME = "stamped-certificate-pdfs";

type StampFileRow = {
  id: string;
  organization_id: string;
  stamp_run_id: string;
  credential_id: string;
  drive_file_id: string | null;
  storage_path: string | null;
};
type RunRow = { achievement_id: string; status: string; drive_folder_id: string };
type CredentialRow = { id: string; serial_number: string; status: string };

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let userClient: Awaited<ReturnType<typeof authenticateRequest>>["client"] | null = null;
  let stampFile: StampFileRow | null = null;
  let claimed = false;
  try {
    const body = requestSchema.parse(await readJson(request));
    const auth = await authenticateRequest(request);
    userClient = auth.client;
    const admin = getAdminClient();
    const { data: rowData, error: rowError } = await admin.from("stamp_files")
      .select("id, organization_id, stamp_run_id, credential_id, drive_file_id, storage_path")
      .eq("id", body.stampFileId)
      .maybeSingle();
    if (rowError) throw new Error("Stamp file lookup failed");
    if (!rowData) return jsonResponse({ error: "stamp_file_not_found" }, 404);
    stampFile = rowData as StampFileRow;
    await requireOrganizationRole(request, stampFile.organization_id, ["owner", "admin", "issuer"]);
    if (!stampFile.drive_file_id || !stampFile.storage_path) {
      return jsonResponse({ error: "stamp_file_unavailable" }, 409);
    }

    const [{ data: runData, error: runError }, { data: credentialData, error: credentialError }] = await Promise.all([
      admin.from("stamp_runs").select("achievement_id, status, drive_folder_id").eq("id", stampFile.stamp_run_id).single(),
      admin.from("credentials").select("id, serial_number, status").eq("id", stampFile.credential_id).single(),
    ]);
    if (runError || credentialError) throw new Error("Stamp file dependencies are unavailable");
    const run = runData as RunRow;
    const credential = credentialData as CredentialRow;
    if (!["approved", "processing", "completed_with_errors"].includes(run.status)) {
      return jsonResponse({ error: "stamp_run_not_approved" }, 409);
    }
    if (credential.status !== "issued") return jsonResponse({ error: "issued_credential_required" }, 409);

    const { data: layoutData, error: layoutError } = await admin.from("qr_layouts")
      .select("page_number, x_points, y_points, size_points, expected_page_width_points, expected_page_height_points, page_size_tolerance_points")
      .eq("organization_id", stampFile.organization_id)
      .eq("achievement_id", run.achievement_id)
      .single();
    if (layoutError) throw new Error("QR layout is unavailable");

    const token = await getDriveAccessToken();
    const driveFile = await getDriveFileMetadata(stampFile.drive_file_id, token);
    await assertDriveFileInFolderTree(driveFile, run.drive_folder_id, token);
    const source = await downloadDrivePdf(driveFile, token);
    const sourceSha256 = await sha256PdfBytes(source);
    const { data: claimData, error: claimError } = await userClient.rpc("claim_stamp_file", {
      p_stamp_file_id: stampFile.id,
      p_source_sha256: sourceSha256,
    });
    if (claimError) throw new Error("stamp_claim_rejected");
    claimed = true;
    const claim = claimData as { storagePath?: unknown; attemptCount?: unknown } | null;
    if (claim?.storagePath !== stampFile.storage_path) {
      throw new Error("stamp_claim_response_invalid");
    }

    const maxPages = getMaxPageCount();
    const result = await stampPdf(
      source,
      `${getPublicSiteUrl()}/verify/${credential.id}`,
      credential.id,
      credential.serial_number,
      layoutData as QrLayout,
      maxPages,
    );
    if (result.sourceSha256 !== sourceSha256) {
      throw new Error("source_hash_changed");
    }

    const { error: uploadError } = await admin.storage.from(BUCKET_NAME).upload(
      stampFile.storage_path,
      result.bytes,
      { contentType: "application/pdf", cacheControl: "0", upsert: true },
    );
    if (uploadError) {
      await completeFailure(userClient, stampFile.id, "storage_upload_failed");
      claimed = false;
      return jsonResponse({ error: "storage_upload_failed" }, 503);
    }

    const { error: completeError } = await userClient.rpc("complete_stamp_file", {
      p_stamp_file_id: stampFile.id,
      p_success: true,
      p_output_sha256: result.outputSha256,
      p_error_code: null,
    });
    if (completeError) throw new Error("stamp_completion_failed");
    claimed = false;
    return jsonResponse({
      stampFileId: stampFile.id,
      status: "completed",
      attemptCount: claim?.attemptCount ?? null,
      outputSha256: result.outputSha256,
    }, 200, { "Cache-Control": "no-store" });
  } catch (error) {
    const errorCode = errorCodeFor(error);
    if (userClient && stampFile) {
      if (claimed) {
        await completeFailure(userClient, stampFile.id, errorCode);
      } else {
        const { error: failError } = await userClient.rpc("fail_stamp_file", {
          p_stamp_file_id: stampFile.id,
          p_error_code: errorCode,
        });
        if (failError) console.error("stamp-one-file failure state update failed");
      }
    }
    if (error instanceof RequestBodyError) return jsonResponse({ error: error.message }, error.status);
    if (error instanceof z.ZodError) return jsonResponse({ error: "Invalid stamp request" }, 400);
    if (error instanceof GoogleDriveError) {
      const headers: HeadersInit = error.retryAfterSeconds
        ? { "Retry-After": String(error.retryAfterSeconds) }
        : {};
      return jsonResponse({ error: error.code }, error.status, headers);
    }
    if (error instanceof StampPdfError) return jsonResponse({ error: error.code }, 422);
    if (error instanceof Error && /outside the selected folder|selected Drive root is not a folder/i.test(error.message)) {
      return jsonResponse({ error: "drive_file_out_of_scope" }, 422);
    }
    if (error instanceof Error && /Authentication required|Invalid authentication token|organization role/i.test(error.message)) {
      return jsonResponse({ error: "organization_access_denied" }, 403);
    }
    if (error instanceof Error && error.message === "stamp_claim_rejected") {
      return jsonResponse({ error: "stamp_file_not_claimable" }, 409);
    }
    console.error("stamp-one-file failed");
    return jsonResponse({ error: errorCode }, errorCode === "drive_rate_limited" ? 429 : 503);
  }
});

function getMaxPageCount(): number {
  const value = Number(Deno.env.get("MAX_STAMP_PDF_PAGES") ?? "50");
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error("Stamping page limit is invalid");
  }
  return value;
}

function errorCodeFor(error: unknown): string {
  if (error instanceof GoogleDriveError) return error.code;
  if (error instanceof StampPdfError) return error.code;
  if (error instanceof Error && /application\/pdf|file size is outside|not a valid PDF/i.test(error.message)) {
    return "pdf_invalid";
  }
  if (error instanceof Error && /stamping page limit/i.test(error.message)) return "other";
  return "other";
}

async function completeFailure(
  client: Awaited<ReturnType<typeof authenticateRequest>>["client"],
  stampFileId: string,
  errorCode: string,
): Promise<void> {
  const allowedCodes = new Set([
    "drive_forbidden",
    "drive_rate_limited",
    "file_missing",
    "pdf_invalid",
    "pdf_encrypted",
    "pdf_signed",
    "pdf_rotated",
    "page_limit",
    "page_size_mismatch",
    "qr_stamping_failed",
    "storage_upload_failed",
    "processing_lease_expired",
    "other",
  ]);
  const sanitizedCode = allowedCodes.has(errorCode) ? errorCode : "other";
  const { error } = await client.rpc("complete_stamp_file", {
    p_stamp_file_id: stampFileId,
    p_success: false,
    p_output_sha256: null,
    p_error_code: sanitizedCode,
  });
  if (error) console.error("stamp-one-file completion failure update failed");
}
