import { corsHeaders, handleOptions, jsonResponse, rateLimit } from "../_shared/http.ts";
import { toPublicJwk } from "../_shared/jwk.ts";
import { getOrganizationDid } from "../_shared/site-config.ts";
import { getAdminClient } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    if (!await rateLimit(request, "did-document")) {
      return jsonResponse({ error: "Too many requests" }, 429);
    }
    const did = getOrganizationDid();
    const client = getAdminClient();
    const { data, error } = await client
      .from("issuer_keys")
      .select("kid, public_jwk")
      .neq("status", "");
    if (error) throw new Error("Could not load active issuer keys");

    const verificationMethod = (data ?? []).map(({ kid, public_jwk }) => ({
      id: `${did}#${kid}`,
      type: "JsonWebKey2020",
      controller: did,
      publicKeyJwk: toPublicJwk(public_jwk),
    }));

    return jsonResponse(
      {
        "@context": ["https://www.w3.org/ns/did/v1"],
        id: did,
        verificationMethod,
        assertionMethod: verificationMethod.map(({ id }) => id),
      },
      200,
      { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" },
    );
  } catch (error) {
    console.error("did-document failed", error);
    return jsonResponse({ error: "DID document is temporarily unavailable" }, 503, corsHeaders);
  }
});
