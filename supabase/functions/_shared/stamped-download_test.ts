import { issueSignedUrlForEligibleFile } from "./stamped-download.ts";

Deno.test("finalize-run does not sign files for pending or anonymized recipients", async () => {
  const unavailableStates = new Set(["pending", "anonymized"]);
  for (const recipientState of ["pending", "anonymized"] as const) {
    let signed = false;
    const url = await issueSignedUrlForEligibleFile(
      async () => unavailableStates.has(recipientState) ? null : "org/run/file.pdf",
      async () => {
        signed = true;
        return "https://storage.invalid/signed.pdf";
      },
    );
    if (url !== null || signed) {
      throw new Error(`A ${recipientState} recipient's file was signed`);
    }
  }
});

Deno.test("finalize-run signs a file only after the database returns an eligible path", async () => {
  let signedPath: string | undefined;
  const url = await issueSignedUrlForEligibleFile(
    async () => "org/run/file.pdf",
    async (path) => {
      signedPath = path;
      return "https://storage.invalid/signed.pdf";
    },
  );
  if (signedPath !== "org/run/file.pdf" || url !== "https://storage.invalid/signed.pdf") {
    throw new Error("Eligible stamped file was not signed");
  }
});
