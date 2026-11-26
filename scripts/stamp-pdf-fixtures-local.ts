import { getPublicSiteUrl } from "../supabase/functions/_shared/site-config.ts";
import {
  stampPdf,
  StampPdfError,
  type QrLayout,
} from "../supabase/functions/_shared/stamping-pdf.ts";

const outputDirectory = Deno.env.get("STAMP_FIXTURE_OUTPUT_DIR");
if (!outputDirectory) throw new Error("STAMP_FIXTURE_OUTPUT_DIR is required");

const layout: QrLayout = {
  page_number: 1,
  x_points: 30,
  y_points: 30,
  size_points: 79.37,
  expected_page_width_points: 841.89,
  expected_page_height_points: 595.28,
  page_size_tolerance_points: 1,
};
const origin = getPublicSiteUrl();
const validFixtures = [
  {
    file: "synthetic-a4.pdf",
    output: "synthetic-a4-stamped.pdf",
    credentialId: "00000000-0000-4000-8000-000000000101",
    serial: "SAMPLE-A4-001",
  },
  {
    file: "flattened-canva-a4.pdf",
    output: "flattened-canva-a4-stamped.pdf",
    credentialId: "00000000-0000-4000-8000-000000000102",
    serial: "SAMPLE-FLAT-001",
  },
];
const rejectedFixtures = [
  { file: "digitally-signed-a4.pdf", code: "pdf_signed" },
  { file: "encrypted-a4.pdf", code: "pdf_encrypted" },
  { file: "rotated-a4.pdf", code: "pdf_rotated" },
  { file: "non-a4.pdf", code: "page_size_mismatch" },
];

await Deno.mkdir(outputDirectory, { recursive: true });
const stamped: Array<{ fixture: string; output: string; expectedUrl: string }> = [];
for (const fixture of validFixtures) {
  const source = await Deno.readFile(
    new URL(`../supabase/functions/_shared/fixtures/${fixture.file}`, import.meta.url),
  );
  const expectedUrl = `${origin}/verify/${fixture.credentialId}`;
  const result = await stampPdf(
    source,
    expectedUrl,
    fixture.credentialId,
    fixture.serial,
    layout,
    20,
  );
  await Deno.writeFile(`${outputDirectory}/${fixture.output}`, result.bytes);
  stamped.push({ fixture: fixture.file, output: fixture.output, expectedUrl });
}

const rejected: Array<{ fixture: string; code: string }> = [];
for (const fixture of rejectedFixtures) {
  const source = await Deno.readFile(
    new URL(`../supabase/functions/_shared/fixtures/${fixture.file}`, import.meta.url),
  );
  try {
    await stampPdf(
      source,
      `${origin}/verify/00000000-0000-4000-8000-000000000199`,
      "00000000-0000-4000-8000-000000000199",
      "SAMPLE-REJECT-001",
      layout,
      20,
    );
  } catch (error) {
    if (!(error instanceof StampPdfError) || error.code !== fixture.code) {
      throw new Error(`Unexpected rejection for ${fixture.file}`, { cause: error });
    }
    rejected.push({ fixture: fixture.file, code: error.code });
    continue;
  }
  throw new Error(`Expected ${fixture.file} to be rejected as ${fixture.code}`);
}

console.log(JSON.stringify({ stamped, rejected }));
