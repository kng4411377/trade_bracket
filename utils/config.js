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
