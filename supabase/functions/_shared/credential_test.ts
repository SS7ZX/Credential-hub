import {
  buildCredential,
  hashRecipientEmail,
  maskRecipientName,
} from "./credential.ts";

Deno.test("buildCredential validates OB 3.0 and never includes recipient names", () => {
  const credential = buildCredential({
    id: "00000000-0000-4000-8000-000000000001",
    publicSiteUrl: "https://example.test",
    issuerName: "Example Issuer",
    issuerUrl: "https://example.test",
    validFrom: "2026-11-25T00:00:00.000Z",
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
  if ("name" in subject) throw new Error("Recipient name was included in the signed subject");
  if (JSON.stringify(credential).includes("Recipient Name")) {
    throw new Error("Recipient name appeared in the signed credential payload");
  }
  if (!("identifier" in subject)) throw new Error("Hashed email identity was omitted");
  if (!Array.isArray(credential["@context"])) throw new Error("Expected official OB contexts");
});

Deno.test("maskRecipientName uses the documented long-name format", () => {
  const masked = maskRecipientName("Ahmad Rafiq Satria");
  if (masked !== "Ahmad R*** S***") {
    throw new Error(`Unexpected masked name: ${masked}`);
  }
});

Deno.test("maskRecipientName reveals initials only for short or single-word names", () => {
  if (maskRecipientName("Ahmad") !== "A.") {
    throw new Error("A single-word name must be reduced to an initial");
  }
  if (maskRecipientName("Li Wei") !== "L. W.") {
    throw new Error("A very short name must be reduced to initials");
  }
  if (maskRecipientName("   ") !== undefined) {
    throw new Error("An empty name must not produce a public value");
  }
});

Deno.test("maskRecipientName preserves Unicode grapheme initials", () => {
  const masked = maskRecipientName("A\u0301hmad Rafiq Satria");
  if (masked !== "Áhmad R*** S***") {
    throw new Error(`Unexpected Unicode masked name: ${masked}`);
  }
});

Deno.test("buildCredential never includes a recipient name, independent of consent", () => {
  const credential = buildCredential({
    id: "00000000-0000-4000-8000-000000000003",
    publicSiteUrl: "https://example.test",
    issuerName: "Example Issuer",
    issuerUrl: "https://example.test",
    validFrom: "2026-11-25T00:00:00.000Z",
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
  if ("name" in subject) throw new Error("Recipient name was included in the signed subject");
});

Deno.test("hashRecipientEmail normalizes email and uses the supplied salt", async () => {
  const first = await hashRecipientEmail(" USER@example.com ", "salt-one");
  const normalized = await hashRecipientEmail("user@example.com", "salt-one");
  const differentSalt = await hashRecipientEmail("user@example.com", "salt-two");
  if (first !== normalized) throw new Error("Email normalization is inconsistent");
  if (first === differentSalt) throw new Error("Salt did not affect the email hash");
});

