import { withScope } from "../src/utils/logging.js";
import { loadConfig } from "../src/utils/config.js";
import { getCryptoPosition } from "../src/utils/positions.js";
import { tryOrWarn } from "../src/utils/tryWrap.js";

const log = withScope("momentum");

export async function runMomentum(RH) {
  const cfg = await loadConfig();
  const rules = cfg.cryptoMomentum ?? [];
  if (!Array.isArray(rules) || rules.length === 0) {
    log.debug("No cryptoMomentum rules configured");
    return;
  }

  // Concurrency cap: check active crypto positions in parallel
  const pairs = rules.map(r => r.pair);
  const active = await Promise.all(pairs.map(p =>
    tryOrWarn(`isActive(${p})`,
      async () => (await getCryptoPosition(RH, p)).qty > 0,
      { logger: log, fallback: false }
    )));
  const activeCount = active.filter(Boolean).length;
  if (activeCount >= (cfg.runtime.maxConcurrentCrypto ?? 3)) {
    log.info({ activeCount }, "Max concurrent crypto positions reached");
    return;
  }

  // TODO: your momentum calc & order placement; wrap risky calls with tryOrWarn
}
