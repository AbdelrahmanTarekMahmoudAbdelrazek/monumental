import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { EchoTeenId } from "@monumental/shared";

/**
 * v35: real people. Scanned-quality characters and motion-captured animations from Mixamo (Adobe), converted to glTF.
 * Files: /public/echo/real/c/<name>.glb (skinned, T-pose) and anim_<clip>.glb (skeleton + one clip).
 * Every Mixamo rig shares bone names, so one set of clips drives everyone.
 */
export const CHARACTER_FILES = ["megan", "bryce", "josh", "kate", "parasite", "swat", "swat_guy", "gas_mask", "copzombie", "chad", "warzombie"] as const;
export type CharacterName = (typeof CHARACTER_FILES)[number];
export const CLIP_FILES = ["idle", "walking", "running", "crouched_walking", "crouch_idle", "looking_around", "pistol_idle", "mutant_run", "zombie_scream", "zombie_attack", "dying"] as const;
export type ClipName = (typeof CLIP_FILES)[number];
/** Which real person plays each teen. */
export const TEEN_CHARACTER: Record<EchoTeenId, CharacterName> = { maya: "megan", theo: "bryce", sam: "josh", nora: "kate" };

export interface RealPeople {
  chars: Partial<Record<CharacterName, THREE.Group>>;
  clips: Partial<Record<ClipName, THREE.AnimationClip>>;
  /** v37: each character's own copy of the clips, hips height scaled to its skeleton (cached). */
  fitted?: Map<string, Partial<Record<ClipName, THREE.AnimationClip>>>;
}

/**
 * The clips move the hips in the units and proportions of the skeleton they were recorded on. A character whose
 * rig is built differently (the parasite) would be pushed half into the floor. Scale the hips track so that this
 * character's hips sit, at the start of "idle", exactly where its own rest pose puts them.
 */
function fitClips(people: RealPeople, name: CharacterName, model: THREE.Object3D): Partial<Record<ClipName, THREE.AnimationClip>> {
  people.fitted ??= new Map();
  const hit = people.fitted.get(name);
  if (hit) return hit;
  const hips = model.getObjectByName("Hips");
  const idle = people.clips.idle?.tracks.find((t) => t.name === "Hips.position");
  const ref = idle ? idle.values[hipsUp] : 0;
  const k = hips && ref ? hips.position.getComponent(hipsUp) / ref : 1;
  const out: Partial<Record<ClipName, THREE.AnimationClip>> = {};
  for (const [n, c] of Object.entries(people.clips) as [ClipName, THREE.AnimationClip][]) {
    if (Math.abs(k - 1) < 0.02) { out[n] = c; continue; }
    const cc = c.clone();
    for (const t of cc.tracks) if (t.name === "Hips.position") { const v = t.values; for (let i = hipsUp; i < v.length; i += 3) v[i] *= k; }
    out[n] = cc;
  }
  people.fitted.set(name, out);
  return out;
}
let loaded: RealPeople | null = null;
let loading: Promise<RealPeople> | null = null;
/** The people, once loaded (null until then: the game falls back to the drawn teens). */
export const realPeople = () => loaded;

const BASE = "/echo/real/c/";
/** Index (0, 1, 2) of the hips translation that is height. */
let hipsUp = 1;
/** "mixamorig:Hips" / "mixamorig2Hips" → "Hips", so every rig and every clip line up. */
const norm = (n: string) => n.replace(/^mixamorig\d*:?/, "");

export function loadRealPeople(onProgress?: (f: number) => void): Promise<RealPeople> {
  if (loading) return loading;
  loading = (async () => {
    const gl = new GLTFLoader();
    const total = CHARACTER_FILES.length + CLIP_FILES.length;
    let done = 0;
    const step = () => { done++; onProgress?.(done / total); };
    const out: RealPeople = { chars: {}, clips: {} };
    await Promise.all([
      ...CHARACTER_FILES.map((n) => gl.loadAsync(`${BASE}${n}.glb`).then((g) => {
        g.scene.traverse((o) => {
          o.name = norm(o.name);
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.frustumCulled = false; // skinned bounds don't follow the pose
          for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
            // Blender's export leaves the fabric glossy; real cloth and skin are matte
            if (mat.isMeshStandardMaterial) { mat.metalness = 0; mat.roughness = Math.max(mat.roughness, 0.78); mat.envMapIntensity = 0.4; }
          }
        });
        out.chars[n] = g.scene; step();
      }, () => step())),
      ...CLIP_FILES.map((n) => gl.loadAsync(`${BASE}anim_${n}.glb`).then((g) => {
        const clip = g.animations[0];
        // which of the hips' own axes is "up" in the world (Blender's export turns the armature: it is z, not y)
        let up = 1, hn: THREE.Object3D | null = null;
        g.scene.traverse((o) => { if (!hn && /Hips$/.test(o.name)) hn = o; });
        const hp = (hn as THREE.Object3D | null)?.parent;
        if (hp) { g.scene.updateMatrixWorld(true); const q = new THREE.Quaternion(); hp.getWorldQuaternion(q); const u = new THREE.Vector3(0, 1, 0).applyQuaternion(q.invert()); const a = [Math.abs(u.x), Math.abs(u.y), Math.abs(u.z)]; up = a.indexOf(Math.max(...a)); }
        hipsUp = up;
        if (clip) {
          clip.name = n;
          for (const t of clip.tracks) t.name = norm(t.name);
          // only the hips may move the body; "in place" clips keep it on the spot
          clip.tracks = clip.tracks.filter((t) => !t.name.endsWith(".position") || t.name.startsWith("Hips."));
          // "in place": the hips keep their height but not their travel (v37: the two level axes, whichever they are)
          if (n !== "dying") for (const t of clip.tracks) if (t.name === "Hips.position") { const v = t.values; for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) if (k !== up) v[i + k] = 0; }
          out.clips[n] = clip;
        }
        step();
      }, () => step())),
    ]);
    loaded = out;
    return out;
  })();
  return loading;
}

/** One posed, animated person in the world. Faces −z (the game's forward) like everything else. */
export class RealBody {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  private actions = new Map<ClipName, THREE.AnimationAction>();
  current: ClipName | null = null;

  constructor(people: RealPeople, name: CharacterName, shadows: boolean) {
    const src = people.chars[name]!;
    this.model = cloneSkinned(src);
    this.model.rotation.y = Math.PI;
    this.model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = shadows; m.receiveShadow = shadows; m.frustumCulled = false; } });
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const [k, c] of Object.entries(fitClips(people, name, this.model)) as [ClipName, THREE.AnimationClip][]) this.actions.set(k, this.mixer.clipAction(c));
  }

  /** Cross-fade to a clip. `once`: play it a single time and hold the last frame. */
  play(name: ClipName, fade = 0.25, timeScale = 1, once = false) {
    const a = this.actions.get(name);
    if (!a) return;
    a.timeScale = timeScale;
    if (this.current === name) return;
    const prev = this.current ? this.actions.get(this.current) : null;
    a.reset();
    if (once) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } else a.setLoop(THREE.LoopRepeat, Infinity);
    a.play();
    if (prev && fade > 0) a.crossFadeFrom(prev, fade, false); else prev?.stop();
    this.current = name;
  }
  setSpeed(timeScale: number) { const a = this.current ? this.actions.get(this.current) : null; if (a) a.timeScale = timeScale; }
  /** Freeze a clip at a moment (0..1 of its length): bodies lying where they fell. */
  pose(name: ClipName, at: number) {
    const a = this.actions.get(name); if (!a) return;
    a.reset(); a.play(); a.paused = true; a.time = a.getClip().duration * at;
    this.mixer.update(0);
    this.current = name;
  }
  bone(name: string) { return this.model.getObjectByName(name) ?? null; }
  update(dt: number) { this.mixer.update(dt); }
  dispose() { this.mixer.stopAllAction(); this.root.removeFromParent(); }
}
