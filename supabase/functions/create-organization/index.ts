import { z } from "npm:zod@4";
import { isVerifiedAllowlistedOwner } from "../_shared/owner.ts";
import {
  handleOptions,
  jsonResponse,
  readJson,
  RequestBodyError,
} from "../_shared/http.ts";
import { authenticateRequest, getAdminClient } from "../_shared/supabase.ts";
import { getOrganizationDid } from "../_shared/site-config.ts";

const organizationSchema = z.object({
  name: z.string().trim().min(1).max(200)
    .transform((value) => value.replace(/\s+/g, " ")),
  slug: z.string().trim().toLowerCase().min(1).max(100)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
}).strict();

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const allowedEmail = Deno.env.get("ISSUER_OWNER_EMAIL")?.trim();
    if (!allowedEmail) throw new Error("Owner allowlist is not configured");

    const { user, userId } = await authenticateRequest(request);
    if (!isVerifiedAllowlistedOwner(
      { email: user.email ?? null, emailConfirmedAt: user.email_confirmed_at ?? null },
      allowedEmail,
    )) {
      return jsonResponse({ error: "Only the configured verified owner can create an organization" }, 403);
    }

    const input = organizationSchema.parse(await readJson(request, 10_000));
    const { data, error } = await getAdminClient().rpc("create_organization", {
      p_name: input.name,
      p_slug: input.slug,
      p_did: getOrganizationDid(),
      p_user_id: userId,
    });
    if (error) {
      if (error.code === "23505") {
        return jsonResponse({ error: "An organization with that slug already exists" }, 409);
      }
      throw new Error("Could not provision organization");
    }
    if (typeof data !== "string") throw new Error("Organization provisioning returned an invalid result");

    return jsonResponse({ id: data }, 201);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    if (error instanceof z.ZodError) {
      return jsonResponse({ error: "Invalid organization details", issues: error.issues }, 400);
    }

    const message = error instanceof Error ? error.message : "Organization provisioning failed";
    if (/Authentication required|Invalid authentication token/i.test(message)) {
      return jsonResponse({ error: message }, 401);
    }
    if (
      message === "Owner allowlist is not configured" ||
      message === "PUBLIC_SITE_URL is not configured" ||
      message === "Supabase authentication configuration is incomplete"
    ) {
      console.error("create-organization configuration is incomplete");
      return jsonResponse({ error: "Organization provisioning is not configured" }, 503);
    }

    console.error("create-organization failed", error);
    return jsonResponse({ error: "Organization provisioning is temporarily unavailable" }, 503);
  }
});
