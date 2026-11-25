import { Ajv2019 } from "npm:ajv@8.17.1/dist/2019.js";
import * as addFormatsModule from "npm:ajv-formats@3.0.1";
import type { FormatsPlugin } from "npm:ajv-formats@3.0.1";
import { z } from "npm:zod@4";
import schema from "./ob_v3p0_achievementcredential_schema.json" with { type: "json" };

export const credentialInputSchema = z.object({
  id: z.string().uuid(),
  issuerDid: z.literal("did:web:tasdiqapp.com"),
  issuerName: z.string().trim().min(1).max(200),
  issuerUrl: z.url(),
  issuerImage: z.url().optional(),
  validFrom: z.iso.datetime({ offset: true }),
  validUntil: z.iso.datetime({ offset: true }).optional(),
  displayName: z.string().trim().min(1).max(200).optional(),
  publicNameConsent: z.boolean().default(false),
  emailHash: z.string().regex(/^[a-f0-9]{64}$/i),
  salt: z.string().min(16).max(256),
  achievement: z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2000),
    criteriaNarrative: z.string().trim().min(1).max(4000),
    imageUrl: z.url().optional(),
  }),
}).strict();

export type CredentialInput = z.infer<typeof credentialInputSchema>;

const validator = new Ajv2019({ allErrors: true, strict: false });
const addFormatsCandidate: unknown = addFormatsModule.default;
function isFormatsPlugin(value: unknown): value is FormatsPlugin {
  return typeof value === "function";
}
if (!isFormatsPlugin(addFormatsCandidate)) {
  throw new Error("Open Badges schema format validation is unavailable");
}
addFormatsCandidate(validator);
const validateOfficialSchema = validator.compile(schema);

export function validateCredential(value: unknown): asserts value is Record<string, unknown> {
  if (!validateOfficialSchema(value)) {
    const errors = (validateOfficialSchema.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`)
      .join("; ");
    throw new Error(`Open Badges 3.0 schema validation failed: ${errors}`);
  }
}

export function consentedRecipientName(
  signedName: unknown,
  hasConsent: boolean,
): string | undefined {
  return hasConsent && typeof signedName === "string" && signedName.trim()
    ? signedName
    : undefined;
}

export function buildCredential(input: CredentialInput): Record<string, unknown> {
  const subject: Record<string, unknown> = {
    type: "AchievementSubject",
    identifier: {
      type: "IdentityObject",
      hashed: true,
      identityHash: `sha256$${input.emailHash.toLowerCase()}`,
      identityType: "emailAddress",
      salt: input.salt,
    },
    achievement: {
      id: `https://tasdiqapp.com/achievements/${input.achievement.id}`,
      type: "Achievement",
      name: input.achievement.name,
      description: input.achievement.description,
      criteria: { narrative: input.achievement.criteriaNarrative },
      ...(input.achievement.imageUrl ? { image: input.achievement.imageUrl } : {}),
    },
  };

  if (input.publicNameConsent && input.displayName) {
    subject.name = input.displayName;
  }

  const credential = {
    "@context": [
      "https://www.w3.org/ns/credentials/v2",
      "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
    ],
    id: `https://tasdiqapp.com/credentials/${input.id}`,
    type: ["VerifiableCredential", "OpenBadgeCredential"],
    issuer: {
      id: input.issuerDid,
      type: "Profile",
      name: input.issuerName,
      url: input.issuerUrl,
      ...(input.issuerImage ? { image: input.issuerImage } : {}),
    },
    validFrom: input.validFrom,
    ...(input.validUntil ? { validUntil: input.validUntil } : {}),
    credentialSubject: subject,
  };

  validateCredential(credential);
  return credential;
}

export async function hashRecipientEmail(email: string, salt: string): Promise<string> {
  const normalizedEmail = email.trim().toLowerCase();
  const bytes = new TextEncoder().encode(`${normalizedEmail}${salt}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
