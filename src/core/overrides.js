import fs from 'node:fs';
import { cfg } from '../config.js';

let overrides = {};
let mtime = 0;

const loadIfChanged = () => {
  try {
    const stat = fs.statSync(cfg.files.overrides);
    const mt = stat.mtimeMs || stat.mtime.getTime();
    if (mt !== mtime) {
      overrides = JSON.parse(fs.readFileSync(cfg.files.overrides, 'utf8') || '{}');
      mtime = mt;
    }
  } catch { /* ignore */ }
};

export const watchOverrides = () => {
  loadIfChanged();
  try { fs.watch(cfg.files.overrides, { persistent: false }, loadIfChanged); } catch {}
};

export const overridesFor = symbol => (loadIfChanged(), overrides[symbol] || {});

const trailingStop = (baseStop, trailPct, maxPrice) => {
  if (!trailPct || !isFinite(maxPrice)) return baseStop;
  const ts = maxPrice * (1 - trailPct/100);
  return Math.max(baseStop, ts);
};

export const computeExits = ({ symbol, baseTarget, baseStop, avgCost, maxPrice, trailPct }) => {
  const o = overridesFor(symbol);
  let target = baseTarget, stop = baseStop, source = 'config';

  if (o.mode === 'absolute') {
    if (isFinite(o.target)) target = Number(o.target);
    if (isFinite(o.stop))   stop   = Number(o.stop);
    source = 'overrides:absolute';
  } else if (o.mode === 'percent') {
    if (isFinite(o.targetPct)) target = avgCost * (1 + o.targetPct/100);
    if (isFinite(o.stopPct))   stop   = avgCost * (1 - o.stopPct/100);
    source = 'overrides:percent';
  }

  return { target, stop: trailingStop(stop, trailPct, maxPrice), source };
};