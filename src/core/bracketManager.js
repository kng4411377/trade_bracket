import { cfg } from '../config.js';
import { consoleLog, fileLog, appendCsv, f6, bucket, session } from '../utils/logging.js';
import { withBackoff } from '../utils/backoff.js';
import { isMarketOpenNow, minutesToCloseET } from '../utils/time.js';
import * as RH from '../services/robinhood.js';
import { overridesFor, computeExits } from './overrides.js';
import { inc } from '../utils/heartbeat.js';
// add near the other imports
import * as RHC from '../services/robinhoodCrypto.js';
import fs from 'node:fs';
import { withScope } from '../utils/logging.js';
import { getCryptoPosition } from '../utils/positions.js';
import { loadConfig } from '../utils/config.js';

const log = withScope('bracket');

async function sellCryptoMarket(RH, pair, qty) {
  if (!qty || qty <= 0) return;
  return RH.crypto.sellMarket({ symbol: pair, quantity: qty });
}

async function sellCryptoLimit(RH, pair, qty, limitPrice) {
  if (!qty || qty <= 0) return;
  if (!limitPrice || limitPrice <= 0) throw new Error('Invalid limit price');
  return RH.crypto.sellLimit({ symbol: pair, quantity: qty, price: limitPrice, timeInForce: 'gtc' });
}

export async function manage(RH, symbol, prices) {
  const cfg = await loadConfig();
  const gateByHours = cfg.runtime.marketHoursOnly && !isCrypto(symbol);
  if (gateByHours) {
    // if it's outside equity hours, skip
  }

  try {
    if (isCrypto(symbol)) {
      const { qty } = await getCryptoPosition(RH, symbol);
      // ... decide exits and call sellCryptoMarket/sellCryptoLimit accordingly
    } else {
      // existing equity flow
    }
  } catch (err) {
    log.error({ err, symbol }, 'Bracket manage failed');
  }
}

// EOD
export async function eodSweep(RH, symbols) {
  const cfg = await loadConfig();
  for (const s of symbols) {
    if (isCrypto(s) && !cfg.runtime.eodCloseForCrypto) continue;
    // otherwise perform EOD close for equity or when explicitly enabled for crypto
  }
}

const isCrypto = (sym) => sym.includes('-'); // e.g., BTC-USD

// Quote router
const getMark = async (symbol) =>
  isCrypto(symbol) ? RHC.getCryptoQuote(symbol) : RH.getQuote(symbol);

// Best-effort positions router
// - Stocks: use RH.qtyAndAvgCost (unchanged)
// - Crypto: we often can’t query holdings via stock endpoints. We’ll try, else return {qty:0, avgCost:NaN}
const qtyAndAvgCostAny = async (symbol) => {
  if (!isCrypto(symbol)) return RH.qtyAndAvgCost(symbol);
  try { return await RH.qtyAndAvgCost(symbol); } catch {}
  return { qty: 0, avgCost: NaN };
};

// No-op canceller for crypto unless you later add it to RHC
const cancelStaleOpenOrdersAny = async (symbol) => {
  if (isCrypto(symbol)) return 0;
  return cancelStaleOpenOrders(symbol);
};

// SELL routers
const placeSellLimitAny = async ({ symbol, qty, limitPrice, tif='gfd' }, dryRun, loggers) => {
  if (!isCrypto(symbol)) {
    return RH.placeSellLimit({ symbol, qty, limitPrice, tif }, dryRun, loggers);
  }
  if (dryRun) {
    const { consoleLog: c, fileLog: f } = loggers;
    c.info({ symbol, qty, limitPrice, tif }, '[DRY RUN] Would place LIMIT sell (CRYPTO)');
    f.info({ symbol, qty, limitPrice, tif }, '[DRY RUN] Would place LIMIT sell (CRYPTO)');
    return { id: 'dry-run-crypto-limit' };
  }
  // REAL mode crypto sell requires functions you haven’t implemented yet
  throw new Error('Crypto limit sell not implemented. Add placeLimitSellCrypto() in robinhoodCrypto.js');
};

const placeSellMarketAny = async ({ symbol, qty, tif='gfd' }, dryRun, loggers) => {
  if (!isCrypto(symbol)) {
    return RH.placeSellMarket({ symbol, qty, tif }, dryRun, loggers);
  }
  if (dryRun) {
    const { consoleLog: c, fileLog: f } = loggers;
    c.info({ symbol, qty, tif }, '[DRY RUN] Would place MARKET sell (CRYPTO)');
    f.info({ symbol, qty, tif }, '[DRY RUN] Would place MARKET sell (CRYPTO)');
    return { id: 'dry-run-crypto-market' };
  }
  // REAL mode crypto sell requires functions you haven’t implemented yet
  throw new Error('Crypto market sell not implemented. Add placeMarketSellCrypto() in robinhoodCrypto.js');
};

// Helper: persist an avgCost into overrides when we can’t read it for crypto
const upsertOverridePatch = (symbol, patch) => {
  try {
    const path = cfg.files.overrides;
    const cur = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8') || '{}') : {};
    cur[symbol] = { ...(cur[symbol] || {}), ...patch };
    fs.writeFileSync(path, JSON.stringify(cur, null, 2), 'utf8');
  } catch { /* ignore */ }
};


const state = new Map(); // symbol -> { closed, reason, maxPrice }

const markClosed = (symbol, reason) => {
  const s = state.get(symbol) || {};
  state.set(symbol, { ...s, closed: true, reason, ts: Date.now() });
};
const isClosed = symbol => !!(state.get(symbol)?.closed);
const updateMax = (symbol, price) => {
  const s = state.get(symbol) || {};
  const maxPrice = Math.max(s.maxPrice || -Infinity, price);
  state.set(symbol, { ...s, maxPrice });
  return maxPrice;
};

const applySlippage = price =>
  (!isFinite(cfg.dryRunSlippageBps) || cfg.dryRunSlippageBps <= 0)
    ? price
    : price * (1 - cfg.dryRunSlippageBps / 10000);

const logDryRunExit = ({ symbol, qty, rawFill, avgCost, reason }) => {
  const fill = applySlippage(rawFill);
  const fee = cfg.dryRunFee;
  const pnl = (fill - avgCost) * qty - fee;
  const b = bucket(symbol);
  b.cumPnL += pnl; b.trades += 1;

  const payload = { session, symbol, qty, rawFill, fill, avgCost, fee, reason, realizedPnL: +pnl.toFixed(4), cumPnL: +b.cumPnL.toFixed(4) };
  consoleLog.info(payload, '[DRY RUN] EXIT simulated');
  fileLog.info(payload, '[DRY RUN] EXIT simulated');

  appendCsv(cfg.files.tradesCsv, [
    new Date().toISOString(), session, symbol, 'sell', f6(qty),
    f6(fill), f6(avgCost), f6(cfg.dryRunSlippageBps), f6(fee), reason, 'DRY_RUN', f6(pnl), f6(b.cumPnL)
  ]);
};

const cancelStaleOpenOrders = async symbol => {
  const open = await withBackoff(() => RH.getOpenStockOrders(), 'openOrders');
  const list = open.filter(o => (o.symbol === symbol) || (o.instrument && o.instrument.includes('/instruments/')));
  let n = 0;
  for (const o of list) {
    try { await RH.cancelOrder(o, cfg.dryRun, { consoleLog, fileLog }); n++; }
    catch { /* ignore */ }
  }
  return n;
};
function isCryptoSymbol(sym) { return sym.includes('-USD'); } // adjust if needed

function shouldGateByHours(symbol) {
  return cfg.marketHoursOnly && !isCryptoSymbol(symbol);
}

export const handleTicker = async t => {
  const { symbol, qty, target, stop, timeInForce='gfd', trailPct } = t;
  if (isClosed(symbol)) return;
  if (shouldGateByHours(symbol) && !isMarketOpenNow()) return;
consoleLog.debug({ at: new Date().toISOString(), symbol }, '[STOCK] poll start');
inc('stock');

  try {
const price = await withBackoff(() => getMark(symbol), `quote:${symbol}`);
    let { qty: held, avgCost } = await qtyAndAvgCostAny(symbol);

    // If crypto and we can’t read avgCost, seed it once from the first observed price (so percent exits work)
    if (isCrypto(symbol) && (!Number.isFinite(avgCost) || avgCost <= 0)) {
      const ovr = overridesFor(symbol) || {};
      if (Number.isFinite(ovr.avgCost) && ovr.avgCost > 0) {
        avgCost = ovr.avgCost;
      } else {
        avgCost = price;
        upsertOverridePatch(symbol, { avgCost }); // remember for next ticks
        consoleLog.info({ symbol, avgCost }, '[CRYPTO] Seeded avgCost from mark');
      }
    }
    if (held > 0) {
      appendCsv(cfg.files.mtmCsv, [
        new Date().toISOString(), session, symbol, f6(price), f6(held), f6(avgCost), f6((price - avgCost) * held)
      ]);
    }

    // EOD closeout
    const ovr = overridesFor(symbol);
    const eodEnabled = (ovr.eodClose ?? cfg.eodCloseEnabled);
    const eodCutoff = (ovr.eodCutoffMin ?? cfg.eodCutoffMin);
    const eodPct = (ovr.eodClosePct ?? cfg.eodClosePartialPct);
    const m2c = minutesToCloseET();

   const allowEod = isCrypto(symbol) ? Boolean(ovr?.eodCloseForCrypto) : eodEnabled;
    if (allowEod && m2c >= 0 && m2c <= eodCutoff && held > 0) {
      const closeQty = Math.floor(held * (eodPct / 100));
      if (closeQty > 0) {
try { await cancelStaleOpenOrdersAny(symbol); } catch {}
        if (cfg.dryRun) {
          logDryRunExit({ symbol, qty: closeQty, rawFill: price, avgCost, reason: 'eod_closeout' });
          if (closeQty === held) markClosed(symbol, 'eod_closeout');
          return;
        } else {
          const res = await withBackoff(() => placeSellMarketAny({ symbol, qty: closeQty, tif: timeInForce }, false, { consoleLog, fileLog }), `eodSell:${symbol}`);
          consoleLog.info({ symbol, closeQty, orderId: res.id }, 'EOD market sell placed');
          fileLog.info({ symbol, closeQty, orderId: res.id }, 'EOD market sell placed');
          if (closeQty === held) markClosed(symbol, 'eod_closeout');
          return;
        }
      }
    }

    const maxP = updateMax(symbol, price);
    const exits = computeExits({ symbol, baseTarget: target, baseStop: stop, avgCost, maxPrice: maxP, trailPct });

    await cancelStaleOpenOrders(symbol);
    if (held < qty) return;

    if (price >= exits.target) {
      if (cfg.dryRun) {
        logDryRunExit({ symbol, qty, rawFill: exits.target, avgCost, reason: 'target_hit' });
        markClosed(symbol, 'target_hit');
      } else {
        const res = await withBackoff(
          () => RH.placeSellLimit({ symbol, qty, limitPrice: exits.target, tif: timeInForce }, false, { consoleLog, fileLog }),
          `limitSell:${symbol}`
        );
        consoleLog.info({ symbol, target: exits.target, orderId: res.id }, 'Placed LIMIT sell');
        fileLog.info({ symbol, target: exits.target, orderId: res.id }, 'Placed LIMIT sell');
        markClosed(symbol, 'target_hit');
      }
      return;
    }

    if (price <= exits.stop) {
      if (cfg.dryRun) {
        logDryRunExit({ symbol, qty, rawFill: price, avgCost, reason: 'stop_hit' });
        markClosed(symbol, 'stop_hit');
      } else {
        const res = await withBackoff(
          () => RH.placeSellMarket({ symbol, qty, tif: timeInForce }, false, { consoleLog, fileLog }),
          `marketSell:${symbol}`
        );
        consoleLog.info({ symbol, stop: exits.stop, orderId: res.id }, 'Placed MARKET sell');
        fileLog.info({ symbol, stop: exits.stop, orderId: res.id }, 'Placed MARKET sell');
        markClosed(symbol, 'stop_hit');
      }
      return;
    }
  } catch (err) {
    consoleLog.error({ symbol, err: err.message }, 'Ticker loop error');
    fileLog.error({ symbol, err: err.message }, 'Ticker loop error');
  }
};


export const startManager = tickers => {
  // immediate tick
  tickers.forEach(t => { void handleTicker(t); });
  // schedule
  const h = setInterval(() => tickers.forEach(t => { void handleTicker(t); }), cfg.pollMs);
  return () => clearInterval(h); // returns a stop() fn
};