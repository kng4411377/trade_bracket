// utils/secret.js
import crypto from "node:crypto";
const PREFIX = "rhenc.v1";

function b64anyToBuf(s) {
  // Try base64url first, then base64
  try { return Buffer.from(s, "base64url"); } catch {}
  return Buffer.from(s, "base64");
}

function parsePayload(payload) {
  if (typeof payload !== "string" || !payload.startsWith(`${PREFIX}.`)) {
    throw new Error("Not an rhenc.v1 payload");
  }
  const parts = payload.split(".");
  if (parts.length !== 5) {
    throw new Error(`Malformed rhenc.v1 payload: expected 5 parts, got ${parts.length}`);
  }
  const [, saltB64, ivB64, ctB64, tagB64] = parts;
  const salt = b64anyToBuf(saltB64);
  const iv = b64anyToBuf(ivB64);
  const ct = b64anyToBuf(ctB64);
  const tag = b64anyToBuf(tagB64);

  if (salt.length !== 16) throw new Error(`Invalid salt length: ${salt.length} (want 16)`);
  if (iv.length !== 12) throw new Error(`Invalid iv length: ${iv.length} (want 12)`);
  if (tag.length !== 16) throw new Error(`Invalid auth tag length: ${tag.length} (want 16)`);
  if (ct.length < 1) throw new Error("Ciphertext is empty or malformed");

  return { salt, iv, ct, tag };
}

export function encryptWithPassword(plaintext, password) {
  if (!password) throw new Error("encryptWithPassword: empty password");
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Use base64url without padding
  return [
    PREFIX,
    salt.toString("base64url"),
    iv.toString("base64url"),
    ct.toString("base64url"),
    tag.toString("base64url")
  ].join(".");
}

export function decryptWithPassword(payload, password) {
  // If not our format, return as-is (behaves like a passthrough)
  if (typeof payload !== "string" || !payload.startsWith(`${PREFIX}.`)) return payload;
  if (!password) throw new Error("decryptWithPassword: empty password");

  const { salt, iv, ct, tag } = parsePayload(payload);
  const key = crypto.scryptSync(password, salt, 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
