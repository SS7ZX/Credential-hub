import { z } from "npm:zod@4";
import {
  assertDriveFileInFolderTree,
  downloadDrivePdf,
  getDriveAccessToken,
  getDriveFileMetadata,
  GoogleDriveError,
  MAX_STAMP_PDF_BYTES,
} from "../_shared/google-drive.ts";
import { corsHeaders, handleOptions, jsonResponse, readJson, RequestBodyError } from "../_shared/http.ts";
import { requireOrganizationRole } from "../_shared/supabase.ts";

const requestSchema = z.object({
  organizationId: z.string().uuid(),
  folderId: z.string().min(10).max(255),
  fileId: z.string().min(10).max(255),
}).strict();

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const requestBody = requestSchema.parse(await readJson(request));
    await requireOrganizationRole(request, requestBody.organizationId, ["owner", "admin", "issuer"]);
    const token = await getDriveAccessToken();
    const metadata = await getDriveFileMetadata(requestBody.fileId, token);
    await assertDriveFileInFolderTree(metadata, requestBody.folderId, token);
    if (metadata.mimeType !== "application/pdf") {
      return jsonResponse({ error: "invalid_mime" }, 415);
    }
    const declaredSize = Number(metadata.size);
    if (!Number.isSafeInteger(declaredSize) || declaredSize <= 0 || declaredSize > MAX_STAMP_PDF_BYTES) {
      return jsonResponse({ error: "file_size_limit_exceeded" }, 413);
    }
    const bytes = await downloadDrivePdf(metadata, token);
    const pdfBody = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(pdfBody).set(bytes);
    return new Response(pdfBody, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=\"preview.pdf\"",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof RequestBodyError) return jsonResponse({ error: error.message }, error.status);
    if (error instanceof z.ZodError) return jsonResponse({ error: "Invalid PDF preview request" }, 400);
    if (error instanceof GoogleDriveError) {
      const headers: HeadersInit = error.retryAfterSeconds
        ? { "Retry-After": String(error.retryAfterSeconds) }
        : {};
      return jsonResponse({ error: error.code }, error.status, headers);
    }
    if (error instanceof Error && /outside the selected folder|selected Drive root is not a folder/i.test(error.message)) {
      return jsonResponse({ error: "drive_file_out_of_scope" }, 422);
    }
    if (error instanceof Error && /Authentication required|Invalid authentication token|organization role/i.test(error.message)) {
      return jsonResponse({ error: "organization_access_denied" }, 403);
    }
    const message = error instanceof Error ? error.message : "";
    if (/Only application\/pdf/i.test(message)) return jsonResponse({ error: "invalid_mime" }, 415);
    if (/file size is outside/i.test(message)) return jsonResponse({ error: "file_size_limit_exceeded" }, 413);
    console.error("preview-drive-file failed");
    return jsonResponse({ error: "drive_preview_unavailable" }, 503);
  }
});
