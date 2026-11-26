import { maskRecipientName } from "./credential.ts";

export type CredentialNameConsent = {
  fullName: string | null;
  maskedNameConsent: boolean;
  fullNameConsent: boolean;
};

export function buildPublicCredential(
  storedCredential: Record<string, unknown>,
  nameConsent: CredentialNameConsent,
): Record<string, unknown> {
  const storedSubject = storedCredential.credentialSubject as Record<string, unknown> | undefined;
  const identifier = storedSubject?.identifier;
  const identity = Array.isArray(identifier) ? identifier[0] : identifier;
  const achievement = storedSubject?.achievement as Record<string, unknown> | undefined;
  const publicName = nameConsent.fullNameConsent
    ? nameConsent.fullName?.trim() || undefined
    : nameConsent.maskedNameConsent && nameConsent.fullName
    ? maskRecipientName(nameConsent.fullName)
    : undefined;
  const publicSubject = {
    ...(storedSubject?.type ? { type: storedSubject.type } : {}),
    ...(identity && typeof identity === "object"
      ? {
        identifier: {
          type: "IdentityObject",
          hashed: true,
          identityHash: (identity as Record<string, unknown>).identityHash,
          identityType: (identity as Record<string, unknown>).identityType,
          salt: (identity as Record<string, unknown>).salt,
        },
      }
      : {}),
    ...(achievement ? { achievement } : {}),
    ...(publicName ? { name: publicName } : {}),
  };
  const credential = Object.fromEntries(
    ["@context", "id", "type", "issuer", "validFrom", "validUntil", "name", "description", "image"]
      .filter((key) => key in storedCredential)
      .map((key) => [key, storedCredential[key]]),
  );
  credential.credentialSubject = publicSubject;
  return credential;
}
