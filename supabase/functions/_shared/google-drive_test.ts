import {
  assertDriveFileInFolderTree,
  getDriveAccessToken,
  getDriveFileMetadata,
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
  let postedScope = "";
  const pair = await crypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  }, true, ["sign", "verify"]);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const privateKey = `-----BEGIN PRIVATE KEY-----\n${
    btoa(String.fromCharCode(...pkcs8)).match(/.{1,64}/g)?.join("\n")
  }\n-----END PRIVATE KEY-----`;
  const requestFetch: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    postedScope = new URLSearchParams(String(init?.body)).get("assertion") ?? "";
    return new Response(JSON.stringify({ access_token: "unit-test-token" }), {
      headers: { "content-type": "application/json" },
    });
  };
  const serviceAccount = JSON.stringify({
    client_email: "unit-test@sample-project.iam.gserviceaccount.com",
    private_key: privateKey,
  });
  const token = await getDriveAccessToken(serviceAccount, requestFetch);
  if (token !== "unit-test-token") throw new Error("OAuth response was not parsed");
  if (requestedUrl !== "https://oauth2.googleapis.com/token") {
    throw new Error("OAuth request used an unexpected URL");
  }
  const assertion = postedScope;
  if (!assertion.split(".")[1]) throw new Error("OAuth request did not contain a signed JWT assertion");
  const jwtPayload = JSON.parse(atob(assertion.split(".")[1])) as { scope?: string };
  if (jwtPayload.scope !== "https://www.googleapis.com/auth/drive.readonly") {
    throw new Error("OAuth token was not limited to read-only Drive access");
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

Deno.test("file access remains within the selected folder and its first-level subfolders", async () => {
  const records = new Map([
    ["root_abcdef1234", {
      id: "root_abcdef1234",
      name: "Root",
      mimeType: "application/vnd.google-apps.folder",
      parents: [],
    }],
    ["child_abcdef1234", {
      id: "child_abcdef1234",
      name: "Child",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["root_abcdef1234"],
    }],
    ["file_abcdef1234", {
      id: "file_abcdef1234",
      name: "Certificate.pdf",
      mimeType: "application/pdf",
      parents: ["child_abcdef1234"],
    }],
    ["other_abcdef1234", {
      id: "other_abcdef1234",
      name: "Outside.pdf",
      mimeType: "application/pdf",
      parents: ["elsewhere_abcdef"],
    }],
  ]);
  const fakeFetch: typeof fetch = async (input) => {
    const url = new URL(String(input));
    const id = url.pathname.split("/").at(-1) ?? "";
    const record = records.get(id);
    return record
      ? new Response(JSON.stringify(record), { headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  };
  const child = await getDriveFileMetadata("file_abcdef1234", "unit-test-token", fakeFetch);
  await assertDriveFileInFolderTree(child, "root_abcdef1234", "unit-test-token", fakeFetch);
  const outside = await getDriveFileMetadata("other_abcdef1234", "unit-test-token", fakeFetch);
  let rejected = false;
  try {
    await assertDriveFileInFolderTree(outside, "root_abcdef1234", "unit-test-token", fakeFetch);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("A file outside the selected folder tree was accepted");
});
