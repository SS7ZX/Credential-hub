import { z } from "npm:zod@4";
import {
  handleOptions,
  jsonResponse,
  rateLimit,
  readJson,
  RequestBodyError,
} from "../_shared/http.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { consentedRecipientName } from "../_shared/credential.ts";

const inputSchema = z.object({
  id: z.string().uuid(),
  format: z.enum(["json", "jwt"]).default("json"),
}).strict();

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
      .select("id, organization_id, status, visibility, issued_at, expires_at, credential_json, jws, recipients(public_name_consent)")
      .eq("id", input.id)
      .maybeSingle();
    if (error) throw new Error("Could not load credential");
    if (!data || data.status === "draft") return jsonResponse({ error: "Credential not found" }, 404);
    if (data.visibility !== "public" && data.visibility !== "unlisted") {
      return jsonResponse({ error: "Credential not found" }, 404);
    }

    const storedCredential = data.credential_json as Record<string, unknown> | null;
    if (!storedCredential && data.status === "revoked") {
      return jsonResponse({
        revoked: true,
        credential: {
          id: `https://tasdiqapp.com/credentials/${data.id}`,
          type: ["VerifiableCredential", "OpenBadgeCredential"],
        },
      });
    }

    if (input.format === "jwt") {
      if (!data.jws) return jsonResponse({ error: "Credential JWT is unavailable" }, 404);
      return new Response(data.jws, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/vc+jwt",
          "Cache-Control": "no-store",
        },
      });
    }

    if (!storedCredential) return jsonResponse({ error: "Credential data is unavailable" }, 404);
    const storedSubject = storedCredential.credentialSubject as Record<string, unknown> | undefined;
    const recipient = Array.isArray(data.recipients) ? data.recipients[0] : data.recipients;
    const identifier = storedSubject?.identifier;
    const identity = Array.isArray(identifier) ? identifier[0] : identifier;
    const achievement = storedSubject?.achievement as Record<string, unknown> | undefined;
    const publicName = consentedRecipientName(
      storedSubject?.name,
      recipient?.public_name_consent === true,
    );
    const publicSubject = {
      ...(storedSubject?.type ? { type: storedSubject.type } : {}),
      ...(identity && typeof identity === "object"
        ? {
          identifier: {
            type: "IdentityObject",
            hashed: true,
            identityHash: (identity as Record<string, unknown>).identityHash,
            identityType: (identity as Record<string, unknown>).identityType,
            salt: (identity as Record<string, unknown>).salt,
          },
        }
        : {}),
      ...(achievement ? { achievement } : {}),
      ...(publicName ? { name: publicName } : {}),
    };
    const credential = Object.fromEntries(
      ["@context", "id", "type", "issuer", "validFrom", "validUntil", "name", "description", "image"]
        .filter((key) => key in storedCredential)
        .map((key) => [key, storedCredential[key]]),
    );
    credential.credentialSubject = publicSubject;
    return jsonResponse({ credential });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    if (error instanceof z.ZodError) return jsonResponse({ error: "Invalid request" }, 400);
    console.error("get-credential failed", error);
    return jsonResponse({ error: "Credential is temporarily unavailable" }, 503);
  }
});
