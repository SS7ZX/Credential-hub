import type { JWK } from "npm:jose@6";

const publicJwkFields = [
  "kty",
  "crv",
  "x",
  "y",
  "n",
  "e",
  "alg",
  "use",
  "kid",
  "key_ops",
  "ext",
] as const;

export function toPublicJwk(value: unknown): JWK {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Issuer public key is malformed");
  }
  const candidate = value as Record<string, unknown>;
  const publicJwk = Object.fromEntries(
    publicJwkFields
      .filter((field) => field in candidate)
      .map((field) => [field, candidate[field]]),
  ) as JWK;
  if (typeof publicJwk.kty !== "string" || typeof publicJwk.kid !== "string") {
    throw new Error("Issuer public key is incomplete");
  }
  return publicJwk;
}
