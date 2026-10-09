import * as THREE from "three";

/** Small seeded random so every player sees the same stains. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")!] as const;
}

/** Soft blotches of dirt / damp. */
function stains(g: CanvasRenderingContext2D, size: number, r: () => number, n: number, color: string, maxR: number) {
  for (let i = 0; i < n; i++) {
    const x = r() * size, y = r() * size, rad = (0.2 + r() * 0.8) * maxR;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, color);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

function grain(g: CanvasRenderingContext2D, size: number, r: () => number, amount: number) {
  const d = g.getImageData(0, 0, size, size);
  for (let i = 0; i < d.data.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n;
  }
  g.putImageData(d, 0, 0);
}

function toTexture(c: HTMLCanvasElement, srgb: boolean, aniso: number) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Grey bump map from a colour canvas (darker = deeper). */
function bumpFrom(src: HTMLCanvasElement, aniso: number) {
  const [c, g] = canvas(src.width);
  g.filter = "grayscale(1) contrast(1.4)";
  g.drawImage(src, 0, 0);
  return toTexture(c, false, aniso);
}

export interface EchoTextures {
  wall: THREE.Texture; wallBump: THREE.Texture;
  floor: THREE.Texture; floorBump: THREE.Texture;
  ceil: THREE.Texture;
  frame: THREE.Texture;
  cookie: THREE.Texture;
}

/** Hospital ward: tiled lower walls, stained plaster above, worn linoleum, ceiling panels. */
export function makeTextures(size: number, aniso: number): EchoTextures {
  // ── walls (one 3 m × 3 m face) ──
  const [w, wg] = canvas(size);
  const r = rng(7);
  const s = size / 512;
  wg.fillStyle = "#8F8B78"; // plaster
  wg.fillRect(0, 0, size, size);
  stains(wg, size, r, 26, "rgba(70,60,40,0.35)", 90 * s);
  stains(wg, size, r, 10, "rgba(40,50,35,0.35)", 60 * s);
  // water streaks
  for (let i = 0; i < 14; i++) {
    const x = r() * size;
    const grd = wg.createLinearGradient(0, 0, 0, size * 0.6);
    grd.addColorStop(0, "rgba(60,50,35,0.35)");
    grd.addColorStop(1, "rgba(60,50,35,0)");
    wg.fillStyle = grd;
    wg.fillRect(x, 0, (2 + r() * 6) * s, size * (0.2 + r() * 0.4));
  }
  // lower 40 %: tiles
  const tileTop = size * 0.6;
  wg.fillStyle = "#6E8A7E";
  wg.fillRect(0, tileTop, size, size - tileTop);
  const ts = size / 10;
  for (let y = tileTop; y < size; y += ts) for (let x = 0; x < size; x += ts) {
    const v = 0.85 + r() * 0.3;
    wg.fillStyle = `rgba(${Math.round(110 * v)},${Math.round(140 * v)},${Math.round(126 * v)},1)`;
    wg.fillRect(x + 1.5 * s, y + 1.5 * s, ts - 3 * s, ts - 3 * s);
    if (r() < 0.08) { wg.strokeStyle = "rgba(20,20,15,0.6)"; wg.lineWidth = 1.2 * s; wg.beginPath(); wg.moveTo(x + r() * ts, y); wg.lineTo(x + r() * ts, y + ts); wg.stroke(); }
  }
  // dark rail between tiles and plaster
  wg.fillStyle = "#3E4A42";
  wg.fillRect(0, tileTop - 8 * s, size, 10 * s);
  stains(wg, size, r, 12, "rgba(30,25,15,0.4)", 50 * s);
  // grime at the floor line
  const fl = wg.createLinearGradient(0, size * 0.88, 0, size);
  fl.addColorStop(0, "rgba(20,18,12,0)");
  fl.addColorStop(1, "rgba(20,18,12,0.75)");
  wg.fillStyle = fl;
  wg.fillRect(0, size * 0.88, size, size * 0.12);
  grain(wg, size, r, 18);

  // ── floor (one 3 m tile = 2 × 2 linoleum squares) ──
  const [f, fg] = canvas(size);
  const r2 = rng(11);
  const half = size / 2;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    fg.fillStyle = (i + j) % 2 ? "#4A4A3E" : "#6A665A";
    fg.fillRect(i * half, j * half, half, half);
  }
  fg.strokeStyle = "rgba(10,10,8,0.6)";
  fg.lineWidth = 2 * s;
  fg.strokeRect(0, 0, size, size);
  fg.beginPath(); fg.moveTo(half, 0); fg.lineTo(half, size); fg.moveTo(0, half); fg.lineTo(size, half); fg.stroke();
  stains(fg, size, r2, 20, "rgba(25,20,10,0.45)", 80 * s);
  for (let i = 0; i < 40; i++) { // scuffs
    fg.strokeStyle = `rgba(${r2() < 0.5 ? "15,15,10" : "140,135,120"},${0.15 + r2() * 0.2})`;
    fg.lineWidth = (0.5 + r2() * 1.5) * s;
    const x = r2() * size, y = r2() * size, a = r2() * Math.PI, l = (10 + r2() * 60) * s;
    fg.beginPath(); fg.moveTo(x, y); fg.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); fg.stroke();
  }
  grain(fg, size, r2, 22);

  // ── ceiling panels ──
  const [c, cg] = canvas(size / 2);
  const r3 = rng(5);
  const cs = size / 2;
  cg.fillStyle = "#77746A";
  cg.fillRect(0, 0, cs, cs);
  cg.strokeStyle = "#3A3A34";
  cg.lineWidth = 3 * s;
  for (let k = 0; k <= 2; k++) { cg.beginPath(); cg.moveTo(k * cs / 2, 0); cg.lineTo(k * cs / 2, cs); cg.moveTo(0, k * cs / 2); cg.lineTo(cs, k * cs / 2); cg.stroke(); }
  stains(cg, cs, r3, 10, "rgba(70,55,30,0.45)", 50 * s);
  grain(cg, cs, r3, 16);

  // ── door frames: dark painted metal ──
  const [d, dg] = canvas(128);
  const r4 = rng(3);
  dg.fillStyle = "#3B4440";
  dg.fillRect(0, 0, 128, 128);
  stains(dg, 128, r4, 8, "rgba(80,60,40,0.5)", 30);
  grain(dg, 128, r4, 24);

  // ── torch cookie: bright core, a ring, soft fall-off, a few smudges ──
  const [k, kg] = canvas(256);
  const r5 = rng(9);
  const grd = kg.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.28, "rgba(235,235,235,1)");
  grd.addColorStop(0.36, "rgba(255,255,255,1)");
  grd.addColorStop(0.42, "rgba(170,170,170,1)");
  grd.addColorStop(0.75, "rgba(70,70,70,1)");
  grd.addColorStop(1, "rgba(0,0,0,1)");
  kg.fillStyle = grd;
  kg.fillRect(0, 0, 256, 256);
  stains(kg, 256, r5, 6, "rgba(0,0,0,0.18)", 40);

  return {
    wall: toTexture(w, true, aniso), wallBump: bumpFrom(w, aniso),
    floor: toTexture(f, true, aniso), floorBump: bumpFrom(f, aniso),
    ceil: toTexture(c, true, aniso),
    frame: toTexture(d, true, aniso),
    cookie: (() => { const t = new THREE.CanvasTexture(k); t.colorSpace = THREE.SRGBColorSpace; return t; })(),
  };
}
