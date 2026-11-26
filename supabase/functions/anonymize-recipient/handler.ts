import { z } from "npm:zod@4";
import {
  handleOptions,
  jsonResponse,
  readJson,
  RequestBodyError,
} from "../_shared/http.ts";

const requestSchema = z.object({
  recipientId: z.string().uuid(),
}).strict();

export type RecipientAnonymizationContext = {
  organizationId: string;
  anonymize: (userId: string) => Promise<void>;
};

export type AnonymizationHandlerDependencies = {
  authenticate: (request: Request) => Promise<{ userId: string }>;
  getRecipientContext: (
    recipientId: string,
  ) => Promise<RecipientAnonymizationContext | null>;
  requireOrganizationRole: (
    request: Request,
    organizationId: string,
    allowedRoles: string[],
  ) => Promise<unknown>;
};

export function createAnonymizeRecipientHandler(
  dependencies: AnonymizationHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const options = handleOptions(request);
    if (options) return options;
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    try {
      const input = requestSchema.parse(await readJson(request));
      const { userId } = await dependencies.authenticate(request);
      const context = await dependencies.getRecipientContext(input.recipientId);
      if (!context) return jsonResponse({ error: "Recipient not found" }, 404);

      await dependencies.requireOrganizationRole(
        request,
        context.organizationId,
        ["owner", "admin"],
      );
      await context.anonymize(userId);
      return jsonResponse({ ok: true });
    } catch (error) {
      if (error instanceof RequestBodyError) {
        return jsonResponse({ error: error.message }, error.status);
      }
      if (error instanceof z.ZodError) {
        return jsonResponse({ error: "Invalid anonymization request" }, 400);
      }
      if (error instanceof Error && error.message === "Could not load recipient") {
        return jsonResponse({ error: error.message }, 500);
      }
      if (error instanceof Error && error.message === "Insufficient organization role") {
        return jsonResponse({ error: error.message }, 403);
      }
      if (error instanceof Error && error.message === "Authentication required") {
        return jsonResponse({ error: error.message }, 401);
      }
      if (
        error instanceof Error
        && error.message === "A stamped PDF is still processing; retry anonymization shortly"
      ) {
        return jsonResponse({ error: error.message }, 409);
      }
      if (
        error instanceof Error
        && error.message === "Could not prepare recipient anonymization"
      ) {
        return jsonResponse({ error: error.message }, 500);
      }
      return jsonResponse({ error: "Recipient anonymization failed; retry safely" }, 500);
    }
  };
}
