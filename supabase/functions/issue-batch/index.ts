import { z } from "npm:zod@4";
import { buildCredential, hashRecipientEmail } from "../_shared/credential.ts";
import { normalizeStagingRows } from "../_shared/issuance-batch.ts";
import { issuanceRowSchema } from "../_shared/issuance-row.ts";
import { getOrganizationDid, getPublicSiteUrl } from "../_shared/site-config.ts";
import {
  handleOptions,
  jsonResponse,
  readJson,
  RequestBodyError,
} from "../_shared/http.ts";
import { EnvKeySigner } from "../_shared/signer.ts";
import { getAdminClient, requireOrganizationRole } from "../_shared/supabase.ts";

const createSchema = z.object({
  action: z.literal("create"),
  organizationId: z.string().uuid(),
  eventId: z.string().uuid(),
  achievementId: z.string().uuid(),
  rowsTotal: z.number().int().min(1).max(1000),
  idempotencyKey: z.string().uuid(),
  options: z.object({
    duplicatePolicy: z.enum(["skip", "reissue", "error"]).default("skip"),
    visibility: z.enum(["public", "unlisted"]).default("unlisted"),
    issueDate: z.string().datetime({ offset: true }).optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
    sendEmail: z.boolean().default(false),
  }).strict().default({
    duplicatePolicy: "skip",
    visibility: "unlisted",
    sendEmail: false,
  }),
}).strict();

const stageSchema = z.object({
  action: z.literal("stage"),
  batchId: z.string().uuid(),
  rows: z.array(z.object({
    rowNumber: z.number().int().min(1),
    payload: z.record(z.string(), z.unknown()),
  }).strict()).min(1).max(50)
    .refine((rows) => new Set(rows.map((row) => row.rowNumber)).size === rows.length),
}).strict();

const processSchema = z.object({
  action: z.literal("process"),
  batchId: z.string().uuid(),
  limit: z.number().int().min(1).max(50).default(50),
}).strict();

const finalizeSchema = z.object({
  action: z.literal("finalize"),
  batchId: z.string().uuid(),
}).strict();

const retrySchema = z.object({
  action: z.literal("retry-failed"),
  batchId: z.string().uuid(),
  limit: z.number().int().min(1).max(50).default(50),
}).strict();

const listRowsSchema = z.object({
  action: z.literal("list-rows"),
  batchId: z.string().uuid(),
  offset: z.number().int().min(0).max(1000).default(0),
  limit: z.number().int().min(1).max(50).default(50),
}).strict();

type StageInput = z.infer<typeof stageSchema>;
type BatchRow = {
  row_number: number;
  payload: Record<string, unknown>;
  idempotency_key: string;
  status: "pending" | "succeeded" | "failed";
};

class InvalidStagedRowsError extends Error {
  constructor(readonly rowNumbers: number[]) {
    super("One or more participant rows need correction");
  }
}

class IssuanceConflictError extends Error {}
class InvalidStageError extends Error {}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function randomSalt(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function parseDate(value: string | undefined, fallback?: string): string | undefined {
  const candidate = value || fallback;
  if (!candidate) return undefined;
  const parsed = new Date(candidate);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Invalid credential date");
  return parsed.toISOString();
}

async function loadBatchForActor(request: Request, batchId: string) {
  const admin = getAdminClient();
  const { data: batch, error } = await admin
    .from("issuance_batches")
    .select("id, organization_id, event_id, achievement_id, options, total, processed_count, succeeded, failed, status")
    .eq("id", batchId)
    .maybeSingle();
  if (error) throw new Error("Could not load issuance batch");
  if (!batch) throw new Error("Issuance batch not found");
  const { userId } = await requireOrganizationRole(
    request,
    batch.organization_id,
    ["owner", "admin", "issuer"],
  );
  return { admin, batch, userId };
}

async function createBatch(request: Request, raw: unknown) {
  const input = createSchema.parse(raw);
  const { client, userId } = await requireOrganizationRole(
    request,
    input.organizationId,
    ["owner", "admin", "issuer"],
  );
  const { data, error } = await client.rpc("create_issuance_batch", {
    p_actor_id: userId,
    p_organization_id: input.organizationId,
    p_event_id: input.eventId,
    p_achievement_id: input.achievementId,
    p_rows_total: input.rowsTotal,
    p_options: input.options,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error?.code === "23505") throw new IssuanceConflictError();
  if (error) throw new Error("Could not create issuance batch", { cause: error });
  return z.object({
    id: z.string().uuid(),
    total: z.number().int(),
    status: z.string(),
  }).parse(data);
}

async function stageRows(request: Request, input: StageInput) {
  const { admin, batch, userId } = await loadBatchForActor(request, input.batchId);
  const normalized = await normalizeStagingRows(batch.id, input.rows);
  if (normalized.invalidRowNumbers.length) {
    throw new InvalidStagedRowsError(normalized.invalidRowNumbers);
  }

  const { data, error } = await admin.rpc("stage_issuance_rows", {
    p_actor_id: userId,
    p_batch_id: batch.id,
    p_rows: normalized.rows.map((row) => ({
      rowNumber: row.rowNumber,
      payload: row.payload,
      idempotencyKey: row.idempotencyKey,
    })),
  });
  if (error) {
    if (error.code === "23505") throw new IssuanceConflictError();
    if (error.code === "22023") throw new InvalidStageError();
    throw new Error("Could not stage issuance rows", { cause: error });
  }
  return { batchId: batch.id, stagedCount: data };
}

async function finalizeBatch(request: Request, batchId: string) {
  const { admin, batch, userId } = await loadBatchForActor(request, batchId);
  const { data, error } = await admin.rpc("finalize_issuance_batch", {
    p_actor_id: userId,
    p_batch_id: batch.id,
  });
  if (error) {
    if (error.code === "P0001") throw new Error(error.message);
    throw new Error("Could not finalize issuance batch");
  }
  return data;
}

function safeFailureCode(error: unknown, payload: Record<string, unknown>): string {
  if (payload.redacted === true) return "recipient_anonymized";
  if (error instanceof z.ZodError) return "invalid_row";
  let cause = error;
  while (cause instanceof Error) {
    if (/duplicate recipient/i.test(cause.message)) return "duplicate_recipient";
    cause = cause.cause;
  }
  return "issuance_failed";
}

function safeStoredErrorCode(value: string | null): string | null {
  if (!value) return null;
  const allowed = new Set([
    "recipient_anonymized",
    "invalid_row",
    "duplicate_recipient",
    "issuance_failed",
  ]);
  return allowed.has(value) ? value : "issuance_failed";
}

async function processBatch(request: Request, batchId: string, limit: number, retryFailed: boolean) {
  const { admin, batch, userId } = await loadBatchForActor(request, batchId);
  if (batch.status === "draft") {
    throw new Error("Draft batch must be staged and finalized before processing");
  }
  if (batch.status === "cancelled") {
    throw new Error("Cancelled issuance batches cannot be processed");
  }
  const { data: rows, error: rowsError } = await admin
    .from("issuance_rows")
    .select("row_number, payload, idempotency_key, status")
    .eq("batch_id", batchId)
    .eq("status", retryFailed ? "failed" : "pending")
    .order("row_number")
    .limit(limit);
  if (rowsError) throw new Error("Could not load issuance rows");

  const results: Array<{
    rowNumber: number;
    status: "succeeded" | "failed";
    errorCode?: string;
  }> = [];

  if (rows?.length) {
    const [{ data: organization, error: organizationError }, { data: achievement, error: achievementError }] =
      await Promise.all([
        admin.from("organizations")
          .select("id, name, website_url, logo_url, did")
          .eq("id", batch.organization_id)
          .single(),
        admin.from("achievements")
          .select("id, name, description, criteria_narrative, image_url")
          .eq("id", batch.achievement_id)
          .eq("organization_id", batch.organization_id)
          .single(),
      ]);
    if (organizationError || achievementError || !organization || !achievement) {
      throw new Error("Could not load issuer or achievement information");
    }
    if (!achievement.criteria_narrative?.trim()) {
      throw new Error("Achievement criteria narrative is required before issuing");
    }

    const signer = new EnvKeySigner();
    const issuerDid = getOrganizationDid();
    const publicSiteUrl = getPublicSiteUrl();
    if (organization.did !== issuerDid) {
      throw new Error("Organization issuer DID does not match PUBLIC_SITE_URL");
    }
    const kid = signer.kid();
    const { data: keyRecord, error: keyError } = await admin
      .from("issuer_keys")
      .select("kid, public_jwk")
      .eq("organization_id", batch.organization_id)
      .eq("kid", kid)
      .eq("status", "active")
      .maybeSingle();
    if (keyError) throw new Error("Could not resolve configured signing key");
    if (!keyRecord) throw new Error("Configured signing key is not registered for this organization");
    const publicJwk = await signer.getPublicJwk();
    const storedJwk = keyRecord.public_jwk as Record<string, unknown>;
    for (const field of ["kty", "crv", "x", "y", "n", "e"]) {
      if (publicJwk[field as keyof typeof publicJwk] !== storedJwk[field]) {
        throw new Error("Configured signing key does not match the registered public key");
      }
    }

    for (const storedRow of rows as BatchRow[]) {
      const payload = storedRow.payload;
      try {
        const input = issuanceRowSchema.parse(payload);
        const emailSalt = randomSalt();
        const emailHash = await hashRecipientEmail(input.email, emailSalt);
        const credentialId = crypto.randomUUID();
        const issuedAt = parseDate(input.issued_on, batch.options.issueDate) ??
          new Date().toISOString();
        const validUntil = parseDate(input.expires_on, batch.options.expiresAt);
        const credential = buildCredential({
          id: credentialId,
          publicSiteUrl,
          issuerName: organization.name,
          issuerUrl: organization.website_url ?? publicSiteUrl,
          ...(organization.logo_url ? { issuerImage: organization.logo_url } : {}),
          validFrom: issuedAt,
          ...(validUntil ? { validUntil } : {}),
          emailHash,
          salt: emailSalt,
          achievement: {
            id: achievement.id,
            name: achievement.name,
            description: achievement.description,
            criteriaNarrative: achievement.criteria_narrative,
            ...(achievement.image_url ? { imageUrl: achievement.image_url } : {}),
          },
        });
        const jws = await signer.sign(credential);
        const contentHash = await sha256(stableJson(credential));
        const { error: persistError } = await admin.rpc("persist_issuance_row", {
          p_actor_id: userId,
          p_batch_id: batchId,
          p_row_number: storedRow.row_number,
          p_payload: input,
          p_idempotency_key: storedRow.idempotency_key,
          p_full_name: input.full_name,
          p_email: input.email,
          p_email_hash: emailHash,
          p_salt: emailSalt,
          p_duplicate_policy: batch.options.duplicatePolicy ?? "skip",
          p_credential_id: credentialId,
          p_issued_at: issuedAt,
          p_expires_at: validUntil ?? null,
          p_visibility: batch.options.visibility ?? "unlisted",
          p_credential_json: credential,
          p_jws: jws,
          p_kid: kid,
          p_content_hash: contentHash,
          p_pdf_path: null,
        });
        if (persistError) {
          throw new Error("Credential persistence failed", { cause: persistError });
        }
        results.push({ rowNumber: storedRow.row_number, status: "succeeded" });
      } catch (error) {
        const errorCode = safeFailureCode(error, payload);
        const { data: current, error: currentError } = await admin
          .from("issuance_rows")
          .select("payload, idempotency_key, status")
          .eq("batch_id", batchId)
          .eq("row_number", storedRow.row_number)
          .single();
        if (currentError || !current) {
          throw new Error("Could not refresh a failed issuance row", { cause: error });
        }
        if (current.status === "succeeded") {
          results.push({ rowNumber: storedRow.row_number, status: "succeeded" });
          continue;
        }
        const { error: failureError } = await admin.rpc("record_issuance_failure", {
          p_actor_id: userId,
          p_batch_id: batchId,
          p_row_number: storedRow.row_number,
          p_payload: current.payload,
          p_idempotency_key: current.idempotency_key,
          p_error: current.payload?.redacted === true ? "recipient_anonymized" : errorCode,
        });
        if (failureError) {
          throw new Error("Could not record an issuance row failure", { cause: error });
        }
        results.push({
          rowNumber: storedRow.row_number,
          status: "failed",
          errorCode: current.payload?.redacted === true ? "recipient_anonymized" : errorCode,
        });
      }
    }
  }

  const { data: refreshed, error: refreshError } = await admin.rpc("refresh_issuance_batch_status", {
    p_actor_id: userId,
    p_batch_id: batchId,
  });
  if (refreshError) throw new Error("Could not update issuance batch progress");
  const state = z.object({
    id: z.string().uuid(),
    status: z.string(),
    total: z.number().int(),
    processed_count: z.number().int(),
    succeeded: z.number().int(),
    failed: z.number().int(),
  }).parse(refreshed);

  return {
    batchId,
    ...state,
    complete: state.status === "completed" || state.status === "completed_with_errors",
    rows: results,
  };
}

async function listRows(request: Request, batchId: string, offset: number, limit: number) {
  const { admin, batch } = await loadBatchForActor(request, batchId);
  const { data: rows, error } = await admin
    .from("issuance_rows")
    .select("row_number, status, last_error, credential_id")
    .eq("batch_id", batchId)
    .order("row_number")
    .range(offset, offset + limit - 1);
  if (error) throw new Error("Could not load batch outcomes");

  const credentialIds = (rows ?? [])
    .map((row) => row.credential_id)
    .filter((id): id is string => Boolean(id));
  const serials = new Map<string, string>();
  if (credentialIds.length) {
    const { data: credentials, error: credentialError } = await admin
      .from("credentials")
      .select("id, serial_number")
      .eq("organization_id", batch.organization_id)
      .in("id", credentialIds);
    if (credentialError) throw new Error("Could not load safe credential references");
    for (const credential of credentials ?? []) {
      serials.set(credential.id, credential.serial_number);
    }
  }

  return {
    batchId,
    offset,
    limit,
    rows: (rows ?? []).map((row) => ({
      rowNumber: row.row_number,
      status: row.status,
      errorCode: safeStoredErrorCode(row.last_error),
      serialNumber: row.credential_id ? serials.get(row.credential_id) ?? null : null,
    })),
  };
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = await readJson(request);
    if (body && typeof body === "object" && "action" in body) {
      if (body.action === "create") {
        return jsonResponse(await createBatch(request, body), 201);
      }
      if (body.action === "stage") {
        return jsonResponse(await stageRows(request, stageSchema.parse(body)));
      }
      if (body.action === "finalize") {
        const input = finalizeSchema.parse(body);
        return jsonResponse(await finalizeBatch(request, input.batchId));
      }
      if (body.action === "process" || body.action === "retry-failed") {
        const input = body.action === "process"
          ? processSchema.parse(body)
          : retrySchema.parse(body);
        return jsonResponse(await processBatch(
          request,
          input.batchId,
          input.limit,
          body.action === "retry-failed",
        ));
      }
      if (body.action === "list-rows") {
        const input = listRowsSchema.parse(body);
        return jsonResponse(await listRows(request, input.batchId, input.offset, input.limit));
      }
    }
    return jsonResponse({ error: "Unsupported issue-batch action" }, 400);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    if (error instanceof InvalidStagedRowsError) {
      return jsonResponse({
        error: error.message,
        rowErrors: error.rowNumbers.map((rowNumber) => ({ rowNumber, code: "invalid_row" })),
      }, 400);
    }
    if (error instanceof IssuanceConflictError) {
      return jsonResponse({
        error: "This row differs from the immutable data already staged. Start a new batch for changed participant data.",
      }, 409);
    }
    if (error instanceof InvalidStageError) {
      return jsonResponse({ error: "The participant staging chunk is invalid." }, 400);
    }
    if (error instanceof z.ZodError) {
      return jsonResponse({ error: "Invalid issuance request" }, 400);
    }
    const message = error instanceof Error ? error.message : "Issuance request failed";
    if (/Authentication required|Invalid authentication token/i.test(message)) {
      return jsonResponse({ error: message }, 401);
    }
    if (/Insufficient organization role/i.test(message)) {
      return jsonResponse({ error: message }, 403);
    }
    if (/not found|does not belong|criteria narrative is required|Unsupported issue-batch action|cancelled issuance batches|draft batch must be staged|all issuance rows must be staged/i.test(message)) {
      return jsonResponse({ error: message }, /not found/i.test(message) ? 404 : 400);
    }
    console.error("issue-batch failed", error);
    return jsonResponse({ error: "Issuance is temporarily unavailable" }, 503);
  }
});
