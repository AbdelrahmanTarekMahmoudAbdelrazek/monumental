import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ECHO, ECHO_DOOR_W, ECHO_H, ECHO_LOCKERS, ECHO_ROOMS, ECHO_W, echoDoor, echoTile, type EchoDoorKind } from "@monumental/shared";
import { NOTES, WALL_WORDS } from "./story";

/** A physics box (centre + half sizes). */
export interface Box { x: number; y: number; z: number; hx: number; hy: number; hz: number }
/** Something that gives off light: a tube, the alarm, the crack. Only the nearest few get a real light each frame. */
export interface LightSource { pos: THREE.Vector3; color: string; dist: number; base: number; phase: number; kind: "fluoro" | "alarm" | "alien" | "exit" | "lift" | "candle" | "beacon"; tube?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; cur: number; toggled: number }
export interface HospitalLights { sources: LightSource[]; pool: THREE.PointLight[] }
export type CeilingLight = LightSource;

const T = ECHO.TILE;
const HT = 3.2;
const WT = 0.2;

// room look by plan letter
const SKIN: Record<string, string> = {
  c: "paintCorr", r: "paintCorr", a: "paintWard", b: "paintKids", n: "paintCorr", o: "paintOffice", p: "paintWard", s: "concrete", w: "tile", t: "tile", m: "tileBlue", i: "padded", k: "concrete", x: "concrete",
  h: "paintChapel", f: "tile", y: "paintKids", q: "paintCorr", l: "tile", d: "paintOffice", g: "paintWard", j: "tile", v: "concrete",
};
const FLOOR: Record<string, string> = {
  c: "lino", r: "lino", a: "lino", b: "lino", n: "lino", o: "wood", p: "lino", s: "concrete", w: "tileF", t: "tileF", m: "tileF", i: "lino", k: "concrete", x: "concrete",
  h: "wood", f: "lino", y: "kidsFloor", q: "lino", l: "tileF", d: "lino", g: "lino", j: "tileF", v: "concrete",
};

function hash(x: number, y: number) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x: number, y: number) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
function fbm(x: number, y: number, o = 4) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); a *= 0.5; f *= 2; } return s; }

/** Builds the hospital's meshes, its light sources and the boxes physics collides with. */
export function buildLevel(_tex: unknown, shadows: boolean, size = 512) {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const group = new THREE.Group();
  const boxes: Box[] = [];
  const sources: LightSource[] = [];
  const textures: THREE.Texture[] = [];
  const S2 = size; // texture size (smaller on phones)

  // ── textures (drawn on canvases) ──
  function tex(w: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, rep = true, h = w) {
    const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d")!, w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; textures.push(t); return t;
  }
  function grime(g: CanvasRenderingContext2D, w: number, h: number, amt = 0.5, scale = 6, bottom = 0.25) {
    const img = g.getImageData(0, 0, w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const n = fbm(x / w * scale, y / h * scale, 4), k = (y * w + x) * 4; const f = 1 - amt * Math.max(0, n - 0.38) - bottom * Math.max(0, (y / h - 0.75) * 4) * n - (rnd() - 0.5) * 0.05; d[k] *= f; d[k + 1] *= f; d[k + 2] *= f; }
    g.putImageData(img, 0, 0);
  }
  const paint = (upper: string, lower: string, stripe: string) => tex(S2, (g, w, h) => {
    g.fillStyle = upper; g.fillRect(0, 0, w, h); g.fillStyle = lower; g.fillRect(0, h * 0.64, w, h * 0.36); g.fillStyle = stripe; g.fillRect(0, h * 0.62, w, h * 0.025);
    g.fillStyle = "#1b1c1a"; g.fillRect(0, h * 0.96, w, h * 0.04);
    g.strokeStyle = "rgba(30,26,20,.5)"; g.lineWidth = 1.2;
    for (let i = 0; i < 4; i++) { let x = rnd() * w, y = rnd() * h * 0.5; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 10; k++) { x += (rnd() - 0.5) * 30; y += rnd() * 26; g.lineTo(x, y); } g.stroke(); }
    for (let i = 0; i < 9; i++) { const x = rnd() * w, len = h * (0.15 + rnd() * 0.45), gr = g.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, "rgba(70,60,40,.28)"); gr.addColorStop(1, "rgba(70,60,40,0)"); g.fillStyle = gr; g.fillRect(x, 0, 3 + rnd() * 9, len); }
    grime(g, w, h, 0.55, 5);
  });
  const tiles = (bg: string, base: [number, number, number], vary: number, rough = 0.65) => tex(S2, (g, w, h) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); const st = w / 16; for (let y = 0; y < h; y += st) for (let x = 0; x < w; x += st) { const v = rnd() * vary; g.fillStyle = `rgb(${base[0] + v},${base[1] + v},${base[2] + v})`; g.fillRect(x + 1.5, y + 1.5, st - 3, st - 3); } grime(g, w, h, rough, 6, 0.45); });
  const TX = {
    paintCorr: paint("#a9a58f", "#3f5a4b", "#8e3b2c"), paintWard: paint("#a8a99a", "#56685f", "#2f4a5e"), paintKids: paint("#b0a684", "#5b6f84", "#a8862a"), paintOffice: paint("#9b8e74", "#5a4a3a", "#2a2a26"),
    tile: tiles("#8f938d", [196, 199, 194], 30), tileBlue: tiles("#5d6e74", [140, 166, 172], 20),
    concrete: tex(S2, (g, w, h) => { const img = g.createImageData(w, h), d = img.data; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const n = fbm(x / (w / 8), y / (h / 8), 5), v = 70 + n * 50 + rnd() * 8, k = (y * w + x) * 4; d[k] = v; d[k + 1] = v; d[k + 2] = v * 0.96; d[k + 3] = 255; } g.putImageData(img, 0, 0); grime(g, w, h, 0.5, 4, 0.6); }),
    padded: tex(256, (g, w, h) => { g.fillStyle = "#b9b5a6"; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 64) for (let x = 0; x < w; x += 64) { const r = g.createRadialGradient(x + 32, y + 32, 4, x + 32, y + 32, 40); r.addColorStop(0, "#d8d4c4"); r.addColorStop(1, "#8c887a"); g.fillStyle = r; g.fillRect(x + 1, y + 1, 62, 62); } grime(g, w, h, 0.5, 4); }),
    lino: tex(S2, (g, w, h) => { const st = w / 8; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const v = (x + y) % 2 ? 128 + rnd() * 10 : 70 + rnd() * 10; g.fillStyle = `rgb(${v},${v + 4},${v - 4})`; g.fillRect(x * st, y * st, st, st); } grime(g, w, h, 0.7, 5, 0); }),
    tileF: tex(S2, (g, w, h) => { g.fillStyle = "#4a4d4a"; g.fillRect(0, 0, w, h); const st = w / 8; for (let y = 0; y < h; y += st) for (let x = 0; x < w; x += st) { const v = 150 + rnd() * 25; g.fillStyle = `rgb(${v},${v},${v - 6})`; g.fillRect(x + 2, y + 2, st - 4, st - 4); } grime(g, w, h, 0.7, 5, 0); }),
    wood: tex(S2, (g, w, h) => { const st = h / 16; for (let y = 0; y < h; y += st) { const v = rnd(); g.fillStyle = `rgb(${88 + v * 25},${60 + v * 18},${38 + v * 10})`; g.fillRect(0, y, w, st); g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(0, y, w, 2); } grime(g, w, h, 0.5, 5, 0); }),
    paintChapel: tex(S2, (g, w, h) => { g.fillStyle = "#8f8670"; g.fillRect(0, 0, w, h); const st = w / 6; for (let x = 0; x < w; x += st) { const v = rnd() * 14; g.fillStyle = `rgb(${70 + v},${46 + v},${30 + v})`; g.fillRect(x + 2, h * 0.6, st - 4, h * 0.4); } g.fillStyle = "#3a2618"; g.fillRect(0, h * 0.58, w, h * 0.03); grime(g, w, h, 0.55, 5); }),
    kidsFloor: tex(S2, (g, w, h) => { const cols = ["#7a3a32", "#2f5a6e", "#8a7a2c", "#3d6a46"]; const st = w / 4; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = cols[(x + y * 2) % 4]; g.fillRect(x * st + 1, y * st + 1, st - 2, st - 2); } grime(g, w, h, 0.8, 5, 0); }),
    // wet blood: pools, smears, handprints, drips, trails, spatter, footprints (4 × 4 atlas)
    blood: tex(S2 >= 512 ? 1024 : 512, (g, w) => {
      const c = w / 4;
      const red = (a = 0.9) => `rgba(${105 + rnd() * 45},${rnd() * 8},${rnd() * 6},${a})`;
      const dot = (x: number, y: number, r: number, a = 0.9) => { g.fillStyle = red(a); g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
      const pool = (cx: number, cy: number, r: number) => {
        for (let i = 0; i < 26; i++) { const a = rnd() * 6.28, d = rnd() * r * 0.55; dot(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, r * (0.22 + rnd() * 0.32), 0.85); }
        for (let i = 0; i < 14; i++) { const a = rnd() * 6.28, d = r * (0.75 + rnd() * 0.5); dot(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1 + rnd() * r * 0.06, 0.9); }
        g.fillStyle = "rgba(40,0,0,.6)"; g.beginPath(); g.arc(cx, cy, r * 0.32, 0, 7); g.fill();
        g.fillStyle = "rgba(255,190,190,.18)"; g.beginPath(); g.ellipse(cx - r * 0.2, cy - r * 0.25, r * 0.22, r * 0.08, -0.5, 0, 7); g.fill();
      };
      const hand = (x: number, y: number, sc: number, a: number) => {
        g.save(); g.translate(x, y); g.rotate(a); g.scale(sc, sc); g.fillStyle = red(0.8); g.beginPath(); g.ellipse(0, 0, 14, 17, 0, 0, 7); g.fill();
        for (const [fx, len, ang] of [[-13, 18, -0.9], [-6, 28, -0.15], [1, 31, 0], [8, 28, 0.12], [14, 21, 0.35]]) { g.save(); g.translate(fx, -8); g.rotate(ang); g.fillRect(-3, -len, 6, len); g.beginPath(); g.arc(0, -len, 3, 0, 7); g.fill(); g.restore(); }
        // dragged down the wall
        g.fillStyle = red(0.35); for (let k = 0; k < 4; k++) g.fillRect(-10 + k * 7, 10, 3, 18 + rnd() * 40);
        g.restore();
      };
      for (let k = 0; k < 4; k++) pool((k + 0.5) * c, 0.5 * c, c * (0.26 + rnd() * 0.1));
      for (let k = 0; k < 2; k++) { const y = 1.5 * c, x0 = k * c; for (let i = 0; i < 40; i++) { const f = i / 40; g.fillStyle = red(0.75 * (1 - f) + 0.1); g.beginPath(); g.ellipse(x0 + c * (0.12 + f * 0.78), y + Math.sin(f * 5 + k) * c * 0.05, c * 0.07 * (1 - f * 0.6), c * 0.12 * (1 - f * 0.5), 0, 0, 7); g.fill(); }
        g.strokeStyle = "rgba(30,0,0,.5)"; g.lineWidth = 2; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(x0 + c * 0.12, y - c * 0.08 + i * c * 0.03); g.lineTo(x0 + c * 0.88, y - c * 0.03 + i * c * 0.015); g.stroke(); } }
      for (let k = 0; k < 2; k++) for (let i = 0; i < 3 + k * 2; i++) hand((2 + k + 0.2 + rnd() * 0.6) * c, (1.2 + rnd() * 0.5) * c, 0.9 + rnd() * 0.5, (rnd() - 0.5) * 0.9);
      for (let k = 0; k < 2; k++) { const x0 = k * c, y0 = 2 * c; g.fillStyle = red(0.85); g.fillRect(x0 + c * 0.05, y0 + 2, c * 0.9, c * 0.08); for (let i = 0; i < 14; i++) { const x = x0 + c * (0.08 + rnd() * 0.84), len = c * (0.15 + rnd() * 0.75); g.fillRect(x - 2, y0 + 2, 3 + rnd() * 3, len); dot(x, y0 + 2 + len, 3 + rnd() * 2); } }
      for (let k = 0; k < 2; k++) { const x0 = (2 + k) * c, y0 = 2 * c; for (let i = 0; i < 18; i++) { const f = i / 18; dot(x0 + c * (0.1 + f * 0.8), y0 + c * (0.5 + Math.sin(f * 7 + k * 2) * 0.18), 2 + rnd() * 5); } }
      for (let k = 0; k < 2; k++) { const cx = (k + 0.5) * c, cy = 3.5 * c; dot(cx, cy, c * 0.12); for (let i = 0; i < 60; i++) { const a = rnd() * 6.28, d = c * (0.1 + rnd() * 0.38); dot(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1 + rnd() * 4); }
        for (let i = 0; i < 10; i++) { const a = rnd() * 6.28; g.save(); g.translate(cx + Math.cos(a) * c * 0.15, cy + Math.sin(a) * c * 0.15); g.rotate(a); g.fillStyle = red(0.8); g.beginPath(); g.ellipse(c * 0.12, 0, c * 0.12, 3, 0, 0, 7); g.fill(); g.restore(); } }
      for (let i = 0; i < 6; i++) { const x = 2 * c + c * (0.35 + (i % 2) * 0.3), y = 3 * c + c * (0.9 - i * 0.15); g.save(); g.translate(x, y); g.fillStyle = red(0.6 - i * 0.07); g.beginPath(); g.ellipse(0, 0, 7, 12, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(0, 16, 6, 6, 0, 0, 7); g.fill(); g.restore(); }
      pool(3.4 * c, 3.4 * c, c * 0.3); for (let i = 0; i < 20; i++) { const f = i / 20; g.fillStyle = red(0.6 * (1 - f)); g.fillRect(3.4 * c - c * (0.1 + f * 0.3), 3.4 * c - c * 0.1, c * 0.06, c * 0.2); }
    }, false),
    ceiling: tex(256, (g, w, h) => { g.fillStyle = "#6e6c62"; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 128) for (let x = 0; x < w; x += 128) { g.fillStyle = "#a8a596"; g.fillRect(x + 3, y + 3, 122, 122); } grime(g, w, h, 0.8, 4, 0); }),
  };

  // ── batching: every static piece is moved into place, given world-scale UVs, and merged per material ──
  const BATCH = new Map<string, THREE.BufferGeometry[]>();
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
  const M4 = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) => { _e.set(rx, ry, rz, "YXZ"); _q.setFromEuler(_e); return new THREE.Matrix4().compose(_v.set(x, y, z), _q, _s.set(1, 1, 1)); };
  function worldUV(g: THREE.BufferGeometry, sx: number, sy = sx) {
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i)); let u: number, v: number;
      if (ny > nx && ny > nz) { u = p.getX(i) / sx; v = p.getZ(i) / sx; } else if (nx > nz) { u = p.getZ(i) / sx; v = p.getY(i) / sy; } else { u = p.getX(i) / sx; v = p.getY(i) / sy; } uv.setXY(i, u, v); }
  }
  function put(key: string, geo: THREE.BufferGeometry, m?: THREE.Matrix4, uvScale = 3, uvY?: number) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone(); geo.dispose(); if (m) g.applyMatrix4(m);
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (uvScale) worldUV(g, uvScale, uvY ?? uvScale);
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
    if (!BATCH.has(key)) BATCH.set(key, []); BATCH.get(key)!.push(g);
  }
  const box = (key: string, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, uv = 1) => put(key, new THREE.BoxGeometry(w, h, d), M4(x, y, z, ry, rx, rz), uv);
  const cyl = (key: string, rt: number, rb: number, h: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, seg = 10) => put(key, new THREE.CylinderGeometry(rt, rb, h, seg), M4(x, y, z, ry, rx, rz), 1);
  const Sm = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.85, ...o });
  const MAT: Record<string, THREE.Material> = {
    paintCorr: Sm({ map: TX.paintCorr }), paintWard: Sm({ map: TX.paintWard }), paintKids: Sm({ map: TX.paintKids }), paintOffice: Sm({ map: TX.paintOffice }),
    tile: Sm({ map: TX.tile, roughness: 0.35 }), tileBlue: Sm({ map: TX.tileBlue, roughness: 0.35 }), concrete: Sm({ map: TX.concrete, roughness: 1 }), padded: Sm({ map: TX.padded, roughness: 1 }),
    lino: Sm({ map: TX.lino, roughness: 0.45 }), tileF: Sm({ map: TX.tileF, roughness: 0.4 }), wood: Sm({ map: TX.wood, roughness: 0.7 }), ceiling: Sm({ map: TX.ceiling, roughness: 1 }),
    wallCore: Sm({ color: "#2a2b28" }), trim: Sm({ color: "#2b2e2b" }), trimLight: Sm({ color: "#8e8a7c" }), doorGreen: Sm({ color: "#33493f", roughness: 0.6 }),
    steel: Sm({ color: "#8d9496", roughness: 0.35, metalness: 0.75 }), darkSteel: Sm({ color: "#3a3f42", roughness: 0.45, metalness: 0.6 }),
    white: Sm({ color: "#c9c6bb", roughness: 0.8 }), sheet: Sm({ color: "#b9b6aa", roughness: 1 }), mattress: Sm({ color: "#6f7d84", roughness: 0.9 }),
    curtain: Sm({ color: "#5f7a70", roughness: 1, side: THREE.DoubleSide }), curtainPink: Sm({ color: "#8a6264", roughness: 1, side: THREE.DoubleSide }),
    glass: Sm({ color: "#0b1012", roughness: 0.06, metalness: 0.5 }), black: Sm({ color: "#0d0e0e", roughness: 0.7 }), rubber: Sm({ color: "#141414", roughness: 0.9 }),
    red: Sm({ color: "#6e211b", roughness: 0.6 }), green: Sm({ color: "#2f4d3b", roughness: 0.7 }), cream: Sm({ color: "#a9a189", roughness: 0.8 }), brownLeather: Sm({ color: "#3e2a1f", roughness: 0.7 }),
    paper: Sm({ color: "#cfc8b2", roughness: 1, side: THREE.DoubleSide }), box1: Sm({ color: "#8b7d5c", roughness: 1 }), box2: Sm({ color: "#6d7a6a", roughness: 1 }),
    rust: Sm({ color: "#5b3b29", roughness: 0.8, metalness: 0.3 }), pipe: Sm({ color: "#4b4f46", roughness: 0.6, metalness: 0.5 }), rock: Sm({ map: TX.concrete, color: "#6a665e", roughness: 1 }),
    lampOff: Sm({ color: "#545650", roughness: 0.5 }), void: new THREE.MeshBasicMaterial({ color: "#030404" }), screen: new THREE.MeshBasicMaterial({ color: "#13392f" }),
    glow: Sm({ color: "#0d2a24", emissive: "#58e0c0", emissiveIntensity: 1.3, roughness: 0.3 }),
    paintChapel: Sm({ map: TX.paintChapel }), kidsFloor: Sm({ map: TX.kidsFloor, roughness: 0.8 }),
    blood: new THREE.MeshStandardMaterial({ map: TX.blood, transparent: true, depthWrite: false, roughness: 0.18, metalness: 0.15, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide }),
    hivis: Sm({ color: "#b8c636", roughness: 0.6, emissive: "#252c06" }), navy: Sm({ color: "#151a22", roughness: 0.8 }), flesh: Sm({ color: "#8f8279", roughness: 0.9 }),
    gown: Sm({ color: "#5d7380", roughness: 1 }), scrubs: Sm({ color: "#3f6b66", roughness: 1 }), bag: Sm({ color: "#15181a", roughness: 0.45, metalness: 0.1 }),
    locker: Sm({ color: "#48525a", roughness: 0.5, metalness: 0.55 }), stainless: Sm({ color: "#a3a8aa", roughness: 0.28, metalness: 0.85 }),
    tape: Sm({ color: "#d9c21c", roughness: 0.7, side: THREE.DoubleSide }), brass: Sm({ color: "#b08a3a", roughness: 0.3, metalness: 0.9 }),
    toyRed: Sm({ color: "#8e2a22", roughness: 0.6 }), toyBlue: Sm({ color: "#25507a", roughness: 0.6 }), toyYellow: Sm({ color: "#b89a2a", roughness: 0.6 }), teddy: Sm({ color: "#6a4a2e", roughness: 1 }),
    van: Sm({ color: "#c9c6b8", roughness: 0.5, metalness: 0.2 }), vanStripe: Sm({ color: "#2f5a3a", roughness: 0.5 }), candle: new THREE.MeshBasicMaterial({ color: "#ffcf80" }),
    note: new THREE.MeshBasicMaterial({ color: "#8c8676" }), phoneGlow: new THREE.MeshBasicMaterial({ color: "#7fa6e8" }),
  };
  const solid = (x: number, z: number, w: number, d: number, ry = 0, h = 1.2) => { const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry)); boxes.push({ x, y: h / 2, z, hx: (w * c + d * s) / 2, hy: h / 2, hz: (w * s + d * c) / 2 }); };
  const wallRect = (x0: number, z0: number, x1: number, z1: number) => boxes.push({ x: (x0 + x1) / 2, y: HT / 2, z: (z0 + z1) / 2, hx: (x1 - x0) / 2, hy: HT / 2, hz: (z1 - z0) / 2 });

  // ── floors, ceilings, tube lights ──
  for (let z = 0; z < ECHO_H; z++) for (let x = 0; x < ECHO_W; x++) {
    const k = echoTile(x, z); if (k === "#") continue;
    put(FLOOR[k], new THREE.PlaneGeometry(T, T), M4((x + 0.5) * T, 0, (z + 0.5) * T, 0, -Math.PI / 2), FLOOR[k] === "lino" ? 4 : 3);
    const missing = hash(x * 3, z * 7) > 0.86 && k !== "t";
    if (!missing) put("ceiling", new THREE.PlaneGeometry(T, T), M4((x + 0.5) * T, HT, (z + 0.5) * T, 0, Math.PI / 2), 1.2);
    else {
      put("void", new THREE.PlaneGeometry(T, T), M4((x + 0.5) * T, HT + 0.6, (z + 0.5) * T, 0, Math.PI / 2), 0);
      for (let i = 0; i < 3; i++) cyl("black", 0.01, 0.01, 0.6 + rnd() * 1.2, (x + 0.3 + rnd() * 0.4) * T, HT - 0.3, (z + 0.3 + rnd() * 0.4) * T, 0, (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.4, 4);
      put("ceiling", new THREE.PlaneGeometry(1.2, 1.2), M4((x + 0.5) * T + 0.4, 0.02, (z + 0.5) * T - 0.3, rnd(), -Math.PI / 2 + 0.05), 1.2);
    }
    if ((x + z) % 2 === 0 && !missing && !["x", "k", "s"].includes(k)) {
      const cx = (x + 0.5) * T, cz = (z + 0.5) * T;
      box("trimLight", 1.3, 0.08, 0.32, cx, HT - 0.04, cz);
      const on = hash(x, z * 2) > 0.9 || (k === "c" && x === 9 && z === 6) || (k === "n" && z === 3) || (k === "a" && x === 7 && z === 3) || (k === "c" && x === 16 && z === 6)
        || (k === "c" && x === 27 && z === 9) || (k === "c" && x === 18 && z === 14) || (k === "g" && x === 15 && z === 17) || (k === "f" && x === 26 && z === 4) || (k === "l" && x === 3 && z === 19) || (k === "c" && x === 24 && z === 6);
      const tube = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.22), on ? new THREE.MeshBasicMaterial({ color: "#dff0e6" }) : (MAT.lampOff as unknown as THREE.MeshBasicMaterial));
      tube.position.set(cx, HT - 0.09, cz); group.add(tube);
      if (on) sources.push({ pos: new THREE.Vector3(cx, HT - 0.3, cz), color: "#d8eee2", dist: 8, tube: tube as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>, base: 7, phase: rnd() * 10, kind: "fluoro", cur: 0, toggled: 0 });
    }
  }
  boxes.push({ x: (ECHO_W * T) / 2, y: -0.5, z: (ECHO_H * T) / 2, hx: (ECHO_W * T) / 2, hy: 0.5, hz: (ECHO_H * T) / 2 });

  // ── walls along room edges, with doorways ──
  const signs: { text: string; x: number; y: number; z: number; yaw: number; w: number; plate?: boolean }[] = [];
  function wallSeg(ax: number, az: number, bx: number, bz: number, skinA: string | null, skinB: string | null) {
    const len = Math.hypot(bx - ax, bz - az); if (len < 0.01) return;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, yaw = Math.atan2(bx - ax, bz - az) + Math.PI / 2;
    box("wallCore", len, HT, WT, mx, HT / 2, mz, yaw, 0, 0, 3);
    const nx = Math.sin(yaw), nz = Math.cos(yaw);
    if (skinA) put(skinA, new THREE.PlaneGeometry(len, HT), M4(mx + nx * (WT / 2 + 0.005), HT / 2, mz + nz * (WT / 2 + 0.005), yaw), 3.2, HT);
    if (skinB) put(skinB, new THREE.PlaneGeometry(len, HT), M4(mx - nx * (WT / 2 + 0.005), HT / 2, mz - nz * (WT / 2 + 0.005), yaw + Math.PI), 3.2, HT);
    wallRect(Math.min(ax, bx) - WT / 2, Math.min(az, bz) - WT / 2, Math.max(ax, bx) + WT / 2, Math.max(az, bz) + WT / 2);
  }
  function door(cx: number, cz: number, yaw: number, w: number, kind: EchoDoorKind, a: string, b: string) {
    const s = Math.sin(yaw), c = Math.cos(yaw), head = 2.25;
    box("wallCore", w, HT - head, WT, cx, (HT + head) / 2, cz, yaw);
    put(a !== "#" ? SKIN[a] : "paintCorr", new THREE.PlaneGeometry(w, HT - head), M4(cx - s * (WT / 2 + 0.005), (HT + head) / 2, cz - c * (WT / 2 + 0.005), yaw + Math.PI), 3.2, HT);
    put(b !== "#" ? SKIN[b] : "paintCorr", new THREE.PlaneGeometry(w, HT - head), M4(cx + s * (WT / 2 + 0.005), (HT + head) / 2, cz + c * (WT / 2 + 0.005), yaw), 3.2, HT);
    for (const k of [-1, 1]) box("trim", 0.1, head, WT + 0.06, cx + c * k * (w / 2 + 0.05), head / 2, cz - s * k * (w / 2 + 0.05), yaw);
    box("trim", w + 0.3, 0.1, WT + 0.06, cx, head + 0.05, cz, yaw);
    const leaves = kind === "double" || kind === "front" ? [[-1, 1], [1, -1]] : [[-1, 1]];
    for (const [side, dir] of leaves) {
      const lw = kind === "double" || kind === "front" ? w / 2 - 0.04 : w - 0.06;
      const open = (1.35 + hash(cx, cz + side) * 0.3) * dir * (hash(cz, cx) > 0.5 ? 1 : -1);
      const hx = cx + c * side * (w / 2), hz = cz - s * side * (w / 2), ang = yaw + open;
      const mx = hx - Math.cos(ang) * side * lw / 2, mz = hz + Math.sin(ang) * side * lw / 2;
      const mat = kind === "front" ? "darkSteel" : [a, b].some((r) => r === "t" || r === "m") ? "steel" : "doorGreen";
      box(mat, lw, 2.15, 0.05, mx, 1.08, mz, ang); box("glass", lw * 0.35, 0.45, 0.06, mx, 1.55, mz, ang);
    }
    const corrSide = a === "c" ? -1 : b === "c" ? 1 : a === "#" ? -1 : 1;
    const other = corrSide === -1 ? b : a;
    if (ECHO_ROOMS[other]) signs.push({ text: ECHO_ROOMS[other].name.toUpperCase(), x: cx + s * corrSide * (WT / 2 + 0.03), y: head + 0.42, z: cz + c * corrSide * (WT / 2 + 0.03), yaw: corrSide === 1 ? yaw : yaw + Math.PI, w: Math.max(1.2, w) });
  }
  for (let z = -1; z < ECHO_H; z++) for (let x = -1; x < ECHO_W; x++) for (const side of ["E", "S"] as const) {
    if ((side === "E" && z < 0) || (side === "S" && x < 0)) continue;
    const a = echoTile(x, z), b = side === "E" ? echoTile(x + 1, z) : echoTile(x, z + 1);
    if (a === b) continue;
    const kind = echoDoor(x, z, side);
    if (kind === "open") continue;
    const sA = a !== "#" ? SKIN[a] : null, sB = b !== "#" ? SKIN[b] : null;
    if (side === "E") {
      const X = (x + 1) * T, z0 = z * T, z1 = (z + 1) * T;
      if (!kind) { wallSeg(X, z0, X, z1, sB, sA); continue; }
      const w = ECHO_DOOR_W[kind], c = (z0 + z1) / 2;
      wallSeg(X, z0, X, c - w / 2, sB, sA); wallSeg(X, c + w / 2, X, z1, sB, sA); door(X, c, Math.PI / 2, w, kind, a, b);
    } else {
      const Z = (z + 1) * T, x0 = x * T, x1 = (x + 1) * T;
      if (!kind) { wallSeg(x0, Z, x1, Z, sA, sB); continue; }
      const w = ECHO_DOOR_W[kind], c = (x0 + x1) / 2;
      wallSeg(x0, Z, c - w / 2, Z, sA, sB); wallSeg(c + w / 2, Z, x1, Z, sA, sB); door(c, Z, 0, w, kind, a, b);
    }
  }
  // nurses' station counter, with a gap at the east end
  box("wood", 4.4, 1.05, 0.5, 15 * T + 2.4, 0.52, 6 * T - 0.4); box("trimLight", 4.5, 0.06, 0.62, 15 * T + 2.4, 1.07, 6 * T - 0.4);
  boxes.push({ x: 15 * T + 2.4, y: 0.6, z: 6 * T - 0.4, hx: 2.2, hy: 0.6, hz: 0.25 });

  // ── furniture ──
  const C = (cx: number, cz: number): [number, number] => [(cx + 0.5) * T, (cz + 0.5) * T];
  const L = (x: number, z: number, ry: number) => (lx: number, lz: number): [number, number] => [x + lx * Math.cos(ry) + lz * Math.sin(ry), z - lx * Math.sin(ry) + lz * Math.cos(ry)];
  function bed(x: number, z: number, ry: number, messy: boolean) {
    const p = L(x, z, ry);
    box("steel", 0.95, 0.06, 2.0, x, 0.55, z, ry); let q = p(0, -0.95); box("steel", 0.95, 0.75, 0.05, q[0], 0.75, q[1], ry);
    q = p(0, 0.98); box("steel", 0.95, 0.45, 0.05, q[0], 0.6, q[1], ry);
    for (const [a, b] of [[-0.44, -0.95], [0.44, -0.95], [-0.44, 0.95], [0.44, 0.95]]) { q = p(a, b); cyl("steel", 0.02, 0.02, 0.55, q[0], 0.28, q[1]); }
    box("mattress", 0.88, 0.14, 1.9, x, 0.66, z, ry);
    q = p(0, messy ? 0.2 : 0.1); box("sheet", 0.92, 0.06, messy ? 1.2 : 1.5, q[0], 0.76, q[1], ry, messy ? 0.08 : 0, messy ? 0.12 : 0);
    q = p(0, -0.7); box("white", 0.55, 0.12, 0.35, q[0], 0.78, q[1], ry, 0.1);
    solid(x, z, 1.0, 2.05, ry);
  }
  function curtain(x: number, z: number, ry: number, len: number, pink: boolean) {
    const p = L(x, z, ry); cyl("steel", 0.015, 0.015, len, x, HT - 0.25, z, ry, 0, Math.PI / 2, 6);
    const g = new THREE.PlaneGeometry(len * 0.7, 2.3, Math.floor(len / 0.3), 1); const pp = g.attributes.position; for (let i = 0; i < pp.count; i++) pp.setZ(i, Math.sin(pp.getX(i) * 10) * 0.06); g.computeVertexNormals();
    const q = p(-len * 0.15, 0); put(pink ? "curtainPink" : "curtain", g, M4(q[0], HT - 0.25 - 1.18, q[1], ry), 0);
  }
  const cabinet = (x: number, z: number) => { box("cream", 0.45, 0.8, 0.45, x, 0.4, z); solid(x, z, 0.45, 0.45); };
  const iv = (x: number, z: number) => { cyl("steel", 0.015, 0.015, 1.9, x, 0.95, z); box("glass", 0.12, 0.2, 0.04, x + 0.1, 1.7, z); };
  function wheelchair(x: number, z: number, ry: number) { const p = L(x, z, ry); box("brownLeather", 0.45, 0.06, 0.45, x, 0.5, z, ry); let q = p(0, -0.24); box("brownLeather", 0.45, 0.45, 0.05, q[0], 0.78, q[1], ry, -0.12);
    for (const s of [-1, 1]) { q = p(s * 0.28, -0.05); put("steel", new THREE.TorusGeometry(0.29, 0.02, 6, 20), M4(q[0], 0.3, q[1], ry + Math.PI / 2), 0); } solid(x, z, 0.65, 0.75, ry); }
  function gurney(x: number, z: number, ry: number) { const p = L(x, z, ry); box("steel", 0.65, 0.05, 1.9, x, 0.8, z, ry); box("sheet", 0.6, 0.08, 1.7, x, 0.86, z, ry, 0, 0.03);
    for (const [a, b] of [[-0.3, -0.85], [0.3, -0.85], [-0.3, 0.85], [0.3, 0.85]]) { const q = p(a, b); cyl("steel", 0.015, 0.015, 0.78, q[0], 0.4, q[1]); } solid(x, z, 0.7, 1.95, ry); }
  function chair(x: number, z: number, ry: number, mat = "green") { const p = L(x, z, ry); box(mat, 0.45, 0.06, 0.45, x, 0.46, z, ry); const q = p(0, -0.21); box(mat, 0.45, 0.45, 0.05, q[0], 0.72, q[1], ry, -0.08); for (const [a, b] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) { const r = p(a, b); cyl("darkSteel", 0.015, 0.015, 0.46, r[0], 0.23, r[1]); } }
  function desk(x: number, z: number, ry: number, w = 1.6) { box("wood", w, 0.05, 0.8, x, 0.76, z, ry); const p = L(x, z, ry); for (const s of [-1, 1]) { const q = p(s * (w / 2 - 0.25), 0); box("wood", 0.45, 0.74, 0.75, q[0], 0.37, q[1], ry); } solid(x, z, w, 0.8, ry); }
  function shelf(x: number, z: number, ry: number, w = 2.0, stocked = 0.6) { const p = L(x, z, ry); for (const s of [-1, 1]) { const q = p(s * w / 2, 0); box("darkSteel", 0.04, 2.0, 0.45, q[0], 1.0, q[1], ry); }
    for (const y of [0.15, 0.6, 1.05, 1.5, 1.95]) { box("darkSteel", w, 0.03, 0.45, x, y, z, ry); for (let i = 0; i < 6; i++) if (rnd() < stocked && y < 1.9) { const q = p(-w / 2 + 0.2 + rnd() * (w - 0.4), (rnd() - 0.5) * 0.2); const bw = 0.12 + rnd() * 0.18, bh = 0.1 + rnd() * 0.25; box(rnd() < 0.5 ? "box1" : "box2", bw, bh, 0.2, q[0], y + 0.015 + bh / 2, q[1], ry + (rnd() - 0.5) * 0.3); } }
    solid(x, z, w, 0.45, ry, 2); }
  const filing = (x: number, z: number, ry: number) => { box("darkSteel", 0.5, 1.35, 0.65, x, 0.67, z, ry); solid(x, z, 0.5, 0.65, ry); };
  const papers = (x: number, z: number, n = 6, r = 1) => { for (let i = 0; i < n; i++) put("paper", new THREE.PlaneGeometry(0.21, 0.297), M4(x + (rnd() - 0.5) * 2 * r, 0.01 + i * 0.002, z + (rnd() - 0.5) * 2 * r, rnd() * 6, -Math.PI / 2), 0); };
  const sink = (x: number, z: number) => { box("white", 0.55, 0.18, 0.42, x, 0.82, z); cyl("white", 0.06, 0.08, 0.72, x, 0.36, z); };
  const rocks = (n: number, fx: () => [number, number, number]) => { for (let i = 0; i < n; i++) { const [x, y, z] = fx(); put("rock", new THREE.DodecahedronGeometry(0.3 + rnd() * 0.6, 0), M4(x, y, z, rnd() * 6), 2); } };

  // reception
  { const [x, z] = C(3, 2); desk(x, z, 0, 3.0); box("wood", 3.0, 1.15, 0.08, x, 0.58, z + 0.42); chair(x - 0.6, z - 0.8, 0);
    for (let i = 0; i < 5; i++) chair(C(1, 4)[0] + 0.1, C(1, 4)[1] - 1.8 + i * 0.6, Math.PI / 2, "red");
    for (let i = 0; i < 4; i++) chair(C(4, 4)[0] + 0.4, C(4, 4)[1] - 1.5 + i * 0.6, -Math.PI / 2, "red");
    papers(C(2, 3)[0], C(2, 3)[1], 10, 1.4); wheelchair(C(4, 1)[0] + 0.6, C(4, 1)[1] + 0.2, 2.5); }
  // ward A
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) { const x = 7.5 * T + s * 2.9, z = (1.4 + i * 1.1) * T; bed(x, z, s * Math.PI / 2, rnd() < 0.4); cabinet(x - s * 0.1, z + 1.45); if (rnd() < 0.6) iv(x - s * 0.9, z - 0.9); curtain(x - s * 0.2, z + 1.6, 0, 2.6, false); }
  // ward B
  for (let i = 0; i < 3; i++) { bed((11.5 + i * 1.3) * T, 1.4 * T, Math.PI, i === 1); curtain((11.5 + i * 1.3) * T + 1.3, 1.4 * T, Math.PI / 2, 2.6, true); bed((11.5 + i * 1.3) * T, 4.5 * T, 0, false); }
  // nurses' station
  { const [x, z] = C(15, 2); desk(x + 1.5, z, 0, 2.6); box("black", 0.5, 0.4, 0.4, x + 1.0, 1.0, z - 0.1); box("screen", 0.42, 0.3, 0.01, x + 1.0, 1.02, z + 0.105);
    chair(x + 1.4, z + 0.9, Math.PI); papers(x + 1.7, z + 1.5, 6, 0.8); shelf(C(16, 1)[0], C(16, 1)[1] - 1.2, 0, 1.8, 0.8); filing(C(15, 4)[0] - 1.0, C(15, 4)[1] + 0.4, Math.PI / 2); }
  // office
  { const [x, z] = C(17.5, 2.5); desk(x, z, 0, 1.8); chair(x, z - 0.8, 0, "brownLeather"); for (let i = 0; i < 3; i++) filing(18.75 * T, (1.3 + i * 0.75) * T, -Math.PI / 2); papers(x, z + 1.2, 12, 1.0); }
  // pharmacy
  { for (let i = 0; i < 3; i++) shelf(C(1, 9)[0] - 1.25, (8.6 + i * 1.5) * T, Math.PI / 2, 2.6, 0.5); for (let i = 0; i < 2; i++) shelf(C(3, 9)[0] + 1.25, (9.1 + i * 1.6) * T, -Math.PI / 2, 2.6, 0.35);
    box("wood", 3.4, 1.0, 0.5, 1 * T + 1.9, 0.5, 9 * T + 0.2); for (let i = 0; i < 11; i++) cyl("steel", 0.01, 0.01, 1.2, 1 * T + 0.3 + i * 0.32, 1.6, 9 * T + 0.2, 0, 0, 0, 4);
    boxes.push({ x: 1 * T + 1.9, y: 0.6, z: 9 * T + 0.2, hx: 1.7, hy: 0.6, hz: 0.25 }); papers(C(2, 11)[0], C(2, 11)[1], 8, 1.2); }
  // stairs & lift
  { for (let i = 0; i < 9; i++) box("concrete", 1.4, 0.18, 0.3, 5.5 * T - 0.1, 0.09 + i * 0.18, 8 * T + 0.4 + i * 0.3, 0, 0, 0, 2); solid(5.5 * T - 0.1, 8 * T + 1.75, 1.4, 2.8, 0, 2);
    rocks(10, () => [5.5 * T + (rnd() - 0.5) * 1.2, 1.7 + rnd() * 1.2, 8 * T + 2.4 + rnd() * 0.8]);
  }
  // the lift: two doors that slide apart when the power comes back, a lit cab behind them
  const steelMat = MAT.steel;
  const liftDoors = [-1, 1].map((k) => { const d = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.2, 0.56), steelMat); d.position.set(4 * T + 0.14, 1.1, 9 * T + 0.75 + k * 0.28); d.castShadow = shadows; group.add(d); return d; });
  box("trimLight", 0.08, 0.3, 1.5, 4 * T + 0.14, 2.38, 9 * T + 0.75); box("trim", 0.1, 2.25, 0.08, 4 * T + 0.14, 1.12, 9 * T + 0.0); box("trim", 0.1, 2.25, 0.08, 4 * T + 0.14, 1.12, 9 * T + 1.5);
  const cabMat = new THREE.MeshBasicMaterial({ color: "#0a0a08" });
  const cab = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.15), cabMat); cab.position.set(4 * T + 0.105, 1.08, 9 * T + 0.75); cab.rotation.y = Math.PI / 2; group.add(cab);
  const liftLight: LightSource = { pos: new THREE.Vector3(4 * T + 0.7, 2.4, 9 * T + 0.75), color: "#ffe2b0", dist: 7, base: 0, phase: 0, kind: "lift", cur: 0, toggled: 0 };
  sources.push(liftLight);
  const liftArrow = new THREE.Mesh(new THREE.CircleGeometry(0.09, 3), new THREE.MeshBasicMaterial({ color: "#3a1a10" })); liftArrow.position.set(4 * T + 0.19, 2.38, 9 * T + 0.75); liftArrow.rotation.set(0, Math.PI / 2, Math.PI / 2); group.add(liftArrow);
  // the fuse box on the boiler room wall, three empty slots
  { const X = 19 * T - 0.1 - 0.13, Z = 10.5 * T;
    box("darkSteel", 0.26, 1.0, 0.8, X, 1.45, Z); box("steel", 0.04, 0.95, 0.75, X - 0.14, 1.45, Z); box("pipe", 0.08, 1.6, 0.08, X + 0.05, 2.5, Z - 0.3);
    signs.push({ text: "FUSES · LIFT", x: X - 0.17, y: 2.1, z: Z, yaw: -Math.PI / 2, w: 0.8, plate: true }); }
  const fuseSlots = [0, 1, 2].map((i) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.14), new THREE.MeshBasicMaterial({ color: "#3a0c08" })); m.position.set(19 * T - 0.1 - 0.13 - 0.17, 1.6 - i * 0.22, 10.5 * T); group.add(m); return m; });
  // washrooms
  { for (let i = 0; i < 3; i++) { const x = 4 * T + 0.3 + i * 1.2; box("green", 0.05, 2.0, 1.4, x + 1.2, 1.05, 12 * T + 2.25); box("green", 0.95, 2.0, 0.04, x + 0.6, 1.05, 12 * T + 1.5); cyl("white", 0.2, 0.18, 0.42, x + 0.6, 0.21, 12 * T + 2.5); }
    boxes.push({ x: 4 * T + 1.8, y: 1, z: 12 * T + 2.25, hx: 1.8, hy: 1, hz: 0.75 });
    for (let i = 0; i < 3; i++) { sink(5.9 * T - 0.25, (10.3 + i * 0.6) * T); box("glass", 0.02, 0.8, 0.6, 6 * T - 0.115, 1.6, (10.3 + i * 0.6) * T); } }
  // operating theatre
  { const [x, z] = C(7, 10); box("darkSteel", 0.5, 0.8, 0.6, x, 0.4, z); box("black", 0.65, 0.12, 2.0, x, 0.88, z); box("sheet", 0.7, 0.03, 1.2, x, 0.96, z + 0.3, 0, 0.02, 0.05); solid(x, z, 0.7, 2.0);
    cyl("steel", 0.03, 0.03, 1.0, x, HT - 0.5, z); put("white", new THREE.SphereGeometry(0.5, 16, 8, 0, 7, 0, Math.PI / 2), M4(x + 0.2, HT - 0.95, z - 0.2, 0, 0.3), 0);
    box("steel", 0.8, 0.04, 0.45, x + 1.4, 0.95, z - 0.6); box("steel", 0.8, 0.04, 0.45, x + 1.4, 0.45, z - 0.6); solid(x + 1.4, z - 0.6, 0.8, 0.45);
    box("black", 0.5, 0.4, 0.3, x - 1.5, 1.4, z - 1.2); box("screen", 0.42, 0.3, 0.01, x - 1.5, 1.42, z - 1.04); cyl("darkSteel", 0.03, 0.03, 1.2, x - 1.5, 0.6, z - 1.2); solid(x - 1.5, z - 1.2, 0.5, 0.4);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: "#ff3a2a" })); lamp.position.set(6.5 * T, HT - 0.12, 8 * T + 0.2); group.add(lamp);
    sources.push({ pos: new THREE.Vector3(6.5 * T, HT - 0.3, 8 * T + 0.4), color: "#ff2a1a", dist: 9, base: 7, phase: 0, kind: "alarm", tube: lamp, cur: 0, toggled: 0 }); }
  // morgue
  { const X = 14.9 * T; for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) { const zz = (8.3 + c * 0.75) * T + 0.3, yy = 0.5 + r * 0.75; box("steel", 0.04, 0.68, 0.68, X, yy, zz); box("darkSteel", 0.06, 0.04, 0.2, X - 0.04, yy + 0.18, zz); }
    box("darkSteel", 0.5, 2.3, 3.2 * 3, X + 0.28, 1.15, (8.3 + 1.5 * 0.75) * T + 0.3); solid(X + 0.2, (8.3 + 1.5 * 0.75) * T + 0.3, 0.6, 9.2, 0, 2.3);
    const zo = (8.3 + 2 * 0.75) * T + 0.3; box("steel", 1.6, 0.05, 0.62, X - 0.8, 1.22, zo); box("sheet", 1.5, 0.12, 0.5, X - 0.8, 1.31, zo, 0, 0, 0.02); solid(X - 0.8, zo, 1.6, 0.62);
    const [x, z] = C(12.5, 10); box("steel", 0.9, 0.05, 2.1, x, 0.92, z); cyl("steel", 0.12, 0.18, 0.9, x, 0.45, z); solid(x, z, 0.9, 2.1); sink(x - 1.8, C(12, 8)[1] - 1.25); gurney(x + 1.6, z + 1.8, 0.4);
    sources.push({ pos: new THREE.Vector3(x, HT - 0.4, z), color: "#7fa8ff", dist: 8, base: 5, phase: 3, kind: "fluoro", cur: 0, toggled: 0 }); }
  // isolation room 7
  { const [x, z] = C(15.5, 9); bed(x + 0.6, z, Math.PI / 2, false); chair(x - 1.2, z - 2.6, Math.PI, "cream"); papers(x - 0.5, z + 1.6, 3, 0.4);
    signs.push({ text: "ROOM 7 · E. MARR", x: 16.2 * T, y: 1.75, z: 8 * T - WT / 2 - 0.02, yaw: Math.PI, w: 1.1, plate: true }); }
  // store
  { shelf(C(15, 11)[0] - 0.9, C(15, 12)[1], Math.PI / 2, 2.6, 0.8); shelf(C(16, 11)[0] + 0.9, C(16, 12)[1] - 0.6, -Math.PI / 2, 2.0, 0.8); }
  // boiler room and the crack
  { const [x, z] = C(17.5, 10.5); cyl("rust", 1.0, 1.0, 2.6, x + 0.3, 1.3, z, 0, 0, Math.PI / 2, 16); solid(x + 0.3, z, 2.8, 2.1, 0, 2.3);
    for (let i = 0; i < 4; i++) cyl("pipe", 0.09, 0.09, 13.5, 17.5 * T + (i - 1.5) * 0.4, HT - 0.35 - i * 0.12, 10.5 * T, 0, Math.PI / 2, 0, 8);
    put("glow", new THREE.PlaneGeometry(0.5, 4.5), M4(18 * T + 0.6, 0.015, 12 * T + 0.6, 0.7, -Math.PI / 2), 0); put("glow", new THREE.PlaneGeometry(0.15, 2.4), M4(19 * T - 0.115, 1.0, 12.4 * T, -Math.PI / 2, 0, 0.3), 0);
    sources.push({ pos: new THREE.Vector3(18 * T + 0.6, 0.5, 12 * T + 0.8), color: "#4fe0bc", dist: 10, base: 9, phase: 1, kind: "alien", cur: 0, toggled: 0 });
    rocks(6, () => [18 * T + 0.6 + (rnd() - 0.5) * 2, 0.15, 12 * T + 0.6 + (rnd() - 0.5) * 2]); }
  // corridor clutter, handrails, exit signs
  gurney(C(6, 6)[0], C(6, 6)[1] - 0.6, Math.PI / 2 + 0.1); gurney(C(13, 7)[0], C(13, 7)[1] + 0.5, Math.PI / 2 - 0.2); wheelchair(C(10, 11)[0] - 0.5, C(10, 11)[1], 0.8); iv(C(16, 6)[0], C(16, 7)[1] + 0.9);
  papers(C(9, 6)[0], C(9, 6)[1] + 1.5, 8, 1.6); papers(C(10, 9)[0], C(10, 9)[1], 5, 1.0);
  // handrails along both corridors (not across doors, lockers or side corridors)
  const lockerNear = (x: number, z: number) => ECHO_LOCKERS.some((L) => Math.abs(L[0] - x) < 1.8 && Math.abs(L[1] - z) < 0.8);
  for (const [zz, rowN, rowS] of [[6 * T + 0.14, 5, 6], [8 * T - 0.14, 7, 8], [13 * T + 0.14, 12, 13], [15 * T - 0.14, 14, 15]] as [number, number, number][]) for (let x = 1 * T + 0.2; x < 29.6 * T; x += 3) {
    const cx = Math.floor(x / T), north = zz % T < 1;
    if (echoDoor(cx, rowN, "S") || echoTile(cx, north ? rowN : rowS) === "c" || echoTile(cx, north ? rowN : rowS) === "#" || lockerNear(x + 1.5, zz)) continue;
    box("wood", 2.8, 0.06, 0.06, x + 1.5, 0.95, zz);
  }
  for (const [x, y, z, ry] of [[2.5 * T, 2.6, 1 * T + 0.14, 0], [30 * T - 0.14, 2.7, 20 * T, -Math.PI / 2]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.04), new THREE.MeshBasicMaterial({ color: "#2fd27a" })); m.position.set(x, y, z); m.rotation.y = ry; group.add(m);
    sources.push({ pos: new THREE.Vector3(x + Math.sin(ry) * 0.3, y - 0.2, z + Math.cos(ry) * 0.3), color: "#2fd27a", dist: 4, base: 1.2, phase: 0, kind: "exit", cur: 0, toggled: 0 });
  }
  rocks(12, () => [2.5 * T + (rnd() - 0.5) * 3, 0.3 + rnd() * 2, 1 * T - 1.2 - rnd() * 0.8]);

  // ═════════ v34: the east wing, the lower floor, the lost police teams ═════════
  /** A blood decal from the atlas: cell 0–15; on the floor (flat) unless `wall` (then it faces ry). */
  function blood(cell: number, w: number, h: number, x: number, y: number, z: number, ry = 0, wall = false) {
    const g = new THREE.PlaneGeometry(w, h); const uv = g.attributes.uv; const col = cell % 4, row = Math.floor(cell / 4);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (col + uv.getX(i)) / 4, 1 - (row + 1 - uv.getY(i)) / 4);
    put("blood", g, wall ? M4(x, y, z, ry) : M4(x, 0.012 + rnd() * 0.004 + y, z, ry, -Math.PI / 2), 0);
  }
  const puddle = (x: number, z: number, s = 2.2) => blood(Math.floor(rnd() * 4), s, s, x, 0, z, rnd() * 6);
  /** Drops leading from one point to another. */
  const trail = (ax: number, az: number, bx: number, bz: number) => { const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(d / 1.3)), a = Math.atan2(bx - ax, bz - az) + Math.PI / 2; for (let i = 0; i < n; i++) { const f = (i + 0.5) / n; blood(rnd() < 0.5 ? 10 : 11, 1.4, 1.4, ax + (bx - ax) * f, 0, az + (bz - az) * f, a); } };
  const drag = (ax: number, az: number, bx: number, bz: number) => { const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(d / 1.6)), a = Math.atan2(bx - ax, bz - az) + Math.PI / 2; for (let i = 0; i < n; i++) { const f = (i + 0.5) / n; blood(rnd() < 0.5 ? 4 : 5, 1.8, 0.9, ax + (bx - ax) * f, 0, az + (bz - az) * f, a); } };
  /** Wall blood (handprints, drips, spatter) on a wall face at (x, z) facing ry. */
  const wallBlood = (cell: number, x: number, y: number, z: number, ry: number, s = 1.1) => blood(cell, s, s, x, y, z, ry, true);

  /** Someone who didn't get out, lying on their back (head toward −z in its own frame). */
  function corpse(x: number, z: number, ry: number, who: "police" | "patient" | "nurse", bleed = true) {
    const p = L(x, z, ry), top = who === "police" ? "hivis" : who === "nurse" ? "scrubs" : "gown", legs = who === "police" ? "navy" : who === "nurse" ? "scrubs" : "gown";
    const lim = (mat: string, w: number, len: number, px: number, pz: number, ang: number, y = 0.07) => { const q = p(px + Math.sin(ang) * len / 2, pz + Math.cos(ang) * len / 2); box(mat, w, w * 0.9, len, q[0], y, q[1], ry + ang); return p(px + Math.sin(ang) * len, pz + Math.cos(ang) * len); };
    let q = p(0, 0); box(top, 0.42, 0.2, 0.6, q[0], 0.11, q[1], ry, 0, (rnd() - 0.5) * 0.2);
    q = p(0, 0.38); box(legs, 0.36, 0.17, 0.22, q[0], 0.09, q[1], ry);
    const tilt = (rnd() - 0.5) * 1.2; q = p(Math.sin(tilt) * 0.06, -0.42); put("flesh", new THREE.SphereGeometry(0.115, 10, 8), M4(q[0], 0.11, q[1], ry + tilt), 1);
    if (who === "police") cyl("navy", 0.12, 0.12, 0.08, q[0] + Math.sin(ry + tilt) * -0.08, 0.1, q[1] + Math.cos(ry + tilt) * -0.08, ry, Math.PI / 2 - 0.3);
    for (const s of [-1, 1]) {
      const a = s * (0.25 + rnd() * 1.4);
      lim(top, 0.1, 0.32, s * 0.25, -0.2, a);
      const fa = a + s * (rnd() * 0.8);
      const e = p(s * 0.25 + Math.sin(a) * 0.32, -0.2 + Math.cos(a) * 0.32);
      const f = [e[0] + Math.sin(ry + fa) * 0.15, e[1] + Math.cos(ry + fa) * 0.15];
      box(who === "nurse" ? "flesh" : top, 0.085, 0.08, 0.3, f[0], 0.06, f[1], ry + fa);
      const ft = lim(legs, 0.13, 0.85, s * 0.1, 0.48, s * (0.04 + rnd() * 0.3));
      box(who === "police" ? "black" : "flesh", 0.12, 0.14, 0.24, ft[0], 0.08, ft[1], ry + s * 0.2);
    }
    if (bleed) { puddle(x + (rnd() - 0.5) * 0.4, z + (rnd() - 0.5) * 0.4, 2.6 + rnd() * 0.9); if (rnd() < 0.6) blood(12 + Math.floor(rnd() * 2), 1.4, 1.4, p(0, -0.6)[0], 0, p(0, -0.6)[1], rnd() * 6); }
  }
  function bodyBag(x: number, z: number, ry: number) { box("bag", 0.55, 0.26, 1.85, x, 0.13, z, ry); const p = L(x, z, ry); const q = p(0.08, 0); box("darkSteel", 0.02, 0.02, 1.6, q[0], 0.265, q[1], ry); const h = p(0, -0.7); put("bag", new THREE.SphereGeometry(0.16, 8, 6), M4(h[0], 0.18, h[1], ry), 1); }
  /** A body under a sheet on a bed (the bed is built separately). */
  function shrouded(x: number, z: number, ry: number) { const p = L(x, z, ry); box("sheet", 0.7, 0.18, 1.55, x, 0.83, z, ry, 0.02); const h = p(0, -0.72); put("sheet", new THREE.SphereGeometry(0.15, 10, 8), M4(h[0], 0.86, h[1], ry), 1); blood(Math.floor(rnd() * 4), 0.7, 0.7, p(0, -0.2)[0], 0.94, p(0, -0.2)[1], rnd() * 6); }

  /** A staff locker you can hide in: door faces `yaw` (player yaw convention, forward = (−sin, −cos)). */
  function locker(x: number, z: number, yaw: number, dented = false) {
    const p = L(x, z, yaw);
    box("locker", 0.6, 1.95, 0.55, x, 0.975, z, yaw, 0, dented ? 0.02 : 0);
    let q = p(0, -0.278); box("darkSteel", 0.54, 1.85, 0.012, q[0], 0.97, q[1], yaw);
    for (let i = 0; i < 5; i++) { q = p(0, -0.286); box("black", 0.36, 0.022, 0.01, q[0], 1.5 + i * 0.055, q[1], yaw); }
    q = p(0.2, -0.29); box("steel", 0.03, 0.14, 0.03, q[0], 1.05, q[1], yaw);
    solid(x, z, 0.62, 0.57, yaw, 2);
  }
  ECHO_LOCKERS.forEach(([x, z, yaw], i) => locker(x, z, yaw, i % 5 === 2));
  /** A handheld police radio / a phone / a sheet of paper: the readable things (story.ts). */
  for (const n of NOTES) {
    if (n.kind === "paper") { put("note", new THREE.PlaneGeometry(0.24, 0.31), M4(n.x, n.y + 0.004, n.z, n.ry, -Math.PI / 2), 0); put("paper", new THREE.PlaneGeometry(0.22, 0.3), M4(n.x + 0.18, n.y + 0.002, n.z + 0.05, n.ry + 0.5, -Math.PI / 2), 0); }
    else if (n.kind === "phone") { box("black", 0.078, 0.012, 0.155, n.x, n.y + 0.006, n.z, n.ry); put("phoneGlow", new THREE.PlaneGeometry(0.066, 0.13), M4(n.x, n.y + 0.0135, n.z, n.ry, -Math.PI / 2), 0); }
    else if (n.kind === "radio") { box("black", 0.07, 0.04, 0.2, n.x, n.y + 0.02, n.z, n.ry); const p = L(n.x, n.z, n.ry)(0.02, -0.12); cyl("black", 0.008, 0.008, 0.16, p[0], n.y + 0.03, p[1], n.ry, Math.PI / 2, 0, 4); box("toyRed", 0.02, 0.01, 0.02, n.x, n.y + 0.045, n.z, n.ry); }
    else if (n.kind === "clipboard") { const p = L(n.x, n.z, n.ry)(0, 0.0); box("brownLeather", 0.25, 0.34, 0.012, p[0], n.y, p[1], n.ry); put("note", new THREE.PlaneGeometry(0.21, 0.28), M4(p[0] + Math.sin(n.ry) * 0.008, n.y - 0.02, p[1] + Math.cos(n.ry) * 0.008, n.ry), 0); }
    else if (n.kind === "taped") { put("note", new THREE.PlaneGeometry(0.3, 0.4), M4(n.x + Math.sin(n.ry) * 0.012, n.y, n.z + Math.cos(n.ry) * 0.012, n.ry), 0); for (const s of [-1, 1]) box("tape", 0.12, 0.03, 0.004, n.x + Math.cos(n.ry) * s * 0.13 + Math.sin(n.ry) * 0.015, n.y + 0.19, n.z - Math.sin(n.ry) * s * 0.13 + Math.cos(n.ry) * 0.015, n.ry, 0, s * 0.5); }
  }

  // ── chapel ──
  { const ax = 64.5, az = 5.0;
    box("white", 2.4, 1.0, 0.9, ax, 0.5, az); box("sheet", 2.5, 0.02, 1.0, ax, 1.005, az); solid(ax, az, 2.4, 0.9, 0, 1.0);
    box("wood", 0.08, 1.4, 0.08, ax, 2.2, 3.12); box("wood", 0.7, 0.08, 0.08, ax, 2.55, 3.12);
    for (const dx of [-0.9, -0.5, 0.6, 0.95]) { cyl("cream", 0.03, 0.03, 0.18 + rnd() * 0.1, ax + dx, 1.1, az - 0.25); put("candle", new THREE.SphereGeometry(0.015, 4, 3), M4(ax + dx, 1.24, az - 0.25), 0); }
    sources.push({ pos: new THREE.Vector3(ax, 1.6, az + 0.4), color: "#ffb35a", dist: 7, base: 2.6, phase: 0.3, kind: "candle", cur: 0, toggled: 0 });
    for (const px of [60.6, 68.4]) for (let r = 0; r < 4; r++) {
      const pz = 8.5 + r * 2.5, knocked = (r === 2 && px > 64) || (r === 3 && px < 64);
      const ry = knocked ? 0.5 + rnd() * 0.4 : 0, p = L(px, pz, ry);
      box("wood", 3.0, 0.07, 0.45, px, 0.45, pz, ry); let q = p(0, 0.24); box("wood", 3.0, 0.55, 0.06, q[0], 0.72, q[1], ry, 0.1);
      for (const s of [-1, 1]) { q = p(s * 1.45, 0); box("wood", 0.06, 0.45, 0.45, q[0], 0.22, q[1], ry); }
      solid(px, pz, 3.0, 0.6, ry, 0.9);
    }
    corpse(66.2, 13.2, 2.4, "patient"); drag(66.2, 13.2, 64.5, 17.6); papers(61, 15, 6, 1.2);
    wallBlood(6, 57 + WT / 2 + 0.012, 1.4, 12.5, Math.PI / 2, 1.2); }

  // ── cafeteria ──
  { box("stainless", 11, 0.95, 0.75, 80, 0.475, 3.55); box("glass", 11, 0.35, 0.02, 80, 1.15, 3.85); solid(80, 3.55, 11, 0.75, 0, 1.0);
    for (const tx of [75, 78.3, 82, 85.5]) for (const tz of [9.2, 13.5]) {
      const over = tx === 82 && tz === 13.5;
      box("cream", 1.6, 0.05, 0.8, tx, over ? 0.42 : 0.76, tz, over ? 0.3 : 0, over ? 1.3 : 0); if (!over) { cyl("darkSteel", 0.04, 0.06, 0.74, tx, 0.37, tz); solid(tx, tz, 1.6, 0.8); }
      for (const s of [-1, 1]) for (const k of [-0.45, 0.45]) { if (rnd() < 0.3) { const q = [tx + k + (rnd() - 0.5), tz + s * 1.2 + (rnd() - 0.5)]; box("green", 0.45, 0.45, 0.06, q[0], 0.1, q[1], rnd() * 6, Math.PI / 2); } else chair(tx + k, tz + s * 0.7, s > 0 ? Math.PI : 0, "green"); }
      if (!over) for (let i = 0; i < 2; i++) { box("darkSteel", 0.42, 0.02, 0.3, tx - 0.4 + i * 0.8, 0.79, tz + (rnd() - 0.5) * 0.3, rnd() * 0.4); cyl("white", 0.09, 0.07, 0.03, tx - 0.4 + i * 0.8, 0.81, tz); }
    }
    puddle(82, 13.2, 2.4); trail(82, 13.2, 87.5, 16.8); wallBlood(8, 80, 2.2, 3 + WT / 2 + 0.012, 0, 2.0); papers(76, 15.8, 5, 1.5); }

  // ── playroom (crayon on the walls, toys, nobody) ──
  { box("cream", 1.2, 0.04, 0.8, 60.5, 0.5, 29); box("cream", 1.2, 0.04, 0.8, 60.5, 0.5, 33.5);
    for (const [tx, tz] of [[60.5, 29], [60.5, 33.5]]) { for (const s of [-1, 1]) cyl("darkSteel", 0.02, 0.02, 0.48, tx + s * 0.5, 0.24, tz); solid(tx, tz, 1.2, 0.8, 0, 0.55); for (const s of [-1, 1]) { const ry = s > 0 ? Math.PI : 0; box("toyBlue", 0.3, 0.04, 0.3, tx + (rnd() - 0.5) * 0.6, 0.28, tz + s * 0.6, ry); } }
    box("toyRed", 1.1, 0.55, 0.6, 67.4, 0.275, 27.5); box("toyYellow", 1.12, 0.06, 0.62, 67.4, 0.62, 27.2, 0, -0.6); solid(67.4, 27.5, 1.1, 0.6, 0, 0.6);
    for (let i = 0; i < 26; i++) box(["toyRed", "toyBlue", "toyYellow"][i % 3], 0.12, 0.12, 0.12, 62 + rnd() * 5, 0.06, 30 + rnd() * 6, rnd() * 3);
    for (const [bx, bz, r] of [[58.2, 25.0, 0.6], [65.0, 37.6, 2.4], [63.3, 31.0, 1.0]]) { put("teddy", new THREE.SphereGeometry(0.16, 10, 8), M4(bx, 0.16, bz), 1); put("teddy", new THREE.SphereGeometry(0.11, 10, 8), M4(bx + Math.sin(r) * 0.04, 0.39, bz + Math.cos(r) * 0.04), 1); for (const s of [-1, 1]) put("teddy", new THREE.SphereGeometry(0.04, 6, 4), M4(bx + Math.cos(r) * s * 0.08, 0.48, bz - Math.sin(r) * s * 0.08), 1); }
    // a rocking horse
    { const hx = 66.5, hz = 34.5; box("toyYellow", 0.25, 0.25, 0.8, hx, 0.55, hz); box("toyYellow", 0.18, 0.4, 0.18, hx, 0.8, hz - 0.4, 0, 0.3); box("toyYellow", 0.16, 0.16, 0.32, hx, 0.98, hz - 0.55); for (const s of [-1, 1]) put("toyRed", new THREE.TorusGeometry(0.5, 0.025, 4, 16, 1.6), M4(hx + s * 0.12, 0.52, hz, Math.PI / 2, 0, -Math.PI / 2 - 0.8), 0); solid(hx, hz, 0.4, 1.0, 0, 0.9); }
    for (let i = 0; i < 4; i++) box(i % 2 ? "toyRed" : "toyBlue", 0.09, 0.05, 0.16, 59 + i * 0.25 + rnd() * 0.1, 0.025, 37.9 - (i % 2) * 0.1, (rnd() - 0.5) * 0.5);
    trail(61.5, 24.2, 63.5, 31.5); wallBlood(6, 69 - WT / 2 - 0.012, 0.75, 34.0, -Math.PI / 2, 0.8); }

  // ── police checkpoint: Team Two's barricade, two of them still here ──
  { // the barricade: an overturned desk, a gurney on its side, crates
    box("wood", 3.2, 0.8, 0.06, 79.2, 0.42, 28, 0, 0, 0.0); box("wood", 3.2, 0.06, 0.8, 79.2, 0.8, 28.4, 0, 0, 0); solid(79.2, 28.2, 3.4, 0.9, 0, 1.1);
    box("steel", 0.65, 1.9, 0.05, 76.8, 0.4, 28.1, 0.1, 0, Math.PI / 2); solid(76.8, 28.1, 0.7, 1.9, Math.PI / 2 + 0.1, 0.9);
    for (let i = 0; i < 4; i++) box(i % 2 ? "box1" : "box2", 0.6, 0.45, 0.45, 77.5 + i * 0.75, 0.225, 27.4 + (rnd() - 0.5) * 0.3, rnd() * 0.3);
    desk(78.5, 34.5, 0, 3.2); chair(78.4, 35.4, Math.PI, "navy"); box("black", 0.45, 0.3, 0.35, 80.0, 0.93, 34.4);
    for (let i = 0; i < 3; i++) box("darkSteel", 0.5, 0.8, 0.04, 70.2 + i * 0.55, 0.8, 24.6, 0, 0.2);
    for (const [cx, cz] of [[70.5, 37.5], [80.3, 25.2], [73.2, 26.0]]) { cyl("toyRed", 0.01, 0.13, 0.42, cx, 0.21, cz); box("white", 0.2, 0.05, 0.2, cx, 0.32, cz); }
    for (let i = 0; i < 18; i++) cyl("brass", 0.006, 0.006, 0.022, 73 + rnd() * 4, 0.011, 29 + rnd() * 4, rnd() * 6, Math.PI / 2, 0, 5);
    // tape across the north doors, sagging
    for (let i = 0; i < 2; i++) box("tape", 2.4, 0.06, 0.004, 73.5, 1.1 + i * 0.5, 24 + WT / 2 + 0.03, 0, 0, (i ? -1 : 1) * 0.12);
    corpse(74.5, 31.4, 0.8, "police"); corpse(79.6, 26.1, -1.9, "police");
    drag(79.6, 26.1, 75.5, 30.5); trail(74.5, 31.4, 81 - 0.3, 31.5); puddle(76.8, 33.8, 1.2);
    wallBlood(12, 81 - WT / 2 - 0.012, 1.4, 27.0, -Math.PI / 2, 1.6); wallBlood(6, 81 - WT / 2 - 0.012, 1.1, 29.4, -Math.PI / 2, 1.0); wallBlood(8, 69 + WT / 2 + 0.012, 2.4, 36.0, Math.PI / 2, 1.6);
    // a dropped beacon still flashing blue and red
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.12, 10), new THREE.MeshBasicMaterial({ color: "#2a4aff" })); lamp.position.set(71.2, 0.06, 36.4); lamp.rotation.z = 1.3; group.add(lamp);
    sources.push({ pos: new THREE.Vector3(71.4, 0.5, 36.2), color: "#2a4aff", dist: 11, base: 7, phase: 0, kind: "beacon", tube: lamp, cur: 0, toggled: 0 });
    papers(76, 36, 8, 1.4); }
  // Team Two's last man, in the service corridor
  corpse(85.9, 42.1, 2.0, "police"); trail(80, 41.2, 85.6, 42.0); wallBlood(12, 86, 1.0, 45 - WT / 2 - 0.012, Math.PI, 1.6);

  // ── laundry ──
  { for (let i = 0; i < 8; i++) { const mx = 13.2 + i * 0.85; box("white", 0.72, 0.9, 0.72, mx, 0.45, 45.5); cyl("glass", 0.23, 0.23, 0.02, mx, 0.5, 45.13, 0, Math.PI / 2, 0, 16); put("darkSteel", new THREE.TorusGeometry(0.24, 0.025, 6, 18), M4(mx, 0.5, 45.13), 0); }
    solid(16.2, 45.5, 6.9, 0.72, 0, 1.0);
    for (const lz of [52, 55.5, 59]) { cyl("darkSteel", 0.01, 0.01, 12, 12, HT - 0.35, lz, Math.PI / 2, 0, Math.PI / 2, 4); for (let i = 0; i < 5; i++) { const sx = 7.5 + i * 2.4 + rnd() * 0.6, sh = 1.4 + rnd() * 0.6; const g2 = new THREE.PlaneGeometry(1.4, sh, 6, 1); const pp = g2.attributes.position; for (let k = 0; k < pp.count; k++) pp.setZ(k, Math.sin(pp.getX(k) * 7 + i) * 0.05); g2.computeVertexNormals(); put(i === 2 && lz === 55.5 ? "curtainPink" : "sheet", g2, M4(sx, HT - 0.35 - sh / 2, lz, rnd() * 0.2), 0); } }
    for (let i = 0; i < 3; i++) { const cx = 6 + i * 4.2, cz = 63 + (rnd() - 0.5); box("darkSteel", 1.0, 0.6, 0.6, cx, 0.5, cz, rnd() * 0.4); box("sheet", 0.9, 0.3, 0.5, cx, 0.85, cz, rnd() * 0.4); solid(cx, cz, 1.0, 0.6, 0, 1); }
    blood(1, 0.6, 0.6, 10.3, 0.86 + 0.01, 63.0, 0.3); corpse(17.5, 61.5, -0.6, "nurse"); drag(17.5, 61.5, 20.6, 55.5); }

  // ── records ──
  { for (const sx of [25.0, 28.5, 31.5, 34.5]) shelf(sx, 60, Math.PI / 2, 5.0, 0.85);
    desk(27.3, 52.2, 0, 1.8); chair(27.3, 53.1, Math.PI); box("black", 0.45, 0.35, 0.4, 28.0, 0.97, 52.0); box("screen", 0.4, 0.28, 0.01, 28.0, 0.99, 52.21);
    for (let i = 0; i < 5; i++) filing(22 + i * 0.6, 45.5, Math.PI);
    papers(29, 56, 18, 2.5); papers(32, 50, 10, 2); papers(24, 63, 8, 1.4); wallBlood(9, 36 - WT / 2 - 0.012, 2.3, 51, -Math.PI / 2, 1.6); }

  // ── ward C ──
  { for (const bx of [38.5, 42.5, 50.5, 54.5]) { bed(bx, 64.6, Math.PI, rnd() < 0.5); cabinet(bx + 1.1, 65.4); curtain(bx + 1.5, 64.6, Math.PI / 2, 2.6, false); }
    for (const bx of [40.5, 46.5, 52.5]) { bed(bx, 52, Math.PI / 2, bx === 46.5); if (rnd() < 0.7) iv(bx - 0.4, 50.7); }
    shrouded(42.5, 64.6, Math.PI); shrouded(52.5, 52, Math.PI / 2); shrouded(54.5, 64.6, Math.PI);
    gurney(48.5, 58.5, 0.9); wheelchair(44.5, 47.8, 2.2); corpse(46.6, 62.0, 3.0, "patient"); drag(46.6, 62.0, 43.6, 46.2);
    wallBlood(13, 46.5, 1.9, 66 - WT / 2 - 0.012, Math.PI, 1.5); wallBlood(6, 57 - WT / 2 - 0.012, 1.2, 58, -Math.PI / 2, 1.1); }

  // ── kitchen (the cold room is shut from inside) ──
  { box("stainless", 4.8, 0.92, 0.7, 60.4, 0.46, 45.45); box("stainless", 4.8, 0.92, 0.7, 68.6, 0.46, 45.45); solid(60.4, 45.45, 4.8, 0.7, 0, 1); solid(68.6, 45.45, 4.8, 0.7, 0, 1);
    box("stainless", 3.2, 0.92, 1.3, 64.5, 0.46, 55); solid(64.5, 55, 3.2, 1.3, 0, 1); for (let i = 0; i < 5; i++) cyl("darkSteel", 0.012, 0.012, 0.4, 63.2 + i * 0.65, HT - 1.0, 55, 0, 0, 0, 4);
    for (let i = 0; i < 4; i++) { cyl("darkSteel", 0.14, 0.12, 0.2, 63.4 + i * 0.7, 1.02, 55 + (rnd() - 0.5) * 0.6); }
    box("stainless", 1.6, 2.3, 0.08, 64, 1.15, 66 - WT / 2 - 0.05); box("darkSteel", 0.06, 0.4, 0.1, 64.6, 1.15, 66 - WT / 2 - 0.12);
    wallBlood(6, 64.9, 1.3, 66 - WT / 2 - 0.1, Math.PI, 0.9); wallBlood(7, 63.2, 1.0, 66 - WT / 2 - 0.1, Math.PI, 0.8);
    drag(64, 65, 71.5, 55.5); puddle(64.2, 64.6, 1.3); papers(60, 52, 4, 1); }

  // ── ambulance bay: the ramp goes into rock ──
  { const vx = 77.2, vz = 53;
    box("van", 2.2, 2.0, 5.2, vx, 1.35, vz); box("vanStripe", 2.22, 0.25, 5.22, vx, 1.2, vz); box("van", 2.1, 1.3, 1.4, vx, 1.0, vz - 3.2); box("glass", 1.9, 0.6, 0.05, vx, 1.4, vz - 3.88, 0, -0.25);
    for (const [wx, wz] of [[-1, -2.6], [1, -2.6], [-1, 1.8], [1, 1.8]]) cyl("rubber", 0.38, 0.38, 0.25, vx + wx * 1.05, 0.38, vz + wz, 0, 0, Math.PI / 2, 12);
    for (const s of [-1, 1]) box("van", 1.05, 1.9, 0.05, vx + s * 1.5, 1.35, vz + 2.65, s * 1.1, 0, 0);
    box("black", 2.0, 1.8, 0.02, vx, 1.4, vz + 2.6); solid(vx, vz - 0.6, 2.3, 7.0, 0, 2.4);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.2), new THREE.MeshBasicMaterial({ color: "#2a4aff" })); lamp.position.set(vx, 2.42, vz - 2.4); group.add(lamp);
    sources.push({ pos: new THREE.Vector3(vx, 2.9, vz - 2.4), color: "#2a4aff", dist: 9, base: 4, phase: 0.5, kind: "beacon", tube: lamp, cur: 0, toggled: 0 });
    gurney(80.0, 61.0, 0.2); for (let i = 0; i < 3; i++) bodyBag(73.4, 59.5 + i * 2.1, Math.PI / 2 + (rnd() - 0.5) * 0.2);
    corpse(82.4, 59.6, -2.6, "police"); drag(82.4, 59.6, 78.2, 56.4); wallBlood(12, 90 - WT / 2 - 0.012, 1.3, 57.5, -Math.PI / 2, 1.8);
    rocks(30, () => [86.5 + rnd() * 3.3, 0.2 + rnd() * 2.6, 54 + rnd() * 11.5]); boxes.push({ x: 88.4, y: 1.6, z: 60, hx: 1.6, hy: 1.6, hz: 6 });
    box("concrete", 3.5, 0.06, 11.5, 88.2, 0.35, 60.2, 0, 0, 0.18); }

  // ── more of the night in the old rooms ──
  corpse(47.0, 12.0, 1.2, "nurse"); puddle(47.4, 12.4, 1.6);
  trail(46.5, 17.5, 31, 19.5); drag(31, 20.5, 29.6, 25.2); trail(30.2, 38.5, 30.2, 44); puddle(30.1, 40.8, 1.4);
  wallBlood(6, 9 * T + WT / 2 + 0.012, 1.3, 33.5, Math.PI / 2, 1.0); wallBlood(8, 33.5, 2.5, 39 - WT / 2 - 0.012, Math.PI, 1.6);
  puddle(C(7, 10)[0] + 0.6, C(7, 10)[1] + 1.4, 2.0); wallBlood(12, 6 * T + WT / 2 + 0.012, 1.5, 31.5, Math.PI / 2, 1.8);
  wallBlood(7, 12.5, 1.2, 18 + WT / 2 + 0.012, 0, 1.0); trail(12.5, 19.2, 13.8, 26.0);
  puddle(C(15.5, 9)[0] - 1.2, C(15.5, 9)[1] + 1.0, 1.4); wallBlood(13, 16.5 * T, 1.7, 8 * T + WT / 2 + 0.012, 0, 1.4);
  gurney(C(27, 9)[0], C(27, 9)[1], 0.25); wheelchair(C(28, 13)[0], C(28, 13)[1] + 0.8, 2.6); gurney(C(6, 13)[0], C(6, 13)[1] + 0.4, Math.PI / 2 + 0.12);
  papers(C(20, 13)[0], C(20, 13)[1], 8, 1.6); papers(C(25, 6)[0], C(25, 6)[1] + 0.5, 6, 1.4);
  // Team One's sergeant made it as far as the east corridor
  corpse(87.2, 21.6, 0.4, "police"); drag(83.5, 26.5, 86.8, 22.4); wallBlood(6, 90 - WT / 2 - 0.012, 1.0, 22.5, -Math.PI / 2, 1.1);
  for (const [x, z, ry] of [[55.5, 18 + WT / 2 + 0.012, 0], [70.5, 24 - WT / 2 - 0.012, Math.PI], [4.5, 39 + WT / 2 + 0.012, 0], [58.5, 45 - WT / 2 - 0.012, Math.PI], [20.5, 45 - WT / 2 - 0.012, Math.PI]] as [number, number, number][]) wallBlood(6 + Math.floor(rnd() * 2), x, 0.9 + rnd() * 0.6, z, ry, 1.0);
  trail(58, 21, 66, 22.5); trail(45, 42, 56, 43.5); puddle(66.2, 22.6, 1.4); puddle(21.5, 42.8, 1.8);

  // ── merge ──
  for (const [key, list] of BATCH) {
    const g = mergeGeometries(list, false); for (const x of list) x.dispose(); if (!g) continue;
    const m = new THREE.Mesh(g, MAT[key]);
    m.castShadow = shadows && !["void", "glow", "ceiling", "lino", "tileF", "concrete"].includes(key); m.receiveShadow = key !== "void";
    group.add(m);
  }

  // ── signs and wall writing ──
  function signTex(text: string, plate?: boolean) {
    return tex(512, (g) => {
      g.fillStyle = plate ? "#c8c2ae" : "#1f3a46"; g.fillRect(0, 0, 512, 96); g.strokeStyle = plate ? "#555" : "#d8d2c2"; g.lineWidth = 5; g.strokeRect(5, 5, 502, 86);
      g.fillStyle = plate ? "#222" : "#e8e2d2"; let fs = 46; g.font = `600 ${fs}px Arial, sans-serif`; while (g.measureText(text).width > 470) { fs -= 2; g.font = `600 ${fs}px Arial, sans-serif`; }
      g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, 256, 50); grime(g, 512, 96, 0.6, 5, 0);
    }, false, 96);
  }
  for (const s of signs) { const w = s.plate ? s.w : Math.min(1.6, s.w); const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 96 / 512), new THREE.MeshStandardMaterial({ map: signTex(s.text, s.plate), roughness: 0.6 })); m.position.set(s.x, s.y, s.z); m.rotation.y = s.yaw; group.add(m); }
  const decal = (draw: (g: CanvasRenderingContext2D) => void, w: number, h: number, x: number, y: number, z: number, ry: number, size: [number, number] = [512, 256]) => { const t = tex(size[0], draw, false, size[1]); const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 0.9 })); m.position.set(x, y, z); m.rotation.y = ry; group.add(m); };
  const FACE_S = 6 * T + WT / 2 + 0.01, FACE_N = 8 * T - WT / 2 - 0.01;
  decal((g) => { g.strokeStyle = g.fillStyle = "rgba(214,92,52,.9)"; g.lineWidth = 10; g.beginPath(); g.moveTo(140, 20); g.lineTo(372, 236); g.moveTo(372, 20); g.lineTo(140, 236); g.stroke(); g.font = "bold 32px 'Courier New', monospace"; g.textAlign = "center"; g.fillText("10/13", 256, 60); g.fillText("EXP3", 160, 138); g.fillText("0", 352, 138); g.fillText("1 MIA", 256, 226); }, 1.0, 0.5, C(11, 6)[0], 1.7, FACE_S, 0);
  decal((g) => { g.fillStyle = "rgba(220,216,200,.85)"; g.font = "bold 66px 'Courier New', monospace"; g.textAlign = "center"; g.save(); g.translate(256, 110); g.rotate(-0.05); g.fillText("DON'T ANSWER", 0, 0); g.restore(); g.font = "30px 'Courier New', monospace"; g.fillStyle = "rgba(220,216,200,.6)"; g.fillText("it sounds like us", 256, 180); }, 2.4, 1.2, C(14, 7)[0], 1.6, FACE_N, Math.PI);
  decal((g) => { g.fillStyle = "rgba(30,20,18,.55)"; for (let i = 0; i < 4; i++) { g.save(); g.translate(60 + i * 110, 40 + i * 12); g.rotate(0.15 * i); for (let f = 0; f < 4; f++) g.fillRect(f * 16, 0, 9, 120 + f * 8); g.restore(); } }, 1.4, 0.7, 17 * T - WT / 2 - 0.01, 1.3, C(16, 9)[1], -Math.PI / 2);
  // blood words, and the drawing in the playroom
  for (const [text, x, y, z, ry, w] of WALL_WORDS) decal((g) => {
    g.font = "bold 92px 'Special Elite', 'Courier New', monospace"; g.textAlign = "center"; g.textBaseline = "middle";
    let fs = 92; while (g.measureText(text).width > 980) { fs -= 4; g.font = `bold ${fs}px 'Special Elite', 'Courier New', monospace`; }
    g.fillStyle = "rgba(96,6,4,.9)"; g.save(); g.translate(512, 100); g.rotate((rnd() - 0.5) * 0.06); g.fillText(text, 0, 0); g.restore();
    const tw = g.measureText(text).width; for (let i = 0; i < 26; i++) { const dx = 512 - tw / 2 + rnd() * tw, len = 20 + rnd() * 110; g.fillRect(dx, 120, 3 + rnd() * 3, len); g.beginPath(); g.arc(dx + 2.5, 120 + len, 3.5, 0, 7); g.fill(); }
  }, w, w / 4, x, y, z, ry, [1024, 256]);
  { const n = NOTES.find((q) => q.kind === "drawing"); if (n) decal((g) => {
    g.lineCap = "round"; g.lineJoin = "round";
    const fig = (x: number, col: string, face: boolean) => { g.strokeStyle = col; g.lineWidth = 7; g.beginPath(); g.arc(x, 70, 30, 0, 7); g.stroke(); if (face) { g.fillStyle = col; g.fillRect(x - 12, 62, 6, 6); g.fillRect(x + 6, 62, 6, 6); g.beginPath(); g.arc(x, 78, 10, 0.2, 2.9); g.stroke(); } g.beginPath(); g.moveTo(x, 100); g.lineTo(x - 30, 190); g.lineTo(x + 30, 190); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(x - 12, 190); g.lineTo(x - 18, 240); g.moveTo(x + 12, 190); g.lineTo(x + 18, 240); g.stroke(); };
    fig(150, "#b23a2e", true); fig(330, "#2a2a2a", false);
    g.strokeStyle = "#b23a2e"; g.lineWidth = 6; g.beginPath(); g.moveTo(175, 140); g.lineTo(305, 140); g.stroke();
    g.fillStyle = "#3a5a9a"; g.font = "bold 34px 'Comic Sans MS', 'Chalkboard SE', sans-serif"; g.textAlign = "left"; g.fillText("MUMMY CAME TWICE", 30, 290); g.fillText("THE 2ND ONE SANG IT WRONG", 30, 335);
    g.strokeStyle = "#c9a52a"; g.lineWidth = 5; g.beginPath(); g.arc(440, 50, 26, 0, 7); g.stroke();
  }, 1.1, 0.8, n.x, n.y, n.z, n.ry, [512, 360]); }
  decal((g) => { g.fillStyle = "#d8d0b8"; g.beginPath(); g.arc(128, 128, 124, 0, 7); g.fill(); g.strokeStyle = "#222"; g.lineWidth = 6; g.stroke(); const hand = (a: number, len: number, w: number) => { g.lineWidth = w; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.sin(a) * len, 128 - Math.cos(a) * len); g.stroke(); }; hand(((9 + 47 / 60) / 12) * Math.PI * 2, 60, 10); hand((47 / 60) * Math.PI * 2, 92, 6); }, 0.45, 0.45, C(3, 1)[0], 2.5, 1 * T + WT / 2 + 0.01, 0, [256, 256]);

  // only a few real lights, moved to the nearest sources every frame (steady cost wherever you are)
  const pool = Array.from({ length: 4 }, () => { const l = new THREE.PointLight(0xffffff, 0, 8, 1.7); group.add(l); return l; });
  return { group, boxes, lights: { sources, pool } as HospitalLights, goal: { liftDoors, cab: cabMat, liftLight, liftArrow: liftArrow.material as THREE.MeshBasicMaterial, fuseSlots }, dispose: () => textures.forEach((t) => t.dispose()) };
}

/** Dying tubes, the alarm, the crack's slow pulse; then the nearest sources get the real lights. */
export function flickerLights(lights: HospitalLights, t: number, px: number, pz: number, fear: { x: number; z: number; r: number; kill: boolean }[] = []) {
  for (const L of lights.sources) {
    const was = L.cur > 0;
    // something wrong is standing near: the tubes stutter; when it shows itself they die
    const f = fear.find((q) => Math.hypot(L.pos.x - q.x, L.pos.z - q.z) < q.r);
    if (f && L.kind !== "exit") {
      const dead = f.kill || Math.sin(t * 23 + L.phase * 11) > 0.35;
      if (dead) {
        L.cur = f.kill ? 0 : L.base * 0.15;
        L.tube?.material.color.set("#1a1b19");
        if (L.kind === "fluoro" && was !== L.cur > 0) L.toggled = t;
        continue;
      }
    }
    if (L.kind === "alarm") { const on = Math.sin(t * 3.2) > 0; L.cur = on ? L.base : 0.2; L.tube?.material.color.set(on ? "#ff3a2a" : "#3a0c08"); }
    else if (L.kind === "beacon") { const ph = (t * 1.7 + L.phase) % 1, blue = ph < 0.5, on = (ph % 0.5) < 0.32; L.color = blue ? "#2a4aff" : "#ff2a2a"; L.cur = on ? L.base : 0.1; L.tube?.material.color.set(on ? L.color : "#120808"); }
    else if (L.kind === "candle") L.cur = L.base * (0.75 + 0.15 * Math.sin(t * 11 + L.phase) + 0.1 * Math.sin(t * 23.7));
    else if (L.kind === "alien") L.cur = L.base * (0.7 + 0.3 * Math.sin(t * 0.9 + L.phase));
    else if (L.kind === "exit" || L.kind === "lift") L.cur = L.base;
    else {
      const cyc = (t * 0.23 + L.phase) % 1, stutter = Math.sin(t * 31 + L.phase * 7) > 0.2;
      const off = cyc < 0.55 || (cyc < 0.62 && stutter) || Math.sin(t * 19 + L.phase * 5) > 0.93;
      L.cur = off ? 0 : L.base; L.tube?.material.color.set(off ? "#2e302c" : "#dff0e6");
    }
    if (L.kind === "fluoro" && was !== L.cur > 0) L.toggled = t;
  }
  const near = lights.sources.map((L) => ({ L, d: Math.hypot(L.pos.x - px, L.pos.z - pz) + (L.kind === "exit" ? 5 : 0) })).filter((o) => o.d < 24).sort((a, b) => a.d - b.d);
  lights.pool.forEach((pl, i) => { const o = near[i]; if (!o) { pl.intensity = 0; return; } pl.position.copy(o.L.pos); pl.color.set(o.L.color); pl.distance = o.L.dist; pl.intensity = o.L.cur; });
}
