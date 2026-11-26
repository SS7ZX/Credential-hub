import { z } from "npm:zod@4";
import { handleOptions, jsonResponse, readJson, RequestBodyError } from "../_shared/http.ts";
import { getAdminClient, requireOrganizationRole } from "../_shared/supabase.ts";
import { issueSignedUrlForEligibleFile } from "../_shared/stamped-download.ts";

const requestSchema = z.object({
  organizationId: z.string().uuid(),
  stampRunId: z.string().uuid(),
  action: z.enum(["status", "sign-file"]),
  stampFileId: z.string().uuid().optional(),
}).strict();
const BUCKET_NAME = "stamped-certificate-pdfs";
const SIGNED_URL_TTL_SECONDS = 300;

type StampRunRow = {
  id: string;
  organization_id: string;
  status: string;
  expected_file_count: number;
  processed_count: number;
  succeeded_count: number;
  failed_count: number;
};

type VisibleStampFile = {
  id: string;
  status: string;
  error_code: string | null;
  credential_id: string;
};

function isVisibleStampFile(value: unknown): value is VisibleStampFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Record<string, unknown>;
  return typeof file.id === "string"
    && typeof file.status === "string"
    && (file.error_code === null || typeof file.error_code === "string")
    && typeof file.credential_id === "string";
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = requestSchema.parse(await readJson(request));
    await requireOrganizationRole(request, body.organizationId, ["owner", "admin", "issuer"]);
    const admin = getAdminClient();
    const { data: runData, error: runError } = await admin.from("stamp_runs")
      .select("id, organization_id, status, expected_file_count, processed_count, succeeded_count, failed_count")
      .eq("id", body.stampRunId)
      .eq("organization_id", body.organizationId)
      .maybeSingle();
    if (runError) throw new Error("Stamp run lookup failed");
    if (!runData) return jsonResponse({ error: "stamp_run_not_found" }, 404);
    const run = runData as StampRunRow;

    if (body.action === "sign-file") {
      const stampFileId = body.stampFileId;
      if (!stampFileId) return jsonResponse({ error: "stamp_file_id_required" }, 400);
      if (!["completed", "completed_with_errors"].includes(run.status)) {
        return jsonResponse({ error: "stamp_run_not_complete" }, 409);
      }
      const signedUrl = await issueSignedUrlForEligibleFile(
        async () => {
          const { data, error } = await admin.rpc("get_stamp_file_download_path", {
            p_organization_id: body.organizationId,
            p_stamp_run_id: run.id,
            p_stamp_file_id: stampFileId,
          });
          if (error) throw new Error("Stamped file eligibility lookup failed");
          return typeof data === "string" && data.length > 0 ? data : null;
        },
        async (path) => {
          const { data, error } = await admin.storage
            .from(BUCKET_NAME)
            .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
          if (error || !data?.signedUrl) throw new Error("Could not sign stamped file");
          return data.signedUrl;
        },
      );
      if (!signedUrl) {
        return jsonResponse({ error: "stamped_file_not_available" }, 404);
      }
      return jsonResponse({
        stampFileId,
        signedUrl,
        expiresIn: SIGNED_URL_TTL_SECONDS,
      }, 200, { "Cache-Control": "no-store" });
    }

    const { data: filesData, error: filesError } = await admin.rpc("list_visible_stamp_run_files", {
      p_organization_id: body.organizationId,
      p_stamp_run_id: run.id,
    });
    if (filesError) throw new Error("Stamp file status lookup failed");
    if (!Array.isArray(filesData) || !filesData.every(isVisibleStampFile)) {
      throw new Error("Stamp file status response is malformed");
    }
    return jsonResponse({
      run: {
        id: run.id,
        status: run.status,
        expectedFileCount: run.expected_file_count,
        processedCount: run.processed_count,
        succeededCount: run.succeeded_count,
        failedCount: run.failed_count,
      },
      files: filesData.map((file) => ({
        id: file.id,
        status: file.status,
        errorCode: file.error_code,
        credentialId: file.credential_id,
      })),
    }, 200, { "Cache-Control": "no-store" });
  } catch (error) {
    if (error instanceof RequestBodyError) return jsonResponse({ error: error.message }, error.status);
    if (error instanceof z.ZodError) return jsonResponse({ error: "Invalid stamp run request" }, 400);
    if (error instanceof Error && /Authentication required|Invalid authentication token|organization role/i.test(error.message)) {
      return jsonResponse({ error: "organization_access_denied" }, 403);
    }
    console.error("finalize-run failed");
    return jsonResponse({ error: "stamp_run_unavailable" }, 503);
  }
});
