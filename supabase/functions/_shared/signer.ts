import {
  exportJWK,
  importPKCS8,
  importSPKI,
  SignJWT,
  jwtVerify,
  type JWK,
  type JWTVerifyResult,
} from "npm:jose@6";

export type SigningAlgorithm = "EdDSA" | "ES256" | "RS256";

export interface Signer {
  sign(credential: Record<string, unknown>): Promise<string>;
  getPublicJwk(): Promise<JWK>;
  kid(): string;
}

interface SigningKeyConfiguration {
  keyId: string;
  algorithm: string;
  privateKeyPem: string;
  publicKeyPem: string;
}

function isSigningAlgorithm(value: string): value is SigningAlgorithm {
  return value === "EdDSA" || value === "ES256" || value === "RS256";
}

function readSigningKeyConfiguration(): SigningKeyConfiguration {
  const keyId = Deno.env.get("CREDENTIAL_SIGNING_KID") ?? "";
  const algorithm = Deno.env.get("CREDENTIAL_SIGNING_ALGORITHM") ?? "EdDSA";
  const privateKeyPem = Deno.env.get("CREDENTIAL_SIGNING_KEY_PKCS8");
  const publicKeyPem = Deno.env.get("CREDENTIAL_SIGNING_PUBLIC_KEY_SPKI");

  if (!keyId) throw new Error("CREDENTIAL_SIGNING_KID is not configured");
  if (!privateKeyPem) throw new Error("CREDENTIAL_SIGNING_KEY_PKCS8 is not configured");
  if (!publicKeyPem) throw new Error("CREDENTIAL_SIGNING_PUBLIC_KEY_SPKI is not configured");

  return { keyId, algorithm, privateKeyPem, publicKeyPem };
}

export class EnvKeySigner implements Signer {
  private readonly keyId: string;
  private readonly algorithm: SigningAlgorithm;
  private readonly keyPromise: Promise<CryptoKey>;
  private readonly publicKeyPromise: Promise<CryptoKey>;
  private readonly validationPromise: Promise<void>;

  constructor(configuration: SigningKeyConfiguration = readSigningKeyConfiguration()) {
    if (!configuration.keyId) throw new Error("CREDENTIAL_SIGNING_KID is not configured");
    if (!isSigningAlgorithm(configuration.algorithm)) {
      throw new Error("Unsupported signing algorithm");
    }
    this.keyId = configuration.keyId;
    this.algorithm = configuration.algorithm;

    const privatePem = configuration.privateKeyPem.replaceAll("\\n", "\n");
    const publicPem = configuration.publicKeyPem.replaceAll("\\n", "\n");

    this.keyPromise = importPKCS8(privatePem, this.algorithm);
    this.publicKeyPromise = importSPKI(publicPem, this.algorithm);
    this.validationPromise = this.validateKeyPair();
  }

  private async validateKeyPair(): Promise<void> {
    const challenge = "credential-hub-key-pair-check";
    const token = await new SignJWT({ challenge })
      .setProtectedHeader({ alg: this.algorithm, kid: this.keyId, typ: "vc+jwt", cty: "vc" })
      .sign(await this.keyPromise);
    let verified: JWTVerifyResult;
    try {
      verified = await jwtVerify(token, await this.publicKeyPromise, {
        algorithms: [this.algorithm],
      });
    } catch {
      throw new Error("Configured private and public signing keys do not match");
    }
    if (verified.payload.challenge !== challenge) {
      throw new Error("Configured private and public signing keys do not match");
    }
  }

  kid(): string {
    return this.keyId;
  }

  async sign(credential: Record<string, unknown>): Promise<string> {
    await this.validationPromise;
    const key = await this.keyPromise;
    return await new SignJWT(credential)
      .setProtectedHeader({ alg: this.algorithm, kid: this.keyId, typ: "vc+jwt", cty: "vc" })
      .sign(key);
  }

  async getPublicJwk(): Promise<JWK> {
    const jwk = await exportJWK(await this.publicKeyPromise);
    jwk.kid = this.keyId;
    jwk.alg = this.algorithm;
    jwk.use = "sig";
    return jwk;
  }
}
