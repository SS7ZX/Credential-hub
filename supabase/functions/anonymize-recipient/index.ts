import {
  removeStampedPdfsThen,
} from "../_shared/anonymize-stamped-pdfs.ts";
import {
  authenticateRequest,
  getAdminClient,
  requireOrganizationRole,
} from "../_shared/supabase.ts";
import { createAnonymizeRecipientHandler } from "./handler.ts";

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

const handler = createAnonymizeRecipientHandler({
  authenticate: async (request) => {
    const { userId } = await authenticateRequest(request);
    return { userId };
  },
  getRecipientContext: async (recipientId) => {
    const admin = getAdminClient();
    const { data: recipient, error: recipientError } = await admin
      .from("recipients")
      .select("organization_id")
      .eq("id", recipientId)
      .maybeSingle();

    if (recipientError) throw new Error("Could not load recipient");
    if (!recipient) return null;

    return {
      organizationId: recipient.organization_id,
      anonymize: async (userId: string) => {
        const { data: cleanupPlan, error: prepareError } = await admin.rpc(
          "prepare_recipient_anonymization",
          {
            p_actor_id: userId,
            p_recipient_id: recipientId,
          },
        );
        if (prepareError) {
          if (prepareError.message.includes("still processing")) {
            throw new Error("A stamped PDF is still processing; retry anonymization shortly");
          }
          throw new Error("Could not prepare recipient anonymization");
        }

        const storagePaths = parseStoragePaths(cleanupPlan);
        await removeStampedPdfsThen(admin.storage, storagePaths, () =>
          admin.rpc("complete_recipient_anonymization", {
            p_actor_id: userId,
            p_recipient_id: recipientId,
          })
        );
      },
    };
  },
  requireOrganizationRole: (request, organizationId, allowedRoles) =>
    requireOrganizationRole(request, organizationId, allowedRoles),
});

Deno.serve(handler);
