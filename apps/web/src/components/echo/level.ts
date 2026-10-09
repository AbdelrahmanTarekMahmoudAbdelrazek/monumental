import * as THREE from "three";
import { ECHO, ECHO_H, ECHO_MAP, ECHO_W, echoTile } from "@monumental/shared";
import type { EchoTextures } from "./textures";

export interface Box { x: number; y: number; z: number; hx: number; hy: number; hz: number }
export interface CeilingLight { light: THREE.PointLight; panel: THREE.MeshBasicMaterial; tint: THREE.Color; broken: boolean; base: number; x: number; z: number }

const T = ECHO.TILE;
const H = ECHO.WALL_H;
const DOOR_W = 1.5;
const DOOR_H = 2.2;

/** Builds the ward's meshes and the boxes physics should collide with. */
export function buildLevel(tex: EchoTextures, shadows: boolean) {
  const group = new THREE.Group();
  const boxes: Box[] = [];
  const lights: CeilingLight[] = [];
  const open = (x: number, z: number) => echoTile(x, z) !== "#";

  // ── walls: only tiles that touch open floor are drawn, one instanced mesh ──
  const wallMat = new THREE.MeshStandardMaterial({ map: tex.wall, bumpMap: tex.wallBump, bumpScale: 1.2, roughness: 0.92, metalness: 0 });
  const wallTiles: [number, number][] = [];
  for (let z = 0; z < ECHO_H; z++) for (let x = 0; x < ECHO_W; x++) {
    if (open(x, z)) continue;
    if (open(x + 1, z) || open(x - 1, z) || open(x, z + 1) || open(x, z - 1)) wallTiles.push([x, z]);
  }
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(T, H, T), wallMat, wallTiles.length);
  const m = new THREE.Matrix4();
  wallTiles.forEach(([x, z], i) => { m.makeTranslation((x + 0.5) * T, H / 2, (z + 0.5) * T); walls.setMatrixAt(i, m); });
  walls.castShadow = shadows;
  walls.receiveShadow = shadows;
  group.add(walls);

  // physics: merge each row's wall runs into one long box
  for (let z = 0; z < ECHO_H; z++) {
    let start = -1;
    for (let x = 0; x <= ECHO_W; x++) {
      const solid = x < ECHO_W && !open(x, z);
      if (solid && start < 0) start = x;
      if (!solid && start >= 0) {
        const len = x - start;
        boxes.push({ x: (start + len / 2) * T, y: H / 2, z: (z + 0.5) * T, hx: (len * T) / 2, hy: H / 2, hz: T / 2 });
        start = -1;
      }
    }
  }

  // ── floor and ceiling: one plane each ──
  const floorMat = new THREE.MeshStandardMaterial({ map: tex.floor, bumpMap: tex.floorBump, bumpScale: 0.8, roughness: 0.55, metalness: 0 });
  tex.floor.repeat.set(ECHO_W, ECHO_H);
  tex.floorBump.repeat.set(ECHO_W, ECHO_H);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ECHO_W * T, ECHO_H * T), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((ECHO_W * T) / 2, 0, (ECHO_H * T) / 2);
  floor.receiveShadow = shadows;
  group.add(floor);
  boxes.push({ x: (ECHO_W * T) / 2, y: -0.5, z: (ECHO_H * T) / 2, hx: (ECHO_W * T) / 2, hy: 0.5, hz: (ECHO_H * T) / 2 });

  tex.ceil.repeat.set(ECHO_W, ECHO_H);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ECHO_W * T, ECHO_H * T), new THREE.MeshStandardMaterial({ map: tex.ceil, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set((ECHO_W * T) / 2, H, (ECHO_H * T) / 2);
  group.add(ceil);

  // ── doorways: side jambs + lintel turn a 3 m gap into a narrow door ──
  const frameMat = new THREE.MeshStandardMaterial({ map: tex.frame, roughness: 0.7, metalness: 0.3 });
  const jambW = (T - DOOR_W) / 2;
  const addBox = (b: Box, mat: THREE.Material, collide: boolean) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2), mat);
    mesh.position.set(b.x, b.y, b.z);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    group.add(mesh);
    if (collide) boxes.push(b);
  };

  // ── beds ──
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a8f8c, roughness: 0.45, metalness: 0.7 });
  const sheet = new THREE.MeshStandardMaterial({ color: 0xb9b3a2, roughness: 0.95 });
  const stain = new THREE.MeshStandardMaterial({ color: 0x5a2a22, roughness: 1 });

  // ── ceiling lights ──
  const lightGeo = new THREE.BoxGeometry(1.3, 0.06, 0.4);

  for (let z = 0; z < ECHO_H; z++) for (let x = 0; x < ECHO_W; x++) {
    const c = echoTile(x, z);
    const cx = (x + 0.5) * T, cz = (z + 0.5) * T;
    if (c === "D") {
      const alongZ = !open(x - 1, z) && !open(x + 1, z); // walls left & right → you walk through along z
      const lintel: Box = { x: cx, y: (H + DOOR_H) / 2, z: cz, hx: T / 2, hy: (H - DOOR_H) / 2, hz: T / 2 };
      addBox(lintel, wallMat, false);
      if (alongZ) {
        addBox({ x: cx - T / 2 + jambW / 2, y: DOOR_H / 2, z: cz, hx: jambW / 2, hy: DOOR_H / 2, hz: T / 2 }, wallMat, true);
        addBox({ x: cx + T / 2 - jambW / 2, y: DOOR_H / 2, z: cz, hx: jambW / 2, hy: DOOR_H / 2, hz: T / 2 }, wallMat, true);
        addBox({ x: cx, y: DOOR_H + 0.05, z: cz - T / 2 + 0.06, hx: DOOR_W / 2 + 0.1, hy: 0.08, hz: 0.06 }, frameMat, false);
        addBox({ x: cx, y: DOOR_H + 0.05, z: cz + T / 2 - 0.06, hx: DOOR_W / 2 + 0.1, hy: 0.08, hz: 0.06 }, frameMat, false);
      } else {
        addBox({ x: cx, y: DOOR_H / 2, z: cz - T / 2 + jambW / 2, hx: T / 2, hy: DOOR_H / 2, hz: jambW / 2 }, wallMat, true);
        addBox({ x: cx, y: DOOR_H / 2, z: cz + T / 2 - jambW / 2, hx: T / 2, hy: DOOR_H / 2, hz: jambW / 2 }, wallMat, true);
        addBox({ x: cx - T / 2 + 0.06, y: DOOR_H + 0.05, z: cz, hx: 0.06, hy: 0.08, hz: DOOR_W / 2 + 0.1 }, frameMat, false);
        addBox({ x: cx + T / 2 - 0.06, y: DOOR_H + 0.05, z: cz, hx: 0.06, hy: 0.08, hz: DOOR_W / 2 + 0.1 }, frameMat, false);
      }
    } else if (c === "b") {
      // a bed lying along x, pushed a little off-centre so it looks placed by hand
      const bx = cx + ((x * 7 + z * 3) % 3 - 1) * 0.3;
      addBox({ x: bx, y: 0.45, z: cz, hx: 1.0, hy: 0.06, hz: 0.45 }, steel, false);
      addBox({ x: bx, y: 0.6, z: cz, hx: 0.95, hy: 0.09, hz: 0.42 }, sheet, false);
      addBox({ x: bx + 0.35, y: 0.7, z: cz + 0.05, hx: 0.25, hy: 0.01, hz: 0.18 }, stain, false);
      addBox({ x: bx - 1.0, y: 0.7, z: cz, hx: 0.04, hy: 0.35, hz: 0.45 }, steel, false);
      for (const [dx, dz] of [[-0.9, -0.38], [0.9, -0.38], [-0.9, 0.38], [0.9, 0.38]]) addBox({ x: bx + dx, y: 0.21, z: cz + dz, hx: 0.03, hy: 0.21, hz: 0.03 }, steel, false);
      boxes.push({ x: bx, y: 0.4, z: cz, hx: 1.05, hy: 0.4, hz: 0.48 });
    } else if (c === "L" || c === "B") {
      const broken = c === "B";
      const panel = new THREE.MeshBasicMaterial({ color: broken ? 0xbfd8c8 : 0xe8e2c8 });
      const mesh = new THREE.Mesh(lightGeo, panel);
      mesh.position.set(cx, H - 0.03, cz);
      group.add(mesh);
      const base = broken ? 5 : 7;
      const light = new THREE.PointLight(broken ? 0xb8e0cc : 0xf2e2b8, base, 9, 2);
      light.position.set(cx, H - 0.25, cz);
      group.add(light);
      lights.push({ light, panel, tint: broken ? new THREE.Color(0.8, 0.95, 0.88) : new THREE.Color(1, 0.96, 0.85), broken, base, x: cx, z: cz });
    }
  }

  return { group, boxes, lights };
}

/** The broken lights stutter; the good ones hum with a tiny wobble. */
export function flickerLights(lights: CeilingLight[], t: number, px: number, pz: number) {
  for (const l of lights) {
    const far = Math.hypot(l.x - px, l.z - pz) > 24;
    let k = 1;
    if (l.broken) {
      const s = Math.sin(t * 13.1 + l.x) * Math.sin(t * 7.3 + l.z) + Math.sin(t * 2.1 + l.x * 3);
      k = s > 0.9 ? 0.05 : s > 0.5 ? 0.5 : 1;
      if (Math.sin(t * 0.37 + l.z) > 0.85) k = 0; // long dead stretches
    } else {
      k = 0.94 + Math.sin(t * 50 + l.x) * 0.03 + Math.sin(t * 3.7) * 0.03;
    }
    l.light.intensity = far ? 0 : l.base * k;
    l.panel.color.copy(l.tint).multiplyScalar(0.15 + 0.85 * k);
  }
}
