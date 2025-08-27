import RobinhoodFactory from 'robinhood';
import { withBackoff } from '../utils/backoff.js';
import { cfg } from '../config.js';

let RH;

export const login = () =>
  new Promise((resolve, reject) => {
    try { RH = RobinhoodFactory({ username: cfg.rhUser, password: cfg.rhPass }, () => resolve()); }
    catch (e) { reject(e); }
  });

export const getQuote = async symbol => {
  const { body } = await new Promise((res, rej) =>
    RH.quote_data(symbol, (err, resp, body) => err ? rej(err) : res({ resp, body }))
  );
  const r = body?.results?.[0]; const last = r ? parseFloat(r.last_trade_price) : NaN;
  if (!isFinite(last)) throw new Error(`No quote for ${symbol}`); return last;
};

export const getPositions = async () => {
  const { body } = await new Promise((res, rej) =>
    RH.positions((err, resp, body) => err ? rej(err) : res({ resp, body }))
  );
  return body?.results || [];
};

export const qtyAndAvgCost = async symbol => {
  const positions = await withBackoff(getPositions, 'positions');
  let qty = 0, cost = 0;
  for (const p of positions) {
    if (p.symbol === symbol) {
      const q = parseFloat(p.quantity || '0');
      const avg = parseFloat(p.average_buy_price || '0');
      if (q > 0) { qty += q; cost += q * avg; }
    }
  }
  return { qty, avgCost: qty > 0 ? cost / qty : 0 };
};

export const getOpenStockOrders = async () => {
  const { body } = await new Promise((res, rej) =>
    RH.orders((err, resp, body) => err ? rej(err) : res({ resp, body }))
  );
  const open = new Set(['queued','unconfirmed','confirmed','partially_filled']);
  return (body?.results || []).filter(o => o.side === 'sell' && o.instrument && open.has(o.state));
};

const instrumentFor = async symbol => {
  const { body } = await new Promise((res, rej) =>
    RH.instruments(symbol, (err, resp, body) => err ? rej(err) : res({ resp, body }))
  );
  const match = body?.results?.find(r => r.symbol === symbol);
  if (!match) throw new Error(`Instrument not found ${symbol}`);
  return match.url;
};

export const cancelOrder = (order, dryRun, loggers) => {
  const { consoleLog, fileLog } = loggers;
  if (!order.cancel) return Promise.resolve(false);
  if (dryRun) {
    consoleLog.warn({ id: order.id, symbol: order.symbol }, '[DRY RUN] Would cancel order');
    fileLog.warn({ id: order.id, symbol: order.symbol }, '[DRY RUN] Would cancel order');
    return Promise.resolve(true);
  }
  return new Promise((resolve, reject) => {
    RH._request.post({ uri: order.cancel, json: true }, err => err ? reject(err) : resolve(true));
  });
};

export const placeSellLimit = async ({ symbol, qty, limitPrice, tif='gfd' }, dryRun, loggers) => {
  const { consoleLog, fileLog } = loggers;
  if (dryRun) {
    consoleLog.info({ symbol, qty, limitPrice, tif }, '[DRY RUN] Would place LIMIT sell');
    fileLog.info({ symbol, qty, limitPrice, tif }, '[DRY RUN] Would place LIMIT sell');
    return { id: 'dry-run-limit' };
  }
  const instrument = await instrumentFor(symbol);
  const payload = { type:'limit', quantity: qty, bid_price: limitPrice, instrument, symbol, time_in_force: tif, trigger:'immediate', side:'sell' };
  const { body } = await new Promise((res, rej) =>
    RH._place_order(payload, (err, resp, body) => err ? rej(err) : res({ resp, body }))
  );
  return body;
};

export const placeSellMarket = async ({ symbol, qty, tif='gfd' }, dryRun, loggers) => {
  const { consoleLog, fileLog } = loggers;
  if (dryRun) {
    consoleLog.info({ symbol, qty, tif }, '[DRY RUN] Would place MARKET sell');
    fileLog.info({ symbol, qty, tif }, '[DRY RUN] Would place MARKET sell');
    return { id: 'dry-run-market' };
  }
  const instrument = await instrumentFor(symbol);
  const payload = { type:'market', quantity: qty, instrument, symbol, time_in_force: tif, trigger:'immediate', side:'sell' };
  const { body } = await new Promise((res, rej) =>
    RH._place_order(payload, (err, resp, body) => err ? rej(err) : res({ resp, body }))
  );
  return body;
};