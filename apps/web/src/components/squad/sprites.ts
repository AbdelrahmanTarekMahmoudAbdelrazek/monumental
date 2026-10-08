"use client";
import { SQ, SQ_BUSHES, SQ_OBSTACLES, SQ_SPAWN, type SqRole, type SqTeam } from "@monumental/shared";

export const TEAM_COLORS: Record<SqTeam, { main: string; dark: string; text: string }> = {
  red: { main: "#E5484D", dark: "#9E2227", text: "#FF8A8E" },
  blue: { main: "#3E8BFF", dark: "#1D4FAF", text: "#8AB8FF" },
};

/** Original top-down character art (facing right, 120×120 view box). */
export function characterSvg(role: SqRole, team: SqTeam) {
  const { main, dark } = TEAM_COLORS[team];
  const body =
    role === "healer"
      ? `<rect x="28" y="42" width="22" height="36" rx="6" fill="#EEF2F6" stroke="#B9C3CF" stroke-width="2"/>
<rect x="36" y="49" width="6" height="22" rx="1.5" fill="#2FCB7E"/><rect x="28" y="57" width="22" height="6" rx="1.5" fill="#2FCB7E"/>
<ellipse cx="60" cy="60" rx="25" ry="22" fill="${main}"/>
<path d="M60 38 L70 40 L70 80 L60 82 Z" fill="#F4F6F8" opacity="0.9"/>
<path d="M66 44 Q80 46 88 54" stroke="#E8B48A" stroke-width="8" stroke-linecap="round" fill="none"/>
<path d="M66 76 Q80 72 88 62" stroke="#E8B48A" stroke-width="8" stroke-linecap="round" fill="none"/>
<rect x="86" y="53" width="18" height="8" rx="2.5" fill="#2B2F36"/><rect x="100" y="55" width="6" height="4" rx="1" fill="#6EE7B7"/>
<circle cx="60" cy="60" r="14" fill="#F4F6F8" stroke="${dark}" stroke-width="3"/>
<rect x="56" y="51" width="8" height="18" rx="2" fill="#2FCB7E"/><rect x="51" y="56" width="18" height="8" rx="2" fill="#2FCB7E"/>`
      : role === "tank"
        ? `<rect x="22" y="28" width="66" height="64" rx="20" fill="${main}"/>
<rect x="30" y="40" width="44" height="40" rx="10" fill="${dark}"/>
<path d="M36 48 H68 M36 60 H68 M36 72 H68" stroke="${main}" stroke-width="3" opacity="0.7"/>
<circle cx="44" cy="28" r="13" fill="${dark}" stroke="#0E141B" stroke-width="2"/><circle cx="44" cy="92" r="13" fill="${dark}" stroke="#0E141B" stroke-width="2"/>
<path d="M70 44 Q86 44 96 52" stroke="#C99572" stroke-width="9" stroke-linecap="round" fill="none"/>
<path d="M70 76 Q86 74 96 66" stroke="#C99572" stroke-width="9" stroke-linecap="round" fill="none"/>
<rect x="88" y="53" width="26" height="14" rx="3" fill="#2B2F36"/><rect x="108" y="55" width="8" height="10" rx="2" fill="#4B5563"/>
<circle cx="58" cy="60" r="16" fill="#4F5866" stroke="#0E141B" stroke-width="2"/><rect x="64" y="53" width="8" height="14" rx="3" fill="#7DD3FC"/>`
        : `<path d="M44 54 Q30 48 22 52 M44 62 Q32 64 24 70" stroke="${dark}" stroke-width="4" stroke-linecap="round" fill="none"/>
<ellipse cx="56" cy="60" rx="21" ry="17" fill="${main}"/>
<path d="M50 45 L58 75" stroke="#2B2F36" stroke-width="4"/>
<path d="M62 48 Q76 50 84 56" stroke="#D99A6C" stroke-width="7" stroke-linecap="round" fill="none"/>
<path d="M62 72 Q72 70 78 62" stroke="#D99A6C" stroke-width="7" stroke-linecap="round" fill="none"/>
<rect x="66" y="56" width="50" height="7" rx="2" fill="#2B2F36"/><rect x="80" y="51" width="14" height="5" rx="1.5" fill="#4B5563"/>
<rect x="112" y="57" width="6" height="5" rx="1" fill="${main}"/>
<circle cx="56" cy="60" r="12" fill="#3B2A22"/><path d="M45 56 Q56 50 67 56 L67 62 Q56 57 45 62 Z" fill="${dark}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">${body}</svg>`;
}

export interface SpriteSet { normal: HTMLCanvasElement; white: HTMLCanvasElement; grey: HTMLCanvasElement }
/** Sprite pixel size; the 120-unit art is drawn at 0.8 scale so the body matches the hit radius. */
export const SPRITE = 96;

function loadSvg(svg: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

function variant(img: HTMLImageElement, mode: "normal" | "white" | "grey") {
  const c = document.createElement("canvas");
  c.width = c.height = SPRITE * 2; // 2× for crisp zoomed / high-dpi rendering
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0, c.width, c.height);
  if (mode === "white") {
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, c.width, c.height);
  } else if (mode === "grey") {
    const d = g.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v * 0.8;
    }
    g.putImageData(d, 0, 0);
  }
  return c;
}

export async function buildSprites(): Promise<Record<string, SpriteSet>> {
  const out: Record<string, SpriteSet> = {};
  for (const team of ["red", "blue"] as SqTeam[]) for (const role of ["healer", "tank", "fighter"] as SqRole[]) {
    const img = await loadSvg(characterSvg(role, team));
    out[`${role}:${team}`] = { normal: variant(img, "normal"), white: variant(img, "white"), grey: variant(img, "grey") };
  }
  return out;
}

/** The whole map (floor, spawn zones, walls, crates) pre-rendered once. Bushes are drawn later, over players. */
export function buildMap(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = SQ.MAP_W;
  c.height = SQ.MAP_H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2B323A";
  g.fillRect(0, 0, c.width, c.height);
  // concrete slabs
  for (let x = 0; x < c.width; x += 96) for (let y = 0; y < c.height; y += 96) {
    const n = ((x * 7 + y * 13) % 5) / 100;
    g.fillStyle = `rgba(255,255,255,${0.012 + n * 0.3})`;
    g.fillRect(x + 1, y + 1, 94, 94);
  }
  g.strokeStyle = "rgba(0,0,0,0.25)";
  g.lineWidth = 2;
  g.beginPath();
  for (let x = 0; x <= c.width; x += 96) { g.moveTo(x, 0); g.lineTo(x, c.height); }
  for (let y = 0; y <= c.height; y += 96) { g.moveTo(0, y); g.lineTo(c.width, y); }
  g.stroke();
  // painted lines
  g.strokeStyle = "rgba(255,210,122,0.18)";
  g.lineWidth = 6;
  g.setLineDash([40, 30]);
  g.beginPath(); g.moveTo(SQ.MAP_W / 2, 0); g.lineTo(SQ.MAP_W / 2, SQ.MAP_H); g.stroke();
  g.setLineDash([]);
  // spawn zones
  for (const t of ["red", "blue"] as SqTeam[]) {
    const s = SQ_SPAWN[t];
    const col = t === "red" ? "229,72,77" : "62,139,255";
    const grd = g.createRadialGradient(s.x, (s.y0 + s.y1) / 2, 20, s.x, (s.y0 + s.y1) / 2, 320);
    grd.addColorStop(0, `rgba(${col},0.22)`);
    grd.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = grd;
    g.fillRect(s.x - 320, s.y0 - 320, 640, s.y1 - s.y0 + 640);
    g.strokeStyle = `rgba(${col},0.5)`;
    g.lineWidth = 4;
    g.strokeRect(s.x - 90, s.y0 - 40, 180, s.y1 - s.y0 + 80);
  }
  // map edge
  g.strokeStyle = "#56636F";
  g.lineWidth = 10;
  g.strokeRect(5, 5, c.width - 10, c.height - 10);
  // obstacles: drop shadows first, then the blocks
  for (const o of SQ_OBSTACLES) { g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(o.x + 10, o.y + 12, o.w, o.h); }
  for (const o of SQ_OBSTACLES) {
    if (o.kind === "wall") {
      g.fillStyle = "#3F4A55"; g.fillRect(o.x, o.y, o.w, o.h);
      g.fillStyle = "#5A6773"; g.fillRect(o.x, o.y, o.w, 6); g.fillRect(o.x, o.y, 6, o.h);
      g.fillStyle = "#313A43"; g.fillRect(o.x, o.y + o.h - 5, o.w, 5);
    } else {
      g.fillStyle = "#9A7444"; g.fillRect(o.x, o.y, o.w, o.h);
      g.strokeStyle = "#6B4F2A"; g.lineWidth = 5; g.strokeRect(o.x + 2.5, o.y + 2.5, o.w - 5, o.h - 5);
      g.strokeStyle = "#B38A55"; g.lineWidth = 3; g.strokeRect(o.x + 9, o.y + 9, o.w - 18, o.h - 18);
      g.strokeStyle = "#6B4F2A"; g.lineWidth = 4;
      g.beginPath(); g.moveTo(o.x + 9, o.y + 9); g.lineTo(o.x + o.w - 9, o.y + o.h - 9); g.stroke();
    }
  }
  return c;
}

/** Bushes are drawn over players (they hide you a bit). */
export function drawBushes(g: CanvasRenderingContext2D, fade: (i: number) => number) {
  SQ_BUSHES.forEach((b, i) => {
    g.globalAlpha = fade(i);
    for (const [dx, dy, r, c] of [[0, 0, 1, "#2E6B3B"], [b.r * 0.55, b.r * 0.2, 0.7, "#357A44"], [-b.r * 0.5, b.r * 0.3, 0.6, "#2B6237"], [b.r * 0.1, -b.r * 0.45, 0.6, "#3A8A4C"]] as [number, number, number, string][]) {
      g.fillStyle = c;
      g.beginPath(); g.arc(b.x + dx, b.y + dy, b.r * r, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  });
}
