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
