import { z } from "npm:zod@4";
import {
  getDriveAccessToken,
  getDriveFileMetadata,
  GoogleDriveError,
  listDriveFolder,
  validateDriveId,
  type DriveFile,
} from "../_shared/google-drive.ts";
import { handleOptions, jsonResponse, readJson, RequestBodyError } from "../_shared/http.ts";
import { requireOrganizationRole } from "../_shared/supabase.ts";

const requestSchema = z.object({
  organizationId: z.string().uuid(),
  folderId: z.string().min(10).max(255),
}).strict();
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

type DriveSection = {
  folderId: string;
  folderName: string;
  files: DriveFile[];
};

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = requestSchema.parse(await readJson(request));
    validateDriveId(body.folderId);
    await requireOrganizationRole(request, body.organizationId, ["owner", "admin", "issuer"]);

    const accessToken = await getDriveAccessToken();
    const root = await getDriveFileMetadata(body.folderId, accessToken);
    if (root.mimeType !== DRIVE_FOLDER_MIME) {
      return jsonResponse({ error: "drive_folder_required" }, 400);
    }

    const rootItems = await listDriveFolder(root.id, accessToken);
    const subfolders = rootItems.filter((item) => item.mimeType === DRIVE_FOLDER_MIME);
    const sections: DriveSection[] = [{
      folderId: root.id,
      folderName: root.name,
      files: rootItems.filter((item) => item.mimeType !== DRIVE_FOLDER_MIME),
    }];
    if (subfolders.length > 100) {
      return jsonResponse({ error: "folder_has_too_many_subfolders" }, 413);
    }

    for (const folder of subfolders) {
      const children = await listDriveFolder(folder.id, accessToken);
      if (children.some((item) => item.mimeType === DRIVE_FOLDER_MIME)) {
        return jsonResponse({ error: "nested_drive_folders_not_supported" }, 422);
      }
      sections.push({
        folderId: folder.id,
        folderName: folder.name,
        files: children,
      });
    }

    const totalFiles = sections.reduce((total, section) => total + section.files.length, 0);
    if (totalFiles > 300) return jsonResponse({ error: "run_file_limit_exceeded" }, 413);

    return jsonResponse({
      folder: { id: root.id, name: root.name },
      sections,
      fileCount: totalFiles,
      maxPdfBytes: 15 * 1024 * 1024,
    }, 200, { "Cache-Control": "no-store" });
  } catch (error) {
    if (error instanceof RequestBodyError) return jsonResponse({ error: error.message }, error.status);
    if (error instanceof z.ZodError) return jsonResponse({ error: "Invalid Drive folder request" }, 400);
    if (error instanceof GoogleDriveError) {
      const headers: HeadersInit = error.retryAfterSeconds
        ? { "Retry-After": String(error.retryAfterSeconds) }
        : {};
      return jsonResponse({ error: error.code }, error.status, headers);
    }
    if (error instanceof Error && /Authentication required|Invalid authentication token|organization role/i.test(error.message)) {
      return jsonResponse({ error: "organization_access_denied" }, 403);
    }
    console.error("list-drive-folder failed");
    return jsonResponse({ error: "drive_listing_unavailable" }, 503);
  }
});
