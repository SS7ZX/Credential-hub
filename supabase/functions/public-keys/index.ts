import { corsHeaders, handleOptions, jsonResponse, rateLimit } from "../_shared/http.ts";
import { toPublicJwk } from "../_shared/jwk.ts";
import { getAdminClient } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    if (!await rateLimit(request, "public-keys")) {
      return jsonResponse({ error: "Too many requests" }, 429);
    }
    const client = getAdminClient();
    const { data, error } = await client
      .from("issuer_keys")
      .select("public_jwk")
      .neq("status", "");
    if (error) throw new Error("Could not load active issuer keys");

    return jsonResponse(
      { keys: (data ?? []).map(({ public_jwk }) => toPublicJwk(public_jwk)) },
      200,
      { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" },
    );
  } catch (error) {
    console.error("public-keys failed", error);
    return jsonResponse({ error: "Public keys are temporarily unavailable" }, 503, corsHeaders);
  }
});
