import { z } from "npm:zod@4";

export const issuanceRowSchema = z.object({
  full_name: z.string().trim().min(1).max(200)
    .transform((value) => value.replace(/\s+/g, " ")),
  email: z.string().trim().email().max(320)
    .transform((value) => value.toLowerCase()),
  external_id: z.string().trim().max(120)
    .transform((value) => value.replace(/\s+/g, " ")).optional(),
  category: z.string().trim().max(100).optional(),
  issued_on: z.string().trim().optional(),
  expires_on: z.string().trim().optional(),
}).strict();

export type IssuanceRow = z.infer<typeof issuanceRowSchema>;
