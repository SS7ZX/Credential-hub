export async function issueSignedUrlForEligibleFile(
  getEligiblePath: () => Promise<string | null>,
  createSignedUrl: (path: string) => Promise<string>,
): Promise<string | null> {
  const path = await getEligiblePath();
  if (!path) return null;
  return await createSignedUrl(path);
}
