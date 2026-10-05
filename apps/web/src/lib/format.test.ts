import { describe, it, expect } from "vitest";
import { fmtPct, fmtM, fmtExact } from "./format";
import { computeLayout } from "@monumental/shared";

describe("format", () => {
  it("formats percentages by magnitude", () => {
    expect(fmtPct(52.7)).toBe("52.7%");
    expect(fmtPct(50)).toBe("50%");
    expect(fmtPct(327.4)).toBe("327%");
    expect(fmtPct(20700)).toBe("20,700%");
  });
  it("formats metres", () => {
    expect(fmtM(4)).toBe("4 m");
    expect(fmtM(0.3)).toBe("30 cm");
    expect(fmtM(138.5)).toBe("139 m");
    expect(fmtM(8849)).toBe("8,849 m");
    expect(fmtM(1_392_700_000)).toBe("1,392,700 km");
    expect(fmtExact(138.5)).toBe("138.5 m");
    expect(fmtExact(12_742_000)).toBe("12,742 km");
    expect(fmtExact(22_500)).toBe("22.5 km");
  });
});

describe("zoom-to-fit layout", () => {
  const sil = { w: 50, d: "" };
  it("keeps both monuments on one ground line with one scale", () => {
    const L = computeLayout({ viewportW: 800, viewportH: 500, baseHeightM: 100, baseSil: sil, targetHeightM: 50, targetSil: sil });
    expect(L.base.y + L.base.h).toBeCloseTo(L.groundY);
    expect(L.target.y + L.target.h).toBeCloseTo(L.groundY);
    expect(L.target.h / L.base.h).toBeCloseTo(0.5);
  });
  it("zooms out when the target grows past the base (Moai vs Burj Khalifa)", () => {
    const small = computeLayout({ viewportW: 800, viewportH: 500, baseHeightM: 4, baseSil: sil, targetHeightM: 2, targetSil: sil });
    const huge = computeLayout({ viewportW: 800, viewportH: 500, baseHeightM: 4, baseSil: sil, targetHeightM: 828, targetSil: sil });
    expect(huge.ppm).toBeLessThan(small.ppm);
    expect(huge.target.y).toBeGreaterThanOrEqual(0);
    expect(huge.base.h).toBeLessThan(small.base.h);
  });
  it("respects wide silhouettes", () => {
    const L = computeLayout({ viewportW: 800, viewportH: 500, baseHeightM: 20, baseSil: { w: 360, d: "" }, targetHeightM: 20, targetSil: sil });
    expect(L.base.x).toBeGreaterThanOrEqual(0);
    expect(L.base.x + L.base.w).toBeLessThanOrEqual(400);
  });
});
