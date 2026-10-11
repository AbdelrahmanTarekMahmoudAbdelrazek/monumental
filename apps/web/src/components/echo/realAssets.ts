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

/**
 * v36: recorded horror sounds (Freesound, CC0) in /public/echo/real/h/<name>.mp3.
 * Every one is optional: whatever is missing keeps its synthesized stand-in.
 */
export const HORROR_GROUPS = {
  child: ["baby_cry_corridor_582341", "ghost_child_crying_216051", "child_scared_172731", "children_crying_203508", "child_giggle_203230", "creepy_girl_laugh_652992"],
  moan: ["boy_frightened_260186"],
  scream: ["woman_scream_219856", "woman_shriek_320740", "man_scream_221544", "weird_scream_353086"],
  door: ["door_creak_219499", "door_creak2_219492", "door_creak_long_168650"],
  slam: ["metal_door_slam_48980", "heavy_door_406197", "jail_door_80449", "metal_impact_530486", "body_fall_heavy_504626"],
  rattle: ["chains_370877", "glass_break_141563", "body_fall_417994"],
  behind: ["ghost_whispers_175944", "child_whisper_350763", "frightened_breathing_112557"],
  music: ["music_box_creepy_274379", "music_box_338986"],
  radio: ["radio_static_17804", "radio_noise_50750"],
  creature: ["monster_screech_565024", "zombie_attack_213509", "monster_roar_398908", "growl_20208"],
  bed: ["room_tone_144046", "terror_ambience_155142", "wind_graveyard_159509", "wind_525292", "horror_inside_42203"],
  buzz: ["faulty_fluorescent_125064", "fluorescent_119910"],
  flicker: ["lights_flicker_on_232447", "neon_flicker_500693"],
  gun: ["reload_1911_396331", "pistol_cock_405538", "shell_bounce_210102", "bullet_flesh_423301"],
  far: ["distant_siren_469363", "heart_monitor_148897", "water_drip_cave_177958"],
} as const;
export type HorrorGroup = keyof typeof HORROR_GROUPS;
let horrorBufs: Map<string, AudioBuffer> | null = null;
let horrorLoading: Promise<Map<string, AudioBuffer>> | null = null;
/** Load what exists (once per page). */
export function loadHorror(ctx: BaseAudioContext): Promise<Map<string, AudioBuffer>> {
  if (horrorLoading) return horrorLoading;
  horrorLoading = (async () => {
    const out = new Map<string, AudioBuffer>();
    const names = [...new Set(Object.values(HORROR_GROUPS).flat())];
    await Promise.all(names.map(async (n) => {
      try { const r = await fetch(`${BASE}h/${n}.mp3`); if (!r.ok) return; out.set(n, await ctx.decodeAudioData(await r.arrayBuffer())); } catch { /* not downloaded yet */ }
    }));
    horrorBufs = out;
    return out;
  })();
  return horrorLoading;
}
/** A random loaded recording from a group, or null (then the synth plays). */
export function horror(group: HorrorGroup, rnd = Math.random): { name: string; buf: AudioBuffer } | null {
  if (!horrorBufs) return null;
  const have = HORROR_GROUPS[group].filter((n) => horrorBufs!.has(n));
  if (!have.length) return null;
  const name = have[Math.floor(rnd() * have.length)];
  return { name, buf: horrorBufs.get(name)! };
}
/**
 * Play a recording into `to`. Long files play a random slice (`maxSec`) with soft edges, so a 2-minute
 * recording of a crying child gives many different short cries. Returns the source (or null).
 */
export function playHorror(ctx: BaseAudioContext, group: HorrorGroup, to: AudioNode, gain: number, maxSec = 6, rate = 1, at = 0): AudioBufferSourceNode | null {
  const h = horror(group); if (!h) return null;
  const s = ctx.createBufferSource(); s.buffer = h.buf; s.playbackRate.value = rate * (0.97 + Math.random() * 0.06);
  const g = ctx.createGain();
  const t0 = ctx.currentTime + at, len = h.buf.duration;
  const dur = Math.min(len, maxSec), start = len > maxSec ? Math.random() * (len - dur) : 0, fade = Math.min(0.4, dur * 0.2);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + (start > 0 ? fade : 0.005));
  g.gain.setValueAtTime(gain, t0 + dur / s.playbackRate.value - fade); g.gain.linearRampToValueAtTime(0, t0 + dur / s.playbackRate.value);
  s.connect(g).connect(to); s.start(t0, start, dur + 0.05);
  return s;
}
