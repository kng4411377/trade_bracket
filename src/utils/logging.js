import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { randomUUID } from 'node:crypto';
import { cfg } from '../config.js';
export const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export function withScope(scope) {
  return logger.child({ scope });
}
export const session = randomUUID();

const ensureDir = p => fs.mkdirSync(path.dirname(p), { recursive: true });
const ensureCsvHeader = (file, header) => {
  if (!fs.existsSync(file)) { ensureDir(file); fs.writeFileSync(file, header + '\n', 'utf8'); }
};

ensureCsvHeader(cfg.files.tradesCsv,
  'ts,session,symbol,side,qty,fill_price,avg_cost,slippage_bps,fee,reason,mode,realized_pnl,cum_pnl');
ensureCsvHeader(cfg.files.mtmCsv,
  'ts,session,symbol,price,qty,avg_cost,unreal_pnl');

export const consoleLog = pino({
  level: 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } }
});
export const fileLog = pino(pino.destination(cfg.files.logFile));

export const appendCsv = (file, arr) => fs.appendFileSync(file, arr.join(',') + '\n', 'utf8');
export const f6 = n => Number(n).toFixed(6);

// perf tracking
const perf = new Map(); // symbol -> { cumPnL, trades }
export const bucket = symbol => {
  if (!perf.has(symbol)) perf.set(symbol, { cumPnL: 0, trades: 0 });
  return perf.get(symbol);
};