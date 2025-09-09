# trade_bracket

Automated **bracket trading** for equities & crypto with:
- Momentum-based entries
- Bracket exits (take-profit / stop-loss / optional trailing)
- 24/7 crypto handling (market-hours gating only for equities)
- Atomic overrides file (safe concurrent writes)
- Web dashboard + OpenAPI endpoints
- Structured logging and robust error handling
- Encrypted secret storage for the Robinhood bearer token

This README reflects the **post-cleanup** architecture (utils consolidated under `src/utils`, atomic overrides wired into the server, config shim).

---

## Contents
- [Overview](#overview)
- [Architecture](#architecture)
- [Key Guarantees](#key-guarantees)
- [Install & Quick Start](#install--quick-start)
- [Configuration](#configuration)
- [Environment Variables](#environment-variables)
- [Secrets & Token Encryption](#secrets--token-encryption)
- [Running](#running)
- [Dashboard & API](#dashboard--api)
- [Overrides (Atomic & Safe)](#overrides-atomic--safe)
- [Trading Logic](#trading-logic)
- [Market Hours & EOD](#market-hours--eod)
- [Logging](#logging)
- [Error Handling](#error-handling)
- [Testing & Dry Run](#testing--dry-run)
- [Operational Playbook](#operational-playbook)
- [Security Practices](#security-practices)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)

---

## Overview

`trade_bracket` continuously evaluates configured crypto pairs (and optionally equities), places **momentum-based entries**, and manages **bracket exits** (TP/SL/trailing). It exposes a **dashboard** and **OpenAPI endpoints** for observability and control (overrides, resets, etc.).

- **Crypto** trades 24/7 (not gated by market hours).
- **Equities** respect `marketHoursOnly`.
- Overrides writes are **atomic** and race-safe.

---

## Architecture

```
src/
  entryMomentum.js            # Momentum entries (concurrency cap, lookbacks)
  bracketManager.js           # Exits: TP/SL/optional trailing, EOD
  api/
    server.js                 # Express app: dashboard + JSON API
    overridesHandlers.js      # Atomic overrides: percent & absolute
  utils/
    config.js                 # loadConfig(): defaults, validation, absolute paths
    positions.js              # getCryptoPosition(RH, pair) (crypto-native)
    atomicFile.js             # readJsonSafe / writeJsonAtomic / withLock
    tryWrap.js                # tryOrWarn(): guard risky operations
    logging.js                # pino logger + withScope(scope)
    backoff.js                # helper for transient-retry flows
scripts/
  encrypt-token.js            # produce RH_TOKEN_ENC from bearer token
services/
  robinhood.js                # equities service
  robinhoodCrypto.js          # crypto service (ensure used for crypto flows)
config/
  config.json                 # main runtime config
  overrides.json              # runtime overrides (atomic)
public/
  dashboard.html, trades.html # static UI assets (if included)
openapi.yaml                  # OpenAPI / Swagger spec
```

**Removed/Deprecated (should be deleted if still present):**
- `src/core/*` duplicates
- root `utils/*` duplicates
- `src/secrets-gcm.js` and `utils/secret-gcm.js` (use `src/utils/secret.js`)

---

## Key Guarantees

- **Single config source**: `src/utils/config.js`; validated defaults; absolute file paths (e.g., `files.overrides`).
- **Atomic overrides**: `withLock()` + `writeJsonAtomic()` to guarantee full writes and avoid races.
- **Crypto correctness**: positions via `getCryptoPosition()` (never equities endpoint).
- **Equities-only market-hours**: gate applies only when `!isCrypto(symbol)`.
- **Secrets**: store bearer token as `RH_TOKEN_ENC` (AES-256-GCM, scrypt) and decrypt with `RH_PASSWORD` at runtime.
- **No silent errors**: risky ops wrapped with `tryOrWarn()`; structured logs via `pino`.

---

## Install & Quick Start

```bash
npm install
cp .env.example .env

# 1) Set your master password (used to decrypt RH_TOKEN_ENC at runtime)
export RH_PASSWORD="your_master_password"

# 2) Obtain your Robinhood bearer token (from web login) and encrypt it
node scripts/encrypt-token.js --token="PASTE_BEARER_TOKEN" --password="$RH_PASSWORD"

# 3) Put these in .env (one line each, no quotes)
RH_PASSWORD=your_master_password
RH_TOKEN_ENC=rhenc.v1.<salt>.<iv>.<ciphertext>.<tag>

# 4) (Optional) simulate with dry-run mode
DRY_RUN=true npm run start
```

---

## Configuration

**File**: `config/config.json` — loaded via `loadConfig()` and merged with defaults.

**Defaults** (from `src/utils/config.js`):
```jsonc
{
  "cryptoMomentum": [],
  "files": { "overrides": "config/overrides.json" },
  "runtime": {
    "pollMs": 30000,
    "cooldownMinutes": 180,
    "marketHoursOnly": true,
    "eodCloseForCrypto": false,
    "maxConcurrentCrypto": 3
  }
}
```

**Example cryptoMomentum rule**:
```json
{
  "pair": "BTC-USD",
  "thresholdPct": 5.0,
  "lookbackMinutes": 60,
  "order": { "sizeUSD": 100 },
  "postBuyBracket": { "targetPct": 4, "stopPct": 2, "trailPct": 0 },
  "cooldownMinutes": 180,
  "pollMs": 30000
}
```

---

## Environment Variables

- `NODE_ENV` — `production` / `development`
- `PORT` / `apiPort`, `apiHost` — dashboard/API binding
- `DRY_RUN` — `true` to simulate orders
- `LOG_LEVEL` — `info` (default), `debug`, …
- `RH_USERNAME` — (optional) if you add a login/refresh flow
- `RH_PASSWORD` — master password (decrypts `RH_TOKEN_ENC`)
- `RH_TOKEN_ENC` — encrypted bearer token
- `RH_API_KEY` — plaintext fallback (not recommended for long-term)

---

## Secrets & Token Encryption

Robinhood authenticates with a **bearer token** (not a developer API key).  
Use `scripts/encrypt-token.js` to bind the bearer to your `RH_PASSWORD` (AES-256-GCM) and store only **`RH_TOKEN_ENC`** in `.env`.

Regenerate when the bearer expires. If you change `RH_PASSWORD`, re-encrypt.

---

## Running

```bash
npm run start
# or
DRY_RUN=true npm run start
```

The server (`src/api/server.js`) exposes the dashboard and API. Overrides routes are atomic:

```js
import { setPercent, setAbsolute } from './overridesHandlers.js';
app.post('/overrides/:symbol/percent', express.json(), setPercent);
app.post('/overrides/:symbol/absolute', express.json(), setAbsolute);
```

Read-only `/overrides` uses:
```js
import { readJsonSafe } from '../utils/atomicFile.js';
const data = await readJsonSafe(cfg.files.overrides);
```

---

## Dashboard & API

- **Dashboard** — serves static files from `public/` (e.g., `/dashboard.html`, `/trades.html`).
- **OpenAPI** — `GET /openapi.yaml`

**Core JSON endpoints**
- `GET /api/mtm` — latest mark-to-market by symbol (merged with realized PnL).
- `GET /api/mtm_series?symbol=BTC-USD[&limit=200]` — rolling series for sparklines.
- `GET /api/trades?limit=200` — recent trades (CSV parsed).
- `GET /overrides` — current overrides (JSON).
- `POST /overrides/:symbol/percent` — `{ "targetPct": 4, "stopPct": 2 }`.
- `POST /overrides/:symbol/absolute` — `{ "target": 3000, "stop": 2800 }`.
- `POST /api/reset` — resets `trades.csv` and `mtm.csv` with headers (protect in prod).

**Dry-run (when `DRY_RUN=true`)**
- `POST /api/dry/open` — `{symbol, qty, price, note?}`
- `POST /api/dry/close` — `{symbol, qty, price, note?}`
- `GET /api/dry/positions`
- `GET /api/dry/journal`

---

## Overrides (Atomic & Safe)

**File**: `config/overrides.json` (path configurable via `files.overrides`).

- **Reads**: `readJsonSafe()` — returns `{}` if missing.
- **Writes**: `withLock(<file>.lock)` → mutate → `writeJsonAtomic()` (temp + rename).  
  Prevents concurrent writers from corrupting the file and guarantees full writes.

---

## Trading Logic

### Momentum entries (`src/entryMomentum.js`)
- Calculates % change over `lookbackMinutes` vs `thresholdPct`.
- Respects `cooldownMinutes` per pair.
- Uses **parallel** active checks (`Promise.all`) to enforce `maxConcurrentCrypto`.

### Bracket exits (`src/bracketManager.js`)
- Implements stop-loss and take-profit logic.
- **Crypto sells** implemented:
  - `sellCryptoMarket(RH, pair, qty)`
  - `sellCryptoLimit(RH, pair, qty, price)`
- No “not implemented” exceptions in live mode.

> Ensure crypto flows use `services/robinhoodCrypto.js` and **not** `qtyAndAvgCost()` from equities. If `src/services/robinhood.js` exposes `qtyAndAvgCost()`, only use that for equities symbols.

---

## Market Hours & EOD

- Gate applies **only to equities**:
  ```js
  if (cfg.runtime.marketHoursOnly && !isCrypto(symbol)) {
    // equity-gated logic
  }
  ```
- EOD sweep:
  - Equities can be auto-closed.
  - **Crypto skipped by default** (`eodCloseForCrypto: false`); enable explicitly to close crypto at an EOD cutover.

---

## Logging

- `pino` logger with `withScope(scope)` to create child loggers:
  ```js
  import { withScope } from '../utils/logging.js';
  const log = withScope('bracket');
  log.info({ symbol, action: 'crypto-sell-limit', price }, 'Exit placed');
  ```
- Use structured fields: `{ symbol/pair, action, qty, price, reason }`.
- Control verbosity with `LOG_LEVEL`.

---

## Error Handling

- Wrap risky calls:
  ```js
  import { tryOrWarn } from '../utils/tryWrap.js';
  const result = await tryOrWarn('sellCryptoLimit', () => sellCryptoLimit(...), { logger: log, rethrow: true });
  ```
- Avoid empty `catch {}` blocks — always log or rethrow.

---

## Testing & Dry Run

- **Dry-run** simulates orders and bracket behavior:
  ```bash
  DRY_RUN=true npm run start
  ```
- Load test overrides endpoints to confirm **locking** and **atomic writes** under concurrency.
- Configure multiple momentum pairs to see the **concurrency cap** in action.

---

## Operational Playbook

- **401s / token expired** → fetch new bearer → `encrypt-token.js` → update `.env` → restart.
- **Overrides missing** → reads return `{}`; first write recreates the file.
- **Disk/FS errors** → `tryOrWarn` logs include context; check logs.
- **Clock skew** → keep server time synced for lookbacks and EOD timing.

---

## Security Practices

- Keep only **`RH_TOKEN_ENC`** and **`RH_PASSWORD`** in `.env`.
- Never commit `.env` or secrets.
- Rotate bearer tokens periodically; rotate `RH_PASSWORD` if exposed.

---

## Troubleshooting

- **“Invalid authentication tag length…”** — `RH_TOKEN_ENC` is truncated or line-wrapped. Regenerate and paste as a single line.
- **“Not implemented” on crypto sells** — ensure you’re using the new `bracketManager.js` and crypto service; no throws remain for crypto sells.
- **Overrides corruption** — ensure routes use `setPercent`/`setAbsolute` and writes go through `writeJsonAtomic()` with a lock.

---

## FAQ

**Robinhood doesn’t issue API keys — what’s “token”?**  
It’s your **bearer access token** from login. We encrypt it as `RH_TOKEN_ENC` for storage.

**Does market-hours gating block crypto?**  
No — only equities are gated. Crypto runs 24/7.

**What if `overrides.json` is missing?**  
Reads return `{}`; first write creates it atomically.

**Can I avoid manually copying the bearer?**  
Yes — implement the login/refresh flow (username + password + 2FA) to programmatically get tokens. For now, this repo uses a manual bearer for simplicity.
