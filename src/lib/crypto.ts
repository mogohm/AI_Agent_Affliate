import crypto from "node:crypto";
import { env, authSecret } from "@/lib/env";

/** 32-byte key for AES-256-GCM. Uses APP_ENCRYPTION_KEY (base64/hex/any string) or derives from AUTH_SECRET. */
function key(): Buffer {
  const raw = env().APP_ENCRYPTION_KEY;
  if (raw) {
    if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
    const b = Buffer.from(raw, "base64");
    if (b.length === 32) return b;
    return crypto.createHash("sha256").update(raw).digest();
  }
  return crypto.createHash("sha256").update(`enc:${authSecret()}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const [v, ivB, tagB, dataB] = payload.split(":");
  if (v !== "v1" || !ivB || !tagB || !dataB) throw new Error("Unsupported secret format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]).toString("utf8");
}

/** Show only the last 4 characters of a secret. */
export function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) return null;
  return secret.length <= 4 ? "••••" : `••••${secret.slice(-4)}`;
}

export function sha256(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}
