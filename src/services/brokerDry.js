// src/services/brokerDry.js
import { loadState, saveState } from "../utils/simState.js";
import { consoleLog } from "../utils/logging.js";

const now = () => new Date().toISOString();

export async function openPosition({ symbol, qty, price, note = "api-open" }) {
  const s = await loadState();
  symbol = String(symbol).toUpperCase();
  qty = Number(qty);
  price = Number(price);
  if (!symbol || !isFinite(qty) || !isFinite(price) || qty <= 0) {
    throw new Error("Invalid symbol/qty/price");
  }

  const cur = s.positions[symbol] || { qty: 0, avgCost: 0 };
  const newQty = cur.qty + qty;
  const newAvg = (cur.qty * cur.avgCost + qty * price) / newQty;
  s.positions[symbol] = { qty: newQty, avgCost: newAvg };

  s.trades.push({ t: now(), symbol, side: "BUY", qty, price, realized: 0 });
  s.orders.push({ t: now(), kind: "market", side: "BUY", symbol, qty, price, note });

  await saveState(s);
  consoleLog.info({ symbol, qty, price }, "[DRY] openPosition");
  return { ok: true, position: s.positions[symbol] };
}

export async function closePosition({ symbol, qty, price, note = "api-close" }) {
  const s = await loadState();
  symbol = String(symbol).toUpperCase();
  qty = Number(qty);
  price = Number(price);

  const cur = s.positions[symbol];
  if (!cur || cur.qty <= 0) throw new Error(`No position for ${symbol}`);
  const sellQty = Math.min(qty, cur.qty);
  const realized = sellQty * (price - cur.avgCost);

  const remQty = cur.qty - sellQty;
  if (remQty <= 0) delete s.positions[symbol];
  else s.positions[symbol] = { qty: remQty, avgCost: cur.avgCost };

  s.trades.push({ t: now(), symbol, side: "SELL", qty: sellQty, price, realized });
  s.orders.push({ t: now(), kind: "market", side: "SELL", symbol, qty: sellQty, price, note });

  await saveState(s);
  consoleLog.info({ symbol, qty: sellQty, price, realized }, "[DRY] closePosition");
  return { ok: true, realized };
}

export async function listPositions() {
  const s = await loadState();
  return s.positions;
}

export async function journal() {
  const s = await loadState();
  return { orders: s.orders, trades: s.trades };
}

// optional helper for PnL in your poll logs
export async function unrealized(symbol, mark) {
  const s = await loadState();
  const p = s.positions[symbol];
  if (!p) return 0;
  return (mark - p.avgCost) * p.qty;
}
