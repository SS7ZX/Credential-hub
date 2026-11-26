import { corsHeadersForFunction, handleOptions, jsonResponse, rateLimit } from "../_shared/http.ts";
import { buildJwks } from "../_shared/issuer-discovery.ts";
import { getAdminClient } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  const responseCorsHeaders = corsHeadersForFunction("public-keys");
  const options = handleOptions(request, responseCorsHeaders);
  if (options) return options;
  if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405, responseCorsHeaders);

  try {
    if (!await rateLimit(request, "public-keys")) {
      return jsonResponse({ error: "Too many requests" }, 429, responseCorsHeaders);
    }
    const client = getAdminClient();
    const { data, error } = await client
      .from("issuer_keys")
      .select("kid, public_jwk, status")
      .in("status", ["active", "retired"]);
    if (error) throw new Error("Could not load published issuer keys");

    return jsonResponse(
      buildJwks(data ?? []),
      200,
      { ...responseCorsHeaders, "Cache-Control": "public, max-age=300, stale-while-revalidate=600" },
    );
  } catch (error) {
    console.error("public-keys failed", error);
    return jsonResponse({ error: "Public keys are temporarily unavailable" }, 503, responseCorsHeaders);
  }
});
