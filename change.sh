#!/usr/bin/env bash
set -euo pipefail

backup_if_exists () {
  local f="$1"
  if [ -f "$f" ]; then
    cp -f "$f" "$f.bak"
    echo "Backed up $f -> $f.bak"
  fi
}

mkdir -p utils scripts src/api config

############################
# utils/secret.js
############################
backup_if_exists utils/secret.js
cat > utils/secret.js <<'EOF'
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
EOF
echo "Wrote utils/secret.js"

############################
# scripts/encrypt-token.js
############################
backup_if_exists scripts/encrypt-token.js
cat > scripts/encrypt-token.js <<'EOF'
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
EOF
chmod +x scripts/encrypt-token.js
echo "Wrote scripts/encrypt-token.js (+x)"

############################
# utils/logging.js
############################
backup_if_exists utils/logging.js
cat > utils/logging.js <<'EOF'
import pino from "pino";
export const logger = pino({ level: process.env.LOG_LEVEL || "info" });
export function withScope(scope) {
  return logger.child({ scope });
}
EOF
echo "Wrote utils/logging.js"

############################
# utils/tryWrap.js
############################
backup_if_exists utils/tryWrap.js
cat > utils/tryWrap.js <<'EOF'
export async function tryOrWarn(taskName, fn, { logger, fallback = undefined, rethrow = false } = {}) {
  try {
    return await fn();
  } catch (err) {
    (logger?.error ?? console.error)({ err, task: taskName }, `${taskName} failed`);
    if (rethrow) throw err;
    return fallback;
  }
}
EOF
echo "Wrote utils/tryWrap.js"

############################
# utils/atomicFile.js
############################
backup_if_exists utils/atomicFile.js
cat > utils/atomicFile.js <<'EOF'
import fs from "node:fs/promises";
import path from "node:path";

export async function readJsonSafe(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
}

export async function writeJsonAtomic(file, data) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = file + ".tmp-" + Date.now();
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, file);
}

export async function withLock(lockFile, fn) {
  const handle = await fs.open(lockFile, "wx").catch(err => {
    if (err.code === "EEXIST") throw new Error("Overrides file is locked");
    throw err;
  });
  try {
    return await fn();
  } finally {
    await handle.close();
    await fs.rm(lockFile, { force: true });
  }
}
EOF
echo "Wrote utils/atomicFile.js"

############################
# utils/config.js
############################
backup_if_exists utils/config.js
cat > utils/config.js <<'EOF'
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  cryptoMomentum: [],
  files: { overrides: "config/overrides.json" },
  runtime: {
    pollMs: 30000,
    cooldownMinutes: 180,
    marketHoursOnly: true,
    eodCloseForCrypto: false,
    maxConcurrentCrypto: 3
  }
};

export async function loadConfig(rootDir = process.cwd()) {
  const cfgPath = path.join(rootDir, "config", "config.json");
  const raw = JSON.parse(await fs.readFile(cfgPath, "utf8"));
  const cfg = {
    ...DEFAULTS,
    ...raw,
    files: { ...DEFAULTS.files, ...(raw.files || {}) },
    runtime: { ...DEFAULTS.runtime, ...(raw.runtime || {}) }
  };
  validateConfig(cfg);
  cfg.files.overrides = path.resolve(rootDir, cfg.files.overrides);
  return cfg;
}

function ensureNumber(n, name, min = 0) {
  if (typeof n !== "number" || !Number.isFinite(n) || n < min) {
    throw new Error(`Invalid ${name}: ${n}`);
  }
}

export function validateConfig(cfg) {
  for (const r of cfg.cryptoMomentum) {
    if (!r.pair) throw new Error('cryptoMomentum item missing "pair"');
    ensureNumber(r.thresholdPct, "thresholdPct", 0);
    ensureNumber(r.lookbackMinutes, "lookbackMinutes", 1);
    ensureNumber(r.order?.sizeUSD, "order.sizeUSD", 1);
    if (r.pollMs != null) ensureNumber(r.pollMs, "pollMs", 1000);
    if (r.cooldownMinutes != null) ensureNumber(r.cooldownMinutes, "cooldownMinutes", 0);
  }
}
EOF
echo "Wrote utils/config.js"

############################
# utils/positions.js
############################
backup_if_exists utils/positions.js
cat > utils/positions.js <<'EOF'
export async function getCryptoPosition(RH, pair) {
  // Expect RH.crypto.positions() → array of { symbol, quantity, average_cost }
  const list = await RH.crypto.positions();
  const p = list.find(x => (x.symbol || x.pair) === pair);
  if (!p) return { qty: 0, avgCost: 0 };
  const qty = Number(p.quantity ?? p.qty ?? 0);
  const avgCost = Number(p.average_cost ?? p.avg_cost ?? 0);
  return { qty, avgCost };
}
EOF
echo "Wrote utils/positions.js"

############################
# src/entryMomentum.js (only writes a scaffold if file missing)
############################
if [ ! -f src/entryMomentum.js ]; then
cat > src/entryMomentum.js <<'EOF'
import { withScope } from "../utils/logging.js";
import { loadConfig } from "../utils/config.js";
import { getCryptoPosition } from "../utils/positions.js";
import { tryOrWarn } from "../utils/tryWrap.js";

const log = withScope("momentum");

export async function runMomentum(RH) {
  const cfg = await loadConfig();
  const rules = cfg.cryptoMomentum ?? [];
  if (!Array.isArray(rules) || rules.length === 0) {
    log.debug("No cryptoMomentum rules configured");
    return;
  }

  // Concurrency cap: check active crypto positions in parallel
  const pairs = rules.map(r => r.pair);
  const active = await Promise.all(pairs.map(p =>
    tryOrWarn(`isActive(${p})`,
      async () => (await getCryptoPosition(RH, p)).qty > 0,
      { logger: log, fallback: false }
    )));
  const activeCount = active.filter(Boolean).length;
  if (activeCount >= (cfg.runtime.maxConcurrentCrypto ?? 3)) {
    log.info({ activeCount }, "Max concurrent crypto positions reached");
    return;
  }

  // TODO: your momentum calc & order placement; wrap risky calls with tryOrWarn
}
EOF
echo "Wrote src/entryMomentum.js (new scaffold)"
else
  echo "Skipped src/entryMomentum.js (exists) — merge the concurrency cap pattern & tryOrWarn usage manually."
fi

############################
# src/bracketManager.js (only writes a scaffold if file missing)
############################
if [ ! -f src/bracketManager.js ]; then
cat > src/bracketManager.js <<'EOF'
import { withScope } from "../utils/logging.js";
import { loadConfig } from "../utils/config.js";
import { getCryptoPosition } from "../utils/positions.js";
import { tryOrWarn } from "../utils/tryWrap.js";

const log = withScope("bracket");
const isCrypto = s => s.includes("-USD");

async function sellCryptoMarket(RH, pair, qty) {
  if (!qty || qty <= 0) return;
  return RH.crypto.sellMarket({ symbol: pair, quantity: qty });
}

async function sellCryptoLimit(RH, pair, qty, price) {
  if (!qty || qty <= 0) return;
  if (!price || price <= 0) throw new Error("Invalid limit price");
  return RH.crypto.sellLimit({ symbol: pair, quantity: qty, price, timeInForce: "gtc" });
}

export async function manageBracket(RH, symbol, prices) {
  const cfg = await loadConfig();
  const gateByHours = cfg.runtime.marketHoursOnly && !isCrypto(symbol);
  if (gateByHours) return;

  if (isCrypto(symbol)) {
    const { qty } = await tryOrWarn(`getCryptoPosition(${symbol})`,
      () => getCryptoPosition(RH, symbol),
      { logger: log, fallback: { qty: 0, avgCost: 0 } }
    );
    if (qty <= 0) return;

    // Replace with your own decision logic:
    const stopLoss = false; // shouldStopLoss(prices, ...)
    const takeProfit = false; // shouldTakeProfit(prices, ...)

    if (stopLoss) {
      await tryOrWarn(`sellCryptoMarket(${symbol})`,
        () => sellCryptoMarket(RH, symbol, qty),
        { logger: log, rethrow: true }
      );
      log.info({ symbol, qty, action: "crypto-sell-market", reason: "stopLoss" }, "Exit placed");
    } else if (takeProfit) {
      const limitPrice = 0; // computeLimitExit(...)
      await tryOrWarn(`sellCryptoLimit(${symbol})`,
        () => sellCryptoLimit(RH, symbol, qty, limitPrice),
        { logger: log, rethrow: true }
      );
      log.info({ symbol, qty, price: limitPrice, action: "crypto-sell-limit", reason: "takeProfit" }, "Exit placed");
    }
    return;
  }

  // Equities branch (unchanged) goes here
}

export async function eodSweep(RH, symbols) {
  const cfg = await loadConfig();
  for (const s of symbols) {
    if (isCrypto(s) && !cfg.runtime.eodCloseForCrypto) continue;
    // Perform EOD close for equities and for crypto only if enabled
  }
}
EOF
echo "Wrote src/bracketManager.js (new scaffold)"
else
  echo "Skipped src/bracketManager.js (exists) — merge the crypto sell helpers, hours gate, and EOD guard manually."
fi

############################
# src/api/overridesHandlers.js
############################
backup_if_exists src/api/overridesHandlers.js
cat > src/api/overridesHandlers.js <<'EOF'
import { withScope } from "../../utils/logging.js";
import { loadConfig } from "../../utils/config.js";
import { readJsonSafe, writeJsonAtomic, withLock } from "../../utils/atomicFile.js";

const log = withScope("overrides");

export async function setPercent(req, res) {
  const cfg = await loadConfig();
  const lock = cfg.files.overrides + ".lock";
  try {
    const result = await withLock(lock, async () => {
      const cur = await readJsonSafe(cfg.files.overrides);
      const next = { ...cur, [req.params.symbol]: { mode: "percent", ...req.body } };
      await writeJsonAtomic(cfg.files.overrides, next);
      return next;
    });
    res.json({ ok: true, overrides: result });
  } catch (err) {
    log.error({ err }, "setPercent failed");
    res.status(500).json({ ok: false, error: "Failed to update overrides" });
  }
}

export async function setAbsolute(req, res) {
  const cfg = await loadConfig();
  const lock = cfg.files.overrides + ".lock";
  try {
    const result = await withLock(lock, async () => {
      const cur = await readJsonSafe(cfg.files.overrides);
      const next = { ...cur, [req.params.symbol]: { mode: "absolute", ...req.body } };
      await writeJsonAtomic(cfg.files.overrides, next);
      return next;
    });
    res.json({ ok: true, overrides: result });
  } catch (err) {
    log.error({ err }, "setAbsolute failed");
    res.status(500).json({ ok: false, error: "Failed to update overrides" });
  }
}
EOF
echo "Wrote src/api/overridesHandlers.js"

############################
# README.md (only create if missing)
############################
if [ ! -f README.md ]; then
cat > README.md <<'EOF'
# trade_bracket

Automated bracket trading with momentum entries, equity + crypto support, a web dashboard, and OpenAPI endpoints.

---

## Contents
- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Environment Variables](#environment-variables)
- [Secrets & Token Encryption](#secrets--token-encryption)
- [Running](#running)
- [Dashboard & API](#dashboard--api)
- [Overrides (Atomic)](#overrides-atomic)
- [Crypto vs Equity Behavior](#crypto-vs-equity-behavior)
- [EOD Logic](#eod-logic)
- [Logging](#logging)
- [Error Handling](#error-handling)
- [Testing / Dry Run](#testing--dry-run)
- [Backtest & Strategy](#backtest--strategy)
- [FAQ](#faq)

---

## Overview
`trade_bracket` manages open positions with bracket orders (take-profit + stop-loss) and supports a momentum-based entry strategy. It handles both **equities (market hours)** and **crypto (24/7)** and exposes a **dashboard** plus **OpenAPI** endpoints for control and inspection.

## Features
- Momentum entry rules with per-pair thresholds and lookback.
- Bracket management for exits (TP/SL) with live or dry-run modes.
- **Crypto-native position tracking** (does not rely on equities endpoints).
- **Atomic overrides** file with a lock to avoid race conditions.
- Consistent structured logging (via `pino`).
- Hardened config loader with defaults + validation.
- Swagger/OpenAPI docs served by the app.

## Architecture
src/
entryMomentum.js
bracketManager.js
api/
overridesHandlers.js
server.js
utils/
config.js
positions.js
atomicFile.js
tryWrap.js
logging.js
scripts/
encrypt-token.js
config/
config.json
overrides.json


## Quick Start
```bash
npm i
cp .env.example .env
# set RH_USERNAME/RH_PASSWORD and optionally RH_TOKEN_ENC (see below)

# Encrypt token once (optional but recommended)
node scripts/encrypt-token.js --token=YOUR_RH_API_KEY --password="$RH_PASSWORD"
# paste RH_TOKEN_ENC=... into .env

npm run start