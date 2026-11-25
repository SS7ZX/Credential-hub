import { z } from "npm:zod@4";
import {
  handleOptions,
  jsonResponse,
  rateLimit,
  readJson,
  RequestBodyError,
} from "../_shared/http.ts";
import { createOpaqueToken, hashOpaqueToken } from "../_shared/recipient-access.ts";
import { getAdminClient } from "../_shared/supabase.ts";

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("redeem"),
    token: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict(),
  z.object({
    action: z.literal("set-visibility"),
    sessionToken: z.string().regex(/^[0-9a-f]{64}$/),
    visibility: z.enum(["public", "unlisted"]),
  }).strict(),
]);

const redemptionResultSchema = z.object({
  credentialId: z.string().uuid(),
  serialNumber: z.string().min(1),
  visibility: z.enum(["public", "unlisted"]),
  issuedAt: z.string().nullable(),
  achievementName: z.string().nullable(),
}).strict();

const visibilityResultSchema = z.object({
  credentialId: z.string().uuid(),
  serialNumber: z.string().min(1),
  visibility: z.enum(["public", "unlisted"]),
}).strict();

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    if (!await rateLimit(request, "recipient-management", 30, 60)) {
      return jsonResponse({ error: "Too many management attempts. Try again shortly." }, 429);
    }

    const input = requestSchema.parse(await readJson(request, 10_000));
    const admin = getAdminClient();

    if (input.action === "redeem") {
      const sessionToken = createOpaqueToken();
      const { data, error } = await admin.rpc("redeem_recipient_access_token", {
        p_token_hash: await hashOpaqueToken(input.token),
        p_session_hash: await hashOpaqueToken(sessionToken),
      });
      if (error) {
        if (error.code === "P0001" || error.code === "22023") {
          return jsonResponse({ error: "This management link is invalid, expired, or already used." }, 400);
        }
        throw new Error("Could not redeem recipient management link");
      }

      const credential = redemptionResultSchema.parse(data);
      return jsonResponse({ sessionToken, credential });
    }

    const { data, error } = await admin.rpc("set_recipient_credential_visibility", {
      p_session_hash: await hashOpaqueToken(input.sessionToken),
      p_visibility: input.visibility,
    });
    if (error) {
      if (error.code === "P0001" || error.code === "22023") {
        return jsonResponse({ error: "This management session has expired. Ask the issuer to resend your link." }, 401);
      }
      throw new Error("Could not update recipient credential visibility");
    }

    return jsonResponse(visibilityResultSchema.parse(data));
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    if (error instanceof z.ZodError) {
      return jsonResponse({ error: "Invalid recipient management request" }, 400);
    }
    console.error("manage-recipient-credential failed", error);
    return jsonResponse({ error: "Recipient management is temporarily unavailable" }, 503);
  }
});
