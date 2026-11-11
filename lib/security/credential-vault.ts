import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedCredentials = {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
};

function getEncryptionKey(): Buffer {
  const value = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!value) throw new Error("Set CREDENTIAL_ENCRYPTION_KEY in the server environment before saving credentials.");

  const key = /^[a-f\d]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("CREDENTIAL_ENCRYPTION_KEY must be 32 bytes encoded as base64 or 64 hexadecimal characters.");
  return key;
}

export function isCredentialEncryptionConfigured(): boolean {
  try { getEncryptionKey(); return true; }
  catch { return false; }
}

export function encryptCredentials(value: { username: string; password: string }): EncryptedCredentials {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptCredentials(value: unknown): { username: string; password: string } | null {
  if (!value || typeof value !== "object") return null;
  const encrypted = value as Partial<EncryptedCredentials>;
  if (encrypted.version !== 1 || !encrypted.iv || !encrypted.tag || !encrypted.ciphertext) return null;
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  const credentials = JSON.parse(plaintext) as { username?: unknown; password?: unknown };
  if (typeof credentials.username !== "string" || typeof credentials.password !== "string") return null;
  return { username: credentials.username, password: credentials.password };
}
