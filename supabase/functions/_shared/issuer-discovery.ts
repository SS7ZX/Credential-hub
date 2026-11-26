import { toPublicJwk } from "./jwk.ts";

export type PublishedIssuerKeyRow = {
  kid: string;
  public_jwk: unknown;
  status: string;
};

const PUBLISHED_STATUSES = new Set(["active", "retired"]);

function getPublishedKeys(rows: PublishedIssuerKeyRow[]) {
  return rows
    .filter(({ status }) => PUBLISHED_STATUSES.has(status))
    .map(({ kid, public_jwk }) => {
      const jwk = toPublicJwk({ ...(public_jwk as Record<string, unknown>), kid });
      return { kid, jwk };
    });
}

export function buildDidDocument(did: string, rows: PublishedIssuerKeyRow[]) {
  const keys = getPublishedKeys(rows);
  const verificationMethod = keys.map(({ kid, jwk }) => ({
    id: `${did}#${kid}`,
    type: "JsonWebKey2020",
    controller: did,
    publicKeyJwk: jwk,
  }));
  return {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: did,
    verificationMethod,
    assertionMethod: verificationMethod.map(({ id }) => id),
  };
}

export function buildJwks(rows: PublishedIssuerKeyRow[]) {
  return { keys: getPublishedKeys(rows).map(({ jwk }) => jwk) };
}
