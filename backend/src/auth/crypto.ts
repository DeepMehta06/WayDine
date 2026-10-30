import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** Versioned AES-GCM envelopes, purpose-bound to prevent cookie/token substitution. */
export class AuthCipher {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, "base64");
    if (this.key.length !== 32) throw new Error("Authentication encryption requires a 32-byte key.");
  }

  seal(value: string, purpose: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(`waydine:v1:${purpose}`));
    const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return `v1.${Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url")}`;
  }

  open(value: string, purpose: string): string {
    if (!value.startsWith("v1.") || value.length > 12000) throw new Error("Invalid authentication envelope.");
    const data = Buffer.from(value.slice(3), "base64url");
    if (data.length < 29) throw new Error("Invalid authentication envelope.");
    const decipher = createDecipheriv("aes-256-gcm", this.key, data.subarray(0, 12));
    decipher.setAAD(Buffer.from(`waydine:v1:${purpose}`));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
  }
}

export const newSessionToken = () => randomBytes(32).toString("base64url");
export const sessionHash = (token: string) => createHash("sha256").update(token).digest("hex");
