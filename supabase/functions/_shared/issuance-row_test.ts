import { issuanceRowSchema } from "./issuance-row.ts";

Deno.test("issuance participant rows normalize email, name, and optional external ID", () => {
  const parsed = issuanceRowSchema.parse({
    full_name: "  Nur   Aisyah  ",
    email: " NUR@Example.Test ",
    external_id: "  NIM   2026-001 ",
  });
  const expected = {
    full_name: "Nur Aisyah",
    email: "nur@example.test",
    external_id: "NIM 2026-001",
  };
  if (JSON.stringify(parsed) !== JSON.stringify(expected)) {
    throw new Error("Participant fields were not normalized as expected");
  }
});

Deno.test("issuance participant rows reject invalid emails and oversized external IDs", () => {
  for (const invalidRow of [
    { full_name: "Nur Aisyah", email: "not-an-email" },
    {
      full_name: "Nur Aisyah",
      email: "nur@example.test",
      external_id: "x".repeat(121),
    },
  ]) {
    try {
      issuanceRowSchema.parse(invalidRow);
    } catch {
      continue;
    }
    throw new Error("Invalid participant data was accepted");
  }
});
