import { fetchIssuerDiscovery } from "./_shared/issuer-discovery-proxy.ts";

Deno.test("well-known proxy calls only the matching Supabase public function", async () => {
  const requested: { url?: URL; apikey?: string } = {};
  const response = await fetchIssuerDiscovery(
    "did",
    {
      SUPABASE_URL: "https://project.example.supabase.co/",
      SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
    },
    async (input, init) => {
      requested.url = new URL(String(input));
      requested.apikey = new Headers(init?.headers).get("apikey") ?? undefined;
      return Response.json({ id: "did:web:issuer.example" }, {
        headers: { "Cache-Control": "public, max-age=300" },
      });
    },
  );

  if (requested.url?.href !== "https://project.example.supabase.co/functions/v1/did-document") {
    throw new Error("DID well-known route did not call the did-document function");
  }
  if (requested.apikey !== "publishable-test-key") {
    throw new Error("DID well-known proxy omitted the public API key");
  }
  if (response.status !== 200 || response.headers.get("Cache-Control") !== "public, max-age=300") {
    throw new Error("DID well-known proxy did not preserve the public response");
  }
});

Deno.test("well-known proxy rejects non-HTTPS upstreams except loopback", async () => {
  let fetchCalled = false;
  const response = await fetchIssuerDiscovery(
    "jwks",
    { SUPABASE_URL: "http://attacker.example", SUPABASE_ANON_KEY: "public-test-key" },
    async () => {
      fetchCalled = true;
      return Response.json({});
    },
  );
  if (fetchCalled || response.status !== 503) {
    throw new Error("Non-HTTPS Supabase destination was not rejected before fetch");
  }
});

Deno.test("Vercel routes well-known DID and JWKS URLs to the tested proxy", async () => {
  const config = JSON.parse(await Deno.readTextFile(new URL("../vercel.json", import.meta.url)));
  const rewrites = config.rewrites as Array<{ source: string; destination: string }>;
  const required = new Map([
    ["/.well-known/did.json", "/api/issuer-discovery?document=did"],
    ["/.well-known/jwks.json", "/api/issuer-discovery?document=jwks"],
  ]);
  for (const [source, destination] of required) {
    if (!rewrites.some((rewrite) => rewrite.source === source && rewrite.destination === destination)) {
      throw new Error(`Missing Vercel discovery rewrite for ${source}`);
    }
  }
});
