import { z } from "npm:zod@4";
import { buildCredential, hashRecipientEmail } from "../_shared/credential.ts";
import {
  handleOptions,
  jsonResponse,
  readJson,
  RequestBodyError,
} from "../_shared/http.ts";
import { EnvKeySigner } from "../_shared/signer.ts";
import { getAdminClient, requireOrganizationRole } from "../_shared/supabase.ts";

const rowSchema = z.object({
  full_name: z.string().trim().min(1).max(200)
    .transform((value) => value.replace(/\s+/g, " ")),
  email: z.string().trim().email().max(320)
    .transform((value) => value.toLowerCase()),
  category: z.string().trim().max(100).optional(),
  issued_on: z.string().trim().optional(),
  expires_on: z.string().trim().optional(),
  public_name_consent: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    return ["true", "yes", "1"].includes(value.trim().toLowerCase());
  }, z.boolean().optional()),
}).strict();

const createSchema = z.object({
  action: z.literal("create"),
  organizationId: z.string().uuid(),
  eventId: z.string().uuid(),
  achievementId: z.string().uuid(),
  sourceFilename: z.string().trim().max(255).optional(),
  rowsTotal: z.number().int().min(1).max(1000),
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

const processSchema = z.object({
  action: z.literal("process"),
  batchId: z.string().uuid(),
  rows: z.array(z.object({
    rowNumber: z.number().int().min(1),
    payload: z.record(z.string(), z.unknown()),
  }).strict()).min(1).max(50),
}).strict();

const retrySchema = z.object({
  action: z.literal("retry-failed"),
  batchId: z.string().uuid(),
  limit: z.number().int().min(1).max(50).default(50),
}).strict();

type RawRow = z.infer<typeof processSchema>["rows"][number];

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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

async function createBatch(request: Request, raw: unknown) {
  const input = createSchema.parse(raw);
  const { client, userId } = await requireOrganizationRole(
    request,
    input.organizationId,
    ["owner", "admin", "issuer"],
  );
  const { data: achievement, error: achievementError } = await client
    .from("achievements")
    .select("id, event_id")
    .eq("id", input.achievementId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (achievementError) throw new Error("Could not validate achievement");
  if (!achievement) throw new Error("Achievement not found in this organization");
  if (achievement.event_id && achievement.event_id !== input.eventId) {
    throw new Error("Achievement does not belong to this event");
  }

  const { data: batch, error } = await client
    .from("issuance_batches")
    .insert({
      organization_id: input.organizationId,
      event_id: input.eventId,
      achievement_id: input.achievementId,
      created_by: userId,
      source_filename: input.sourceFilename ?? null,
      total: input.rowsTotal,
      options: input.options,
      status: "draft",
    })
    .select("id, total, status")
    .single();
  if (error || !batch) throw new Error("Could not create issuance batch");
  return batch;
}

async function processRows(request: Request, batchId: string, rows: RawRow[]) {
  const admin = getAdminClient();
  const { data: batchAccess, error: accessError } = await admin
    .from("issuance_batches")
    .select("organization_id")
    .eq("id", batchId)
    .maybeSingle();
  if (accessError) throw new Error("Could not authorize issuance batch");
  if (!batchAccess) throw new Error("Issuance batch not found");

  const { userId } = await requireOrganizationRole(
    request,
    batchAccess.organization_id,
    ["owner", "admin", "issuer"],
  );

  const { data: batch, error: batchError } = await admin
    .from("issuance_batches")
    .select("id, organization_id, achievement_id, options, total, status")
    .eq("id", batchId)
    .single();
  if (batchError) throw new Error("Could not load authorized issuance batch");

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

  const results: Array<{ rowNumber: number; status: "issued" | "skipped" | "failed"; error?: string }> = [];
  for (const entry of rows) {
    const payload = entry.payload;
    const idempotencyKey = await sha256(`${batchId}:${entry.rowNumber}:${stableJson(payload)}`);
    try {
      const input = rowSchema.parse(payload);
      const emailSalt = randomSalt();
      const emailHash = await hashRecipientEmail(input.email, emailSalt);
      const credentialId = crypto.randomUUID();
      const issuedAt = parseDate(input.issued_on, batch.options.issueDate) ?? new Date().toISOString();
      const validUntil = parseDate(input.expires_on, batch.options.expiresAt);
      const credential = buildCredential({
        id: credentialId,
        issuerDid: organization.did as "did:web:tasdiqapp.com",
        issuerName: organization.name,
        issuerUrl: organization.website_url ?? "https://tasdiqapp.com",
        ...(organization.logo_url ? { issuerImage: organization.logo_url } : {}),
        validFrom: issuedAt,
        ...(validUntil ? { validUntil } : {}),
        displayName: input.full_name,
        publicNameConsent: input.public_name_consent ?? false,
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
      const { data: persisted, error: persistError } = await admin.rpc("persist_issuance_row", {
        p_actor_id: userId,
        p_batch_id: batchId,
        p_row_number: entry.rowNumber,
        p_payload: payload,
        p_idempotency_key: idempotencyKey,
        p_full_name: input.full_name,
        p_email: input.email,
        p_email_hash: emailHash,
        p_salt: emailSalt,
        p_public_name_consent: input.public_name_consent ?? false,
        p_duplicate_policy: (batch.options.duplicatePolicy ?? "skip") as string,
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
      if (persistError) throw new Error("Credential persistence failed", { cause: persistError });
      const outcome = (persisted as { outcome?: string } | null)?.outcome;
      results.push({
        rowNumber: entry.rowNumber,
        status: outcome === "skipped" || outcome === "replayed" ? "skipped" : "issued",
      });
    } catch (error) {
      const reason = error instanceof z.ZodError
        ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        : error instanceof Error ? error.message : "Row processing failed";
      const { error: failureError } = await admin.rpc("record_issuance_failure", {
        p_actor_id: userId,
        p_batch_id: batchId,
        p_row_number: entry.rowNumber,
        p_payload: payload,
        p_idempotency_key: idempotencyKey,
        p_error: reason,
      });
      if (failureError) {
        throw new Error(
          `Could not record an issuance row failure: ${failureError.message}`,
          { cause: error },
        );
      }
      results.push({ rowNumber: entry.rowNumber, status: "failed", error: reason });
    }
  }

  const { data: counts, error: countsError } = await admin
    .from("issuance_batches")
    .select("total, processed_count, succeeded, failed")
    .eq("id", batchId)
    .single();
  if (countsError || !counts) throw new Error("Could not load batch progress");

  const complete = counts.processed_count >= counts.total;
  const { error: updateError } = await admin
    .from("issuance_batches")
    .update({
      status: complete
        ? counts.failed > 0 ? "completed_with_errors" : "completed"
        : "processing",
      ...(complete ? { completed_at: new Date().toISOString() } : { started_at: new Date().toISOString() }),
    })
    .eq("id", batchId);
  if (updateError) throw new Error("Could not update batch progress");

  return { batchId, ...counts, complete, rows: results };
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = await readJson(request);
    if (body && typeof body === "object" && "action" in body && body.action === "create") {
      return jsonResponse(await createBatch(request, body), 201);
    }
    if (body && typeof body === "object" && "action" in body && body.action === "process") {
      const input = processSchema.parse(body);
      return jsonResponse(await processRows(request, input.batchId, input.rows));
    }
    if (body && typeof body === "object" && "action" in body && body.action === "retry-failed") {
      const input = retrySchema.parse(body);
      const admin = getAdminClient();
      const { data: batch, error: batchError } = await admin
        .from("issuance_batches")
        .select("organization_id")
        .eq("id", input.batchId)
        .maybeSingle();
      if (batchError) throw new Error("Could not authorize issuance batch");
      if (!batch) throw new Error("Issuance batch not found");
      await requireOrganizationRole(request, batch.organization_id, ["owner", "admin", "issuer"]);

      const { data: failedRows, error } = await admin
        .from("issuance_rows")
        .select("row_number, payload")
        .eq("batch_id", input.batchId)
        .eq("status", "failed")
        .order("row_number")
        .limit(input.limit);
      if (error) throw new Error("Could not load failed issuance rows");
      if (!failedRows?.length) {
        return jsonResponse({ batchId: input.batchId, complete: true, rows: [] });
      }
      const rows = failedRows.map((row) => ({
        rowNumber: row.row_number,
        payload: row.payload as Record<string, unknown>,
      }));
      return jsonResponse(await processRows(request, input.batchId, rows));
    }
    return jsonResponse({ error: "Unsupported issue-batch action" }, 400);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    if (error instanceof z.ZodError) {
      return jsonResponse({ error: "Invalid issuance request", issues: error.issues }, 400);
    }
    const message = error instanceof Error ? error.message : "Issuance request failed";
    if (/Authentication required|Invalid authentication token/i.test(message)) {
      return jsonResponse({ error: message }, 401);
    }
    if (/Insufficient organization role/i.test(message)) {
      return jsonResponse({ error: message }, 403);
    }
    if (/not found|does not belong|criteria narrative is required|Unsupported issue-batch action/i.test(message)) {
      return jsonResponse({ error: message }, /not found/i.test(message) ? 404 : 400);
    }
    console.error("issue-batch failed", error);
    return jsonResponse({ error: "Issuance is temporarily unavailable" }, 503);
  }
});
