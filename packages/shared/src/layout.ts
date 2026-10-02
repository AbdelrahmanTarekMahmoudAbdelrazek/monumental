import type { Silhouette } from "./types";

export interface SceneInput {
  viewportW: number;
  viewportH: number;
  baseHeightM: number;
  baseSil: Silhouette;
  /** Current displayed height of the target in metres (guess or truth). */
  targetHeightM: number;
  targetSil: Silhouette;
  /** Optional: fit the scale to this target height instead (e.g. max(guess, truth) during reveal). */
  fitHeightM?: number;
  /** Vertical padding for the sky / HUD, px. */
  topPad?: number;
  groundPad?: number;
}

export interface Box { x: number; y: number; w: number; h: number }

export interface SceneLayout {
  /** pixels per metre */
  ppm: number;
  groundY: number;
  base: Box;
  target: Box;
  /** Max metres that fit vertically — used to draw the height ruler. */
  visibleMetres: number;
}

/**
 * Zoom-to-fit layout. Both monuments stand on the same ground line and share one
 * pixels-per-metre scale, so relative heights are always truthful. The scale is
 * chosen so the taller of (base, current target) fills the stage, which means
 * the base stays at a fixed size until the target grows past it, then the view
 * zooms out. Wide silhouettes (Sphinx, bridges) also constrain the scale.
 */
export function computeLayout(i: SceneInput): SceneLayout {
  const topPad = i.topPad ?? 48;
  const groundPad = i.groundPad ?? 40;
  const stageH = Math.max(50, i.viewportH - topPad - groundPad);
  const stageW = Math.max(100, i.viewportW);
  const gap = Math.max(16, stageW * 0.06);
  const colW = (stageW - gap) / 2;

  const fitH = Math.max(i.targetHeightM, i.fitHeightM ?? 0);
  const tallest = Math.max(i.baseHeightM, fitH, 1e-6);
  // vertical constraint
  let ppm = stageH / tallest;
  // horizontal constraints: width = (sil.w/100) * heightPx, with a little breathing room
  const baseW = (i.baseSil.w / 100) * i.baseHeightM;
  const targetW = (i.targetSil.w / 100) * i.targetHeightM;
  const fitW = (i.targetSil.w / 100) * fitH;
  const usable = colW * 0.92;
  ppm = Math.min(ppm, usable / Math.max(baseW, 1e-6), usable / Math.max(fitW, 1e-6));

  const groundY = topPad + stageH;
  const bh = i.baseHeightM * ppm;
  const bw = baseW * ppm;
  const th = i.targetHeightM * ppm;
  const tw = targetW * ppm;

  // centre each in its column
  const base: Box = { x: colW / 2 - bw / 2, y: groundY - bh, w: bw, h: bh };
  const target: Box = { x: colW + gap + colW / 2 - tw / 2, y: groundY - th, w: tw, h: th };
  return { ppm, groundY, base, target, visibleMetres: stageH / ppm };
}

/** Nice ruler step for a given span of metres (1, 2, 5 × 10^n). */
export function rulerStep(visibleMetres: number, maxTicks = 8): number {
  const raw = visibleMetres / maxTicks;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}
