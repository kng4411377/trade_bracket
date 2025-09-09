import { withBackoff } from '../utils/backoff.js';
import crypto from 'node:crypto';

// ---- Minimal REST helpers against the official Crypto Trading API ----
// Docs show trading host & signed headers; some clients sign body exactly as JSON.
// (We keep it simple; you already log in with stocks for positions.)
// For production, store/handle API keys per RH Crypto docs.
const API_BASE = 'https://trading.robinhood.com';

const _fetch = async (path, { method = 'GET', body } = {}) => {
  // For your real account: replace with required auth (api key / timestamp / signature headers).
  // Here we assume your environment/middleware handles auth or you adapt this to your credentials.
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`RH Crypto ${method} ${path} ${res.status}: ${txt}`);
  }
  return res.json();
};

// --- Market data (simple last price via quotes v1) ---
export const getCryptoQuote = async (pair) => {
  // Example endpoint; adjust to the official market data path if needed.
  const data = await _fetch(`/api/v1/crypto/marketdata/quotes/${encodeURIComponent(pair)}`);
  // Expecting { price: "xxxxx" } or similar—adapt if schema differs.
  const p = parseFloat(data.price ?? data.last_trade_price ?? data.mark_price);
  if (!isFinite(p)) throw new Error(`No crypto quote for ${pair}`);
  return p;
};

// --- Place a market buy (size in USD or asset qty) ---
export const placeMarketBuy = async ({ pair, qty, sizeUSD, tif = 'gtc' }) => {
  const clientOrderId = crypto.randomUUID();
  const body = {
    client_order_id: clientOrderId,
    side: 'buy',
    symbol: pair,
    type: 'market',
    time_in_force: tif,
    ...(isFinite(qty) && qty > 0
        ? { market_order_config: { asset_quantity: String(qty) } }
        : { market_order_config: { cash_amount: String(sizeUSD) } }
    )
  };
  // Official POST order path:
  const resp = await _fetch('/api/v1/crypto/trading/orders/', { method: 'POST', body });
  return { id: resp.id ?? clientOrderId, raw: resp };
};