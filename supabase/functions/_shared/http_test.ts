import { corsHeaders, corsHeadersForFunction, handleOptions, publicCorsHeaders, readJson, RequestBodyError } from "./http.ts";

Deno.test("site-restricted Edge Function CORS allows only the configured public site origin", () => {
  const configuredOrigin = Deno.env.get("PUBLIC_SITE_URL") ?? "http://localhost:5173";
  const expectedOrigin = new URL(configuredOrigin).origin;
  if (corsHeaders["Access-Control-Allow-Origin"] !== expectedOrigin) {
    throw new Error("CORS origin does not match PUBLIC_SITE_URL");
  }
  if (corsHeaders["Access-Control-Allow-Origin"] === "*") {
    throw new Error("Wildcard CORS is not allowed");
  }
});

Deno.test("only public issuer read functions use wildcard CORS without credentials", () => {
  const publicFunctions = ["did-document", "public-keys", "get-credential"];
  const restrictedFunctions = [
    "verify-credential",
    "manage-recipient-credential",
    "issue-batch",
    "generate-pdf",
    "create-organization",
    "send-emails",
    "accept-organization-invitation",
    "list-drive-folder",
    "preview-drive-file",
    "stamp-one-file",
    "finalize-run",
    "anonymize-recipient",
  ];

  for (const name of publicFunctions) {
    if (corsHeadersForFunction(name)["Access-Control-Allow-Origin"] !== "*") {
      throw new Error(`${name} must allow public read-only browser access`);
    }
  }
  for (const name of restrictedFunctions) {
    if (corsHeadersForFunction(name)["Access-Control-Allow-Origin"] !== corsHeaders["Access-Control-Allow-Origin"]) {
      throw new Error(`${name} must restrict browser access to PUBLIC_SITE_URL`);
    }
  }
  if ("Access-Control-Allow-Credentials" in publicCorsHeaders) {
    throw new Error("Wildcard CORS must not allow credentials");
  }

  const preflight = handleOptions(new Request("https://edge.test", { method: "OPTIONS" }), publicCorsHeaders);
  if (preflight?.headers.get("Access-Control-Allow-Origin") !== "*") {
    throw new Error("Public endpoint preflight did not use wildcard CORS");
  }
});

Deno.test("readJson parses a bounded JSON request body", async () => {
  const result = await readJson(new Request("https://local.test", {
    method: "POST",
    body: JSON.stringify({ ok: true }),
  }));
  if (!result || typeof result !== "object" || (result as { ok?: boolean }).ok !== true) {
    throw new Error("JSON request body was not parsed");
  }
});

Deno.test("readJson rejects oversized bodies even without Content-Length", async () => {
  try {
    await readJson(new Request("https://local.test", {
      method: "POST",
      body: "12345",
    }), 4);
  } catch (error) {
    if (error instanceof RequestBodyError && error.status === 413) return;
    throw error;
  }
  throw new Error("Oversized body was accepted");
});

Deno.test("readJson reports malformed JSON as a client error", async () => {
  try {
    await readJson(new Request("https://local.test", {
      method: "POST",
      body: "{invalid",
    }));
  } catch (error) {
    if (error instanceof RequestBodyError && error.status === 400) return;
    throw error;
  }
  throw new Error("Malformed JSON was accepted");
});
