import type { PDFDocument } from "npm:pdf-lib@1.17.1";

export function setCredentialPdfMetadata(document: PDFDocument): void {
  document.setTitle("Digital credential");
  document.setAuthor("Credential Hub");
  document.setSubject("Open Badges 3.0 credential");
  document.setCreator("Credential Hub");
  document.setProducer("Credential Hub");
  document.setKeywords([]);
}
