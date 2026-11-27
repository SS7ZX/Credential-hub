import { deflateSync } from "node:zlib";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { EnvKeySigner } from "../supabase/functions/_shared/signer.ts";
import { buildCredential } from "../supabase/functions/_shared/credential.ts";
import {
  stampPdf,
  type QrLayout,
} from "../supabase/functions/_shared/stamping-pdf.ts";

const DRY_RUN_COUNT = 300;
const SITE_URL = "https://h2-local.invalid";
const A4_LANDSCAPE = { width: 841.89, height: 595.28 };
const QR_LAYOUT: QrLayout = {
  page_number: 1,
  x_points: 28,
  y_points: 28,
  size_points: 79.37,
  expected_page_width_points: A4_LANDSCAPE.width,
  expected_page_height_points: A4_LANDSCAPE.height,
  page_size_tolerance_points: 1,
};

function pem(label: string, bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  const wrapped = base64.match(/.{1,64}/g)?.join("\n") ?? base64;
  return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----`;
}

function createPng(width: number, height: number): Uint8Array {
  const bytesPerPixel = 3;
  const rowLength = width * bytesPerPixel + 1;
  const pixels = new Uint8Array(rowLength * height);
  let state = 0x6d2b79f5;
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowLength;
    pixels[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      const grain = (state >>> 0) % 17 - 8;
      const border = x < 12 || y < 12 || x >= width - 12 || y >= height - 12;
      const stripe = y > height * 0.22 && y < height * 0.225;
      const base = border || stripe ? 151 : 239;
      const pixel = rowStart + 1 + x * bytesPerPixel;
      pixels[pixel] = base + grain;
      pixels[pixel + 1] = base + grain - (border || stripe ? 17 : 3);
      pixels[pixel + 2] = base + grain - (border || stripe ? 54 : 18);
    }
  }

  const type = new TextEncoder();
  const crcTable = new Uint32Array(256);
  for (let index = 0; index < crcTable.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    crcTable[index] = value >>> 0;
  }
  function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function chunk(name: string, data: Uint8Array): Uint8Array {
    const nameBytes = type.encode(name);
    const checksumInput = new Uint8Array(nameBytes.length + data.length);
    checksumInput.set(nameBytes);
    checksumInput.set(data, nameBytes.length);
    const output = new Uint8Array(12 + data.length);
    const view = new DataView(output.buffer);
    view.setUint32(0, data.length);
    output.set(nameBytes, 4);
    output.set(data, 8);
    view.setUint32(8 + data.length, crc32(checksumInput));
    return output;
  }
  function concat(...parts: Uint8Array[]): Uint8Array {
    const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }

  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8;
  header[9] = 2;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return concat(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(pixels, { level: 6 }))),
    chunk("IEND", new Uint8Array()),
  );
}

function memorySnapshot() {
  const usage = Deno.memoryUsage();
  return {
    rssBytes: usage.rss,
    heapUsedBytes: usage.heapUsed,
  };
}

function mebibytes(bytes: number): number {
  return Number((bytes / 1024 / 1024).toFixed(2));
}

const startedAt = performance.now();
const memoryAtStart = memorySnapshot();
const generatedKey = await crypto.subtle.generateKey(
  { name: "Ed25519" },
  true,
  ["sign", "verify"],
);
if (!("privateKey" in generatedKey)) throw new Error("Ed25519 key generation did not return a key pair");
const keyPair = generatedKey;
const privateDer = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
const publicDer = new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));
const signer = new EnvKeySigner({
  keyId: "h2-ephemeral-local-only",
  algorithm: "EdDSA",
  privateKeyPem: pem("PRIVATE KEY", privateDer),
  publicKeyPem: pem("PUBLIC KEY", publicDer),
});

const credentialIds: string[] = [];
let totalJwsBytes = 0;
const issuanceStartedAt = performance.now();
for (let index = 0; index < DRY_RUN_COUNT; index += 1) {
  const id = crypto.randomUUID();
  const credential = buildCredential({
    id,
    publicSiteUrl: SITE_URL,
    issuerName: "H2 Synthetic Issuer",
    issuerUrl: "https://issuer.h2-local.invalid",
    validFrom: new Date().toISOString(),
    emailHash: index.toString(16).padStart(64, "0"),
    salt: "h2-local-only-synthetic-salt",
    achievement: {
      id: "20000000-0000-4000-8000-000000000001",
      name: "Synthetic Completion Award",
      description: "Local H2 issuance throughput fixture.",
      criteriaNarrative: "Automatically issued to a synthetic test recipient.",
    },
  });
  const jws = await signer.sign(credential);
  credentialIds.push(id);
  totalJwsBytes += new TextEncoder().encode(jws).byteLength;
}
const issuanceDurationMs = performance.now() - issuanceStartedAt;

const backgroundPng = createPng(1400, 990);
const pdfDocument = await PDFDocument.create();
const background = await pdfDocument.embedPng(backgroundPng);
const page = pdfDocument.addPage([A4_LANDSCAPE.width, A4_LANDSCAPE.height]);
page.drawImage(background, {
  x: 0,
  y: 0,
  width: A4_LANDSCAPE.width,
  height: A4_LANDSCAPE.height,
});
page.drawText("CERTIFICATE OF ACHIEVEMENT", { x: 80, y: 470, size: 24 });
page.drawText("Synthetic flattened background, A4 landscape, 1400 x 990 raster", {
  x: 80,
  y: 440,
  size: 10,
});
const sourcePdf = await pdfDocument.save({ useObjectStreams: true });

let stampedBytesTotal = 0;
let peakRssBytes = memorySnapshot().rssBytes;
let peakHeapUsedBytes = memorySnapshot().heapUsedBytes;
const stampingStartedAt = performance.now();
for (let index = 0; index < DRY_RUN_COUNT; index += 1) {
  const output = await stampPdf(
    sourcePdf,
    `${SITE_URL}/verify/${credentialIds[index]}`,
    credentialIds[index],
    `H2-${String(index + 1).padStart(4, "0")}`,
    QR_LAYOUT,
    10,
  );
  stampedBytesTotal += output.bytes.byteLength;
  if ((index + 1) % 10 === 0) {
    const memory = memorySnapshot();
    peakRssBytes = Math.max(peakRssBytes, memory.rssBytes);
    peakHeapUsedBytes = Math.max(peakHeapUsedBytes, memory.heapUsedBytes);
  }
}
const stampingDurationMs = performance.now() - stampingStartedAt;
const memoryAtEnd = memorySnapshot();
peakRssBytes = Math.max(peakRssBytes, memoryAtEnd.rssBytes);
peakHeapUsedBytes = Math.max(peakHeapUsedBytes, memoryAtEnd.heapUsedBytes);

console.log(JSON.stringify({
  result: "PASS",
  mode: "in-memory dry run; no database or Storage writes",
  credentialCount: DRY_RUN_COUNT,
  issuance: {
    elapsedMs: Number(issuanceDurationMs.toFixed(1)),
    credentialsPerSecond: Number((DRY_RUN_COUNT / (issuanceDurationMs / 1000)).toFixed(2)),
    averageVcJwtBytes: Math.round(totalJwsBytes / DRY_RUN_COUNT),
  },
  stamping: {
    elapsedMs: Number(stampingDurationMs.toFixed(1)),
    filesPerSecond: Number((DRY_RUN_COUNT / (stampingDurationMs / 1000)).toFixed(2)),
    sourcePdfBytes: sourcePdf.byteLength,
    sourceRaster: "1400x990 RGB synthetic certificate artwork",
    averageStampedPdfBytes: Math.round(stampedBytesTotal / DRY_RUN_COUNT),
    totalStampedBytesFor300: stampedBytesTotal,
    storageEstimateDecimalGB: Number((stampedBytesTotal / 1_000_000_000).toFixed(3)),
    storageEstimateGiB: Number((stampedBytesTotal / 1024 ** 3).toFixed(3)),
  },
  memory: {
    initialRssMiB: mebibytes(memoryAtStart.rssBytes),
    peakRssMiB: mebibytes(peakRssBytes),
    peakHeapUsedMiB: mebibytes(peakHeapUsedBytes),
    finalRssMiB: mebibytes(memoryAtEnd.rssBytes),
    finalHeapUsedMiB: mebibytes(memoryAtEnd.heapUsedBytes),
  },
  totalElapsedMs: Number((performance.now() - startedAt).toFixed(1)),
}, null, 2));
