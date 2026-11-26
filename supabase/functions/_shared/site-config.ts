function parsePublicSiteUrl(value: string | undefined): URL {
  if (!value) throw new Error("PUBLIC_SITE_URL is not configured");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PUBLIC_SITE_URL must be an absolute URL");
  }

  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback))
    || url.username
    || url.password
    || (url.pathname !== "/" && url.pathname !== "")
    || url.search
    || url.hash
  ) {
    throw new Error("PUBLIC_SITE_URL must be an HTTPS origin (HTTP is allowed only for loopback development)");
  }

  return url;
}

export function getPublicSiteUrl(value = Deno.env.get("PUBLIC_SITE_URL")): string {
  return parsePublicSiteUrl(value).origin;
}

export function getOrganizationDid(value = Deno.env.get("PUBLIC_SITE_URL")): string {
  const url = parsePublicSiteUrl(value);
  const port = url.port ? `%3A${url.port}` : "";
  return `did:web:${url.hostname.toLowerCase()}${port}`;
}
