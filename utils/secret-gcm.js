#!/usr/bin/env node
import crypto from "node:crypto";
import readline from "node:readline";

function usage() {
  console.log(`Usage:
  secret-gcm encrypt "plaintext" --passphrase "my pass"
  secret-gcm decrypt "<token>"   --passphrase "my pass"
  
Token format: v1:<salt_b64>:<iv_b64>:<cipher_b64>:<tag_b64>`);
  process.exit(1);
}

const [, , cmd, inputArg, ...rest] = process.argv;
if (!["encrypt", "decrypt"].includes(cmd)) usage();

const args = Object.fromEntries(
  rest.reduce((a, v, i, arr) => {
    if (v.startsWith("--")) a.push([v.replace(/^--/, ""), arr[i + 1]]);
    return a;
  }, [])
);

async function promptHidden(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return await new Promise((res) => {
    const onData = (char) => {
      char = char + "";
      if (["\n", "\r", "\u0004"].includes(char)) process.stdout.write("\n");
      else process.stdout.write("*");
    };
    process.stdin.on("data", onData);
    rl.question(q, (answer) => {
      process.stdin.removeListener("data", onData);
      rl.close();
      res(answer);
    });
  });
}

async function getPassphrase() {
  return args.passphrase ?? (await promptHidden("Passphrase: "));
}

function deriveKey(pass, salt) {
  return crypto.scryptSync(pass, salt, 32); // 256-bit key
}

if (cmd === "encrypt") {
  (async () => {
    const plaintext = inputArg ?? "";
    if (!plaintext) usage();
    const pass = await getPassphrase();
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = deriveKey(pass, salt);

    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    const token = [
      "v1",
      salt.toString("base64"),
      iv.toString("base64"),
      enc.toString("base64"),
      tag.toString("base64"),
    ].join(":");
    console.log(token);
    key.fill(0);
  })();
} else {
  (async () => {
    const token = inputArg ?? "";
    if (!token) usage();
    const [v, saltB64, ivB64, cipherB64, tagB64] = token.split(":");
    if (v !== "v1") throw new Error("Unsupported token version");
    const pass = await getPassphrase();

    const salt = Buffer.from(saltB64, "base64");
    const iv = Buffer.from(ivB64, "base64");
    const data = Buffer.from(cipherB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const key = deriveKey(pass, salt);

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    console.log(dec.toString("utf8"));
    key.fill(0);
  })();
}