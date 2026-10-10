import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Real assets for the hospital (v35): photo-scanned surfaces and scanned props from Poly Haven, recorded sounds from Freesound (all CC0).
 * Files live in /public/echo/real: m/<name>.glb, t/<surface>_{diffuse,nor_gl,rough}.webp (t512/ on phones), s/<name>.mp3.
 */
export const SURFACE_NAMES = [
  "old_linoleum_flooring_01", "long_white_tiles", "peeling_painted_wall", "ceiling_interior", "damaged_plaster", "dirty_tiles", "painted_metal_shutter",
  "green_metal_rust", "concrete_floor_worn_001", "decrepit_wallpaper", "damaged_concrete_floor", "painted_plaster_wall", "metal_plate", "floor_tiles_06",
] as const;
export type SurfaceName = (typeof SURFACE_NAMES)[number];
export const PROP_NAMES = [
  "service_pistol", "old_bed_frame", "metal_office_desk", "metal_trash_can", "drawer_cabinet", "plastic_monobloc_chair_01", "SchoolChair_01", "vintage_crutches_01",
  "medical_box", "metal_stool_01", "old_gas_mask", "vintage_cabinet_01", "Barrel_01", "cardboard_box_01", "fire_alarm", "korean_fire_extinguisher_01", "ammo_box",
  "power_box_01", "industrial_wall_lamp", "caged_hanging_light", "alarm_clock_01", "portable_searchlight", "metal_tool_chest", "old_military_crate", "signal_flashlight",
  "vintage_flashlight", "utility_box_01", "metal_jerrycan",
] as const;
export type PropName = (typeof PROP_NAMES)[number];

export interface RealSurface { map: THREE.Texture | null; normalMap: THREE.Texture | null; roughnessMap: THREE.Texture | null }
export interface RealAssets {
  surfaces: Record<SurfaceName, RealSurface>;
  props: Partial<Record<PropName, THREE.Group>>;
}

const BASE = "/echo/real/";
let cache: Promise<RealAssets> | null = null;

/** Load everything once (shared between rounds). `small`: phones get 512 px textures. Missing files are skipped, never fatal. */
export function loadRealAssets(small: boolean, onProgress?: (f: number) => void): Promise<RealAssets> {
  if (cache) return cache;
  cache = (async () => {
    const total = SURFACE_NAMES.length * 3 + PROP_NAMES.length;
    let done = 0;
    const step = () => { done++; onProgress?.(done / total); };
    const tl = new THREE.TextureLoader();
    const tex = (file: string, srgb: boolean) => new Promise<THREE.Texture | null>((ok) => tl.load(`${BASE}${small ? "t512" : "t"}/${file}.webp`, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      step(); ok(t);
    }, undefined, () => { step(); ok(null); }));
    const surfaces = {} as Record<SurfaceName, RealSurface>;
    const gl = new GLTFLoader();
    const props: Partial<Record<PropName, THREE.Group>> = {};
    await Promise.all([
      ...SURFACE_NAMES.map(async (n) => {
        const [map, normalMap, roughnessMap] = await Promise.all([tex(`${n}_diffuse`, true), tex(`${n}_nor_gl`, false), tex(`${n}_rough`, false)]);
        surfaces[n] = { map, normalMap, roughnessMap };
      }),
      ...PROP_NAMES.map((n) => new Promise<void>((ok) => gl.load(`${BASE}m/${n}.glb`, (g) => { props[n] = g.scene; step(); ok(); }, undefined, () => { step(); ok(); }))),
    ]);
    return { surfaces, props };
  })();
  return cache;
}

/** Recorded sounds, decoded for one AudioContext. */
export const SOUND_NAMES = ["pistol_indoors_402789", "9mm_pistol_427592", "pistol_shot_427598", "gunshot_344142", "bullet_hit_266916", "ricochet_213925", "metal_fall_259553"] as const;
export type SoundName = (typeof SOUND_NAMES)[number];
export async function loadRealSounds(ctx: BaseAudioContext): Promise<Partial<Record<SoundName, AudioBuffer>>> {
  const out: Partial<Record<SoundName, AudioBuffer>> = {};
  await Promise.all(SOUND_NAMES.map(async (n) => {
    try { out[n] = await ctx.decodeAudioData(await (await fetch(`${BASE}s/${n}.mp3`)).arrayBuffer()); } catch { /* missing: the synth fallback plays */ }
  }));
  return out;
}
