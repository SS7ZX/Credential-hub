import { createOpaqueToken, hashOpaqueToken } from "./recipient-access.ts";

Deno.test("recipient access tokens are random hex values stored only as a digest", async () => {
  const token = createOpaqueToken();
  const digest = await hashOpaqueToken(token);

  if (!/^[0-9a-f]{64}$/.test(token) || !/^[0-9a-f]{64}$/.test(digest) || digest === token) {
    throw new Error("Recipient access token is not safely encoded and hashed");
  }
});
