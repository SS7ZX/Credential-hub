import { fetchIssuerDiscovery, type DiscoveryDocument } from "./_shared/issuer-discovery-proxy.ts";

type VercelRequest = {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
};

type VercelResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): VercelResponse;
  send(body: string): void;
};

declare const process: { env: Record<string, string | undefined> };

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET") {
    response.status(405).send(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const document = request.query?.document;
  if (document !== "did" && document !== "jwks") {
    response.status(404).send(JSON.stringify({ error: "Not found" }));
    return;
  }

  const result = await fetchIssuerDiscovery(
    document as DiscoveryDocument,
    process.env,
  );
  response.status(result.status);
  for (const name of ["Content-Type", "Cache-Control", "X-Content-Type-Options"]) {
    const value = result.headers.get(name);
    if (value) response.setHeader(name, value);
  }
  response.send(await result.text());
}
