import { isVerifiedAllowlistedOwner } from "./owner.ts";

Deno.test("owner allowlist compares normalized verified email addresses", () => {
  if (!isVerifiedAllowlistedOwner(
    { email: " Owner@TasdiqApp.com ", emailConfirmedAt: "2026-01-01T00:00:00Z" },
    "owner@tasdiqapp.com",
  )) {
    throw new Error("A verified matching owner email was rejected");
  }
});

Deno.test("owner allowlist rejects unverified and non-matching accounts", () => {
  const allowedEmail = "owner@tasdiqapp.com";
  for (const identity of [
    { email: "owner@tasdiqapp.com", emailConfirmedAt: null },
    { email: "other@tasdiqapp.com", emailConfirmedAt: "2026-01-01T00:00:00Z" },
    { email: null, emailConfirmedAt: "2026-01-01T00:00:00Z" },
  ]) {
    if (isVerifiedAllowlistedOwner(identity, allowedEmail)) {
      throw new Error("An unverified or non-matching account was allowed");
    }
  }
});
