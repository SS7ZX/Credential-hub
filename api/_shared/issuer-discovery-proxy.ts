export type DiscoveryDocument = "did" | "jwks";

export type DiscoveryEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
};

export async function fetchIssuerDiscovery(
  document: DiscoveryDocument,
  environment: DiscoveryEnvironment,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const supabaseUrl = environment.SUPABASE_URL;
  const apiKey = environment.SUPABASE_PUBLISHABLE_KEY ?? environment.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !apiKey) {
    return Response.json({ error: "Issuer discovery is not configured" }, { status: 503 });
  }

  let endpoint: URL;
  try {
    endpoint = new URL(supabaseUrl);
  } catch {
    return Response.json({ error: "Issuer discovery is not configured" }, { status: 503 });
  }
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname);
  if (
    (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && isLoopback))
    || endpoint.username
    || endpoint.password
  ) {
    return Response.json({ error: "Issuer discovery is not configured" }, { status: 503 });
  }

  endpoint.pathname = `/functions/v1/${document === "did" ? "did-document" : "public-keys"}`;
  endpoint.search = "";
  endpoint.hash = "";

  let upstream: Response;
  try {
    upstream = await fetcher(endpoint, {
      method: "GET",
      headers: { apikey: apiKey, accept: "application/json" },
    });
  } catch {
    return Response.json({ error: "Issuer discovery is temporarily unavailable" }, { status: 502 });
  }

  const body = await upstream.text();
  if (body.length > 128_000) {
    return Response.json({ error: "Issuer discovery response is too large" }, { status: 502 });
  }
  return new Response(body, {
    status: upstream.status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": upstream.headers.get("Cache-Control") ?? "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
