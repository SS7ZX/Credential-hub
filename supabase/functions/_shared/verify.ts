import {
  importJWK,
  jwtVerify,
  type JWK,
  type JWTVerifyResult,
} from "npm:jose@6";
import { z } from "npm:zod@4";
import { getAdminClient } from "./supabase.ts";
import { validateCredential } from "./credential.ts";
import { getOrganizationDid, getPublicSiteUrl } from "./site-config.ts";

const compactJwsSchema = z.string()
  .min(20)
  .max(1_000_000)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

const supportedAlgorithms = ["EdDSA", "ES256", "RS256"] as const;

export class CredentialVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialVerificationError";
  }
}

export type VerificationCheck = { name: string; passed: boolean; detail: string };

export function requireKnownSigningKey<T>(keyRecord: T | null): T {
  if (keyRecord === null) throw new CredentialVerificationError("Unknown signing key");
  return keyRecord;
}

export function parseVcJwtHeader(jwsInput: string): {
  alg: typeof supportedAlgorithms[number];
  kid: string;
} {
  const parsed = compactJwsSchema.safeParse(jwsInput);
  if (!parsed.success) {
    throw new CredentialVerificationError("Credential is not a valid compact VC-JWT");
  }

  const encodedHeader = parsed.data.split(".", 1)[0];
  let header: unknown;
  try {
    const base64 = encodedHeader.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
    header = JSON.parse(decoded);
  } catch {
    throw new CredentialVerificationError("VC-JWT protected header is malformed");
  }

  if (!header || typeof header !== "object") {
    throw new CredentialVerificationError("VC-JWT protected header is malformed");
  }
  const record = header as Record<string, unknown>;
  if (
    record.typ !== "vc+jwt" ||
    record.cty !== "vc" ||
    typeof record.kid !== "string" ||
    !supportedAlgorithms.includes(record.alg as typeof supportedAlgorithms[number])
  ) {
    throw new CredentialVerificationError("Unsupported VC-JWT protected header");
  }
  return { alg: record.alg as typeof supportedAlgorithms[number], kid: record.kid };
}

export async function verifyCredentialProof(
  jws: string,
  jwk: JWK,
  algorithm: typeof supportedAlgorithms[number],
  expectedKid: string,
): Promise<JWTVerifyResult> {
  const key = await importJWK(jwk, algorithm);
  let result: JWTVerifyResult;
  try {
    result = await jwtVerify(jws, key, { algorithms: [algorithm] });
  } catch {
    throw new CredentialVerificationError("Credential signature is invalid");
  }
  if (result.protectedHeader.typ !== "vc+jwt" || result.protectedHeader.kid !== expectedKid) {
    throw new CredentialVerificationError("Invalid VC-JWT protected header");
  }
  return result;
}

export async function verifyCredentialJwt(jwsInput: string): Promise<{
  credential: Record<string, unknown>;
  checks: VerificationCheck[];
  result: JWTVerifyResult;
}> {
  const jws = compactJwsSchema.parse(jwsInput);
  const header = parseVcJwtHeader(jws);

  const client = getAdminClient();
  const { data: keyRecord, error: keyError } = await client
    .from("issuer_keys")
    .select("algorithm, public_jwk, status, organization_id")
    .eq("kid", header.kid)
    .maybeSingle();
  if (keyError) throw new Error("Could not resolve credential signing key");
  const knownKey = requireKnownSigningKey(keyRecord);
  if (knownKey.algorithm !== header.alg) {
    throw new CredentialVerificationError("Signing algorithm does not match key record");
  }
  if (!supportedAlgorithms.includes(knownKey.algorithm as typeof supportedAlgorithms[number])) {
    throw new Error("Issuer key has an unsupported signing algorithm");
  }

  const result = await verifyCredentialProof(
    jws,
    knownKey.public_jwk as JWK,
    knownKey.algorithm,
    header.kid,
  );

  const credential = result.payload as Record<string, unknown>;
  try {
    validateCredential(credential);
  } catch {
    throw new CredentialVerificationError("Credential does not match the Open Badges 3.0 schema");
  }
  const expectedIssuerDid = getOrganizationDid();
  if (credential.issuer && typeof credential.issuer === "object") {
    const issuerId = (credential.issuer as Record<string, unknown>).id;
    if (issuerId !== expectedIssuerDid) {
      throw new CredentialVerificationError("Credential issuer is not trusted");
    }
  } else if (credential.issuer !== expectedIssuerDid) {
    throw new CredentialVerificationError("Credential issuer is not trusted");
  }

  const now = Date.now();
  const validFrom = typeof credential.validFrom === "string" ? Date.parse(credential.validFrom) : NaN;
  const validUntil = typeof credential.validUntil === "string" ? Date.parse(credential.validUntil) : null;
  const credentialId = typeof credential.id === "string" ? credential.id : "";
  const credentialPrefix = `${getPublicSiteUrl()}/credentials/`;
  const credentialIdPart = credentialId.startsWith(credentialPrefix)
    ? credentialId.slice(credentialPrefix.length)
    : "";
  if (!z.string().uuid().safeParse(credentialIdPart).success) {
    throw new CredentialVerificationError("Credential ID is malformed");
  }

  const { data: credentialRow, error: credentialError } = await client
    .from("credentials")
    .select("organization_id, status, visibility, kid")
    .eq("id", credentialIdPart)
    .maybeSingle();
  if (credentialError) throw new Error("Could not resolve credential status");
  if (!credentialRow) throw new CredentialVerificationError("Credential is not registered");
  if (
    credentialRow.kid !== header.kid ||
    credentialRow.organization_id !== knownKey.organization_id
  ) {
    throw new CredentialVerificationError("Credential does not match its registered signing key");
  }

  const { data: organization, error: organizationError } = await client
    .from("organizations")
    .select("status")
    .eq("id", credentialRow.organization_id)
    .maybeSingle();
  if (organizationError) throw new Error("Could not resolve issuer status");

  const { data: revocation, error: revocationError } = await client
    .from("revocations")
    .select("revoked_at")
    .eq("organization_id", credentialRow.organization_id)
    .eq("credential_id", credentialIdPart)
    .maybeSingle();
  if (revocationError) throw new Error("Could not resolve revocation status");

  const checks: VerificationCheck[] = [
    { name: "signature", passed: true, detail: "JWS signature verified" },
    { name: "issuer", passed: organization?.status === "active", detail: "Issuer status checked" },
    { name: "validFrom", passed: Number.isFinite(validFrom) && validFrom <= now, detail: "Credential start date checked" },
    {
      name: "validUntil",
      passed: credentialRow.status !== "expired" &&
        (validUntil === null || (Number.isFinite(validUntil) && validUntil >= now)),
      detail: "Credential expiry checked",
    },
    {
      name: "revocation",
      passed: !revocation && credentialRow.status !== "revoked",
      detail: revocation ? "Credential has been revoked" : "No revocation record found",
    },
    {
      name: "registered",
      passed: credentialRow.status === "issued",
      detail: credentialRow.status === "issued"
        ? "Credential ID is registered and issued"
        : "Credential is not currently issued",
    },
  ];

  return { credential, checks, result };
}
