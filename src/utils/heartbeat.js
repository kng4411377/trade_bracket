// src/utils/heartbeat.js
const counters = { stock: 0, crypto: 0 };

export function inc(kind) {
  if (kind in counters) counters[kind] += 1;
}

export function getAndReset() {
  const snap = { ...counters };
  counters.stock = 0; counters.crypto = 0;
  return snap;
}
