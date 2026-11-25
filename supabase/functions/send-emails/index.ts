import { z } from "npm:zod@4";
import {
  handleOptions,
  jsonResponse,
  readJson,
  RequestBodyError,
} from "../_shared/http.ts";
import { createOpaqueToken, hashOpaqueToken } from "../_shared/recipient-access.ts";
import { getAdminClient, requireOrganizationRole } from "../_shared/supabase.ts";

const credentialRequestSchema = z.object({
  organizationId: z.string().uuid(),
  credentialIds: z.array(z.string().uuid()).min(1).max(50),
}).strict();
const invitationRequestSchema = z.object({
  action: z.literal("invite-member"),
  organizationId: z.string().uuid(),
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  role: z.enum(["admin", "issuer", "viewer"]),
}).strict();
const requestSchema = z.union([invitationRequestSchema, credentialRequestSchema]);

type Recipient = { email: string | null; full_name: string | null };
type CredentialRow = {
  id: string;
  status: string;
  recipients: Recipient | Recipient[] | null;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

type EmailConfiguration = {
  apiKey: string;
  from: string;
  siteUrl: string;
  sandbox: boolean;
  sandboxTo: string | undefined;
  dailyLimit: number;
};

async function completeEmailAttempt(
  admin: ReturnType<typeof getAdminClient>,
  attemptId: string,
  providerId: string | null,
  status: "sent" | "failed",
  detail: string | null,
  sandbox: boolean,
) {
  const { error } = await admin.rpc("complete_email_send", {
    p_attempt_id: attemptId,
    p_provider_id: providerId,
    p_status: status,
    p_detail: detail,
    p_sandbox: sandbox,
  });
  if (error) throw new Error("Could not record the email attempt");
}

async function sendInvitationEmail(
  admin: ReturnType<typeof getAdminClient>,
  configuration: EmailConfiguration,
  input: z.infer<typeof invitationRequestSchema>,
  actorId: string,
) {
  const { data: reservationId, error: reservationError } = await admin.rpc("reserve_email_send", {
    p_organization_id: input.organizationId,
    p_credential_id: null,
    p_daily_limit: configuration.dailyLimit,
  });
  if (reservationError) throw new Error("Could not enforce the daily email limit");
  if (reservationId === null) {
    const { error } = await admin.from("email_events").insert({
      organization_id: input.organizationId,
      credential_id: null,
      type: "throttled",
      payload: { category: "organization_invitation" },
    });
    if (error) throw new Error("Could not save the invitation throttle event");
    return { sent: 0, failed: 0, throttled: 1 };
  }
  if (typeof reservationId !== "string") {
    throw new Error("The daily email limit returned an invalid reservation");
  }

  const { data: invitationData, error: invitationError } = await admin.rpc(
    "create_organization_invitation",
    {
      p_organization_id: input.organizationId,
      p_email: input.email,
      p_role: input.role,
      p_actor_id: actorId,
    },
  );
  if (invitationError) {
    await completeEmailAttempt(
      admin,
      reservationId,
      null,
      "failed",
      "Could not create organization invitation",
      configuration.sandbox,
    );
    if (invitationError.code === "P0001") {
      throw new Error(invitationError.message);
    }
    throw new Error("Could not create organization invitation");
  }

  const invitation = z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    role: z.enum(["admin", "issuer", "viewer"]),
    organizationName: z.string().min(1),
    hasAccount: z.boolean(),
  }).parse(invitationData);
  const redirectTo = `${configuration.siteUrl.replace(/\/$/, "")}/invite?invitation=${invitation.id}`;
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: invitation.hasAccount ? "magiclink" : "invite",
    email: invitation.email,
    options: { redirectTo },
  });
  const actionLink = linkData?.properties?.action_link;
  if (linkError || !actionLink) {
    await completeEmailAttempt(
      admin,
      reservationId,
      null,
      "failed",
      "Could not create secure sign-in link",
      configuration.sandbox,
    );
    return { sent: 0, failed: 1, throttled: 0 };
  }

  const targetEmail = configuration.sandbox
    ? configuration.sandboxTo
    : invitation.email;
  if (!targetEmail) throw new Error("Email recipient is unavailable");

  let response: Response;
  let responseText: string;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${configuration.apiKey}`,
        "content-type": "application/json",
        "Idempotency-Key": reservationId,
      },
      body: JSON.stringify({
        from: configuration.from,
        to: [targetEmail],
        subject: `Invitation to join ${invitation.organizationName} on Tasdiq`,
        text: `You have been invited to join ${invitation.organizationName} as ${invitation.role}. Accept the invitation using this secure link: ${actionLink}`,
        html: `<p>You have been invited to join <strong>${escapeHtml(invitation.organizationName)}</strong> as ${escapeHtml(invitation.role)}.</p><p><a href="${escapeHtml(actionLink)}">Accept your invitation</a></p><p>This link confirms the invited email address and expires according to the authentication provider's link policy. Organization invitations expire in seven days.</p>`,
      }),
    });
    responseText = await response.text();
  } catch {
    await completeEmailAttempt(
      admin,
      reservationId,
      null,
      "failed",
      "Email provider request failed",
      configuration.sandbox,
    );
    return { sent: 0, failed: 1, throttled: 0 };
  }

  let providerResponse: { id?: string; message?: string } = {};
  if (responseText) {
    try {
      providerResponse = JSON.parse(responseText) as typeof providerResponse;
    } catch {
      providerResponse = { message: "Email provider returned an unreadable response" };
    }
  }
  const status = response.ok ? "sent" : "failed";
  await completeEmailAttempt(
    admin,
    reservationId,
    providerResponse.id ?? null,
    status,
    response.ok ? null : providerResponse.message ?? "Email provider rejected the request",
    configuration.sandbox,
  );
  return {
    sent: response.ok ? 1 : 0,
    failed: response.ok ? 0 : 1,
    throttled: 0,
  };
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const input = requestSchema.parse(await readJson(request));
    const membership = await requireOrganizationRole(
      request,
      input.organizationId,
      "action" in input ? ["owner"] : ["owner", "admin", "issuer"],
    );

    const apiKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("RESEND_FROM_EMAIL");
    const siteUrl = Deno.env.get("PUBLIC_SITE_URL");
    const sandbox = Deno.env.get("RESEND_SANDBOX") !== "false";
    const sandboxTo = Deno.env.get("RESEND_SANDBOX_TO");
    const dailyLimit = Number(Deno.env.get("RESEND_DAILY_PLAN_LIMIT"));
    if (
      !apiKey || !from || !siteUrl ||
      (sandbox && !sandboxTo) ||
      !Number.isSafeInteger(dailyLimit) || dailyLimit < 1
    ) {
      throw new Error("Email sending configuration is incomplete");
    }

    const admin = getAdminClient();
    const configuration = { apiKey, from, siteUrl, sandbox, sandboxTo, dailyLimit };
    if ("action" in input) {
      return jsonResponse(await sendInvitationEmail(admin, configuration, input, membership.userId));
    }

    const results: Array<{ credentialId: string; status: "sent" | "failed" | "throttled"; detail?: string }> = [];
    for (const credentialId of new Set(input.credentialIds)) {
      const { data: credentialData, error: credentialError } = await admin
        .from("credentials")
        .select("id, status, recipients(email, full_name)")
        .eq("organization_id", input.organizationId)
        .eq("id", credentialId)
        .maybeSingle();
      if (credentialError) throw new Error("Could not load credential recipient");
      const credential = credentialData as CredentialRow | null;
      const recipient = Array.isArray(credential?.recipients)
        ? credential.recipients[0]
        : credential?.recipients;
      if (!credential || credential.status !== "issued" || !recipient?.email) {
        results.push({ credentialId, status: "failed", detail: "Issued credential recipient is unavailable" });
        continue;
      }

      const { data: reservationId, error: limitError } = await admin.rpc("reserve_email_send", {
        p_organization_id: input.organizationId,
        p_credential_id: credential.id,
        p_daily_limit: dailyLimit,
      });
      if (limitError) {
        throw new Error("Could not enforce the daily email limit");
      }
      if (reservationId === null) {
        const { error: logError } = await admin.from("email_events").insert({
          organization_id: input.organizationId,
          credential_id: credential.id,
          type: "throttled",
          payload: { detail: "Organization daily sending limit reached" },
        });
        if (logError) throw new Error("Could not save the email throttle event");
        results.push({ credentialId, status: "throttled", detail: "The organization daily sending limit has been reached" });
        continue;
      }
      if (typeof reservationId !== "string") {
        throw new Error("The daily email limit returned an invalid reservation");
      }

      const accessToken = createOpaqueToken();
      const { data: accessData, error: accessError } = await admin.rpc(
        "create_recipient_access_token",
        {
          p_credential_id: credential.id,
          p_token_hash: await hashOpaqueToken(accessToken),
        },
      );
      if (accessError) {
        const { error: completionError } = await admin.rpc("complete_email_send", {
          p_attempt_id: reservationId,
          p_provider_id: null,
          p_status: "failed",
          p_detail: "Could not create recipient management link",
          p_sandbox: sandbox,
        });
        if (completionError) throw new Error("Could not record the failed email attempt");
        results.push({ credentialId, status: "failed", detail: "Could not create recipient management link" });
        continue;
      }
      const access = accessData as { email?: unknown; name?: unknown } | null;
      if (!access || typeof access.email !== "string") {
        const { error: completionError } = await admin.rpc("complete_email_send", {
          p_attempt_id: reservationId,
          p_provider_id: null,
          p_status: "failed",
          p_detail: "Recipient management link returned invalid recipient details",
          p_sandbox: sandbox,
        });
        if (completionError) throw new Error("Could not record the failed email attempt");
        results.push({ credentialId, status: "failed", detail: "Recipient management link could not be created" });
        continue;
      }

      const shareUrl = `${siteUrl.replace(/\/$/, "")}/c/${credential.id}`;
      const manageUrl = `${siteUrl.replace(/\/$/, "")}/manage#${accessToken}`;
      const targetEmail = sandbox ? sandboxTo : access.email;
      if (!targetEmail) throw new Error("Email recipient is unavailable");
      const recipientName = sandbox
        ? undefined
        : typeof access.name === "string" ? access.name.trim() : undefined;
      const greeting = recipientName ? `Hello ${escapeHtml(recipientName)},` : "Hello,";
      let response: Response;
      let responseText: string;
      try {
        response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            "Idempotency-Key": reservationId,
          },
          body: JSON.stringify({
            from,
            to: [targetEmail],
            subject: "Your Tasdiq digital credential",
            text: `${recipientName ? `Hello ${recipientName},\n\n` : "Hello,\n\n"}Your digital credential is ready to view and share: ${shareUrl}\n\nManage its visibility using this one-time link (expires in 30 minutes): ${manageUrl}`,
            html: `<p>${greeting}</p><p>Your digital credential is ready to view and share.</p><p><a href="${escapeHtml(shareUrl)}">View your credential</a></p><p><a href="${escapeHtml(manageUrl)}">Manage credential visibility</a> (one-time link, expires in 30 minutes)</p>`,
          }),
        });
        responseText = await response.text();
      } catch {
        const { error: completionError } = await admin.rpc("complete_email_send", {
          p_attempt_id: reservationId,
          p_provider_id: null,
          p_status: "failed",
          p_detail: "Email provider request failed",
          p_sandbox: sandbox,
        });
        if (completionError) throw new Error("Could not record the failed email attempt");
        results.push({ credentialId, status: "failed", detail: "Email provider request failed" });
        continue;
      }
      let providerResponse: { id?: string; message?: string } = {};
      if (responseText) {
        try {
          providerResponse = JSON.parse(responseText) as typeof providerResponse;
        } catch {
          providerResponse = { message: "Email provider returned an unreadable response" };
        }
      }
      const status = response.ok ? "sent" : "failed";
      const detail = response.ok ? undefined : providerResponse.message ?? "Email provider rejected the request";
      const { error: completionError } = await admin.rpc("complete_email_send", {
        p_attempt_id: reservationId,
        p_provider_id: providerResponse.id ?? null,
        p_status: status,
        p_detail: detail ?? null,
        p_sandbox: sandbox,
      });
      if (completionError) throw new Error("Email was attempted but its audit event could not be saved");
      results.push({ credentialId, status, ...(detail ? { detail } : {}) });
    }

    return jsonResponse({
      sent: results.filter((result) => result.status === "sent").length,
      failed: results.filter((result) => result.status === "failed").length,
      throttled: results.filter((result) => result.status === "throttled").length,
      results,
    });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    if (error instanceof z.ZodError) return jsonResponse({ error: "Invalid email request" }, 400);
    console.error("send-emails failed", error);
    const message = error instanceof Error ? error.message : "Email sending failed";
    if (/Authentication required|Invalid authentication token|organization role/i.test(message)) {
      return jsonResponse({ error: message }, 403);
    }
    return jsonResponse({ error: "Email sending is temporarily unavailable" }, 503);
  }
});
