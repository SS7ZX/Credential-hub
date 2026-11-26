import { buildPublicCredential } from "./public-credential.ts";

const sourceCredential = {
  id: "https://example.test/credentials/credential-id",
  credentialSubject: {
    type: "AchievementSubject",
    name: "Legacy Signed Name",
    identifier: {
      identityHash: "sha256$identity-hash",
      identityType: "emailAddress",
      salt: "identity-salt",
    },
    achievement: { name: "Participation" },
  },
};

Deno.test("public credential projection hides names without active consent", () => {
  const result = buildPublicCredential(sourceCredential, {
    fullName: "Recipient Name",
    maskedNameConsent: false,
    fullNameConsent: false,
  });
  const subject = result.credentialSubject as Record<string, unknown>;

  if ("name" in subject) throw new Error("Public projection exposed a name without consent");
  if (JSON.stringify(result).includes("Legacy Signed Name")) {
    throw new Error("Public projection retained a legacy signed recipient name");
  }
  if (subject.identifier === undefined) {
    throw new Error("Public projection dropped the signed identity object");
  }
});

Deno.test("public credential projection applies masked and full consent independently", () => {
  const masked = buildPublicCredential(sourceCredential, {
    fullName: "Ahmad Rafiq Satria",
    maskedNameConsent: true,
    fullNameConsent: false,
  });
  const maskedSubject = masked.credentialSubject as Record<string, unknown>;
  if (maskedSubject.name !== "Ahmad R*** S***") {
    throw new Error("Masked consent did not produce the masked public name");
  }

  const full = buildPublicCredential(sourceCredential, {
    fullName: "Ahmad Rafiq Satria",
    maskedNameConsent: false,
    fullNameConsent: true,
  });
  const fullSubject = full.credentialSubject as Record<string, unknown>;
  if (fullSubject.name !== "Ahmad Rafiq Satria") {
    throw new Error("Full-name consent did not produce the full public name");
  }
});
