import { z } from "npm:zod@4";
import {
  handleOptions,
  jsonResponse,
  rateLimit,
  readJson,
  RequestBodyError,
} from "../_shared/http.ts";
import {
  CredentialVerificationError,
  verifyCredentialJwt,
} from "../_shared/verify.ts";
import { getPublicSiteUrl } from "../_shared/site-config.ts";

const inputSchema = z.object({
  id: z.string().uuid().optional(),
  jws: z.string().max(1_000_000).optional(),
  url: z.url().optional(),
}).strict().refine((value) => [value.id, value.jws, value.url].filter(Boolean).length === 1);

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    if (!await rateLimit(request, "verify-credential")) {
      return jsonResponse({ error: "Too many requests" }, 429);
    }
    const input = inputSchema.parse(await readJson(request));
    let jws = input.jws;
    let credentialId = input.id;

    if (input.url) {
      const url = new URL(input.url);
      if (url.origin !== getPublicSiteUrl()) {
        return jsonResponse({ error: "Only configured verification URLs are accepted" }, 400);
      }
      const match = url.pathname.match(/^\/verify\/([0-9a-f-]{36})$/i);
      if (!match) return jsonResponse({ error: "Unsupported verification URL" }, 400);
      credentialId = match[1];
    }

    if (!jws && credentialId) {
      const { getAdminClient } = await import("../_shared/supabase.ts");
      const client = getAdminClient();
      const { data, error } = await client
        .from("credentials")
        .select("jws, status")
        .eq("id", credentialId)
        .maybeSingle();
      if (error) throw new Error("Could not load credential");
      if (!data) return jsonResponse({ error: "Credential not found" }, 404);
      if (!data.jws && data.status === "revoked") {
        return jsonResponse({
          valid: false,
          checks: [
            { name: "registered", passed: true, detail: "Credential ID is registered" },
            { name: "revocation", passed: false, detail: "Credential has been revoked and its recipient data was deleted" },
          ],
          summary: "Credential was revoked; recipient data has been deleted",
          credential: { id: `${getPublicSiteUrl()}/credentials/${credentialId}` },
        });
      }
      if (!data.jws) return jsonResponse({ error: "Credential data is unavailable" }, 404);
      jws = data.jws;
    }

    if (!jws) return jsonResponse({ error: "Credential JWS is required" }, 400);
    const { credential, checks } = await verifyCredentialJwt(jws);
    const valid = checks.every((check) => check.passed);
    const subject = credential.credentialSubject as Record<string, unknown> | undefined;
    const achievement = subject?.achievement as Record<string, unknown> | undefined;
    const summary = valid
      ? "Credential is valid"
      : checks.find((check) => !check.passed)?.detail ?? "Credential is invalid";

    return jsonResponse({
      valid,
      checks,
      summary,
      credential: {
        id: credential.id,
        issuer: credential.issuer,
        validFrom: credential.validFrom,
        validUntil: credential.validUntil,
        achievement: achievement
          ? { name: achievement.name, description: achievement.description, image: achievement.image }
          : null,
      },
    });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    if (error instanceof z.ZodError) return jsonResponse({ error: "Invalid verification input" }, 400);
    if (error instanceof CredentialVerificationError) {
      return jsonResponse({
        valid: false,
        checks: [{ name: "credential", passed: false, detail: error.message }],
        summary: "Credential could not be verified",
      });
    }
    console.error("verify-credential failed", error);
    return jsonResponse({ error: "Verification is temporarily unavailable" }, 503);
  }
});
