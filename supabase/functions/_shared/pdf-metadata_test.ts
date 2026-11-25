import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { setCredentialPdfMetadata } from "./pdf-metadata.ts";

Deno.test("credential PDF metadata contains no recipient PII and no XMP packet", async () => {
  const document = await PDFDocument.create();
  setCredentialPdfMetadata(document);
  const bytes = await document.save();
  const loaded = await PDFDocument.load(bytes);
  const metadataValues = [
    loaded.getTitle(),
    loaded.getAuthor(),
    loaded.getSubject(),
    loaded.getCreator(),
    loaded.getProducer(),
    ...(loaded.getKeywords() ?? []),
  ].join("\n");
  const serialized = new TextDecoder().decode(bytes);

  if (/Recipient A|recipient-a@test\.invalid/i.test(metadataValues)) {
    throw new Error("Recipient name or email was written to PDF Info metadata");
  }
  if (/\/Type\s*\/Metadata\b/.test(serialized)) {
    throw new Error("PDF contains an XMP metadata stream");
  }
});
