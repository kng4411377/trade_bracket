import { cfg } from '../config.js';
import { consoleLog, fileLog } from '../utils/logging.js';
import { withBackoff } from '../utils/backoff.js';
import * as RHC from '../services/robinhoodCrypto.js';
import fs from 'node:fs';
import * as RH from '../services/robinhood.js'; // to query qty when we can
import { getCryptoPosition } from '../utils/positions.js';
import { withScope } from '../utils/logging.js';
import { loadConfig } from '../utils/config.js';
import { getCryptoPosition } from '../utils/positions.js';
// entryMomentum.js
async function countActivePairs(RH, pairs) {
  const results = await Promise.all(pairs.map(p => isPairActive(RH, p)));
  return results.filter(Boolean).length;
}


const log = withScope('entryMomentum');

export async function runMomentum(RH) {
  const cfg = await loadConfig();
  const rules = cfg.cryptoMomentum ?? [];
  if (!Array.isArray(rules) || rules.length === 0) {
    log.debug('No cryptoMomentum rules configured'); 
    return;
  }

  // Enforce concurrency cap
  const pairs = rules.map(r => r.pair);
  const activeCount = (await Promise.all(pairs.map(p => getCryptoPosition(RH, p).then(x => x.qty > 0)))).filter(Boolean).length;
  if (activeCount >= (cfg.runtime.maxConcurrentCrypto ?? 3)) {
    log.info({ activeCount }, 'Max concurrent crypto positions reached');
    return;
  }

  // Loop rules in parallel (bounded if desired)
  await Promise.all(rules.map(async r => {
    const pollMs = r.pollMs ?? cfg.runtime.pollMs;
    const cooldown = r.cooldownMinutes ?? cfg.runtime.cooldownMinutes;

    try {
      // your existing momentum calc here...
      // if trigger => place buy and then set bracket
    } catch (err) {
      log.error({ err, pair: r.pair }, 'Momentum rule failed');
    } finally {
      await new Promise(res => setTimeout(res, pollMs));
    }
  }));
}

// track “active” momentum positions by pair (in-memory safety net)
const activePairs = new Set();

const isPairActive = async (pair) => {
  // Prefer truth from Robinhood if it returns crypto qty; otherwise fall back to memory flag.
  try {
    const { qty, avgCost } = await getCryptoPosition(RH, pair);
    if (Number.isFinite(qty) && qty > 0) {
      activePairs.add(pair);
      return true;
    }
  } catch { /* ignore; RH may not include crypto in this endpoint for some accounts */ }
  return activePairs.has(pair);
};

const refreshActiveSet = async (pairs) => {
  // Cull pairs no longer held (best-effort)
  for (const p of [...activePairs]) {
    try {
      const { qty } = await RH.qtyAndAvgCost(p);
      if (!(Number.isFinite(qty) && qty > 0)) activePairs.delete(p);
    } catch { /* ignore */ }
  }
  // Ensure pairs seen in config but flat aren’t marked active
  for (const p of pairs) {
    if (!activePairs.has(p)) {
      try {
        const { qty } = await RH.qtyAndAvgCost(p);
        if (Number.isFinite(qty) && qty > 0) activePairs.add(p);
      } catch { /* ignore */ }
    }
  }
};

const mem = new Map(); // pair -> { ring: Array<{ts, price}>, lastBuyTs?: number }

const pushPrice = (pair, price, lookbackMin) => {
  const now = Date.now();
  const w = mem.get(pair) ?? { ring: [] };
  w.ring.push({ ts: now, price });
  // keep ~90 mins for safety
  const cutoff = now - (lookbackMin + 30) * 60 * 1000;
  w.ring = w.ring.filter(p => p.ts >= cutoff);
  mem.set(pair, w);
};

const pctChange = (series, minutes) => {
  if (series.length < 2) return null;
  const now = Date.now();
  const startTs = now - minutes * 60 * 1000;
  // find earliest sample >= startTs (or closest older)
  let base = series[0].price;
  for (const s of series) { if (s.ts <= startTs) base = s.price; else break; }
  const last = series[series.length - 1].price;
  if (!isFinite(base) || !isFinite(last) || base <= 0) return null;
  return ((last - base) / base) * 100;
};

const writeOverride = (pair, { targetPct, stopPct, trailPct }) => {
  const path = cfg.files.overrides;
  let obj = {};
  try { obj = JSON.parse(fs.readFileSync(path, 'utf8') || '{}'); } catch {}
  obj[pair] = { ...(obj[pair] || {}), mode: 'percent', targetPct, stopPct, trailPct: trailPct || 0 };
  fs.writeFileSync(path, JSON.stringify(obj, null, 2), 'utf8');
};

export const startMomentum = () => {
  const tasks = [];

  for (const m of (cfg.cryptoMomentum || [])) {
    const { pair, thresholdPct, lookbackMinutes = 60, pollMs = 30000, order, postBuyBracket, cooldownMinutes = 180 } = m;
    if (!pair) continue;

    const t = setInterval(async () => {
      try {
        // 1) get price & update buffer
        const price = await withBackoff(() => RHC.getCryptoQuote(pair), `cryptoQuote:${pair}`);
        pushPrice(pair, price, lookbackMinutes);

        const state = mem.get(pair);
        const change = pctChange(state.ring, lookbackMinutes);
        if (change == null) return;

        // 2) check momentum & cooldown
        const lastBuyTs = state.lastBuyTs || 0;
        const since = (Date.now() - lastBuyTs) / 60000;
        const cooled = since >= cooldownMinutes;

        consoleLog.debug?.({ pair, change, cooled }, 'Momentum check');
        fileLog.debug?.({ pair, change, cooled }, 'Momentum check');

        if (change >= thresholdPct && cooled) {
          // 3) BUY
          // refresh active set occasionally (cheap)
if (Math.random() < 0.1) { // ~every 10 ticks per pair
  const allPairs = (cfg.cryptoMomentum || []).map(x => x.pair);
  await refreshActiveSet(allPairs);
}

// ---- CONCURRENCY CAP ----
let activeCount = 0;
for (const p of new Set((cfg.cryptoMomentum || []).map(x => x.pair))) {
  if (await isPairActive(p)) activeCount++;
}
if (activeCount >= cfg.maxConcurrentCrypto) {
  consoleLog.info({ activeCount, cap: cfg.maxConcurrentCrypto }, 'Max concurrent crypto positions reached; skipping buy');
  fileLog.info({ activeCount, cap: cfg.maxConcurrentCrypto }, 'Max concurrent crypto positions reached; skipping buy');
  return; // skip this tick’s buy
}
          if (cfg.dryRun) {
            consoleLog.info({ pair, change, sizeUSD: order.sizeUSD, qty: order.qty }, '[DRY RUN] Momentum BUY signal');
            fileLog.info({ pair, change, sizeUSD: order.sizeUSD, qty: order.qty }, '[DRY RUN] Momentum BUY signal');
          } else {
            const res = await withBackoff(
              () => RHC.placeMarketBuy({
                pair,
                qty: isFinite(order.qty) ? Number(order.qty) : undefined,
                sizeUSD: isFinite(order.sizeUSD) ? Number(order.sizeUSD) : undefined,
                tif: order.timeInForce || 'gtc'
              }),
              `cryptoBuy:${pair}`
            );
            consoleLog.info({ pair, orderId: res.id, price }, 'Momentum BUY placed');
            fileLog.info({ pair, orderId: res.id, price }, 'Momentum BUY placed');
          }
// after placing (or simulating) the BUY successfully:
activePairs.add(pair);
          // 4) set exits via overrides so the bracket manager takes over
          const { targetPct, stopPct, trailPct } = postBuyBracket || {};
          if (isFinite(targetPct) || isFinite(stopPct)) {
            writeOverride(pair, { targetPct, stopPct, trailPct });
            consoleLog.info({ pair, targetPct, stopPct, trailPct }, 'Post-buy bracket overrides set');
            fileLog.info({ pair, targetPct, stopPct, trailPct }, 'Post-buy bracket overrides set');
          }

          state.lastBuyTs = Date.now();
          mem.set(pair, state);
        }
      } catch (err) {
        consoleLog.error({ pair: m.pair, err: err.message }, 'Momentum loop error');
        fileLog.error({ pair: m.pair, err: err.message }, 'Momentum loop error');
      }
    }, pollMs);

    tasks.push(() => clearInterval(t));
  }

  return () => tasks.forEach(fn => fn());
};