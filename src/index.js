import { loadConfig } from './utils/config.js';
import { consoleLog, fileLog, session } from './utils/logging.js';
import { startApi } from './api/server.js';
import * as RH from './services/robinhood.js';
import { startManager } from './bracketManager.js';
import { getAndReset } from './utils/heartbeat.js';

  const cfg = await loadConfig();

consoleLog.info({
  session,
  dryRun: cfg.dryRun,
  slippageBps: cfg.dryRunSlippageBps,
  feePerTrade: cfg.dryRunFee
}, 'Run config');

await RH.login();
consoleLog.info('Logged into Robinhood.'); fileLog.info('Logged into Robinhood.');

startApi();

const stop = startManager(cfg.tickers);
// after const stop = startManager(cfg.tickers);
let hbStock = 0, hbCrypto = 0;
setInterval(() => {
  // lightweight heartbeat; adjust messages to your setup
  consoleLog.info({ t: new Date().toISOString(), ticks: { stock: hbStock, crypto: hbCrypto } }, "heartbeat");
  hbStock = 0; hbCrypto = 0;
    const ticks = getAndReset();
  consoleLog.info({ t: new Date().toISOString(), ticks }, 'heartbeat');
  fileLog.info({ t: new Date().toISOString(), ticks }, 'heartbeat');
}, 60_000);


const shutdown = () => {
  stop();
  consoleLog.warn('Shutting down...');
  fileLog.warn('Shutting down...');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);