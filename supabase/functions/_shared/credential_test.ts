import {
  buildCredential,
  consentedRecipientName,
  hashRecipientEmail,
} from "./credential.ts";

Deno.test("buildCredential validates an Open Badges 3.0 credential and hides unconsented name", () => {
  const credential = buildCredential({
    id: "00000000-0000-4000-8000-000000000001",
    issuerDid: "did:web:tasdiqapp.com",
    issuerName: "Tasdiq",
    issuerUrl: "https://tasdiqapp.com",
    validFrom: "2026-11-25T00:00:00.000Z",
    displayName: "Recipient Name",
    publicNameConsent: false,
    emailHash: "a".repeat(64),
    salt: "random-salt-value",
    achievement: {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Participant",
      description: "Participated",
      criteriaNarrative: "Attended the event",
    },
  });
  const subject = credential.credentialSubject as Record<string, unknown>;
  if ("name" in subject) throw new Error("Unconsented recipient name was included");
  if (!Array.isArray(credential["@context"])) throw new Error("Expected official OB contexts");
});

Deno.test("buildCredential includes the recipient name only after explicit consent", () => {
  const credential = buildCredential({
    id: "00000000-0000-4000-8000-000000000003",
    issuerDid: "did:web:tasdiqapp.com",
    issuerName: "Tasdiq",
    issuerUrl: "https://tasdiqapp.com",
    validFrom: "2026-11-25T00:00:00.000Z",
    displayName: "Recipient Name",
    publicNameConsent: true,
    emailHash: "b".repeat(64),
    salt: "another-random-salt",
    achievement: {
      id: "00000000-0000-4000-8000-000000000004",
      name: "Winner",
      description: "Won",
      criteriaNarrative: "Placed first",
    },
  });
  const subject = credential.credentialSubject as Record<string, unknown>;
  if (subject.name !== "Recipient Name") throw new Error("Consented recipient name was omitted");
});

Deno.test("hashRecipientEmail normalizes email and uses the supplied salt", async () => {
  const first = await hashRecipientEmail(" USER@example.com ", "salt-one");
  const normalized = await hashRecipientEmail("user@example.com", "salt-one");
  const differentSalt = await hashRecipientEmail("user@example.com", "salt-two");
  if (first !== normalized) throw new Error("Email normalization is inconsistent");
  if (first === differentSalt) throw new Error("Salt did not affect the email hash");
});

Deno.test("consented public names must come from the signed subject", () => {
  if (consentedRecipientName("Signed Name", true) !== "Signed Name") {
    throw new Error("Consented signed name was not included");
  }
  if (consentedRecipientName("Signed Name", false) !== undefined) {
    throw new Error("Name was included without current consent");
  }
  if (consentedRecipientName(undefined, true) !== undefined) {
    throw new Error("Name absent from the signed subject was synthesized");
  }
});
