import {
  removeStampedPdfs,
  removeStampedPdfsThen,
  STAMPED_PDF_BUCKET,
} from "./anonymize-stamped-pdfs.ts";

Deno.test("removes stamped PDFs in bounded Storage API batches", async () => {
  const calls: Array<{ bucket: string; paths: string[] }> = [];
  const storage = {
    from(bucket: string) {
      return {
        async remove(paths: string[]) {
          calls.push({ bucket, paths });
          return { error: null };
        },
      };
    },
  };
  const paths = Array.from({ length: 205 }, (_, index) => `org/run/${index}.pdf`);

  await removeStampedPdfs(storage, paths);

  if (calls.length !== 3) throw new Error(`Expected 3 batches, got ${calls.length}`);
  if (calls.some((call) => call.bucket !== STAMPED_PDF_BUCKET)) {
    throw new Error("Unexpected bucket used for cleanup");
  }
  if (calls[0].paths.length !== 100 || calls[1].paths.length !== 100 || calls[2].paths.length !== 5) {
    throw new Error("Unexpected Storage batch sizes");
  }
  if (calls.flatMap((call) => call.paths).join("|") !== paths.join("|")) {
    throw new Error("Cleanup did not preserve the object path list");
  }
});

Deno.test("does not call Storage when there are no stamped PDFs", async () => {
  let called = false;
  const storage = {
    from() {
      return {
        async remove() {
          called = true;
          return { error: null };
        },
      };
    },
  };

  await removeStampedPdfs(storage, []);

  if (called) throw new Error("Storage should not be called for an empty path list");
});

Deno.test("surfaces Storage deletion failures without exposing provider details", async () => {
  const storage = {
    from() {
      return {
        async remove() {
          return { error: new Error("secret/path/person@example.test") };
        },
      };
    },
  };

  try {
    await removeStampedPdfs(storage, ["org/run/file.pdf"]);
    throw new Error("Expected Storage failure");
  } catch (error) {
    if (!(error instanceof Error)) {
      throw new Error("Expected an Error instance", { cause: error });
    }
    if (error.message !== "Could not remove stamped PDFs from private Storage") {
      throw new Error("Storage provider details were not sanitized", { cause: error });
    }
  }
});

Deno.test("does not finalize anonymization until all Storage deletions succeed", async () => {
  const order: string[] = [];
  const storage = {
    from() {
      return {
        async remove() {
          order.push("remove");
          return { error: null };
        },
      };
    },
  };

  await removeStampedPdfsThen(storage, ["org/run/file.pdf"], async () => {
    order.push("finalize");
    return { error: null };
  });

  if (order.join(",") !== "remove,finalize") {
    throw new Error(`Unexpected operation order: ${order.join(",")}`);
  }
});

Deno.test("does not finalize anonymization after a Storage failure", async () => {
  let finalized = false;
  const storage = {
    from() {
      return {
        async remove() {
          return { error: new Error("Storage unavailable") };
        },
      };
    },
  };

  try {
    await removeStampedPdfsThen(storage, ["org/run/file.pdf"], async () => {
      finalized = true;
      return { error: null };
    });
  } catch {
    if (finalized) throw new Error("Finalization ran after a Storage failure");
    return;
  }
  throw new Error("Expected Storage failure");
});
