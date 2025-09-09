import { withScope } from "../src/utils/logging.js";
import { loadConfig } from "../src/utils/config.js";
import { getCryptoPosition } from "../src/utils/positions.js";
import { tryOrWarn } from "../src/utils/tryWrap.js";

const log = withScope("bracket");
const isCrypto = s => s.includes("-USD");

async function sellCryptoMarket(RH, pair, qty) {
  if (!qty || qty <= 0) return;
  return RH.crypto.sellMarket({ symbol: pair, quantity: qty });
}

async function sellCryptoLimit(RH, pair, qty, price) {
  if (!qty || qty <= 0) return;
  if (!price || price <= 0) throw new Error("Invalid limit price");
  return RH.crypto.sellLimit({ symbol: pair, quantity: qty, price, timeInForce: "gtc" });
}

export async function manageBracket(RH, symbol, prices) {
  const cfg = await loadConfig();
  const gateByHours = cfg.runtime.marketHoursOnly && !isCrypto(symbol);
  if (gateByHours) return;

  if (isCrypto(symbol)) {
    const { qty } = await tryOrWarn(`getCryptoPosition(${symbol})`,
      () => getCryptoPosition(RH, symbol),
      { logger: log, fallback: { qty: 0, avgCost: 0 } }
    );
    if (qty <= 0) return;

    // Replace with your own decision logic:
    const stopLoss = false; // shouldStopLoss(prices, ...)
    const takeProfit = false; // shouldTakeProfit(prices, ...)

    if (stopLoss) {
      await tryOrWarn(`sellCryptoMarket(${symbol})`,
        () => sellCryptoMarket(RH, symbol, qty),
        { logger: log, rethrow: true }
      );
      log.info({ symbol, qty, action: "crypto-sell-market", reason: "stopLoss" }, "Exit placed");
    } else if (takeProfit) {
      const limitPrice = 0; // computeLimitExit(...)
      await tryOrWarn(`sellCryptoLimit(${symbol})`,
        () => sellCryptoLimit(RH, symbol, qty, limitPrice),
        { logger: log, rethrow: true }
      );
      log.info({ symbol, qty, price: limitPrice, action: "crypto-sell-limit", reason: "takeProfit" }, "Exit placed");
    }
    return;
  }

  // Equities branch (unchanged) goes here
}

export async function eodSweep(RH, symbols) {
  const cfg = await loadConfig();
  for (const s of symbols) {
    if (isCrypto(s) && !cfg.runtime.eodCloseForCrypto) continue;
    // Perform EOD close for equities and for crypto only if enabled
  }
}
