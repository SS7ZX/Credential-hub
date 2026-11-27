import { exportJWK, generateKeyPair, SignJWT } from "npm:jose@6";
import {
  CredentialVerificationError,
  parseVcJwtHeader,
  requireKnownSigningKey,
  verifyCredentialProof,
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

Deno.test("missing key lookup rejects an unknown VC-JWT kid", () => {
  try {
    requireKnownSigningKey(null);
  } catch (error) {
    if (error instanceof CredentialVerificationError && error.message === "Unknown signing key") return;
    throw error;
  }
  throw new Error("Unknown signing key was accepted");
});

Deno.test("verifyCredentialProof accepts valid signatures and rejects tampered VC-JWTs", async () => {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA");
  const publicJwk = await exportJWK(publicKey);
  const signed = await new SignJWT({ sub: "https://credential.example/credentials/test" })
    .setProtectedHeader({ alg: "EdDSA", kid: "test-key", typ: "vc+jwt", cty: "vc" })
    .setIssuedAt()
    .sign(privateKey);

  const verified = await verifyCredentialProof(signed, publicJwk, "EdDSA", "test-key");
  if (verified.protectedHeader.kid !== "test-key") {
    throw new Error("Valid VC-JWT signature did not verify");
  }

  const [header, payload, signature] = signed.split(".");
  const changedSignature = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
  try {
    await verifyCredentialProof(`${header}.${payload}.${changedSignature}`, publicJwk, "EdDSA", "test-key");
  } catch (error) {
    if (error instanceof CredentialVerificationError && error.message === "Credential signature is invalid") return;
    throw error;
  }
  throw new Error("Tampered VC-JWT signature was accepted");
});
