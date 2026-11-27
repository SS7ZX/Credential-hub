import { normalizeStagingRows } from "./issuance-batch.ts";

Deno.test("staging normalizes participant data and derives a PII-free row key", async () => {
  const result = await normalizeStagingRows("batch-id", [{
    rowNumber: 7,
    payload: {
      full_name: "  Nur   Aisyah ",
      email: " NUR@Example.Test ",
      external_id: " NIM   001 ",
    },
  }]);

  if (result.invalidRowNumbers.length !== 0 || result.rows.length !== 1) {
    throw new Error("Valid row was not normalized for staging");
  }
  const [row] = result.rows;
  if (
    row.rowNumber !== 7 ||
    row.payload.full_name !== "Nur Aisyah" ||
    row.payload.email !== "nur@example.test" ||
    row.payload.external_id !== "NIM 001" ||
    !/^[a-f0-9]{64}$/.test(row.idempotencyKey) ||
    row.idempotencyKey.includes("nur")
  ) {
    throw new Error("Staged row normalization or idempotency key is invalid");
  }
});

Deno.test("staging returns only row numbers for invalid participant data", async () => {
  const result = await normalizeStagingRows("batch-id", [{
    rowNumber: 3,
    payload: { full_name: "Nur Aisyah", email: "not-an-email" },
  }]);

  if (result.rows.length !== 0 || JSON.stringify(result.invalidRowNumbers) !== "[3]") {
    throw new Error("Invalid staging row was not safely identified");
  }
});

Deno.test("staging rejects duplicate row numbers within a chunk", async () => {
  try {
    await normalizeStagingRows("batch-id", [
      { rowNumber: 1, payload: { full_name: "A", email: "a@example.test" } },
      { rowNumber: 1, payload: { full_name: "B", email: "b@example.test" } },
    ]);
  } catch (error) {
    if (error instanceof Error && error.message === "Duplicate row number in staging chunk") {
      return;
    }
    throw error;
  }
  throw new Error("Duplicate row numbers were accepted");
});
