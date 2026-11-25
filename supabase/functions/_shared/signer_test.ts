import { importJWK, jwtVerify } from "npm:jose@6";
import { EnvKeySigner } from "./signer.ts";

function toPem(label: string, value: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(value)));
  const lines = base64.match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}

async function createEd25519Keys(): Promise<{ privateKeyPem: string; publicKeyPem: string }> {
  const generated = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  if (!("privateKey" in generated) || !("publicKey" in generated)) {
    throw new Error("Ed25519 key-pair generation returned a single key");
  }
  const pair = generated;
  const privateKey = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const publicKey = await crypto.subtle.exportKey("spki", pair.publicKey);
  return {
    privateKeyPem: toPem("PRIVATE KEY", privateKey),
    publicKeyPem: toPem("PUBLIC KEY", publicKey),
  };
}

Deno.test("EnvKeySigner signs VC-JWTs with the matching configured public key", async () => {
  const keys = await createEd25519Keys();
  const signer = new EnvKeySigner({
    keyId: "test-ed25519",
    algorithm: "EdDSA",
    ...keys,
  });
  const token = await signer.sign({ id: "https://tasdiqapp.com/credentials/test" });
  const verified = await jwtVerify(token, await importJWK(await signer.getPublicJwk(), "EdDSA"), {
    algorithms: ["EdDSA"],
  });

  if (
    verified.protectedHeader.typ !== "vc+jwt" ||
    verified.protectedHeader.cty !== "vc" ||
    verified.protectedHeader.kid !== "test-ed25519" ||
    verified.payload.id !== "https://tasdiqapp.com/credentials/test"
  ) {
    throw new Error("Signer did not produce the expected VC-JWT");
  }
});

Deno.test("EnvKeySigner rejects mismatched private and public keys", async () => {
  const privateKeys = await createEd25519Keys();
  const publicKeys = await createEd25519Keys();
  const signer = new EnvKeySigner({
    keyId: "test-ed25519",
    algorithm: "EdDSA",
    privateKeyPem: privateKeys.privateKeyPem,
    publicKeyPem: publicKeys.publicKeyPem,
  });

  try {
    await signer.sign({ id: "https://tasdiqapp.com/credentials/test" });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Configured private and public signing keys do not match"
    ) {
      return;
    }
    throw error;
  }
  throw new Error("Signer accepted mismatched private and public keys");
});
