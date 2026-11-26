import { buildDidDocument, buildJwks, type PublishedIssuerKeyRow } from "./issuer-discovery.ts";

Deno.test("DID document and JWKS match issuer_keys, including retired verification keys", () => {
  const issuerKeys: PublishedIssuerKeyRow[] = [
    {
      kid: "active-2026",
      status: "active",
      public_jwk: { kty: "OKP", crv: "Ed25519", x: "active-public-key" },
    },
    {
      kid: "retired-2025",
      status: "retired",
      public_jwk: { kty: "OKP", crv: "Ed25519", x: "retired-public-key" },
    },
    {
      kid: "invalid-status",
      status: "disabled",
      public_jwk: { kty: "OKP", crv: "Ed25519", x: "not-published" },
    },
  ];

  const did = buildDidDocument("did:web:issuer.example", issuerKeys);
  const jwks = buildJwks(issuerKeys);
  const didKeys = did.verificationMethod.map(({ id, publicKeyJwk }) => ({
    kid: id.split("#").at(-1),
    jwk: publicKeyJwk,
  }));

  if (didKeys.length !== 2 || jwks.keys.length !== 2) {
    throw new Error("Only active and retired issuer keys should be published");
  }
  for (const { kid, jwk } of jwks.keys.map((jwk) => ({ kid: jwk.kid, jwk }))) {
    const didKey = didKeys.find((entry) => entry.kid === kid);
    if (!didKey || JSON.stringify(didKey.jwk) !== JSON.stringify(jwk)) {
      throw new Error(`DID document and JWKS disagree for issuer key ${kid}`);
    }
  }
  if (!jwks.keys.some(({ kid }) => kid === "retired-2025")) {
    throw new Error("Retired issuer keys must remain published for old credentials");
  }
});
