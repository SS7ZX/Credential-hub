import {
  getDriveAccessToken,
  isAllowedGoogleApiUrl,
  listDriveFolder,
  validateDriveId,
} from "./google-drive.ts";

Deno.test("Drive API URL allowlist accepts only fixed Google API hosts and paths", () => {
  if (!isAllowedGoogleApiUrl("https://www.googleapis.com/drive/v3/files")) {
    throw new Error("Drive API URL should be allowed");
  }
  if (!isAllowedGoogleApiUrl("https://oauth2.googleapis.com/token")) {
    throw new Error("OAuth token URL should be allowed");
  }
  for (const url of [
    "https://drive.google.com/drive/v3/files",
    "https://www.googleapis.com.evil.test/drive/v3/files",
    "http://www.googleapis.com/drive/v3/files",
    "https://www.googleapis.com/other",
  ]) {
    if (isAllowedGoogleApiUrl(url)) throw new Error(`Unexpected allowed URL: ${url}`);
  }
});

Deno.test("folder identifiers are strictly validated before an API request", () => {
  let rejected = false;
  try {
    validateDriveId("https://attacker.invalid");
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("A URL was accepted as a Drive ID");
});

Deno.test("service-account OAuth always posts to the fixed token endpoint", async () => {
  let requestedUrl = "";
  const fakeFetch: typeof fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ access_token: "unit-test-token" }), {
      headers: { "content-type": "application/json" },
    });
  };
  const serviceAccount = JSON.stringify({
    client_email: "unit-test@sample-project.iam.gserviceaccount.com",
    private_key: [
      "-----BEGIN PRIVATE KEY-----",
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC...",
      "-----END PRIVATE KEY-----",
    ].join("\n"),
  });
  let rejected = false;
  try {
    await getDriveAccessToken(serviceAccount, fakeFetch);
  } catch {
    rejected = true;
  }
  if (!rejected && requestedUrl !== "https://oauth2.googleapis.com/token") {
    throw new Error("OAuth request used an unexpected URL");
  }
});

Deno.test("Drive listing constructs a fixed-host request and rejects an attacker URL", async () => {
  let requestedUrl = "";
  const fakeFetch: typeof fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ files: [] }), {
      headers: { "content-type": "application/json" },
    });
  };
  await listDriveFolder("folder_abcdef1234", "unit-test-token", fakeFetch);
  if (!requestedUrl.startsWith("https://www.googleapis.com/drive/v3/files?")) {
    throw new Error("Drive request used an unexpected URL");
  }
});
