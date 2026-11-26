import { PDFDocument, PDFName } from "npm:pdf-lib@1.17.1";
import { getPublicSiteUrl } from "../supabase/functions/_shared/site-config.ts";
import { stampPdf } from "../supabase/functions/_shared/stamping-pdf.ts";

const outputPath = Deno.env.get("STAMP_TEST_OUTPUT");
if (!outputPath) throw new Error("STAMP_TEST_OUTPUT is required");

const credentialId = "70000000-0000-4000-8000-000000000001";
const syntheticName = "Synthetic Recipient QA";
const syntheticEmail = "synthetic-qa@example.test";
const sourceDocument = await PDFDocument.create();
sourceDocument.addPage([842, 595]);
sourceDocument.setTitle(syntheticName);
sourceDocument.setAuthor(syntheticEmail);
sourceDocument.setSubject(`${syntheticName} ${syntheticEmail}`);

const xmp = new TextEncoder().encode(
  `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description>${syntheticName} ${syntheticEmail}</rdf:Description></rdf:RDF></x:xmpmeta>`,
);
const metadata = sourceDocument.context.register(
  sourceDocument.context.stream(xmp, {
    Type: PDFName.of("Metadata"),
    Subtype: PDFName.of("XML"),
  }),
);
sourceDocument.catalog.set(PDFName.of("Metadata"), metadata);

const sourceBytes = await sourceDocument.save();
const expectedUrl = `${getPublicSiteUrl()}/verify/${credentialId}`;
const stamped = await stampPdf(
  sourceBytes,
  expectedUrl,
  credentialId,
  "SAMPLE-000001",
  {
    page_number: 1,
    x_points: 24,
    y_points: 24,
    size_points: 80,
    expected_page_width_points: 842,
    expected_page_height_points: 595,
    page_size_tolerance_points: 1,
  },
  1,
);

const outputDocument = await PDFDocument.load(stamped.bytes, { updateMetadata: false });
if (
  outputDocument.getTitle()
  || outputDocument.getAuthor()
  || outputDocument.getSubject()
  || outputDocument.catalog.get(PDFName.of("Metadata"))
) {
  throw new Error("Stamped PDF retained Info or XMP metadata");
}

const rawOutput = new TextDecoder("latin1").decode(stamped.bytes);
if (rawOutput.includes(syntheticName) || rawOutput.includes(syntheticEmail)) {
  throw new Error("Stamped PDF retained synthetic recipient metadata");
}

await Deno.writeFile(outputPath, stamped.bytes);
console.log(JSON.stringify({
  result: "PASS",
  expectedUrl,
  outputPath,
  sourceSha256: stamped.sourceSha256,
  outputSha256: stamped.outputSha256,
  pageCount: stamped.pageCount,
  metadata: "Info and XMP removed; synthetic recipient markers absent",
}));
