import * as THREE from "three";
import type { EchoLook } from "@monumental/shared";

/** Swatches for the colour slots in EchoLook (indexes are what travels on the wire). */
export const SKIN_COLORS = ["#f3d2b5", "#e6b892", "#c99168", "#a86f48", "#7d4e30", "#55331f"];
export const HAIR_COLORS = ["#141110", "#3b2516", "#6b3f22", "#a8642f", "#d3b07a", "#7a7d80"];
export const COAT_COLORS = ["#3c4a36", "#2a3340", "#5a2a2c", "#6f5a33", "#2c2e30", "#3f5f6a", "#7a3d1f", "#d8d2c2"];
export const PANTS_COLORS = ["#28344a", "#1d1f22", "#4a4535", "#3a3f35"];

export type TeenMove = "idle" | "walk" | "run" | "crouch" | "crouchIdle" | "scared" | "radio" | "scan" | "wave";
export interface TeenControl {
  move: TeenMove;
  /** Ground speed in m/s (drives the step rate). Defaults to a natural speed for the move. */
  speed?: number;
  /** Where they look: + up, radians. */
  pitch?: number;
  /** Their light is on (hand-held lights are raised and aimed). */
  lightOn?: boolean;
  /** Talking: the shoulder radio light blinks. */
  talk?: boolean;
}
export interface TeenLightCfg { intensity: number; distance: number; decay: number; shadows: boolean; beam: number }

type Pose = Record<string, number>;
type Side = 1 | -1; // +1 = their left (+x), -1 = their right
interface Limb { sh: THREE.Group; el: THREE.Group; wr: THREE.Group; th: THREE.Group; kn: THREE.Group; an: THREE.Group }

const M = (color: string, rough = 0.85, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });
const capG = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 5, 12);
const sphG = (r: number, ws = 16, hs = 12, ...a: number[]) => new THREE.SphereGeometry(r, ws, hs, ...a);
const cylG = (rt: number, rb: number, h: number, s = 14, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open);
function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, pos?: number[], rot?: number[], scale?: number[]) {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  if (scale) m.scale.set(scale[0], scale[1], scale[2]);
  return m;
}
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: number) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
  return t;
}
const plaid = (base: string) => canvasTex(128, 128, (g) => {
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(0, 40, 128, 26); g.fillRect(40, 0, 26, 128);
  g.fillStyle = "rgba(255,255,255,0.16)"; g.fillRect(0, 100, 128, 6); g.fillRect(100, 0, 6, 128);
}, 3);
const letterPatch = () => canvasTex(128, 128, (g) => { g.fillStyle = "#d8d2c2"; g.font = "bold 104px Georgia, serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("M", 64, 70); });

/** Where this look's light comes from. */
export function lightSource(look: EchoLook): "head" | "right" | "left" {
  if (look.hat === "headlamp") return "head";
  if (look.item === "torch" || look.item === "phone") return "right";
  return "left";
}

/**
 * One of the Marrowfield teens: a simple jointed body dressed from an EchoLook, animated procedurally.
 * Faces +z. Used by the lobby preview and by friends' avatars in the game.
 */
export class TeenRig {
  readonly root = new THREE.Group();
  /** Their torch / headlamp / phone light. */
  lamp: THREE.SpotLight | null = null;
  look!: EchoLook;
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private neck = new THREE.Group();
  private head = new THREE.Group();
  private limbs: Record<Side, Limb>;
  private parts: THREE.Object3D[] = [];
  private textures: THREE.Texture[] = [];
  private pony: THREE.Group | null = null;
  private itemR = new THREE.Group();
  private itemL = new THREE.Group();
  private walkieL: THREE.Group | null = null;
  private torchL: THREE.Group | null = null;
  private leds: THREE.MeshBasicMaterial[] = [];
  private lens: THREE.MeshBasicMaterial | null = null;
  private beam: THREE.Mesh | null = null;
  private pose: Pose = {};
  private phase = Math.random() * 6;
  private t = Math.random() * 10;
  private src: "head" | "right" | "left" = "right";

  constructor(public light: TeenLightCfg, private castShadows: boolean) {
    this.root.add(this.hips);
    this.hips.add(this.torso);
    this.neck.position.y = 0.5; this.torso.add(this.neck);
    this.head.position.y = 0.05; this.neck.add(this.head);
    const mk = (s: Side): Limb => {
      const sh = new THREE.Group(); sh.position.set(0.2 * s, 0.44, 0); this.torso.add(sh);
      const el = new THREE.Group(); el.position.y = -0.29; sh.add(el);
      const wr = new THREE.Group(); wr.position.y = -0.27; el.add(wr);
      const th = new THREE.Group(); th.position.set(0.095 * s, -0.02, 0); this.hips.add(th);
      const kn = new THREE.Group(); kn.position.y = -0.44; th.add(kn);
      const an = new THREE.Group(); an.position.y = -0.43; kn.add(an);
      return { sh, el, wr, th, kn, an };
    };
    this.limbs = { 1: mk(1), [-1]: mk(-1) } as Record<Side, Limb>;
  }

  private clear() {
    for (const p of this.parts) {
      p.parent?.remove(p);
      p.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose()); }
        if ((o as THREE.SpotLight).isSpotLight) (o as THREE.SpotLight).dispose();
      });
    }
    for (const t of this.textures) t.dispose();
    this.parts = []; this.textures = []; this.leds = []; this.lens = null; this.beam = null; this.lamp = null; this.pony = null; this.walkieL = null; this.torchL = null;
  }

  build(look: EchoLook) {
    this.clear();
    this.look = look;
    this.src = lightSource(look);
    const add = <T extends THREE.Object3D>(parent: THREE.Object3D, m: T): T => { parent.add(m); this.parts.push(m); return m; };
    const bw = look.build === "slim" ? 0.92 : look.build === "broad" ? 1.12 : 1;
    const skin = M(SKIN_COLORS[look.skin], 0.6);
    const hairM = M(HAIR_COLORS[look.hairC], 0.75);
    const cc = COAT_COLORS[look.coatC], cc2 = COAT_COLORS[look.coatC2];
    let coatM: THREE.Material;
    if (look.coat === "rain") coatM = new THREE.MeshPhysicalMaterial({ color: cc, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.25 });
    else if (look.coat === "flannel") { const t = plaid(cc); this.textures.push(t); coatM = M("#ffffff", 0.9, { map: t }); }
    else if (look.coat === "denim") coatM = M(look.coatC === 7 ? "#c9c2b1" : "#41577a", 0.95);
    else coatM = M(cc, look.coat === "puffer" ? 0.55 : 0.9);
    const sleeveM = look.coat === "varsity" ? M(cc2, 0.7) : coatM;
    const pantsM = M(look.pants === "jeans" && look.pantsC === 0 ? "#2c3b57" : PANTS_COLORS[look.pantsC], 0.9);
    const shoeM = M(look.shoes === "boots" ? "#3a2a1e" : "#d9d6cf", 0.7);
    const soleM = M(look.shoes === "boots" ? "#151210" : "#f2f0ea", 0.8);
    const handM = look.gloves ? M("#1b1d1c", 0.7) : skin;
    const dark = M("#1c1c1c", 0.6);
    const puff = look.coat === "puffer" ? 1.14 : 1;

    // legs
    add(this.hips, mesh(capG(0.15, 0.08), pantsM, [0, 0, 0], [0, 0, Math.PI / 2], [bw, 1.15, 0.8]));
    for (const s of [1, -1] as Side[]) {
      const L = this.limbs[s];
      const lw = (look.pants === "joggers" ? 0.068 : look.pants === "cargo" ? 0.08 : 0.072) * bw;
      add(L.th, mesh(capG(lw, 0.3), pantsM, [0, -0.22, 0]));
      add(L.kn, mesh(capG(lw * 0.86, 0.31), pantsM, [0, -0.2, 0]));
      if (look.pants === "cargo") add(L.th, mesh(new THREE.BoxGeometry(0.035, 0.12, 0.1), pantsM, [0.075 * s * bw, -0.25, 0]));
      if (look.pants === "joggers") add(L.kn, mesh(cylG(0.052, 0.05, 0.05), M("#111111"), [0, -0.39, 0]));
      if (look.shoes === "boots") add(L.kn, mesh(cylG(0.062, 0.065, 0.14), shoeM, [0, -0.36, 0]));
      add(L.an, mesh(new THREE.BoxGeometry(0.105, 0.075, 0.25), shoeM, [0, -0.025, 0.045]));
      add(L.an, mesh(new THREE.BoxGeometry(0.11, 0.025, 0.26), soleM, [0, -0.07, 0.045]));
      // arms
      const sr = (look.coat === "puffer" ? 0.068 : 0.055) * bw;
      add(L.sh, mesh(capG(sr, 0.2), sleeveM, [0, -0.14, 0]));
      add(L.el, mesh(capG(sr * 0.88, 0.17), sleeveM, [0, -0.12, 0]));
      if (look.coat === "varsity") add(L.el, mesh(new THREE.TorusGeometry(0.047, 0.009, 6, 14), M(cc, 0.7), [0, -0.225, 0], [Math.PI / 2, 0, 0]));
      add(L.wr, mesh(new THREE.BoxGeometry(0.06, 0.09, 0.075), handM, [0, -0.05, 0.005]));
      add(L.wr, mesh(capG(0.014, 0.04), handM, [0, -0.045, 0.045], [0.6, 0, 0]));
    }

    // torso and coat
    const T = this.torso;
    const chestW = 1.13 * bw * puff;
    add(T, mesh(capG(0.165, 0.24), coatM, [0, 0.29, 0], undefined, [chestW, 1, 0.84 * puff]));
    add(T, mesh(cylG(0.05, 0.055, 0.1), skin, [0, 0.5, 0]));
    if (look.coat === "hoodie") {
      add(T, mesh(new THREE.BoxGeometry(0.2, 0.09, 0.03), coatM, [0, 0.15, 0.135]));
      for (const x of [-0.03, 0.03]) add(T, mesh(cylG(0.004, 0.004, 0.12, 5), M("#cfc8b8"), [x, 0.39, 0.15]));
      if (look.hat !== "hood") add(T, mesh(new THREE.TorusGeometry(0.1, 0.045, 8, 16, Math.PI * 1.3), coatM, [0, 0.48, -0.05], [-0.5, 0, Math.PI * 1.15]));
    }
    if (look.coat === "rain") {
      add(T, mesh(cylG(0.2 * bw, 0.235 * bw, 0.22, 18, true), coatM, [0, 0.06, 0], undefined, [1.05, 1, 0.82])).material.side = THREE.DoubleSide;
      add(T, mesh(cylG(0.075, 0.085, 0.08), coatM, [0, 0.5, 0]));
      add(T, mesh(new THREE.BoxGeometry(0.01, 0.44, 0.01), M("#111111"), [0, 0.25, 0.142]));
    }
    if (look.coat === "puffer") {
      for (const y of [0.13, 0.24, 0.35]) add(T, mesh(new THREE.TorusGeometry(0.168 * chestW / 1.13, 0.022, 7, 24), coatM, [0, y, 0], [Math.PI / 2, 0, 0], [1, 0.84 * puff, 1]));
      add(T, mesh(new THREE.TorusGeometry(0.085, 0.035, 7, 18), M("#cdbb9c", 1), [0, 0.5, 0], [Math.PI / 2, 0, 0]));
    }
    if (look.coat === "denim") {
      for (const x of [-0.07, 0.07]) add(T, mesh(new THREE.BoxGeometry(0.07, 0.06, 0.02), coatM, [x, 0.36, 0.13]));
      add(T, mesh(new THREE.TorusGeometry(0.09, 0.032, 7, 18, Math.PI * 1.4), M("#e3dccb", 1), [0, 0.48, 0], [Math.PI / 2, 0, Math.PI * 0.8]));
    }
    if (look.coat === "varsity") {
      const t = letterPatch(); this.textures.push(t);
      add(T, mesh(new THREE.PlaneGeometry(0.08, 0.08), M("#ffffff", 0.8, { map: t, transparent: true }), [0.075, 0.36, 0.142]));
      add(T, mesh(new THREE.TorusGeometry(0.155 * bw, 0.015, 6, 22), M("#d8d2c2"), [0, 0.07, 0], [Math.PI / 2, 0, 0], [chestW, 0.84, 1]));
    }
    if (look.coat === "flannel") {
      add(T, mesh(new THREE.BoxGeometry(0.1, 0.36, 0.01), M("#1d1e1e"), [0, 0.28, 0.137]));
      add(T, mesh(cylG(0.07, 0.08, 0.05), coatM, [0, 0.49, 0]));
    }
    // shoulder radio: everyone carries one; it blinks while they talk
    const radio = add(T, new THREE.Group());
    radio.position.set(0.11 * bw * puff, 0.4, 0.12 * puff);
    radio.add(mesh(new THREE.BoxGeometry(0.045, 0.07, 0.025), M("#1d2020", 0.6)));
    const led = new THREE.MeshBasicMaterial({ color: "#401010" });
    radio.add(mesh(sphG(0.007, 8, 6), led, [-0.012, 0.025, 0.014]));
    this.leds.push(led);

    // bag
    const packM = M(look.pack === "hiking" ? "#5b3a2c" : "#3b2430", 0.85);
    if (look.pack === "school" || look.pack === "hiking") {
      const hh = look.pack === "hiking" ? 0.5 : 0.36;
      add(T, mesh(new THREE.BoxGeometry(0.3 * bw, hh, 0.14), packM, [0, 0.3 + (hh - 0.36) / 3, -0.21 * puff]));
      add(T, mesh(new THREE.BoxGeometry(0.22 * bw, 0.13, 0.05), packM, [0, 0.17, -0.3 * puff]));
      for (const x of [-0.08, 0.08]) add(T, mesh(new THREE.TorusGeometry(0.15, 0.012, 5, 14, Math.PI), M("#1a1a1a"), [x * bw, 0.3, -0.03], [0, Math.PI / 2, 0], [1, 1.25, 1.2 * puff]));
      if (look.pack === "hiking") add(T, mesh(cylG(0.06, 0.06, 0.34, 12), M("#2f4a3a"), [0, 0.6, -0.22 * puff], [0, 0, Math.PI / 2]));
    }
    if (look.pack === "sling") {
      add(T, mesh(new THREE.TorusGeometry(0.22, 0.012, 5, 26), M("#1b1b1b"), [0, 0.3, 0], [Math.PI / 2, 0.75, 0], [1.05 * bw * puff, 0.85 * puff, 1]));
      add(T, mesh(new THREE.BoxGeometry(0.22, 0.13, 0.07), packM, [-0.07, 0.18, -0.19 * puff], [0, 0, 0.5]));
    }

    // head and face
    const H = this.head;
    add(H, mesh(sphG(0.105, 22, 16), skin, [0, 0.11, 0], undefined, [0.94, 1.14, 1]));
    for (const s of [1, -1]) add(H, mesh(sphG(0.03, 8, 6), skin, [0.098 * s, 0.1, -0.005], undefined, [0.5, 1, 0.8]));
    const eyeW = M("#e8e6e0", 0.4), eyeD = M("#141414", 0.3);
    for (const x of [0.036, -0.036]) {
      add(H, mesh(sphG(0.016, 10, 8), eyeW, [x, 0.125, 0.087], undefined, [1, 0.8, 0.5]));
      add(H, mesh(sphG(0.009, 8, 6), eyeD, [x, 0.125, 0.094]));
      add(H, mesh(new THREE.BoxGeometry(0.036, 0.007, 0.01), hairM, [x, 0.15, 0.094], [0, 0, x > 0 ? -0.12 : 0.12]));
    }
    add(H, mesh(new THREE.BoxGeometry(0.02, 0.04, 0.03), skin, [0, 0.1, 0.1], [0.25, 0, 0]));
    add(H, mesh(new THREE.BoxGeometry(0.04, 0.006, 0.01), M("#7a4a42", 0.6), [0, 0.06, 0.098]));

    // hair (hidden under hats where it would poke through)
    const hatTop = ["beanie", "cap", "capback", "hood", "bucket"].includes(look.hat);
    const scalp = (r: number, cut: number) => sphG(r, 20, 12, 0, Math.PI * 2, 0, Math.PI * cut);
    if (look.hair === "buzz") add(H, mesh(scalp(0.108, 0.5), hairM, [0, 0.12, -0.004], undefined, [0.95, 1.12, 1.02]));
    if (!hatTop && (look.hair === "short" || look.hair === "pony" || look.hair === "bob")) {
      add(H, mesh(scalp(0.113, 0.56), hairM, [0, 0.12, -0.01], [-0.25, 0, 0], [0.96, 1.12, 1.04]));
      if (look.hair === "short") add(H, mesh(new THREE.BoxGeometry(0.14, 0.035, 0.05), hairM, [0, 0.21, 0.07], [0.5, 0, 0]));
    }
    if (look.hair === "bob") {
      for (const s of [1, -1]) add(H, mesh(capG(0.04, 0.09), hairM, [0.085 * s, 0.07, -0.01]));
      add(H, mesh(capG(0.05, 0.08), hairM, [0, 0.06, -0.075], [0, 0, Math.PI / 2], [1, 1.3, 1]));
    }
    if (look.hair === "pony") {
      const p = add(H, new THREE.Group()); p.position.set(0, 0.17, -0.1); this.pony = p;
      p.add(mesh(new THREE.TorusGeometry(0.018, 0.008, 6, 10), M("#c73b3b"), [0, 0, -0.01]));
      p.add(mesh(capG(0.032, 0.17), hairM, [0, -0.11, -0.03], [0.25, 0, 0]));
    }
    if (look.hair === "curly" || look.hair === "curlylong") {
      let seed = 7;
      const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const long = look.hair === "curlylong";
      const mats: THREE.Matrix4[] = [];
      for (let i = 0; i < (long ? 90 : 55); i++) {
        const u = r() * Math.PI * 2, v = Math.acos(1 - r() * (long ? 1.55 : 1.05));
        const x = Math.sin(v) * Math.cos(u), y = Math.cos(v), z = Math.sin(v) * Math.sin(u);
        const rr = 0.028 + r() * 0.018;
        if (z > 0.35 && y < 0.55) continue; // keep the face clear
        if (hatTop && y > 0.45) continue;
        let py = 0.12 + y * 0.13;
        if (long && y < 0.3) py -= (0.3 - y) * 0.12;
        mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x * 0.112, py, z * 0.112 - 0.012), new THREE.Quaternion(), new THREE.Vector3(rr, rr, rr)));
      }
      const im = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), hairM, mats.length);
      mats.forEach((m, i) => im.setMatrixAt(i, m));
      add(H, im);
    }

    // head wear
    const hatM = M(look.hat === "beanie" ? "#8a3a2a" : look.hat === "bucket" ? "#5d5a3f" : "#24292b", 0.9);
    if (look.hat === "beanie") {
      add(H, mesh(scalp(0.122, 0.5), hatM, [0, 0.13, -0.008], [-0.15, 0, 0], [0.96, 1.15, 1.04]));
      add(H, mesh(cylG(0.118, 0.12, 0.05, 20), hatM, [0, 0.145, -0.01], [-0.15, 0, 0], [0.96, 1, 1.04]));
      add(H, mesh(sphG(0.03, 10, 8), M("#e8e2d2", 1), [0, 0.275, -0.03]));
    }
    if (look.hat === "cap" || look.hat === "capback") {
      const g = add(H, new THREE.Group()); g.position.set(0, 0.15, 0); if (look.hat === "capback") g.rotation.y = Math.PI;
      g.add(mesh(scalp(0.118, 0.5), hatM, [0, 0, -0.005], undefined, [0.96, 0.95, 1.04]));
      g.add(mesh(cylG(0.085, 0.085, 0.008, 18), hatM, [0, 0.005, 0.12], undefined, [1, 1, 0.85]));
    }
    if (look.hat === "bucket") {
      add(H, mesh(cylG(0.1, 0.118, 0.1, 20), hatM, [0, 0.21, -0.01]));
      add(H, mesh(cylG(0.12, 0.17, 0.035, 24, true), hatM, [0, 0.155, -0.01])).material.side = THREE.DoubleSide;
    }
    if (look.hat === "hood") {
      const gap = Math.PI * 0.62;
      const hoodM = look.coat === "hoodie" || look.coat === "rain" ? coatM : M(cc, 0.9);
      const h = add(H, mesh(sphG(0.145, 20, 14, Math.PI / 2 + gap / 2, Math.PI * 2 - gap, 0, Math.PI * 0.82), hoodM, [0, 0.12, -0.015], [0.12, 0, 0], [0.98, 1.12, 1.05]));
      (h.material as THREE.Material).side = THREE.DoubleSide;
    }
    if (look.hat === "headlamp") {
      add(H, mesh(new THREE.TorusGeometry(0.11, 0.008, 6, 26), dark, [0, 0.16, 0], [Math.PI / 2 - 0.1, 0, 0], [0.97, 1.06, 1]));
      add(H, mesh(new THREE.BoxGeometry(0.05, 0.034, 0.03), M("#2b2b2b", 0.5), [0, 0.165, 0.112]));
      this.lens = new THREE.MeshBasicMaterial({ color: "#fff7dc" });
      add(H, mesh(cylG(0.012, 0.012, 0.006, 12), this.lens, [0, 0.165, 0.128], [Math.PI / 2, 0, 0]));
    }
    if (look.glasses) {
      for (const x of [0.036, -0.036]) add(H, mesh(new THREE.TorusGeometry(0.022, 0.0035, 6, 16), M("#111111", 0.4), [x, 0.125, 0.1]));
      add(H, mesh(new THREE.BoxGeometry(0.03, 0.004, 0.004), M("#111111"), [0, 0.13, 0.102]));
    }
    if (look.scarf) {
      add(T, mesh(new THREE.TorusGeometry(0.075, 0.034, 8, 18), M("#a2372f", 1), [0, 0.5, 0], [Math.PI / 2, 0, 0]));
      add(T, mesh(new THREE.BoxGeometry(0.06, 0.2, 0.025), M("#a2372f", 1), [0.05, 0.38, 0.13], [0.15, 0, 0.1]));
    }

    // hands: the kit item on the right; a torch in the left if the light isn't on the head or in the right hand
    this.itemR = add(this.limbs[-1].wr, new THREE.Group()); this.itemR.position.set(0, -0.06, 0.02);
    this.itemL = add(this.limbs[1].wr, new THREE.Group()); this.itemL.position.set(0, -0.06, 0.02);
    const metal = M("#2a2c2c", 0.45, { metalness: 0.4 });
    const torchModel = (g: THREE.Group) => {
      g.add(mesh(cylG(0.02, 0.018, 0.18, 10), metal, [0, -0.02, 0.02], [Math.PI / 2, 0, 0]));
      g.add(mesh(cylG(0.032, 0.022, 0.05, 12), metal, [0, -0.02, 0.13], [Math.PI / 2, 0, 0]));
      this.lens = new THREE.MeshBasicMaterial({ color: "#fff6dc" });
      g.add(mesh(cylG(0.028, 0.028, 0.004, 12), this.lens, [0, -0.02, 0.156], [Math.PI / 2, 0, 0]));
    };
    const walkieModel = (g: THREE.Group) => {
      g.add(mesh(new THREE.BoxGeometry(0.055, 0.13, 0.03), M("#1d2020", 0.6), [0, -0.03, 0.03]));
      g.add(mesh(cylG(0.006, 0.006, 0.1, 6), M("#111111"), [0.018, -0.14, 0.03]));
      const l = new THREE.MeshBasicMaterial({ color: "#401010" }); this.leds.push(l);
      g.add(mesh(sphG(0.007, 8, 6), l, [-0.015, -0.1, 0.047]));
    };
    const it = look.item;
    if (it === "torch") torchModel(this.itemR);
    if (it === "walkie") walkieModel(this.itemR);
    if (it === "phone") {
      this.itemR.add(mesh(new THREE.BoxGeometry(0.075, 0.15, 0.01), M("#111111", 0.3), [0, -0.03, 0.05], [0.2, 0, 0]));
      this.itemR.add(mesh(new THREE.PlaneGeometry(0.066, 0.135), new THREE.MeshBasicMaterial({ color: "#7fe9cf" }), [0, -0.03, 0.0555], [0.2, 0, 0]));
      this.lens = new THREE.MeshBasicMaterial({ color: "#fff6dc" });
      this.itemR.add(mesh(sphG(0.008, 8, 6), this.lens, [0.02, 0.03, 0.04]));
    }
    if (it === "cutters") {
      for (const x of [-0.02, 0.02]) this.itemR.add(mesh(cylG(0.011, 0.011, 0.5, 8), M("#b2382c", 0.6), [x, -0.2, 0.02], [0, 0, x * 2]));
      this.itemR.add(mesh(new THREE.BoxGeometry(0.06, 0.12, 0.02), M("#5d6265", 0.3, { metalness: 0.8 }), [0, -0.5, 0.02]));
    }
    if (it === "crowbar") {
      this.itemR.add(mesh(cylG(0.012, 0.012, 0.62, 8), M("#26292b", 0.4, { metalness: 0.7 }), [0, -0.22, 0.02]));
      this.itemR.add(mesh(new THREE.TorusGeometry(0.035, 0.012, 6, 12, Math.PI), M("#26292b", 0.4, { metalness: 0.7 }), [0.035, -0.53, 0.02], [0, 0, Math.PI]));
    }
    if (it === "map") this.itemR.add(mesh(new THREE.BoxGeometry(0.16, 0.2, 0.006), M("#d8cfb4", 1), [0, -0.07, 0.05], [0.4, 0, 0.2]));
    if (this.src === "left") { this.torchL = new THREE.Group(); this.itemL.add(this.torchL); torchModel(this.torchL); }
    if (it !== "walkie") { this.walkieL = new THREE.Group(); this.walkieL.visible = false; this.itemL.add(this.walkieL); walkieModel(this.walkieL); }

    // the light itself
    const L = this.light;
    const lamp = new THREE.SpotLight(0xfff0d0, 0, L.distance, 0.42, 0.6, L.decay);
    lamp.castShadow = L.shadows;
    if (L.shadows) lamp.shadow.mapSize.set(512, 512);
    const tgt = new THREE.Object3D();
    let holder: THREE.Object3D;
    if (this.src === "head") { holder = H; lamp.position.set(0, 0.165, 0.13); tgt.position.set(0, 0.0, 2); }
    else { holder = this.src === "right" ? this.itemR : this.torchL!; lamp.position.set(0, -0.02, 0.16); tgt.position.set(0, -0.02, 3); }
    add(holder, lamp); add(holder, tgt); lamp.target = tgt;
    this.lamp = lamp;
    if (L.beam > 0) {
      const len = 2.8, g = new THREE.ConeGeometry(0.75, len, 20, 1, true);
      g.translate(0, -len / 2, 0); g.rotateX(-Math.PI / 2);
      const bm = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: "#fff1d6", transparent: true, opacity: L.beam, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      bm.position.copy(lamp.position); bm.userData.beam = true;
      this.beam = add(holder, bm);
    }
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.userData.beam) { o.castShadow = this.castShadows; o.receiveShadow = this.castShadows; } });
  }

  private target(c: TeenControl, dt: number): Pose {
    const t = this.t;
    const p: Pose = { hipsY: 0.93, hipsX: 0, hipsRY: 0, torsoX: 0.03, torsoY: 0, torsoZ: 0, headX: 0, headY: 0, headZ: 0,
      th1: 0, kn1: 0.05, an1: 0, th_1: 0, kn_1: 0.05, an_1: 0, shX1: 0.05, shZ1: 0.09, el1: -0.12, shX_1: 0.05, shZ_1: -0.09, el_1: -0.12, shY_1: 0, wr1: 0, wr_1: 0 };
    const breathe = Math.sin(t * 1.7);
    const move = c.move;
    const natural: Partial<Record<TeenMove, number>> = { walk: 2.6, run: 4.6, crouch: 1.4 };
    const perMetre: Partial<Record<TeenMove, number>> = { walk: 0.68, run: 0.6, crouch: 0.85 };
    if (perMetre[move]) this.phase += dt * Math.PI * 2 * (c.speed ?? natural[move]!) * perMetre[move]!;
    const f = this.phase;
    const key = (s: Side) => (s === 1 ? "1" : "_1");
    if (move === "idle") {
      p.torsoX += breathe * 0.012; p.headY = Math.sin(t * 0.37) * 0.45; p.headX = Math.sin(t * 0.23) * 0.08;
      p.hipsX = Math.sin(t * 0.3) * 0.015; p.torsoZ = -p.hipsX * 2;
      p.kn1 = 0.06 + Math.max(0, Math.sin(t * 0.3)) * 0.12; p.th1 = -p.kn1 * 0.4;
    }
    if (move === "walk" || move === "run" || move === "crouch") {
      const A = move === "run" ? 0.78 : move === "crouch" ? 0.38 : 0.44;
      const K = move === "run" ? 1.25 : move === "crouch" ? 0.5 : 0.7;
      for (const s of [1, -1] as Side[]) {
        const ph = f + (s === 1 ? 0 : Math.PI);
        p["th" + key(s)] = -A * Math.sin(ph);
        p["kn" + key(s)] = 0.08 + K * Math.max(0, Math.cos(ph)) ** 1.3;
        p["an" + key(s)] = 0.25 * Math.sin(ph);
        const arm = (move === "run" ? 0.75 : 0.38) * Math.sin(ph);
        p["shX" + key(s)] = arm;
        p["el" + key(s)] = move === "run" ? -1.35 : -0.25 - Math.max(0, -arm) * 0.5;
      }
      p.hipsY = 0.93 + (move === "run" ? 0.045 : 0.022) * Math.cos(2 * f) - (move === "run" ? 0.03 : 0);
      p.hipsRY = 0.09 * Math.sin(f); p.torsoY = -0.13 * Math.sin(f); p.torsoX = move === "run" ? 0.24 : 0.06;
      p.headX = move === "run" ? -0.12 : -0.02; p.hipsX = 0.02 * Math.sin(f);
    }
    if (move === "crouch" || move === "crouchIdle") {
      const g = move === "crouch" ? f : 0;
      p.hipsY = 0.62 + (move === "crouch" ? 0.015 * Math.cos(2 * g) : 0); p.torsoX = 0.5; p.headX = -0.42;
      if (move === "crouchIdle") { p.th1 = p.th_1 = 0; p.kn1 = p.kn_1 = 0.08; p.an1 = p.an_1 = 0; p.torsoX += breathe * 0.015; }
      p.th1 -= 0.75; p.th_1 -= 0.75; p.kn1 += 1.15; p.kn_1 += 1.15; p.an1 -= 0.35; p.an_1 -= 0.35;
      p.shX1 = -0.55 + 0.2 * Math.sin(g + Math.PI); p.shX_1 = -0.7 + 0.2 * Math.sin(g); p.el1 = -0.9; p.el_1 = -0.9;
      p.headY = Math.sin(t * 0.8) * 0.3;
    }
    if (move === "scared") {
      const tr = Math.sin(t * 31) * 0.012 + Math.sin(t * 23) * 0.01;
      p.hipsY = 0.86; p.torsoX = 0.2 + tr; p.kn1 = p.kn_1 = 0.38; p.th1 = p.th_1 = -0.22; p.an1 = p.an_1 = -0.15;
      p.headY = Math.sin(t * 1.9) * 0.7 + Math.sin(t * 5.3) * 0.12; p.headX = -0.15 + tr;
      p.shX1 = p.shX_1 = -0.95; p.shZ1 = -0.25; p.shZ_1 = 0.25; p.el1 = p.el_1 = -1.9 + tr * 3;
    }
    if (move === "radio") {
      const talk = Math.sin(t * 0.9) > -0.3;
      const useR = this.look.item === "walkie";
      const a = useR ? "_1" : "1", b = useR ? "1" : "_1", sg = useR ? -1 : 1;
      p["shX" + a] = talk ? -1.55 : -0.7; p["shZ" + a] = sg * (talk ? -0.55 : 0.05); p["el" + a] = talk ? -2.35 : -1.5;
      p["shX" + b] = 0.02; p["el" + b] = -0.2;
      p.headX = 0.12; p.headY = 0.25 * sg; p.headZ = 0.05 * sg; p.torsoX = 0.07 + breathe * 0.01;
      c = { ...c, talk: c.talk ?? talk };
    }
    if (move === "scan") {
      const sw = Math.sin(t * 0.75);
      p.torsoY = sw * 0.55; p.headY = sw * 0.25;
      p.kn1 = p.kn_1 = 0.18; p.hipsY = 0.91; p.torsoX = 0.08;
    }
    if (move === "wave") {
      p.shZ_1 = -2.55 + Math.sin(t * 7) * 0.22; p.el_1 = -0.35; p.shX_1 = -0.15; p.headY = 0.1; p.headZ = Math.sin(t * 7) * 0.03; p.torsoZ = 0.05;
    }
    // look up/down
    const pitch = Math.max(-1, Math.min(1, c.pitch ?? 0));
    p.headX += -pitch * 0.7;
    // a hand-held light is raised and aimed where they look
    const aim = (c.lightOn || move === "scan") && this.src !== "head" && move !== "run" && move !== "wave" && move !== "scared" && move !== "radio";
    if (aim) {
      const k = this.src === "right" ? "_1" : "1", s = this.src === "right" ? -1 : 1;
      const crouchLift = move === "crouch" || move === "crouchIdle" ? -0.5 : 0;
      p["shX" + k] = -1.4 - pitch * 0.9 + crouchLift * 0 - (p.torsoX - 0.05);
      p["el" + k] = -0.15; p["shZ" + k] = 0.08 * s; p["wr" + k] = -pitch - p["shX" + k] - p["el" + k] - p.torsoX;
      if (k === "_1") p.shY_1 = 0.05;
    }
    this.talking = !!c.talk;
    return p;
  }
  private talking = false;

  /** Advance the animation. `dt` in seconds. */
  update(dt: number, c: TeenControl) {
    this.t += dt;
    const p = this.target(c, dt);
    const k = 1 - Math.exp(-dt * 9);
    for (const n in p) this.pose[n] = this.pose[n] === undefined ? p[n] : this.pose[n] + (p[n] - this.pose[n]) * k;
    const q = this.pose;
    this.hips.position.set(q.hipsX, q.hipsY, 0); this.hips.rotation.y = q.hipsRY;
    this.torso.rotation.set(q.torsoX, q.torsoY, q.torsoZ);
    this.neck.rotation.set(-q.torsoX * 0.4, 0, 0);
    this.head.rotation.set(q.headX, q.headY, q.headZ);
    for (const s of [1, -1] as Side[]) {
      const L = this.limbs[s], i = s === 1 ? "1" : "_1";
      L.th.rotation.x = q["th" + i]; L.kn.rotation.x = q["kn" + i];
      L.an.rotation.x = -q["kn" + i] * 0.3 + q["an" + i] * 0.4 - (q["th" + i] + q["kn" + i]) * 0.2;
      L.sh.rotation.set(q["shX" + i], s === -1 ? q.shY_1 : 0, q["shZ" + i]);
      L.el.rotation.x = q["el" + i]; L.wr.rotation.x = q["wr" + i];
    }
    if (this.pony) this.pony.rotation.x = 0.35 + Math.sin(this.phase * 2) * (c.move === "run" ? 0.35 : 0.12) - q.torsoX * 0.6;
    if (this.walkieL) this.walkieL.visible = c.move === "radio";
    if (this.torchL) this.torchL.visible = c.move !== "radio";
    const blink = this.talking && Math.sin(this.t * 12) > -0.2;
    for (const l of this.leds) l.color.set(blink ? "#ff3b30" : "#401010");
    const on = c.lightOn ?? false;
    if (this.lamp) this.lamp.intensity = on ? this.light.intensity * (0.95 + 0.05 * Math.sin(this.t * 17) * Math.sin(this.t * 3.1)) : 0;
    if (this.lens) this.lens.color.set(on ? "#fff6dc" : "#2a2a2a");
    if (this.beam) this.beam.visible = on;
  }

  dispose() { this.clear(); }
}
