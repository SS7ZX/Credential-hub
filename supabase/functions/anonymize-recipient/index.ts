import { z } from "npm:zod@4";
import {
  removeStampedPdfsThen,
} from "../_shared/anonymize-stamped-pdfs.ts";
import {
  handleOptions,
  jsonResponse,
  readJson,
  RequestBodyError,
} from "../_shared/http.ts";
import {
  authenticateRequest,
  getAdminClient,
  requireOrganizationRole,
} from "../_shared/supabase.ts";

const requestSchema = z.object({
  recipientId: z.string().uuid(),
}).strict();

function parseStoragePaths(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Could not prepare recipient anonymization");
  }
  const paths = (value as Record<string, unknown>).storagePaths;
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== "string")) {
    throw new Error("Could not prepare recipient anonymization");
  }
  return paths;
}

Deno.serve(async (request: Request): Promise<Response> => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const input = requestSchema.parse(await readJson(request));
    const { userId } = await authenticateRequest(request);
    const admin = getAdminClient();
    const { data: recipient, error: recipientError } = await admin
      .from("recipients")
      .select("organization_id")
      .eq("id", input.recipientId)
      .maybeSingle();

    if (recipientError) {
      return jsonResponse({ error: "Could not load recipient" }, 500);
    }
    if (!recipient) {
      return jsonResponse({ error: "Recipient not found" }, 404);
    }

    await requireOrganizationRole(request, recipient.organization_id, ["owner", "admin"]);
    const { data: cleanupPlan, error: prepareError } = await admin.rpc(
      "prepare_recipient_anonymization",
      {
        p_actor_id: userId,
        p_recipient_id: input.recipientId,
      },
    );
    if (prepareError) {
      const status = prepareError.message.includes("still processing") ? 409 : 500;
      return jsonResponse(
        { error: status === 409
          ? "A stamped PDF is still processing; retry anonymization shortly"
          : "Could not prepare recipient anonymization" },
        status,
      );
    }

    const storagePaths = parseStoragePaths(cleanupPlan);
    await removeStampedPdfsThen(admin.storage, storagePaths, () =>
      admin.rpc("complete_recipient_anonymization", {
        p_actor_id: userId,
        p_recipient_id: input.recipientId,
      })
    );

    return jsonResponse({ ok: true });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    if (error instanceof z.ZodError) {
      return jsonResponse({ error: "Invalid anonymization request" }, 400);
    }
    if (error instanceof Error && error.message === "Insufficient organization role") {
      return jsonResponse({ error: error.message }, 403);
    }
    if (error instanceof Error && error.message === "Authentication required") {
      return jsonResponse({ error: error.message }, 401);
    }
    return jsonResponse({ error: "Recipient anonymization failed; retry safely" }, 500);
  }
});
