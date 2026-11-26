import {
  CredentialVerificationError,
  parseVcJwtHeader,
} from "./verify.ts";

function encodeJson(value: unknown): string {
  return btoa(JSON.stringify(value))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function jwsHeader(header: Record<string, unknown>): string {
  return `${encodeJson(header)}.${encodeJson({})}.AA`;
}

Deno.test("parseVcJwtHeader accepts a conforming VC-JWT header", () => {
  const header = parseVcJwtHeader(jwsHeader({
    alg: "EdDSA",
    kid: "issuer-2026-01",
    typ: "vc+jwt",
    cty: "vc",
  }));
  if (header.alg !== "EdDSA" || header.kid !== "issuer-2026-01") {
    throw new Error("VC-JWT protected header was not parsed");
  }
});

Deno.test("parseVcJwtHeader rejects missing content type and unsupported algorithms", () => {
  for (const header of [
    { alg: "EdDSA", kid: "key", typ: "vc+jwt" },
    { alg: "none", kid: "key", typ: "vc+jwt", cty: "vc" },
  ]) {
    try {
      parseVcJwtHeader(jwsHeader(header));
    } catch (error) {
      if (error instanceof CredentialVerificationError) continue;
      throw error;
    }
    throw new Error("Non-conforming VC-JWT header was accepted");
  }
});

Deno.test("parseVcJwtHeader rejects malformed encoded headers", () => {
  try {
    parseVcJwtHeader("not-json.eyJ2YyI6e30f.AA");
  } catch (error) {
    if (error instanceof CredentialVerificationError) return;
    throw error;
  }
  throw new Error("Malformed VC-JWT header was accepted");
});
