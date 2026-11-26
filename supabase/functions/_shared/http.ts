import { getAdminClient } from "./supabase.ts";
import { getPublicSiteUrl } from "./site-config.ts";

const corsOrigin = getPublicSiteUrl(
  Deno.env.get("PUBLIC_SITE_URL") ?? "http://localhost:5173",
);
export const corsHeaders = {
  "Access-Control-Allow-Origin": corsOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
export const publicCorsHeaders = {
  ...corsHeaders,
  "Access-Control-Allow-Origin": "*",
};

const wildcardCorsFunctions = new Set(["did-document", "public-keys", "get-credential"]);

export function corsHeadersForFunction(functionName: string) {
  return wildcardCorsFunctions.has(functionName) ? publicCorsHeaders : corsHeaders;
}

export function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

export function handleOptions(request: Request, headers: HeadersInit = corsHeaders): Response | null {
  return request.method === "OPTIONS"
    ? new Response("ok", { headers })
    : null;
}

export class RequestBodyError extends Error {
  constructor(
    readonly status: 400 | 413,
    message: string,
  ) {
    super(message);
    this.name = "RequestBodyError";
  }
}

export async function readJson(
  request: Request,
  maxBytes = 1_000_000,
): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new RequestBodyError(400, "Invalid Content-Length header");
    }
    if (Number(declaredLength) > maxBytes) {
      throw new RequestBodyError(413, "Request body is too large");
    }
  }

  const reader = request.body?.getReader();
  if (!reader) throw new RequestBodyError(400, "Request body must be valid JSON");

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new RequestBodyError(413, "Request body is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw new RequestBodyError(400, "Request body must be valid JSON");
  }
}

export async function rateLimit(
  request: Request,
  endpoint: string,
  limit = 60,
  windowSeconds = 60,
): Promise<boolean> {
  const ip = request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const secret = Deno.env.get("RATE_LIMIT_HASH_SECRET");
  if (!ip || !secret) throw new Error("Public rate-limit configuration is incomplete");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${endpoint}:${ip}`),
  );
  const bucketKey = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

  const { data, error } = await getAdminClient().rpc("consume_api_rate_limit", {
    p_bucket_key: bucketKey,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error || typeof data !== "boolean") {
    throw new Error("Could not enforce public rate limit");
  }
  return data;
}

export function getBearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") ? value.slice(7) : null;
}
