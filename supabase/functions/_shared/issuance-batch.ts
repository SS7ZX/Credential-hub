import { issuanceRowSchema } from "./issuance-row.ts";

export type StagingCandidate = {
  rowNumber: number;
  payload: Record<string, unknown>;
};

export type NormalizedStagingRow = {
  rowNumber: number;
  payload: Record<string, unknown>;
  idempotencyKey: string;
};

export async function normalizeStagingRows(
  batchId: string,
  candidates: StagingCandidate[],
): Promise<{ rows: NormalizedStagingRow[]; invalidRowNumbers: number[] }> {
  const seen = new Set<number>();
  const rows: NormalizedStagingRow[] = [];
  const invalidRowNumbers: number[] = [];

  for (const candidate of candidates) {
    if (seen.has(candidate.rowNumber)) {
      throw new Error("Duplicate row number in staging chunk");
    }
    seen.add(candidate.rowNumber);

    const parsed = issuanceRowSchema.safeParse(candidate.payload);
    if (!parsed.success) {
      invalidRowNumbers.push(candidate.rowNumber);
      continue;
    }

    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${batchId}:${candidate.rowNumber}`),
    );
    const idempotencyKey = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    rows.push({
      rowNumber: candidate.rowNumber,
      payload: parsed.data,
      idempotencyKey,
    });
  }

  return { rows, invalidRowNumbers };
}
