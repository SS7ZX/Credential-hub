import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { z } from "npm:zod@4";
import {
  corsHeaders,
  handleOptions,
  jsonResponse,
  readJson,
  RequestBodyError,
} from "../_shared/http.ts";
import { getAdminClient, requireOrganizationRole } from "../_shared/supabase.ts";
import { setCredentialPdfMetadata } from "../_shared/pdf-metadata.ts";

const requestSchema = z.object({ credentialId: z.string().uuid() }).strict();
type CredentialRow = {
  id: string;
  organization_id: string;
  status: string;
  serial_number: string;
  issued_at: string | null;
  credential_json: Record<string, unknown> | null;
  recipients: { full_name: string | null } | Array<{ full_name: string | null }> | null;
};

function printable(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.replace(/[^\x20-\xFF]/g, "?").trim().slice(0, 160);
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const { credentialId } = requestSchema.parse(await readJson(request));
    const admin = getAdminClient();
    const { data: credentialAccess, error: accessError } = await admin
      .from("credentials")
      .select("organization_id, status")
      .eq("id", credentialId)
      .maybeSingle();
    if (accessError) throw new Error("Could not authorize credential access");
    if (!credentialAccess) return jsonResponse({ error: "Issued credential not found" }, 404);
    await requireOrganizationRole(request, credentialAccess.organization_id, ["owner", "admin", "issuer"]);
    if (credentialAccess.status !== "issued") {
      return jsonResponse({ error: "PDFs are only available for currently issued credentials" }, 409);
    }

    const { data: rowData, error: credentialError } = await admin
      .from("credentials")
      .select("id, organization_id, status, serial_number, issued_at, credential_json, recipients(full_name)")
      .eq("id", credentialId)
      .eq("status", "issued")
      .single();
    if (credentialError) throw new Error("Could not load issued credential");
    const credential = rowData as CredentialRow;
    if (!credential.credential_json) {
      return jsonResponse({ error: "Credential data is unavailable" }, 409);
    }

    const stored = credential.credential_json;
    const issuer = typeof stored.issuer === "object" && stored.issuer !== null
      ? stored.issuer as Record<string, unknown>
      : {};
    const subject = typeof stored.credentialSubject === "object" && stored.credentialSubject !== null
      ? stored.credentialSubject as Record<string, unknown>
      : {};
    const achievement = typeof subject.achievement === "object" && subject.achievement !== null
      ? subject.achievement as Record<string, unknown>
      : {};
    const recipient = Array.isArray(credential.recipients)
      ? credential.recipients[0]
      : credential.recipients;
    const recipientName = recipient?.full_name?.trim();

    const document = await PDFDocument.create();
    setCredentialPdfMetadata(document);
    const page = document.addPage([841.89, 595.28]);
    const heading = await document.embedFont(StandardFonts.HelveticaBold);
    const body = await document.embedFont(StandardFonts.Helvetica);
    const dark = rgb(0.12, 0.27, 0.22);
    const green = rgb(0.43, 0.57, 0.32);
    page.drawRectangle({
      x: 25,
      y: 25,
      width: 791.89,
      height: 545.28,
      borderColor: rgb(0.83, 0.87, 0.78),
      borderWidth: 1,
    });
    page.drawText("DIGITAL CREDENTIAL", {
      x: 62,
      y: 512,
      size: 10,
      font: heading,
      color: green,
    });
    page.drawText("CERTIFICATE OF ACHIEVEMENT", {
      x: 62,
      y: 435,
      size: 14,
      font: heading,
      color: dark,
    });
    page.drawText(printable(achievement.name, "Achievement"), {
      x: 62,
      y: 375,
      size: 30,
      font: heading,
      color: dark,
      maxWidth: 700,
    });

    if (recipientName) {
      page.drawText("AWARDED TO", { x: 62, y: 322, size: 9, font: heading, color: green });
      page.drawText(printable(recipientName, "Credential recipient"), {
        x: 62,
        y: 292,
        size: 22,
        font: body,
        color: dark,
        maxWidth: 700,
      });
    }
    page.drawText(printable(achievement.description, ""), {
      x: 62,
      y: 238,
      size: 11,
      font: body,
      color: rgb(0.35, 0.42, 0.37),
      maxWidth: 700,
      lineHeight: 16,
    });
    page.drawLine({
      start: { x: 62, y: 145 },
      end: { x: 780, y: 145 },
      thickness: 1,
      color: rgb(0.88, 0.91, 0.85),
    });
    page.drawText(`Issued by ${printable(issuer.name, "Credential issuer")}`, {
      x: 62,
      y: 112,
      size: 10,
      font: body,
      color: dark,
    });
    page.drawText(`Credential ID: ${credential.id}`, {
      x: 62,
      y: 83,
      size: 8,
      font: body,
      color: rgb(0.42, 0.49, 0.44),
    });
    page.drawText(`Serial: ${credential.serial_number}`, {
      x: 62,
      y: 65,
      size: 8,
      font: body,
      color: rgb(0.42, 0.49, 0.44),
    });
    page.drawText(
      credential.issued_at ? `Issued ${new Date(credential.issued_at).toISOString().slice(0, 10)}` : "Issued by credential issuer",
      { x: 640, y: 65, size: 8, font: body, color: rgb(0.42, 0.49, 0.44) },
    );

    const pdf = await document.save();
    const pdfBuffer = new ArrayBuffer(pdf.byteLength);
    new Uint8Array(pdfBuffer).set(pdf);
    return new Response(pdfBuffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="credential-${credential.serial_number.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    if (error instanceof z.ZodError) return jsonResponse({ error: "Invalid PDF request" }, 400);
    console.error("generate-pdf failed", error);
    const message = error instanceof Error ? error.message : "PDF generation failed";
    if (/Authentication required|Invalid authentication token|organization role/i.test(message)) {
      return jsonResponse({ error: message }, 403);
    }
    return jsonResponse({ error: "PDF generation is temporarily unavailable" }, 503);
  }
});
