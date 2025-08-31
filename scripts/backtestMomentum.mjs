#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

// ---------- CLI args ----------
const args = Object.fromEntries(process.argv.slice(2).map(s => {
  const [k, v] = s.split('=');
  return [k.replace(/^--/, ''), v ?? true];
}));

if (!args.file) {
  console.error('Usage: node scripts/backtestMomentum.mjs --file=BTC-USD.csv [--lookback=60] [--threshold=5] [--target=4] [--stop=2] [--trail=0] [--sizeUSD=100] [--cooldown=180] [--maxConcurrent=3]');
  process.exit(1);
}

// ---------- Params ----------
const FILE = args.file;
const LOOKBACK = Number(args.lookback ?? 60);        // minutes
const THRESH = Number(args.threshold ?? 5.0);        // %
const TPCT = Number(args.target ?? 4.0);             // %
const SPCT = Number(args.stop ?? 2.0);               // %
const TRAIL = Number(args.trail ?? 0);               // %
const SIZE = Number(args.sizeUSD ?? 100);            // USD per entry
const COOLDOWN = Number(args.cooldown ?? 180);       // minutes
const MAXCC = Number(args.maxConcurrent ?? 3);

// ---------- Load CSV ----------
const raw = fs.readFileSync(FILE, 'utf8').trim().split('\n');
const header = raw.shift().split(',');
const idxTs = header.indexOf('ts');
const idxPrice = header.indexOf('price');
if (idxTs < 0 || idxPrice < 0) throw new Error('CSV must have columns: ts,price');

const rows = raw.map(line => {
  const cols = line.split(',');
  return { ts: cols[idxTs], t: new Date(cols[idxTs]).getTime(), price: Number(cols[idxPrice]) };
}).filter(r => Number.isFinite(r.price)).sort((a,b) => a.t - b.t);

// ---------- Helpers ----------
const f2 = n => Number(n).toFixed(2);
let equity = 0, cash = 0, trades = [], open = []; // open positions [{entryPx, tgt, stp, trail, qty, tsIn}]
const ring = []; // for momentum lookback

const pushRing = (p) => {
  ring.push(p);
  const cutoff = p.t - (LOOKBACK + 5) * 60 * 1000;
  while (ring.length && ring[0].t < cutoff) ring.shift();
};
const pctChange = (nowTs) => {
  if (ring.length < 2) return null;
  const cutoff = nowTs - LOOKBACK * 60 * 1000;
  let base = ring[0].price;
  for (const s of ring) { if (s.t <= cutoff) base = s.price; else break; }
  const last = ring[ring.length - 1].price;
  if (!isFinite(base) || base <= 0) return null;
  return ((last - base) / base) * 100;
};

// trail stop computation
const trailStop = (baseStop, trailPct, high) => {
  if (!trailPct) return baseStop;
  return Math.max(baseStop, high * (1 - trailPct / 100));
};

let lastBuyTs = 0;

for (const p of rows) {
  pushRing(p);

  // 1) Update all open positions (max price for trailing)
  for (const pos of open) {
    pos.high = Math.max(pos.high, p.price);
    pos.effStop = trailStop(pos.stop, pos.trailPct, pos.high);
  }

  // 2) Exit checks
  const stillOpen = [];
  for (const pos of open) {
    if (p.price >= pos.target) {
      const pnl = (pos.target - pos.entryPx) * (pos.qty / pos.entryPx); // qty in “USD notionals / entryPx”
      cash += pnl;
      equity += pnl;
      trades.push({ tsIn: new Date(pos.tsIn).toISOString(), tsOut: new Date(p.t).toISOString(), reason: 'target', entry: pos.entryPx, exit: pos.target, pnl });
    } else if (p.price <= pos.effStop) {
      const exitPx = p.price; // market exit
      const pnl = (exitPx - pos.entryPx) * (pos.qty / pos.entryPx);
      cash += pnl;
      equity += pnl;
      trades.push({ tsIn: new Date(pos.tsIn).toISOString(), tsOut: new Date(p.t).toISOString(), reason: 'stop', entry: pos.entryPx, exit: exitPx, pnl });
    } else {
      stillOpen.push(pos);
    }
  }
  open = stillOpen;

  // 3) Momentum entry
  const change = pctChange(p.t);
  const cooled = (p.t - lastBuyTs) / 60000 >= COOLDOWN;
  if (change != null && change >= THRESH && cooled) {
    // concur cap
    if (open.length < MAXCC) {
      const entryPx = p.price;
      const stopPx = entryPx * (1 - SPCT / 100);
      const targetPx = entryPx * (1 + TPCT / 100);
      open.push({
        entryPx,
        target: targetPx,
        stop: stopPx,
        effStop: stopPx,
        trailPct: TRAIL,
        high: entryPx,
        qty: SIZE, // notionally invest SIZE USD
        tsIn: p.t
      });
      lastBuyTs = p.t;
    }
  }
}

// Close any remaining at last price (mark-to-market)
if (open.length) {
  const last = rows[rows.length - 1];
  for (const pos of open) {
    const pnl = (last.price - pos.entryPx) * (pos.qty / pos.entryPx);
    cash += pnl; equity += pnl;
    trades.push({ tsIn: new Date(pos.tsIn).toISOString(), tsOut: new Date(last.t).toISOString(), reason: 'eod', entry: pos.entryPx, exit: last.price, pnl });
  }
  open = [];
}

// ---------- Output ----------
const outDir = path.join(process.cwd(), 'var');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const tradesCsv = path.join(outDir, 'backtest_trades.csv');
fs.writeFileSync(tradesCsv, 'ts_in,ts_out,reason,entry,exit,pnl\n' + trades.map(t =>
  [t.tsIn, t.tsOut, t.reason, f2(t.entry), f2(t.exit), f2(t.pnl)].join(',')
).join('\n'));

const equityCsv = path.join(outDir, 'backtest_summary.txt');
const totalPnl = trades.reduce((a,b)=>a+b.pnl,0);
const wins = trades.filter(t=>t.pnl>0).length;
const losses = trades.length - wins;
const avg = trades.length ? totalPnl / trades.length : 0;
const winrate = trades.length ? (wins / trades.length * 100) : 0;

fs.writeFileSync(equityCsv,
  [
    `file: ${FILE}`,
    `trades: ${trades.length}`,
    `wins: ${wins}, losses: ${losses}, winrate: ${winrate.toFixed(1)}%`,
    `total_pnl_usd: ${f2(totalPnl)}`,
    `avg_pnl_per_trade_usd: ${f2(avg)}`
  ].join('\n')
);

console.log(`Backtest complete.
- Trades CSV: ${tradesCsv}
- Summary:    ${equityCsv}
`);