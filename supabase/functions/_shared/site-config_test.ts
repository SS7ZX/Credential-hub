import { getOrganizationDid, getPublicSiteUrl } from "./site-config.ts";

Deno.test("public site origin is the sole source for the issuer DID", () => {
  const siteUrl = getPublicSiteUrl("https://issuer.example.test/");
  if (siteUrl !== "https://issuer.example.test") {
    throw new Error(`Unexpected public site origin: ${siteUrl}`);
  }
  if (getOrganizationDid(siteUrl) !== "did:web:issuer.example.test") {
    throw new Error("Issuer DID was not derived from the configured site origin");
  }
});

Deno.test("public site URL rejects non-HTTPS non-loopback origins", () => {
  try {
    getPublicSiteUrl("http://example.test");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PUBLIC_SITE_URL must be an HTTPS origin")) {
      return;
    }
    throw error;
  }
  throw new Error("Insecure public site origin was accepted");
});
