#!/usr/bin/env node
import { encryptWithPassword } from "../utils/secret.js";

function arg(name) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : undefined;
}

const token = process.env.RH_TOKEN ?? arg("token");
const password = process.env.RH_PASSWORD ?? arg("password");

if (!token || !password) {
  console.error('Usage: node scripts/encrypt-token.js --token=YOUR_API_KEY --password="your_master_password"');
  process.exit(1);
}

const enc = encryptWithPassword(token, password);
console.log("");
console.log("Add this to your .env:");
console.log("");
console.log(`RH_TOKEN_ENC=${enc}`);
console.log("");
