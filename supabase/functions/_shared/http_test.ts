import { corsHeaders, readJson, RequestBodyError } from "./http.ts";

Deno.test("Edge Function CORS allows only the configured public site origin", () => {
  const configuredOrigin = Deno.env.get("PUBLIC_SITE_URL") ?? "http://localhost:5173";
  const expectedOrigin = new URL(configuredOrigin).origin;
  if (corsHeaders["Access-Control-Allow-Origin"] !== expectedOrigin) {
    throw new Error("CORS origin does not match PUBLIC_SITE_URL");
  }
  if (corsHeaders["Access-Control-Allow-Origin"] === "*") {
    throw new Error("Wildcard CORS is not allowed");
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
