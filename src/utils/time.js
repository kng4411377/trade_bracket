export const nowET = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
export const isMarketOpenNow = () => {
  const d = nowET(); const day = d.getDay(); if (day === 0 || day === 6) return false;
  const m = d.getHours() * 60 + d.getMinutes(); return m >= 9 * 60 + 30 && m < 16 * 60;
};
export const minutesToCloseET = () => {
  const d = nowET(); const closeMin = 16 * 60; const m = d.getHours() * 60 + d.getMinutes();
  return closeMin - m;
};