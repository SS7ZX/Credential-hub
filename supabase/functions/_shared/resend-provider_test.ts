import { submitResendEmail } from "./resend-provider.ts";

Deno.test("Resend transport outage is recorded as a failed submission", async () => {
  const result = await submitResendEmail(
    "local-test-key",
    "local-attempt-id",
    { to: ["recipient@example.test"] },
    async () => {
      throw new TypeError("network unavailable");
    },
  );
  if (
    result.accepted
    || result.providerId !== null
    || result.detail !== "Email provider request failed"
  ) throw new Error("Resend outage did not become a sanitized failed submission");
});

Deno.test("Resend HTTP rejection is failed and preserves the reservation idempotency key", async () => {
  let idempotencyKey = "";
  const result = await submitResendEmail(
    "local-test-key",
    "local-attempt-id",
    { to: ["recipient@example.test"] },
    async (_input, init) => {
      idempotencyKey = new Headers(init?.headers).get("Idempotency-Key") ?? "";
      return Response.json({ message: "provider temporarily unavailable" }, { status: 503 });
    },
  );
  if (
    result.accepted
    || idempotencyKey !== "local-attempt-id"
    || result.detail !== "provider temporarily unavailable"
  ) throw new Error("Resend rejection or idempotency key was mishandled");
});

Deno.test("Resend acceptance records provider message id but is not a delivery receipt", async () => {
  const result = await submitResendEmail(
    "local-test-key",
    "local-attempt-id",
    { to: ["recipient@example.test"] },
    async () => Response.json({ id: "resend-message-id" }, { status: 200 }),
  );
  if (!result.accepted || result.providerId !== "resend-message-id" || result.detail) {
    throw new Error("Resend acceptance response was not represented correctly");
  }
});
