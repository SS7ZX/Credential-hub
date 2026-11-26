export const STAMPED_PDF_BUCKET = "stamped-certificate-pdfs";

type StorageRemover = {
  from(bucket: string): {
    remove(paths: string[]): Promise<{ error: unknown | null }>;
  };
};

const DELETE_BATCH_SIZE = 100;

export async function removeStampedPdfs(
  storage: StorageRemover,
  paths: readonly string[],
): Promise<void> {
  for (let offset = 0; offset < paths.length; offset += DELETE_BATCH_SIZE) {
    const batch = paths.slice(offset, offset + DELETE_BATCH_SIZE);
    const { error } = await storage.from(STAMPED_PDF_BUCKET).remove(batch);
    if (error) {
      throw new Error("Could not remove stamped PDFs from private Storage");
    }
  }
}

export async function removeStampedPdfsThen(
  storage: StorageRemover,
  paths: readonly string[],
  finalize: () => PromiseLike<{ error: unknown | null }>,
): Promise<void> {
  await removeStampedPdfs(storage, paths);
  const { error } = await finalize();
  if (error) {
    throw new Error("Could not complete recipient anonymization");
  }
}
