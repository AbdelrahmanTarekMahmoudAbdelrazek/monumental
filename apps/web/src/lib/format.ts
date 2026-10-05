/** Percent with sensible precision. */
export function fmtPct(p: number) {
  if (p >= 1000) return `${Math.round(p).toLocaleString("en-US")}%`;
  if (p >= 100) return `${p.toFixed(0)}%`;
  return `${p.toFixed(1).replace(/\.0$/, "")}%`;
}

/** Approximate length for live readouts and ruler ticks (cm → m → km). */
export function fmtM(m: number) {
  if (m < 1) return `${+(m * 100).toFixed(0)} cm`;
  if (m < 100) return `${+m.toFixed(1)} m`;
  if (m < 10_000) return `${Math.round(m).toLocaleString("en-US")} m`;
  const km = m / 1000;
  if (km < 100) return `${+km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

/** Exact reference value as stored (keeps decimals like 138.5 m), km for big things. */
export function fmtExact(m: number) {
  if (m < 1) return `${+(m * 100).toFixed(1)} cm`;
  if (m < 10_000) return `${m.toLocaleString("en-US", { maximumFractionDigits: 2 })} m`;
  return `${(m / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })} km`;
}
