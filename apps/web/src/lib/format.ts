export function fmtPct(p: number) {
  if (p >= 1000) return `${Math.round(p).toLocaleString("en-US")}%`;
  if (p >= 100) return `${p.toFixed(0)}%`;
  return `${p.toFixed(1).replace(/\.0$/, "")}%`;
}
export function fmtM(m: number) {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  if (m >= 100) return `${m.toFixed(0)} m`;
  return `${m.toFixed(1)} m`;
}
