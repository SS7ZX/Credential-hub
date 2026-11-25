import { z } from "npm:zod@4";
import {
  handleOptions,
  jsonResponse,
  readJson,
  RequestBodyError,
} from "../_shared/http.ts";
import { authenticateRequest, getAdminClient } from "../_shared/supabase.ts";

const requestSchema = z.object({
  invitationId: z.string().uuid(),
}).strict();

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const input = requestSchema.parse(await readJson(request));
    const { user } = await authenticateRequest(request);
    if (!user.email_confirmed_at || !user.email) {
      return jsonResponse({ error: "Verify your email address before accepting this invitation." }, 403);
    }

    const { data, error } = await getAdminClient().rpc("accept_organization_invitation", {
      p_invitation_id: input.invitationId,
      p_user_id: user.id,
    });
    if (error) {
      if (error.code === "42501") {
        return jsonResponse({ error: "This invitation belongs to a different verified email address." }, 403);
      }
      if (error.code === "P0001") {
        return jsonResponse({ error: "This invitation is invalid, expired, or already used." }, 400);
      }
      throw new Error("Invitation acceptance failed");
    }

    const result = z.object({
      organizationId: z.string().uuid(),
      organizationName: z.string().min(1),
      role: z.enum(["admin", "issuer", "viewer"]),
    }).parse(data);
    return jsonResponse(result);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    if (error instanceof z.ZodError) return jsonResponse({ error: "Invalid invitation request" }, 400);
    const message = error instanceof Error ? error.message : "Invitation acceptance failed";
    if (message === "Authentication required" || message === "Invalid authentication token") {
      return jsonResponse({ error: message }, 401);
    }
    console.error("accept-organization-invitation failed", error);
    return jsonResponse({ error: "Could not accept this invitation right now." }, 503);
  }
});
