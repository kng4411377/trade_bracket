// src/api/server.js
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../utils/config.js';
import { consoleLog } from '../utils/logging.js';
import { openPosition as dryOpen, closePosition as dryClose, listPositions as dryPositions, journal as dryJournal } from '../services/brokerDry.js';
import { setPercent,setAbsolute } from './overridesHandlers.js';
import { fileURLToPath } from 'node:url';
const cfg = await loadConfig();
const isDry = () => (globalThis.__DRY_RUN__ ?? cfg.dryRun) === true;

// ---- helpers to parse CSVs (simple, robust enough for our headers) ----
const parseCsv = (file) => {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return [];
  const [header, ...rows] = raw.split('\n');
  const cols = header.split(',');
  return rows.map(line => {
    // naive split is fine (no commas in our values)
    const vals = line.split(',');
    const obj = {};
    cols.forEach((c, i) => obj[c] = vals[i]);
    return obj;
  });
};
const mtmSeries = (symbol, limit = 200) => {
  const rows = parseCsv(cfg.files.mtmCsv)
    .filter(r => r.symbol === symbol)
    .sort((a,b) => (a.ts < b.ts ? -1 : 1)); // oldest -> newest
  if (rows.length > limit) return rows.slice(rows.length - limit);
  return rows;
};

// --- reset CSV files (keep headers) ---
const resetCsvWithHeader = (file, header) => {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, header + '\n', 'utf8');
};
// latest MTM per symbol
const latestMtmBySymbol = () => {
  const rows = parseCsv(cfg.files.mtmCsv);
  const bySym = new Map();
  for (const r of rows) {
    const prev = bySym.get(r.symbol);
    if (!prev || r.ts > prev.ts) bySym.set(r.symbol, r);
  }
  return Object.fromEntries(bySym.entries());
};

// realized PnL per symbol (sum trades.csv realized_pnl)
const realizedPnlBySymbol = () => {
  const rows = parseCsv(cfg.files.tradesCsv);
  const sums = new Map();
  for (const r of rows) {
    const pnl = Number(r.realized_pnl || 0);
    const cur = sums.get(r.symbol) || 0;
    sums.set(r.symbol, cur + pnl);
  }
  return Object.fromEntries(sums.entries());
};

// ---- lightweight auth only for mutating routes ----
// const auth = (req, res, next) => {
//   const hdr = req.headers.authorization || '';
//   const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
//   if (cfg.apiToken && token !== cfg.apiToken) return res.status(401).json({ error: 'unauthorized' });
//   next();
// };

export const startApi = () => {
  const app = express();
  app.use(express.json());

  // serve static dashboard pages
  app.use(express.static(path.join(process.cwd(), 'public')));

  app.get('/openapi.yaml', (_req, res) => {
  res.sendFile(path.join(process.cwd(), 'openapi.yaml'));
});

  // ---------- READ-ONLY API (no auth) ----------
  app.get('/api/mtm', (_req, res) => {
    const latest = latestMtmBySymbol();
    const realized = realizedPnlBySymbol();
    // merge realized into each symbol block
    const payload = Object.fromEntries(
      Object.entries(latest).map(([sym, v]) => ([
        sym,
        { ...v,
          price: Number(v.price),
          qty: Number(v.qty),
          avg_cost: Number(v.avg_cost),
          unreal_pnl: Number(v.unreal_pnl),
          realized_pnl: Number(realized[sym] || 0),
          total_pnl: Number(v.unreal_pnl || 0) + Number(realized[sym] || 0)
        }
      ]))
    );
    res.json({ data: payload, ts: new Date().toISOString() });
  });

  app.get('/api/trades', (req, res) => {
    const rows = parseCsv(cfg.files.tradesCsv)
      .map(r => ({
        ...r,
        qty: Number(r.qty),
        fill_price: Number(r.fill_price),
        avg_cost: Number(r.avg_cost),
        slippage_bps: Number(r.slippage_bps),
        fee: Number(r.fee),
        realized_pnl: Number(r.realized_pnl),
        cum_pnl: Number(r.cum_pnl)
      }))
      .sort((a, b) => (a.ts < b.ts ? 1 : -1)); // newest first

    const limit = Math.max(0, Math.min(1000, Number(req.query.limit || 200)));
    res.json({ data: rows.slice(0, limit), total: rows.length });
  });

  // ---------- MUTATING API (protected) ----------
  app.get('/overrides', (_req, res) => res.json({ overrides: loadOverrides() }));

 // Atomic overrides routes
app.post('/overrides/:symbol/percent', express.json(), setPercent);
app.post('/overrides/:symbol/absolute', express.json(), setAbsolute);


  app.post('/control/dry-run', (req, res) => {
    const { dryRun } = req.body || {};
    if (typeof dryRun !== 'boolean') return res.status(400).json({ error: 'dryRun boolean required' });
    globalThis.__DRY_RUN__ = dryRun;
    return res.json({ ok: true, dryRun: globalThis.__DRY_RUN__ });
  });

  app.get('/', (_req, res) => res.redirect('/dashboard.html'));
  app.get('/dashboard', (_req, res) => res.redirect('/dashboard.html'));
  app.get('/trades', (_req, res) => res.redirect('/trades.html'));

  // Rolling series for a symbol (for sparklines)
app.get('/api/mtm_series', (req, res) => {
  const symbol = String(req.query.symbol || '').toUpperCase();
  const limit = Math.max(10, Math.min(2000, Number(req.query.limit || 200)));
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  const rows = mtmSeries(symbol, limit).map(r => ({
    ts: r.ts, price: Number(r.price), unreal_pnl: Number(r.unreal_pnl)
  }));
  res.json({ symbol, data: rows });
});

// Reset trade history (protected)
app.post('/api/reset', (_req, res) => {
  resetCsvWithHeader(
    cfg.files.tradesCsv,
    'ts,session,symbol,side,qty,fill_price,avg_cost,slippage_bps,fee,reason,mode,realized_pnl,cum_pnl'
  );
  resetCsvWithHeader(
    cfg.files.mtmCsv,
    'ts,session,symbol,price,qty,avg_cost,unreal_pnl'
  );
  return res.json({ ok: true, reset: ['trades.csv', 'mtm.csv'] });
});
  // ---------- DRY-RUN TRADING API ----------
  if (isDry()) {
    consoleLog.info('Dry-run mode detected: enabling /api/dry routes');

    // POST /api/dry/open  {symbol, qty, price, note?}
    app.post('/api/dry/open', async (req, res) => {
      try {
        const { symbol, qty, price, note } = req.body || {};
        if (!symbol || !isFinite(qty) || !isFinite(price)) {
          return res.status(400).json({ error: 'symbol, qty, price are required' });
        }
        const result = await dryOpen({ symbol, qty: Number(qty), price: Number(price), note });
        return res.json(result);
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    });

    // POST /api/dry/close {symbol, qty, price, note?}
    app.post('/api/dry/close', async (req, res) => {
      try {
        const { symbol, qty, price, note } = req.body || {};
        if (!symbol || !isFinite(qty) || !isFinite(price)) {
          return res.status(400).json({ error: 'symbol, qty, price are required' });
        }
        const result = await dryClose({ symbol, qty: Number(qty), price: Number(price), note });
        return res.json(result);
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    });

    // GET /api/dry/positions
    app.get('/api/dry/positions', async (_req, res) => {
      const pos = await dryPositions();
      return res.json(pos);
    });

    // GET /api/dry/journal
    app.get('/api/dry/journal', async (_req, res) => {
      const j = await dryJournal();
      return res.json(j);
    });
  }

  app.listen(cfg.apiPort, cfg.apiHost, () => {
    consoleLog.info({ host: cfg.apiHost, port: cfg.apiPort }, 'Control API + Dashboard listening');
  });
};