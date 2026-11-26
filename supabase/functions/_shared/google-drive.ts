import { importPKCS8, SignJWT } from "npm:jose@6";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const MAX_STAMP_PDF_BYTES = 15 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  parents?: string[];
  modifiedTime?: string;
};

type ServiceAccount = {
  client_email: string;
  private_key: string;
};

export class GoogleDriveError extends Error {
  constructor(
    readonly code: "drive_forbidden" | "drive_rate_limited" | "file_missing" | "drive_unavailable",
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = "GoogleDriveError";
  }
}

export function isAllowedGoogleApiUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.port
      || url.searchParams.has("access_token")
    ) return false;
    if (url.hostname === "oauth2.googleapis.com") {
      return url.pathname === "/token";
    }
    return url.hostname === "www.googleapis.com"
      && url.pathname.startsWith("/drive/v3/");
  } catch {
    return false;
  }
}

export function validateDriveId(value: string): string {
  if (!/^[A-Za-z0-9_-]{10,255}$/.test(value)) {
    throw new Error("Invalid Drive identifier");
  }
  return value;
}

export async function getDriveAccessToken(
  serviceAccountJson = Deno.env.get("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON"),
  fetcher: typeof fetch = fetch,
): Promise<string> {
  if (!serviceAccountJson) throw new Error("Drive service account secret is not configured");

  let account: ServiceAccount;
  try {
    const parsed: unknown = JSON.parse(serviceAccountJson);
    if (
      typeof parsed !== "object"
      || parsed === null
      || typeof (parsed as Record<string, unknown>).client_email !== "string"
      || typeof (parsed as Record<string, unknown>).private_key !== "string"
    ) throw new Error();
    account = parsed as ServiceAccount;
  } catch {
    throw new Error("Drive service account configuration is invalid");
  }

  const email = account.client_email;
  if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(email)) {
    throw new Error("Drive service account configuration is invalid");
  }
  const key = await importPKCS8(account.private_key, "RS256");
  const assertion = await new SignJWT({ scope: DRIVE_READONLY_SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(email)
    .setAudience(TOKEN_URL)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
  assertAllowedGoogleApiUrl(TOKEN_URL);

  let response: Response;
  try {
    response = await fetcher(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GoogleDriveError("drive_unavailable", 503, 5);
  }
  if (!response.ok) throw await mapGoogleError(response);
  const data: unknown = await response.json();
  if (
    typeof data !== "object"
    || data === null
    || typeof (data as Record<string, unknown>).access_token !== "string"
  ) throw new GoogleDriveError("drive_unavailable", 503, 5);
  return (data as Record<string, string>).access_token;
}

export async function getDriveFileMetadata(
  fileId: string,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<DriveFile> {
  validateDriveId(fileId);
  const url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id%2Cname%2CmimeType%2Csize%2Cparents%2CmodifiedTime`;
  const response = await fetchGoogle(url, accessToken, fetcher);
  if (response.status === 404) throw new GoogleDriveError("file_missing", 404);
  if (!response.ok) throw await mapGoogleError(response);
  const file: unknown = await response.json();
  if (
    typeof file !== "object"
    || file === null
    || typeof (file as Record<string, unknown>).id !== "string"
    || typeof (file as Record<string, unknown>).name !== "string"
    || typeof (file as Record<string, unknown>).mimeType !== "string"
  ) throw new GoogleDriveError("drive_unavailable", 502);
  return file as DriveFile;
}

export async function listDriveFolder(
  folderId: string,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<DriveFile[]> {
  validateDriveId(folderId);
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken,files(id,name,mimeType,size,parents,modifiedTime)",
      pageSize: "1000",
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetchGoogle(`${DRIVE_API}/files?${params.toString()}`, accessToken, fetcher);
    if (!response.ok) throw await mapGoogleError(response);
    const data: unknown = await response.json();
    if (typeof data !== "object" || data === null) {
      throw new GoogleDriveError("drive_unavailable", 502);
    }
    const result = data as { files?: unknown; nextPageToken?: unknown };
    if (!Array.isArray(result.files)) throw new GoogleDriveError("drive_unavailable", 502);
    for (const item of result.files) {
      if (
        typeof item !== "object"
        || item === null
        || typeof (item as Record<string, unknown>).id !== "string"
        || typeof (item as Record<string, unknown>).name !== "string"
        || typeof (item as Record<string, unknown>).mimeType !== "string"
      ) throw new GoogleDriveError("drive_unavailable", 502);
      files.push(item as DriveFile);
      if (files.length > 1000) throw new GoogleDriveError("drive_unavailable", 413);
    }
    pageToken = typeof result.nextPageToken === "string" ? result.nextPageToken : undefined;
  } while (pageToken);
  return files;
}

export async function downloadDrivePdf(
  file: DriveFile,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<Uint8Array> {
  validateDriveId(file.id);
  if (file.mimeType !== "application/pdf") {
    throw new Error("Only application/pdf files are accepted");
  }
  if (file.size !== undefined) {
    const size = Number(file.size);
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_STAMP_PDF_BYTES) {
      throw new Error("PDF file size is outside the allowed limit");
    }
  }
  const url = `${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media`;
  const response = await fetchGoogle(url, accessToken, fetcher);
  if (!response.ok) throw await mapGoogleError(response);
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/pdf") throw new Error("Drive file is not application/pdf");
  const declaredLength = Number(response.headers.get("content-length") ?? file.size ?? 0);
  if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0 || declaredLength > MAX_STAMP_PDF_BYTES) {
    throw new Error("PDF file size is outside the allowed limit");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_STAMP_PDF_BYTES) {
    throw new Error("PDF file size is outside the allowed limit");
  }
  return bytes;
}

async function fetchGoogle(
  url: string,
  accessToken: string,
  fetcher: typeof fetch,
): Promise<Response> {
  assertAllowedGoogleApiUrl(url);
  try {
    return await fetcher(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GoogleDriveError("drive_unavailable", 503, 5);
  }
}

function assertAllowedGoogleApiUrl(url: string): void {
  if (!isAllowedGoogleApiUrl(url)) throw new Error("Blocked non-Google API request");
}

async function mapGoogleError(response: Response): Promise<GoogleDriveError> {
  let rateLimited = response.status === 429;
  if (response.status === 403 || response.status === 429) {
    const body = await response.json().catch(() => null) as {
      error?: { errors?: Array<{ reason?: string }> };
    } | null;
    rateLimited ||= body?.error?.errors?.some((item) =>
      item.reason === "rateLimitExceeded" || item.reason === "userRateLimitExceeded"
    ) ?? false;
  }
  const retryAfter = Number(response.headers.get("retry-after"));
  if (rateLimited) {
    return new GoogleDriveError("drive_rate_limited", 429, Number.isInteger(retryAfter) && retryAfter > 0 ? retryAfter : 5);
  }
  if (response.status === 403) return new GoogleDriveError("drive_forbidden", 403, 5);
  if (response.status === 404) return new GoogleDriveError("file_missing", 404);
  return new GoogleDriveError("drive_unavailable", 503, 5);
}
