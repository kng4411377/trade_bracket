// src/secrets-gcm.js
import "dotenv/config";
import crypto from "node:crypto";

export function getDecryptedPassword() {
  const token = process.env.ROBINHOOD_PASSWORD_TOKEN;
  const pass = process.env.PASSPHRASE;
  if (!token) throw new Error("Missing ROBINHOOD_PASSWORD_TOKEN");
  if (!pass) throw new Error("Missing PASSPHRASE");

  const [v, saltB64, ivB64, cipherB64, tagB64] = token.split(":");
  if (v !== "v1") throw new Error("Unsupported token version");

  const salt = Buffer.from(saltB64, "base64");
  const iv = Buffer.from(ivB64, "base64");
  const data = Buffer.from(cipherB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const key = crypto.scryptSync(pass, salt, 32);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  key.fill(0);
  return dec.toString("utf8");
}