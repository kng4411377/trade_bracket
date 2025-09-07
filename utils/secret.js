import crypto from "node:crypto";
const PREFIX = "rhenc.v1";

// AES-256-GCM with scrypt-derived key; binds secrets to RH_PASSWORD
export function encryptWithPassword(plaintext, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    salt.toString("base64url"),
    iv.toString("base64url"),
    ct.toString("base64url"),
    tag.toString("base64url")
  ].join(".");
}

export function decryptWithPassword(payload, password) {
  if (!payload || !payload.startsWith(`${PREFIX}.`)) return payload;
  const [, saltB64, ivB64, ctB64, tagB64] = payload.split(".");
  const salt = Buffer.from(saltB64, "base64url");
  const iv = Buffer.from(ivB64, "base64url");
  const ct = Buffer.from(ctB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const key = crypto.scryptSync(password, salt, 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
