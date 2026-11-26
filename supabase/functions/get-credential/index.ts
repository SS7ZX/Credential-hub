import { z } from "npm:zod@4";
import {
  corsHeaders,
  handleOptions,
  jsonResponse,
  rateLimit,
  readJson,
  RequestBodyError,
} from "../_shared/http.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { buildPublicCredential } from "../_shared/public-credential.ts";
import { getPublicSiteUrl } from "../_shared/site-config.ts";

const inputSchema = z.object({
  id: z.string().uuid(),
  format: z.enum(["json", "jwt"]).default("json"),
}).strict();

const nameConsentSchema = z.object({
  fullName: z.string().nullable(),
  maskedNameConsent: z.boolean(),
  fullNameConsent: z.boolean(),
}).strict();

function publicJsonResponse(body: unknown, status = 200): Response {
  return jsonResponse(body, status, { "Cache-Control": "no-store" });
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    if (!await rateLimit(request, "get-credential")) {
      return jsonResponse({ error: "Too many requests" }, 429);
    }
    const input = inputSchema.parse(await readJson(request));
    const client = getAdminClient();
    const { data, error } = await client
      .from("credentials")
      .select("id, organization_id, status, visibility, issued_at, expires_at, credential_json, jws")
      .eq("id", input.id)
      .maybeSingle();
    if (error) throw new Error("Could not load credential");
    if (!data || data.status === "draft") return publicJsonResponse({ error: "Credential not found" }, 404);
    if (data.visibility !== "public" && data.visibility !== "unlisted") {
      return publicJsonResponse({ error: "Credential not found" }, 404);
    }

    const storedCredential = data.credential_json as Record<string, unknown> | null;
    if (!storedCredential && data.status === "revoked") {
      return publicJsonResponse({
        revoked: true,
        credential: {
          id: `${getPublicSiteUrl()}/credentials/${data.id}`,
          type: ["VerifiableCredential", "OpenBadgeCredential"],
        },
      });
    }

    if (input.format === "jwt") {
      if (!data.jws) return publicJsonResponse({ error: "Credential JWT is unavailable" }, 404);
      return new Response(data.jws, {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/vc+jwt",
          "Cache-Control": "no-store",
        },
      });
    }

    if (!storedCredential) return publicJsonResponse({ error: "Credential data is unavailable" }, 404);
    const { data: nameConsentData, error: nameConsentError } = await client.rpc(
      "get_credential_name_consent",
      { p_credential_id: input.id },
    );
    if (nameConsentError) throw new Error("Could not load recipient name consent");
    const nameConsent = nameConsentSchema.parse(nameConsentData);
    const credential = buildPublicCredential(storedCredential, nameConsent);
    return publicJsonResponse({ credential });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    if (error instanceof z.ZodError) return jsonResponse({ error: "Invalid request" }, 400);
    console.error("get-credential failed", error);
    return jsonResponse({ error: "Credential is temporarily unavailable" }, 503);
  }
});
