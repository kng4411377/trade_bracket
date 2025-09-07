export async function getCryptoPosition(RH, pair) {
  // Expect RH.crypto.positions() → array of { symbol, quantity, average_cost }
  const list = await RH.crypto.positions();
  const p = list.find(x => (x.symbol || x.pair) === pair);
  if (!p) return { qty: 0, avgCost: 0 };
  const qty = Number(p.quantity ?? p.qty ?? 0);
  const avgCost = Number(p.average_cost ?? p.avg_cost ?? 0);
  return { qty, avgCost };
}
