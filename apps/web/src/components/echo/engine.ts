import * as THREE from "three";
import type RAPIER_NS from "@dimforge/rapier3d-compat";
import { COPY, ECHO, ECHO_LOCKERS, ECHO_ROOMS, GOAL, HIDE, lockerFront, type EchoGoal, ECHO_TAKEN, ECHO_TEENS, MIMIC_STATES, TEEN_LOOKS, decodeEchoSnap, echoPath, type EchoTeenId, echoTile, echoTileOf, echoWallsBetween, tagText, type ClipTag, type EchoEvent, type EchoMeta, type EchoPeerState, type EchoSnap2 } from "@monumental/shared";
import { makeTextures } from "./textures";
import { buildLevel, flickerLights, type HospitalLights } from "./hospital";
import { HospitalAudio } from "./hospitalAudio";
import { loadRealAssets, type RealAssets } from "./realAssets";
import { loadRealPeople, RealBody, type CharacterName } from "./realPeople";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { SoundBank } from "./sound";
import { Voice, voiceMix, type PeerStatus } from "./voice";
import { Avatar } from "./avatars";
import { VoiceCapture, Transcriber } from "./capture";
import { MimicFigure, MimicSound } from "./mimic";
import { NOTES } from "./story";

interface MimicView {
  fig: MimicFigure;
  snd: MimicSound;
  hist: { t: number; x: number; z: number; yaw: number; state: string; speaking: boolean; as: number; torch: boolean; crouch: boolean; pitch: number }[];
  /** The friend it is dressed as (rebuilt when it changes face). */
  av: Avatar | null;
  avAs: number;
  /** Its footsteps, exactly like a friend's. */
  steps: { panner: PannerNode; gain: GainNode; phase: number; lx: number; lz: number };
}

type Rapier = typeof RAPIER_NS;
/** What E / Use does: server actions, or reading something (local). */
export type EchoUse = { type: "pickup"; fuse: number } | { type: "install" } | { type: "call" } | { type: "hide"; locker: number } | { type: "unhide" } | { type: "gun" } | { type: "read"; note: number };

export interface EchoHud {
  fps: number;
  stamina: number;
  torch: boolean;
  crouch: boolean;
  locked: boolean;
  mic: { has: boolean; muted: boolean; level: number; error: string | null };
  peers: { n: number; status: PeerStatus }[];
  quality: number;
  /** I was grabbed; seconds until I'm back. */
  taken: number;
  pieces: number;
  /** The room I'm in. */
  room: string;
  /** What E / Use would do right now. */
  act: string | null;
  carrying: boolean;
  /** Who is talking on Channel 4 right now (wire numbers; 0 = me). */
  onAir: number[];
  /** A voice on the radio that might not be who it sounds like. */
  fakeAir: number | null;
  /** Which teen I play. */
  teen: EchoTeenId | null;
  /** Maya's phone: where to go next (through doors), how far, and which way relative to where I look (deg, + = right). */
  finder: { what: string; m: number; deg: number } | null;
  /** Sam has used his cutters this match. */
  cuttersUsed: boolean;
  /** Grabbed twice: out for the rest of the match. */
  gone: boolean;
  /** The creature is in my face (the grab). */
  scare: boolean;
  /** Prying a fuse out: 0..1, or null. */
  pry: number | null;
  /** Seconds until the lift arrives (null = not called / already here). */
  liftIn: number | null;
  liftHere: boolean;
  /** Hiding in a locker. */
  hidden: boolean;
  /** I hold the pistol: bullets left. */
  ammo: number | null;
  /** A note / phone / radio log within reach (its id), for E. */
  note: number | null;
  /** Just got shot (0..1 fading). */
  hurt: number;
}

export interface EchoNet {
  sendState: (s: { x: number; y: number; z: number; yaw: number; pitch: number; torch: boolean; crouch: boolean; talk: boolean; radio: boolean; seq: number }) => void;
  sendSignal: (to: number, data: unknown) => void;
  sendClip: (p: { id: number; ms: number; tags: ClipTag[] }) => void;
  sendTag: (p: { id: number; tags: ClipTag[] }) => void;
  sendHave: (key: string) => void;
  /** Voice relay logins from the game server. */
  getIce?: () => Promise<RTCIceServer[]>;
}

const STEP = 1 / 60;
const INTERP_MS = 120;
const CAPSULE_HALF = 0.55;
const CENTER_Y = CAPSULE_HALF + ECHO.RADIUS; // 0.9: capsule centre above the feet

/** Smooth angle blend along the short way round. */
const lerpAngle = (a: number, b: number, f: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * f;

function sample(h: EchoPeerState[], t: number): EchoPeerState | null {
  if (!h.length) return null;
  const last = h[h.length - 1];
  if (t >= last.t) return last;
  let i = h.length - 1;
  while (i > 0 && h[i - 1].t > t) i--;
  if (i === 0) return h[0];
  const a = h[i - 1], b = h[i];
  if (Math.hypot(b.x - a.x, b.z - a.z) > 6) return b;
  const f = (t - a.t) / Math.max(1, b.t - a.t);
  return { ...b, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f, yaw: lerpAngle(a.yaw, b.yaw, f), pitch: a.pitch + (b.pitch - a.pitch) * f };
}

function sampleMimic(h: MimicView["hist"], t: number) {
  if (!h.length) return null;
  const last = h[h.length - 1];
  if (t >= last.t) return last;
  let i = h.length - 1;
  while (i > 0 && h[i - 1].t > t) i--;
  if (i === 0) return h[0];
  const a = h[i - 1], b = h[i];
  if (Math.hypot(b.x - a.x, b.z - a.z) > 6) return b;
  const f = (t - a.t) / Math.max(1, b.t - a.t);
  return { ...b, x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, yaw: lerpAngle(a.yaw, b.yaw, f) };
}

/**
 * ECHO HALLS Phase 1: first-person walking in a dark ward, a torch with real shadows,
 * friends drawn smoothly, and proximity voice. Owns the canvas; React only draws the HUD.
 */
export class EchoEngine {
  readonly sounds: SoundBank;
  readonly voice: Voice;
  private R!: Rapier;
  private world!: RAPIER_NS.World;
  private body!: RAPIER_NS.RigidBody;
  private collider!: RAPIER_NS.Collider;
  private ctrl!: RAPIER_NS.KinematicCharacterController;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private torch!: THREE.SpotLight;
  private torchRig = new THREE.Group();
  private lights: HospitalLights = { sources: [], pool: [] };
  private hospital: HospitalAudio | null = null;
  private goalView: ReturnType<typeof buildLevel>["goal"] | null = null;
  private goal: EchoGoal | null = null;
  private fuses = new Map<number, { g: THREE.Group; glow: THREE.MeshStandardMaterial }>();
  private doorOpen = 0;
  /** What E / Use would do right now. */
  private act: EchoUse | null = null;
  private hiddenIn: number | null = null;
  private gunWorld: THREE.Group | null = null;
  private gunHeld: THREE.Group | null = null;
  private muzzle: THREE.PointLight | null = null;
  private muzzleSprite: THREE.Mesh | null = null;
  private flashUntil = 0;
  private recoil = 0;
  private hurtAt = 0;
  private hits: THREE.Mesh[] = [];
  private real: RealAssets | null = null;
  private composer: EffectComposer | null = null;
  private film: ShaderPass | null = null;
  private deadBodies: { body: RealBody; dirty: boolean }[] = [];
  private casings: { m: THREE.Mesh; v: THREE.Vector3; spin: THREE.Vector3; hits: number }[] = [];

  /** The lost police and patients, as real people lying where they fell. */
  private placeBodies(list: { x: number; z: number; ry: number; who: "police" | "patient" | "nurse" }[], people: Awaited<ReturnType<typeof loadRealPeople>>) {
    const police: CharacterName[] = ["swat", "swat_guy", "gas_mask", "copzombie"];
    let pi = 0;
    for (const b of list) {
      const name: CharacterName = b.who === "police" ? police[pi++ % police.length] : b.who === "nurse" ? "chad" : "warzombie";
      if (!people.chars[name] || !people.clips.dying) continue;
      const body = new RealBody(people, name, !this.opts.mobile);
      body.root.rotation.y = b.ry;
      this.scene.add(body.root);
      body.pose("dying", 0.985);
      body.root.updateMatrixWorld(true);
      // put the hips (not the feet) where the blood is
      const hips = body.bone("Hips");
      if (hips) { const w = new THREE.Vector3(); hips.getWorldPosition(w); body.root.position.set(b.x - w.x, 0, b.z - w.z); }
      this.deadBodies.push({ body, dirty: false });
    }
  }
  private avatars = new Map<number, Avatar>();
  private remoteSteps = new Map<number, { panner: PannerNode; gain: GainNode; phase: number; lx: number; lz: number }>();
  private hist = new Map<number, EchoPeerState[]>();
  private tOff: number | null = null;
  private meta: EchoMeta | null = null;
  private raf = 0;
  private mimics = new Map<number, MimicView>();
  private takenSet = new Set<number>();
  private takenUntil = 0;
  private capture: VoiceCapture | null = null;
  private transcriber: Transcriber | null = null;
  private myPieces: { id: number; endedAt: number }[] = [];
  private names: Record<number, string> = {};
  private ro: ResizeObserver | null = null;
  private destroyed = false;

  // my state
  private yaw = 0;
  private pitch = 0;
  private vel = new THREE.Vector3();
  private vy = 0;
  private prev = new THREE.Vector3();
  private cur = new THREE.Vector3();
  private eye: number = ECHO.EYE;
  private bob = 0;
  private stepCount = 0;
  private stamina = 1;
  private tired = false;
  private torchOn = true;
  private talkUntil = 0;
  private wasOnAir = false;
  private fakeAir: { as: number; until: number } | null = null;
  private onAir = new Set<number>();
  private crouch = false;
  private grounded = true;
  private realSpeed = 0;
  private acc = 0;
  private last = 0;
  private seq = 0;
  private sentAt = 0;
  private hudAt = 0;
  private noiseAt = 0;
  private frameMs = 16;
  private pixelRatio = 1;
  private maxRatio = 1;

  // input
  keys = { f: false, b: false, l: false, r: false, run: false, crouch: false, radio: false };
  /** Touch stick, −1…1. */
  stick = { x: 0, y: 0 };
  sensitivity = 0.0022;
  /** Speech-to-text language for the "smart mimic", or null (off). Set before enter(). */
  smartLang: string | null = null;
  locked = false;

  constructor(private canvas: HTMLCanvasElement, private opts: { me: number; spawn: { x: number; z: number }; mobile: boolean; net: EchoNet; onHud: (h: EchoHud) => void }) {
    this.sounds = new SoundBank();
    // voice exists from the start so set-up messages that arrive while the hospital is still building aren't lost
    this.voice = new Voice(this.sounds, opts.me, (to, d) => opts.net.sendSignal(to, d), () => this.pushHud(true));
    this.voice.onClip = (key) => opts.net.sendHave(key);
    opts.net.getIce?.().then((l) => this.voice.setIce(l), () => {});
    this.camera = new THREE.PerspectiveCamera(opts.mobile ? 78 : 72, 1, 0.05, 70);
  }

  async init() {
    const R = (await import("@dimforge/rapier3d-compat")).default;
    await R.init();
    if (this.destroyed) return;
    this.R = R;
    const mobile = this.opts.mobile;

    // ── renderer ──
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !mobile, powerPreference: "high-performance" });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.maxRatio = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
    this.pixelRatio = Math.min(this.maxRatio, mobile ? 1.1 : 1.5);
    this.scene.background = new THREE.Color(0x020303);
    this.scene.fog = new THREE.FogExp2(0x010202, 0.075);

    // ── the hospital ──
    const tex = makeTextures(mobile ? 512 : 1024, Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    // v35: real photo-scanned surfaces, props and people (each optional: anything missing falls back to the drawn version)
    const [real, people] = await Promise.all([
      loadRealAssets(mobile).catch(() => undefined),
      loadRealPeople().catch(() => null),
    ]);
    if (this.destroyed) return;
    this.real = real ?? null;
    const level = buildLevel(tex, !mobile, mobile ? 256 : 512, real, !!people?.chars.swat);
    if (people) this.placeBodies(level.bodies, people);
    this.scene.add(level.group);
    this.goalView = level.goal;
    this.lights = level.lights;
    this.scene.add(new THREE.HemisphereLight(0x3a4550, 0x0b0907, 0.03));

    // ── my torch: one shadowed spot light that lags a little behind my head ──
    this.torch = new THREE.SpotLight(0xfff2d6, 75, 30, 0.5, 0.45, 2);
    this.torch.map = tex.cookie;
    this.torch.castShadow = true;
    this.torch.shadow.mapSize.set(mobile ? 512 : 1024, mobile ? 512 : 1024);
    this.torch.shadow.camera.near = 0.2;
    this.torch.shadow.camera.far = 26;
    this.torch.shadow.bias = -0.0004;
    this.torch.shadow.normalBias = 0.035;
    this.torch.position.set(0, 0, 0);
    this.torch.target.position.set(0, 0, -1);
    this.applyPerk();
    this.torchRig.add(this.torch, this.torch.target);
    this.scene.add(this.torchRig);
    // a very faint glow around me so total darkness still shows the nearest walls
    const fill = new THREE.PointLight(0x9fb0c0, 0.35, 3.5, 2);
    this.camera.add(fill);
    this.scene.add(this.camera);

    // ── physics ──
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;
    for (const b of level.boxes) this.world.createCollider(R.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setTranslation(b.x, b.y, b.z));
    this.body = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(this.opts.spawn.x, CENTER_Y, this.opts.spawn.z));
    this.collider = this.world.createCollider(R.ColliderDesc.capsule(CAPSULE_HALF, ECHO.RADIUS), this.body);
    this.ctrl = this.world.createCharacterController(0.02);
    this.ctrl.setSlideEnabled(true);
    this.ctrl.enableAutostep(0.3, 0.2, true);
    this.ctrl.enableSnapToGround(0.3);
    this.ctrl.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
    this.cur.set(this.opts.spawn.x, CENTER_Y, this.opts.spawn.z);
    this.prev.copy(this.cur);
    this.yaw = Math.PI; // face the doors to the corridor

    // a film look on desktop: the tubes bloom, grain, a darker edge
    if (!mobile) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.4, 0.6, 0.85));
      this.film = new ShaderPass({
        uniforms: { tDiffuse: { value: null }, t: { value: 0 }, hurt: { value: 0 } },
        vertexShader: "varying vec2 v; void main(){ v = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }",
        fragmentShader: "uniform sampler2D tDiffuse; uniform float t; uniform float hurt; varying vec2 v; float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + t) * 43758.5453); } void main(){ vec2 d = v - .5; float r2 = dot(d,d); vec3 c; c.r = texture2D(tDiffuse, v + d * .003).r; c.g = texture2D(tDiffuse, v).g; c.b = texture2D(tDiffuse, v - d * .003).b; c *= 1. - smoothstep(.15, .65, r2) * .7; c += (h(v * 911.) - .5) * .04; c = mix(c, c * vec3(1.4,.35,.3), hurt * smoothstep(.05,.4,r2)); gl_FragColor = vec4(c, 1.); }",
      });
      this.composer.addPass(this.film);
      this.composer.addPass(new OutputPass());
    }
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvas);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Call from the "Enter" click: starts sound, the mic and pointer lock. */
  async enter() {
    await this.sounds.resume();
    this.hospital = new HospitalAudio(this.sounds.ctx, this.sounds.master);
    this.hospital.start();
    if (await this.voice.startMic()) await this.startCapture();
    if (this.meta) this.voice.sync(this.meta.players.map((p) => p.n).filter((n) => n !== this.opts.me));
    this.lock();
    this.pushHud(true);
  }

  /** Cut my speech into pieces (for the mimics) and share them with the group. */
  private async startCapture() {
    const stream = this.voice.micStream;
    if (!stream || this.capture) return;
    this.capture = new VoiceCapture(this.sounds.ctx, stream, (p) => {
      const tags: ClipTag[] = [p.ms <= 1200 ? "short" : "long"];
      if (p.peak > 0.5) tags.push("loud");
      this.voice.shareMine(p.id, p.pcm, p.ms, tags);
      this.opts.net.sendClip({ id: p.id, ms: p.ms, tags });
      this.myPieces.push({ id: p.id, endedAt: p.endedAt });
      if (this.myPieces.length > 20) this.myPieces.shift();
    });
    await this.capture.start();
    if (this.smartLang && Transcriber.available()) {
      this.transcriber = new Transcriber();
      this.transcriber.start(this.smartLang, (text) => {
        // the words belong to the piece that just ended
        const now = performance.now();
        const piece = [...this.myPieces].reverse().find((x) => now - x.endedAt < 3000);
        if (!piece) return;
        const tags = tagText(text, this.names);
        if (!tags.length) return;
        this.voice.tagMine(piece.id, tags);
        this.opts.net.sendTag({ id: piece.id, tags });
      });
    }
  }

  lock() {
    if (this.opts.mobile) return;
    const c = this.canvas as HTMLCanvasElement & { requestPointerLock: (o?: { unadjustedMovement?: boolean }) => Promise<void> | void };
    try {
      const p = c.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof (p as Promise<void>).catch === "function") (p as Promise<void>).catch(() => { try { c.requestPointerLock(); } catch { /* not allowed now */ } });
    } catch { try { c.requestPointerLock(); } catch { /* not allowed now */ } }
  }

  setMeta(m: EchoMeta) {
    this.meta = m;
    this.goal = m.goal ?? null;
    this.applyPerk();
    this.names = Object.fromEntries(m.players.map((p) => [p.n, p.name.toLowerCase()]));
    const others = m.players.filter((p) => p.n !== this.opts.me);
    for (const p of others) {
      const look = p.look ?? TEEN_LOOKS[ECHO_TEENS[(p.n - 1) % 4].id];
      const had = this.avatars.get(p.n);
      if (had) { had.setLook(look); continue; }
      const a = new Avatar(p.name, p.color, look, !this.opts.mobile);
      this.avatars.set(p.n, a);
      this.scene.add(a.root);
      const gain = this.sounds.ctx.createGain();
      const panner = this.sounds.panner();
      gain.connect(panner);
      this.remoteSteps.set(p.n, { panner, gain, phase: 0, lx: 0, lz: 0 });
    }
    for (const [n, a] of [...this.avatars]) {
      if (others.some((p) => p.n === n)) continue;
      this.scene.remove(a.root);
      a.dispose();
      this.avatars.delete(n);
      this.hist.delete(n);
      this.remoteSteps.get(n)?.panner.disconnect();
      this.remoteSteps.delete(n);
    }
    this.voice.sync(others.map((p) => p.n));
  }

  onSnap(s: EchoSnap2) {
    const now = performance.now();
    const sample = s.t - now;
    this.tOff = this.tOff === null || sample > this.tOff ? sample : this.tOff - 0.25;
    this.takenSet = new Set(s.p.filter((r) => (r[6] & ECHO_TAKEN) !== 0).map((r) => r[0]));
    for (const r of s.m ?? []) {
      let v = this.mimics.get(r[0]);
      if (!v) {
        const gain = this.sounds.ctx.createGain();
        const panner = this.sounds.panner();
        gain.connect(panner);
        v = { fig: new MimicFigure(true), snd: new MimicSound(this.sounds), hist: [], av: null, avAs: 0, steps: { panner, gain, phase: 0, lx: 0, lz: 0 } };
        this.mimics.set(r[0], v);
        this.scene.add(v.fig.root);
      }
      if (v.hist.length && v.hist[v.hist.length - 1].t >= s.t) continue;
      v.hist.push({ t: s.t, x: r[1] / 100, z: r[2] / 100, yaw: r[3] / 1000, state: MIMIC_STATES[r[4]] ?? "wander", speaking: r[5] === 1, as: r[6] ?? 0, torch: ((r[7] ?? 1) & 1) === 1, crouch: ((r[7] ?? 0) & 2) === 2, pitch: (r[8] ?? 0) / 1000 });
      while (v.hist.length > 2 && v.hist[1].t < s.t - 1500) v.hist.shift();
    }
    const live = new Set((s.m ?? []).map((r) => r[0]));
    for (const [id, v] of [...this.mimics]) if (!live.has(id)) this.dropMimic(id, v);
    for (const p of decodeEchoSnap(s)) {
      if (p.n === this.opts.me) continue;
      let h = this.hist.get(p.n);
      if (!h) { h = []; this.hist.set(p.n, h); }
      if (h.length && h[h.length - 1].t >= p.t) continue;
      h.push(p);
      while (h.length > 2 && h[1].t < s.t - 1500) h.shift();
    }
  }

  /** Something happened in the night. */
  /** Recent events (debugging and tests). */
  readonly events: EchoEvent[] = [];

  onEvent(e: EchoEvent) {
    this.events.push(e);
    if (this.events.length > 50) this.events.shift();
    if (e.type === "pickup" || e.type === "install" || e.type === "power" || e.type === "end" || e.type === "drop" || e.type === "call" || e.type === "lift") this.hospital?.sfx(e.type === "end" ? e.result : e.type);
    if (e.type === "pry") { const f = this.goal?.fuses[e.fuse]; if (f) this.hospital?.scrape(f.x, f.y + 0.3, f.z); }
    if (e.type === "reveal") {
      // the friend's face slides off: a scream, the lights die around it, the room shakes
      const v = this.mimics.get(e.mimic);
      v?.snd.shriek();
      const h = v?.hist[v.hist.length - 1];
      if (h) { const d = Math.hypot(h.x - this.cur.x, h.z - this.cur.z); if (d < 16) { this.shake = Math.max(this.shake, 1 - d / 16); this.hospital?.sfx("reveal"); } }
    }
    if (e.type === "hide") {
      const [lx, lz] = ECHO_LOCKERS[e.locker];
      this.hospital?.locker(lx, lz, false);
      if (e.n === this.opts.me) { this.hiddenIn = e.locker; this.yaw = ECHO_LOCKERS[e.locker][2]; this.pitch = 0; this.cur.set(lx, this.cur.y, lz); this.prev.copy(this.cur); }
    }
    if (e.type === "unhide") {
      const [lx, lz] = ECHO_LOCKERS[e.locker];
      this.hospital?.locker(lx, lz, false);
      if (e.n === this.opts.me) { this.hiddenIn = null; this.teleport(e.x, e.z); this.yaw = ECHO_LOCKERS[e.locker][2]; }
    }
    if (e.type === "yank") {
      const [lx, lz] = ECHO_LOCKERS[e.locker];
      this.hospital?.locker(lx, lz, true);
      const d = Math.hypot(lx - this.cur.x, lz - this.cur.z); if (d < 14) this.shake = Math.max(this.shake, 1 - d / 14);
    }
    if (e.type === "gun" && e.n === this.opts.me) this.sounds.click();
    if (e.type === "shot") {
      const d = Math.hypot(e.x - this.cur.x, e.z - this.cur.z);
      if (e.n !== this.opts.me) { this.hospital?.gunshot(e.x, 1.5, e.z, d); if (d < 10) this.shake = Math.max(this.shake, 0.3 * (1 - d / 10)); }
      this.markHit(e.hx, e.hy, e.hz, !!e.hit);
      if (e.hit) this.hospital?.impact(e.hx, e.hy, e.hz);
      if (e.hit && "n" in e.hit && e.hit.n === this.opts.me) { this.hurtAt = performance.now(); this.shake = 1; this.sounds.sting(); if (e.hit.gone) { this.gone = true; this.takenUntil = Infinity; } }
      if (e.hit && "copy" in e.hit) this.mimics.get(e.hit.copy)?.snd.shriek();
    }
    if (e.type === "restart") {
      this.hiddenIn = null;
      for (const m of this.hits) { this.scene.remove(m); m.geometry.dispose(); }
      this.hits = [];
      const mine = e.spawns.find((s) => s[0] === this.opts.me);
      if (mine) this.teleport(mine[1], mine[2]);
      this.takenUntil = 0;
      this.doorOpen = 0;
      this.cuttersUsed = false;
      this.gone = false;
    }
    if (e.type === "radio") {
      const clips = e.clips.map((k) => this.voice.bank.get(k)).filter((c): c is NonNullable<typeof c> => !!c);
      // a call in my own voice would give it away to me, so I don't hear that one
      if (clips.length && !this.isTaken && e.as !== this.opts.me) { const d = this.voice.radio.play(clips); this.fakeAir = { as: e.as, until: performance.now() + d * 1000 }; }
    } else if (e.type === "say") {
      const v = this.mimics.get(e.mimic);
      const clips = e.clips.map((k) => this.voice.bank.get(k)).filter((c): c is NonNullable<typeof c> => !!c);
      if (v && clips.length) v.snd.say(clips);
    } else if (e.type === "free") {
      if (e.n === this.opts.me) { this.cuttersUsed = true; this.sounds.sting(); }
      this.mimics.get(e.mimic)?.snd.shriek();
    } else if (e.type === "exposed") {
      this.mimics.get(e.mimic)?.snd.shriek();
    } else if (e.type === "taken") {
      if (e.n === this.opts.me) {
        this.hiddenIn = null;
        this.takenUntil = e.gone ? Infinity : performance.now() + COPY.BACK_SEC * 1000;
        this.gone = !!e.gone;
        this.startScare(e.mimic);
        if (this.capture) this.capture.enabled = false;
      } else {
        const a = this.avatars.get(e.n);
        if (a) {
          const p = this.sounds.panner();
          this.sounds.place(p, a.root.position.x, 1.6, a.root.position.z);
          const mix = voiceMix({ x: this.cur.x, z: this.cur.z }, { x: a.root.position.x, z: a.root.position.z });
          this.sounds.cry(p, Math.min(0.6, mix.gain * 0.5 + 0.05));
          setTimeout(() => p.disconnect(), 1500);
        }
      }
    } else if (e.type === "back" && e.n === this.opts.me) {
      this.takenUntil = 0;
      this.teleport(e.x, e.z);
      if (this.capture) this.capture.enabled = !this.voice.muted;
    }
    this.pushHud(true);
  }

  private teleport(x: number, z: number) {
    this.body.setTranslation({ x, y: CENTER_Y, z }, true);
    this.cur.set(x, CENTER_Y, z);
    this.prev.copy(this.cur);
    this.vel.set(0, 0, 0);
    this.yaw = Math.PI;
    this.pitch = 0;
  }

  get isTaken() { return this.takenUntil > performance.now(); }

  look(dx: number, dy: number) {
    if (this.isTaken) return;
    this.yaw -= dx * this.sensitivity;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy * this.sensitivity));
    // through the slits of a locker door: only a little way left and right
    if (this.hiddenIn !== null) {
      const base = ECHO_LOCKERS[this.hiddenIn][2], d = Math.atan2(Math.sin(this.yaw - base), Math.cos(this.yaw - base));
      this.yaw = base + Math.max(-0.55, Math.min(0.55, d));
      this.pitch = Math.max(-0.35, Math.min(0.3, this.pitch));
    }
  }

  /** Fire the pistol (if I have it): local flash and kick now; the server decides what it hit. */
  shoot(): { yaw: number; pitch: number } | null {
    const g = this.goal?.gun;
    if (!g || g.by !== this.opts.me || this.isTaken || this.hiddenIn !== null || this.goal?.result) return null;
    if (g.ammo <= 0) { this.sounds.click(); return null; }
    const aim = { yaw: this.yaw, pitch: this.pitch };
    this.flashUntil = performance.now() + 70;
    this.recoil = 1;
    this.shake = Math.max(this.shake, 0.35);
    this.hospital?.gunshot(this.cur.x, 1.5, this.cur.z, 0);
    if (this.gunHeld) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.0048, 0.0048, 0.019, 8), new THREE.MeshStandardMaterial({ color: 0xb8913a, metalness: 0.9, roughness: 0.3 }));
      const wp = new THREE.Vector3(0.04, 0.06, -0.1); this.gunHeld.localToWorld(wp); c.position.copy(wp); this.scene.add(c);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      this.casings.push({ m: c, v: right.multiplyScalar(2 + Math.random()).add(new THREE.Vector3(0, 2.2, 0)), spin: new THREE.Vector3(Math.random() * 30, Math.random() * 30, 0), hits: 0 });
      if (this.casings.length > 20) { const o = this.casings.shift()!; this.scene.remove(o.m); o.m.geometry.dispose(); }
    }
    return aim;
  }

  toggleTorch() {
    this.torchOn = !this.torchOn;
    this.sounds.click();
    this.pushHud(true);
  }

  toggleCrouch() { this.crouch = !this.crouch; this.pushHud(true); }

  toggleMute() {
    this.voice.setMuted(!this.voice.muted);
    if (this.capture) this.capture.enabled = !this.voice.muted && !this.isTaken;
    this.pushHud(true);
  }

  resize() {
    if (!this.renderer) return;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(this.pixelRatio); this.composer?.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  // ───────── one physics step (60 per second) ─────────
  private physics(dt: number) {
    const k = this.keys;
    if (this.hiddenIn !== null) { this.prev.copy(this.cur); this.vel.set(0, 0, 0); this.realSpeed = 0; return; }
    const frozen = this.isTaken;
    let fx = frozen ? 0 : (k.f ? 1 : 0) - (k.b ? 1 : 0) - this.stick.y;
    let sx = frozen ? 0 : (k.r ? 1 : 0) - (k.l ? 1 : 0) + this.stick.x;
    const len = Math.hypot(fx, sx);
    if (len > 1) { fx /= len; sx /= len; }
    const crouching = this.crouch || k.crouch;
    const moving = len > 0.05;
    const wantsRun = k.run && moving && !crouching && fx > 0.2;
    if (wantsRun && !this.tired) {
      this.stamina = Math.max(0, this.stamina - dt / 5);
      if (this.stamina === 0) this.tired = true;
    } else {
      this.stamina = Math.min(1, this.stamina + dt / 4);
      if (this.stamina > 0.35) this.tired = false;
    }
    const speed = crouching ? ECHO.CROUCH : wantsRun && !this.tired ? ECHO.SPRINT : ECHO.WALK;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // forward is −z when yaw = 0
    const tx = (-sin * fx + cos * sx) * speed;
    const tz = (-cos * fx - sin * sx) * speed;
    const accel = moving ? 9 : 11; // speed up and slow down over a few frames, never instantly
    const f = 1 - Math.exp(-accel * dt);
    this.vel.x += (tx - this.vel.x) * f;
    this.vel.z += (tz - this.vel.z) * f;
    this.vy = this.grounded ? -1 : this.vy - 9.81 * dt;

    this.ctrl.computeColliderMovement(this.collider, { x: this.vel.x * dt, y: this.vy * dt, z: this.vel.z * dt });
    const m = this.ctrl.computedMovement();
    this.grounded = this.ctrl.computedGrounded();
    const p = this.body.translation();
    this.prev.copy(this.cur);
    this.cur.set(p.x + m.x, p.y + m.y, p.z + m.z);
    this.body.setNextKinematicTranslation({ x: this.cur.x, y: this.cur.y, z: this.cur.z });
    this.world.step();
    // the speed I really moved (walking into a wall makes no footsteps)
    this.realSpeed = Math.hypot(m.x, m.z) / dt;
    if (this.realSpeed < Math.hypot(this.vel.x, this.vel.z) * 0.5) { this.vel.x *= 0.8; this.vel.z *= 0.8; }
  }

  private frame = () => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.frameMs = this.frameMs * 0.95 + dt * 1000 * 0.05;

    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 6) { this.physics(STEP); this.acc -= STEP; steps++; }
    if (steps === 6) this.acc = 0;
    const alpha = this.acc / STEP;
    const px = this.prev.x + (this.cur.x - this.prev.x) * alpha;
    const py = this.prev.y + (this.cur.y - this.prev.y) * alpha;
    const pz = this.prev.z + (this.cur.z - this.prev.z) * alpha;
    const feet = py - CENTER_Y;

    // ── head: crouch height, bob, footsteps ──
    const crouching = this.crouch || this.keys.crouch;
    this.eye += ((crouching ? ECHO.CROUCH_EYE : ECHO.EYE) - this.eye) * (1 - Math.exp(-dt * 10));
    const sp = this.grounded ? this.realSpeed : 0;
    this.bob += sp * dt * 2.15;
    const amp = Math.min(1, sp / ECHO.WALK);
    const bobY = Math.sin(this.bob * 2) * 0.035 * amp;
    const bobX = Math.cos(this.bob) * 0.025 * amp;
    const n = Math.floor(this.bob / Math.PI);
    if (n !== this.stepCount) {
      this.stepCount = n;
      if (sp > 0.6) this.sounds.step(crouching ? 0.05 : sp > ECHO.WALK + 0.5 ? 0.32 : 0.18);
    }
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const strafe = this.vel.x * cos - this.vel.z * sin;
    const scared = now < this.scareUntil;
    const slump = this.isTaken && !scared ? 1 : 0;
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const sh = this.shake * this.shake * 0.06;
    this.camera.position.set(px + cos * bobX + (Math.random() - 0.5) * sh, feet + this.eye + bobY - slump * 1.2 + (Math.random() - 0.5) * sh, pz - sin * bobX);
    this.camera.rotation.set((scared ? 0 : this.pitch) + slump * 0.9 + (Math.random() - 0.5) * sh * 0.5, this.yaw, -strafe * 0.008 + slump * 0.6 + (Math.random() - 0.5) * sh * 0.5, "YXZ");
    if (this.hiddenIn !== null) {
      const [lx, lz, ly] = ECHO_LOCKERS[this.hiddenIn];
      this.camera.position.set(lx + Math.sin(ly) * 0.08, 1.58 + Math.sin(now * 0.0021) * 0.004, lz + Math.cos(ly) * 0.08);
    }
    // the pistol kicks
    if (this.recoil > 0) { this.recoil = Math.max(0, this.recoil - dt * 6); this.camera.rotation.x += this.recoil * 0.06; }
    this.camera.updateMatrixWorld();

    // ── torch follows the head with a little lag, like a real hand ──
    const off = new THREE.Vector3(-0.1, -0.05, -0.55).applyQuaternion(this.camera.quaternion); // ahead of the hand, so the pistol isn't lit white
    this.torchRig.position.copy(this.camera.position).add(off);
    this.torchRig.quaternion.slerp(this.camera.quaternion, 1 - Math.exp(-dt * 16));
    this.torch.intensity = this.torchOn && this.hiddenIn === null ? 75 * (0.97 + Math.sin(now * 0.013) * 0.015 + Math.sin(now * 0.0071) * 0.015) : 0;

    if (this.meta?.night?.awake && !this.goal?.result) {
      if (now > this.blackoutNext) {
        if (this.blackoutNext) { this.blackout = { x: px, z: pz, until: now + 3500 + Math.random() * 3500 }; this.hospital?.sfx("powerdown"); }
        this.blackoutNext = now + 40000 + Math.random() * 35000;
      }
    } else this.blackoutNext = 0;
    flickerLights(this.lights, now / 1000, px, pz, this.fear());
    this.hospital?.update({ x: px, y: this.camera.position.y, z: pz, yaw: this.yaw }, this.torchOn, this.lights.sources, now / 1000, this.isTaken, this.danger);
    this.updateGoal(dt, now / 1000, px, pz);
    this.updateGun(now);

    // ── friends, shown 0.12 s in the past so their movement is smooth ──
    const rt = this.tOff !== null ? now + this.tOff - INTERP_MS : 0;
    const others = new Map<number, { x: number; y: number; z: number }>();
    for (const [num, a] of this.avatars) {
      const s = sample(this.hist.get(num) ?? [], rt);
      if (!s || this.takenSet.has(num) || s.hidden) { a.root.visible = false; if (s?.hidden) others.set(num, { x: s.x, y: s.y, z: s.z }); continue; }
      a.root.visible = true;
      const d = Math.hypot(s.x - px, s.z - pz);
      const seen = d < 12 && echoWallsBetween(px, pz, s.x, s.z) === 0;
      a.update(s.x, s.y, s.z, s.yaw, s.pitch, s.torch, s.crouch, s.talk, dt, seen, d, s.radio);
      this.voice.setRadio(num, s.radio);
      if (s.radio) this.onAir.add(num); else this.onAir.delete(num);
      others.set(num, { x: s.x, y: s.y, z: s.z });
      // their footsteps, from their feet, quieter through walls
      const st = this.remoteSteps.get(num);
      if (st) {
        const moved = Math.hypot(s.x - st.lx, s.z - st.lz);
        st.lx = s.x; st.lz = s.z;
        if (moved < 2) st.phase += moved * 2.15 * 2;
        if (st.phase > Math.PI * 2 && a.speed > 0.6) {
          st.phase = 0;
          const walls = d < 20 ? echoWallsBetween(px, pz, s.x, s.z) : 3;
          const v = Math.max(0, 1 - d / 20) * (walls === 0 ? 1 : walls === 1 ? 0.4 : 0.15);
          if (v > 0.01) {
            this.sounds.place(st.panner, s.x, s.y + 0.1, s.z);
            this.sounds.step(v * (s.crouch ? 0.1 : a.speed > ECHO.WALK + 0.5 ? 0.35 : 0.22), st.gain);
          }
        }
      }
    }
    // ── the Copies, drawn in the past like friends: a friend's face until it shows what it is ──
    let danger = 0, behind = 0;
    for (const v of this.mimics.values()) {
      const m = sampleMimic(v.hist, rt);
      if (!m) { v.fig.root.visible = false; if (v.av) v.av.root.visible = false; continue; }
      const revealed = m.state === "chase" || m.state === "flee";
      const d = Math.hypot(m.x - px, m.z - pz);
      const walls = d < 20 ? echoWallsBetween(px, pz, m.x, m.z) : 3;
      const seen = d < 12 && walls === 0;
      const face = this.meta?.players.find((p) => p.n === m.as);
      if (face && (!v.av || v.avAs !== m.as)) {
        if (v.av) { this.scene.remove(v.av.root); v.av.dispose(); }
        v.av = new Avatar(face.name, face.color, face.look ?? TEEN_LOOKS[ECHO_TEENS[(face.n - 1) % 4].id], !this.opts.mobile);
        v.avAs = m.as;
        this.scene.add(v.av.root);
      }
      if (v.av && face?.look) v.av.setLook(face.look);
      const disguised = !revealed && m.state !== "dormant" && !!v.av;
      if (v.av) {
        v.av.root.visible = disguised;
        if (disguised) v.av.update(m.x, 0, m.z, m.yaw, m.pitch, m.torch, m.crouch, m.speaking, dt, seen, d);
      }
      v.fig.root.visible = revealed;
      v.fig.update(m.x, m.z, m.yaw, m.state, m.speaking, dt, now / 1000);
      const mix = voiceMix({ x: px, z: pz }, m);
      v.snd.update(m.x, m.z, this.isTaken ? 0 : mix.gain, mix.cutoff, d, walls, m.state === "chase", revealed);
      // footsteps like anyone's (a friend who makes no sound would give it away)
      if (disguised && v.av) {
        const st = v.steps;
        const moved = Math.hypot(m.x - st.lx, m.z - st.lz);
        st.lx = m.x; st.lz = m.z;
        if (moved < 2) st.phase += moved * 2.15 * 2;
        if (st.phase > Math.PI * 2 && v.av.speed > 0.6) {
          st.phase = 0;
          const vol = Math.max(0, 1 - d / 20) * (walls === 0 ? 1 : walls === 1 ? 0.4 : 0.15);
          if (vol > 0.01) { this.sounds.place(st.panner, m.x, 0.1, m.z); this.sounds.step(vol * (m.crouch ? 0.1 : 0.22), st.gain); }
        }
      }
      if (m.state === "chase" && d < 18) danger = Math.max(danger, 1 - d / 18);
      // Theo's walkie: something close that he can't see
      const away = d > 0.01 ? Math.acos(Math.max(-1, Math.min(1, ((m.x - px) * -Math.sin(this.yaw) + (m.z - pz) * -Math.cos(this.yaw)) / d))) : 0;
      if (d < 10 && m.state !== "dormant" && (walls > 0 || away > 1.75)) behind = Math.max(behind, 1 - d / 10);
    }
    if (behind > 0 && this.myTeen() === "theo" && !this.isTaken && now > this.crackleAt) {
      this.crackleAt = now + 1400 + Math.random() * 2200 - behind * 900;
      this.voice.radio.crackle(0.35 + behind * 0.65);
    }
    this.danger = danger;
    // the grab, up close
    if (this.scareFig) {
      const on = now < this.scareUntil;
      this.scareFig.root.visible = on;
      if (on) {
        this.scareFig.update(0, 0, 0, "stalk", true, dt, now / 1000);
        // right in front of my eyes, facing me, lunging closer
        const k = Math.max(0, Math.min(1, 1 - (this.scareUntil - now) / 1400));
        const dist = 0.95 - k * 0.35;
        const c = this.camera.position;
        this.scareFig.root.position.set(c.x - Math.sin(this.yaw) * dist + (Math.random() - 0.5) * 0.03, c.y - 2.38 + Math.random() * 0.02, c.z - Math.cos(this.yaw) * dist);
        this.scareFig.root.rotation.set(0, this.yaw + Math.PI, 0);
      }
    }

    this.sounds.listener(this.camera.position.x, this.camera.position.y, this.camera.position.z, this.yaw);
    this.voice.update({ x: px, z: pz }, others);

    // a creak somewhere in the building every 20–45 s
    if (now > this.noiseAt) {
      if (this.noiseAt) {
        const p = this.sounds.panner();
        const a = Math.random() * Math.PI * 2;
        this.sounds.place(p, px + Math.cos(a) * 14, 1.5, pz + Math.sin(a) * 14);
        this.sounds.distantNoise(p);
        setTimeout(() => p.disconnect(), 1500);
      }
      this.noiseAt = now + 20000 + Math.random() * 25000;
    }

    // ── tell the server where I am, 20 times a second ──
    if (now - this.sentAt >= ECHO.SEND_MS) {
      this.sentAt = now;
      // talking: my mic is loud enough, held a moment so the light doesn't flicker between words
      const lvl = this.voice.hasMic && !this.voice.muted && !this.isTaken ? this.voice.micLevel() ?? 0 : 0;
      if (lvl > 0.15) this.talkUntil = now + 350;
      const onAir = this.keys.radio && !!this.voice.hasMic && !this.voice.muted && !this.isTaken;
      if (onAir !== this.wasOnAir) { this.wasOnAir = onAir; this.voice.radio.squelch(onAir); }
      this.opts.net.sendState({ x: px, y: feet, z: pz, yaw: this.yaw, pitch: this.pitch, torch: this.torchOn && this.hiddenIn === null, crouch: crouching, talk: now < this.talkUntil, radio: onAir, seq: ++this.seq });
    }

    this.adaptQuality();
    if (this.composer && this.film) { this.film.uniforms.t.value = now * 0.001; this.film.uniforms.hurt.value = Math.max(0, 1 - (now - this.hurtAt) / 1600); this.composer.render(); }
    else this.renderer.render(this.scene, this.camera);
    for (const b of this.deadBodies) if (b.dirty) { b.body.update(0); b.dirty = false; }
    this.pushHud(false);
  };

  /** Lower the resolution a little when frames get slow, raise it again when there's room. */
  private qualityAt = 0;
  private adaptQuality() {
    const now = performance.now();
    if (now - this.qualityAt < 2000) return;
    this.qualityAt = now;
    let r = this.pixelRatio;
    if (this.frameMs > 22) r = Math.max(0.6, r - 0.15);
    else if (this.frameMs < 13 && r < this.maxRatio) r = Math.min(this.maxRatio, r + 0.1);
    if (Math.abs(r - this.pixelRatio) > 0.01) { this.pixelRatio = r; this.resize(); }
  }

  private cuttersUsed = false;
  private danger = 0;
  /** Now and then the power dips around you: every light in reach dies for a few seconds. */
  private blackout: { x: number; z: number; until: number } | null = null;
  private blackoutNext = 0;
  /** Where the lights go wrong: dead around a revealed creature, stuttering near a disguised one. */
  private fear() {
    const out: { x: number; z: number; r: number; kill: boolean }[] = [];
    if (this.blackout && performance.now() < this.blackout.until) out.push({ x: this.blackout.x, z: this.blackout.z, r: 24, kill: true });
    for (const v of this.mimics.values()) {
      const h = v.hist[v.hist.length - 1];
      if (!h || h.state === "dormant") continue;
      const revealed = h.state === "chase" || h.state === "flee";
      out.push({ x: h.x, z: h.z, r: revealed ? 12 : 5, kill: revealed });
    }
    return out;
  }
  private myTeen(): EchoTeenId | null { return this.meta?.players.find((p) => p.n === this.opts.me)?.look?.teen ?? null; }

  /** Nora's headlamp throws further and brighter. */
  private applyPerk() {
    if (!this.torch) return;
    const nora = this.myTeen() === "nora";
    this.torch.intensity = nora ? 115 : 75;
    this.torch.distance = nora ? 38 : 30;
    this.torch.angle = nora ? 0.56 : 0.5;
  }

  /** Maya's phone: the next thing to do, and the first step of the walk there (so it points at doors, not through walls). */
  private finder(): { what: string; m: number; deg: number } | null {
    const g = this.goal;
    if (!g || g.result) return null;
    const px = this.cur.x, pz = this.cur.z;
    let what: string, tx: number, tz: number;
    if (g.power) { what = "Lift"; tx = GOAL.LIFT.x; tz = GOAL.LIFT.z; }
    else if (g.fuses.some((f) => f.by === this.opts.me)) { what = "Fuse box"; tx = GOAL.BOX.x; tz = GOAL.BOX.z; }
    else {
      const loose = g.fuses.filter((f) => !f.placed && f.by === null).sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz))[0];
      if (!loose) return null;
      what = "Fuse"; tx = loose.x; tz = loose.z;
    }
    const path = echoPath([echoTileOf(px), echoTileOf(pz)], [echoTileOf(tx), echoTileOf(tz)]);
    const T = ECHO.TILE;
    // aim at the next tile's centre while there is more than one step left, else straight at the target
    let wx = tx, wz = tz;
    if (path.length > 1) { wx = (path[0][0] + 0.5) * T; wz = (path[0][1] + 0.5) * T; }
    let m = 0, lx = px, lz = pz;
    for (const [cx, cz] of path.slice(0, -1)) { const x = (cx + 0.5) * T, z = (cz + 0.5) * T; m += Math.hypot(x - lx, z - lz); lx = x; lz = z; }
    m += Math.hypot(tx - lx, tz - lz);
    const dx = wx - px, dz = wz - pz;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const ahead = -sin * dx - cos * dz, right = cos * dx - sin * dz;
    return { what, m: Math.round(m), deg: Math.round((Math.atan2(right, ahead) * 180) / Math.PI) };
  }

  private gone = false;
  private shake = 0;
  private scareUntil = 0;
  private scareFig: MimicFigure | null = null;
  private crackleAt = 0;

  /** Server time now (ms), from the snapshot clock. */
  private serverNow() { return performance.now() + (this.tOff ?? 0); }
  private pryProgress(): number | null {
    const p = this.goal?.pry.find((q) => q[0] === this.opts.me);
    if (!p) return null;
    return Math.max(0, Math.min(1, 1 - (p[2] - this.serverNow()) / (GOAL.PRY_SEC * 1000)));
  }
  private liftIn(): number | null {
    const g = this.goal;
    if (!g?.liftAt || g.result) return null;
    const s = Math.ceil((g.liftAt - this.serverNow()) / 1000);
    return s > 0 ? s : null;
  }
  private liftHere() { const g = this.goal; return !!g?.liftAt && !g.result && this.serverNow() >= g.liftAt; }

  /** The grab: the creature fills the screen for a moment. */
  private startScare(mimic: number) {
    this.sounds.sting();
    this.mimics.get(mimic)?.snd.shriek();
    this.hospital?.sfx("reveal");
    this.scareUntil = performance.now() + 1400;
    this.shake = 1;
    if (!this.scareFig) {
      this.scareFig = new MimicFigure(false);
      this.scareFig.scream = 1;
      this.scene.add(this.scareFig.root);
    }
    this.scareFig.root.visible = true;
  }

  private dropMimic(id: number, v: MimicView) {
    v.snd.dispose(); this.scene.remove(v.fig.root); v.fig.dispose();
    if (v.av) { this.scene.remove(v.av.root); v.av.dispose(); }
    v.steps.panner.disconnect();
    this.mimics.delete(id);
  }

  private pushHud(force: boolean) {
    const now = performance.now();
    if (!force && now - this.hudAt < 100) return;
    this.hudAt = now;
    this.opts.onHud({
      fps: Math.round(1000 / Math.max(1, this.frameMs)),
      stamina: this.stamina,
      torch: this.torchOn,
      crouch: this.crouch || this.keys.crouch,
      locked: this.locked,
      mic: { has: this.voice.hasMic ?? false, muted: this.voice.muted ?? false, level: this.voice.micLevel() ?? 0, error: this.voice.micError ?? null },
      peers: this.voice.statuses() ?? [],
      quality: this.pixelRatio,
      taken: Math.max(0, Math.ceil((this.takenUntil - now) / 1000)),
      pieces: [...this.voice.bank.keys()].filter((k) => k.startsWith(`${this.opts.me}:`)).length,
      room: ECHO_ROOMS[echoTile(echoTileOf(this.cur.x), echoTileOf(this.cur.z))]?.name ?? "",
      act: this.act ? ({ pickup: "pry the fuse out", call: "call the lift", install: "put the fuse in", hide: "hide in the locker", unhide: "get out", gun: "take the pistol", read: "read" } as const)[this.act.type] + (this.act.type === "read" ? `: ${NOTES[this.act.note]?.title ?? ""}` : "") : null,
      carrying: !!this.goal?.fuses.some((f) => f.by === this.opts.me),
      onAir: [...(this.wasOnAir ? [0] : []), ...this.onAir],
      fakeAir: this.fakeAir && this.fakeAir.until > now ? this.fakeAir.as : null,
      teen: this.myTeen(),
      finder: this.myTeen() === "maya" && !this.isTaken ? this.finder() : null,
      cuttersUsed: this.cuttersUsed,
      gone: this.gone,
      scare: now < this.scareUntil,
      pry: this.pryProgress(),
      liftIn: this.liftIn(),
      liftHere: this.liftHere(),
      hidden: this.hiddenIn !== null,
      ammo: this.goal?.gun?.by === this.opts.me ? this.goal.gun.ammo : null,
      note: this.noteNear,
      hurt: Math.max(0, 1 - (now - this.hurtAt) / 1600),
    });
  }

  /** The fuses, the fuse box lights, the lift doors; and what E / Use would do. */
  private updateGoal(dt: number, t: number, px: number, pz: number) {
    const g = this.goal, v = this.goalView;
    if (!g || !v) return;
    for (const f of g.fuses) {
      let o = this.fuses.get(f.id);
      if (!o) {
        const grp = new THREE.Group();
        const glow = new THREE.MeshStandardMaterial({ color: 0x3a2a14, emissive: 0xffa040, emissiveIntensity: 0.6, roughness: 0.3, transparent: true, opacity: 0.85 });
        const cap = new THREE.MeshStandardMaterial({ color: 0x9aa0a2, metalness: 0.8, roughness: 0.3 });
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.16, 12), glow); body.rotation.z = Math.PI / 2; grp.add(body);
        for (const k of [-1, 1]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 12), cap); c.rotation.z = Math.PI / 2; c.position.x = k * 0.1; grp.add(c); }
        this.scene.add(grp);
        o = { g: grp, glow };
        this.fuses.set(f.id, o);
      }
      const { g: grp, glow } = o;
      grp.visible = !f.placed;
      glow.emissiveIntensity = 0.35 + 0.35 * Math.max(0, Math.sin(t * 3 + f.id * 2));
      if (f.placed) continue;
      if (f.by === this.opts.me) {
        if (grp.parent !== this.camera) this.camera.add(grp);
        grp.position.set(-0.2, -0.2, -0.55); grp.rotation.set(0.3, 0.6, 0.2); grp.scale.setScalar(0.55);
      } else {
        if (grp.parent !== this.scene) { this.scene.add(grp); grp.scale.setScalar(1); }
        const a = f.by === null ? null : f.by < 0 ? this.mimics.get(-f.by)?.av ?? null : this.avatars.get(f.by);
        if (a) { const yaw = a.root.rotation.y; grp.position.set(a.root.position.x - Math.cos(yaw) * 0.3 - Math.sin(yaw) * 0.25, 0.95, a.root.position.z + Math.sin(yaw) * 0.3 - Math.cos(yaw) * 0.25); grp.rotation.set(0, yaw, 0); }
        else { grp.position.set(f.x, f.y + 0.05 + Math.sin(t * 2 + f.id) * 0.01, f.z); grp.rotation.set(0, t * 0.4 + f.id, 0); }
      }
    }
    v.fuseSlots.forEach((m, i) => m.material.color.set(i < g.placed ? (g.power ? 0x3cff8a : 0x2fd27a) : 0x3a0c08));
    // the lift wakes up when the power is back
    this.doorOpen = Math.min(1, Math.max(0, this.doorOpen + (this.liftHere() ? dt / 2 : g.result === "win" ? -dt / 1.5 : 0)));
    v.liftDoors.forEach((d, i) => { d.position.z = 9 * ECHO.TILE + 0.75 + (i ? 1 : -1) * (0.28 + 0.5 * this.doorOpen); });
    v.cab.color.setRGB(0.04 + 0.85 * this.doorOpen, 0.035 + 0.72 * this.doorOpen, 0.03 + 0.5 * this.doorOpen);
    v.liftLight.base = 6 * this.doorOpen;
    v.liftArrow.color.set(g.calledAt ? (Math.sin(t * (this.liftHere() ? 2 : 6)) > 0 ? 0xffb040 : 0x3a1a10) : g.power ? 0x6a3010 : 0x3a1a10);
    // what can I do right here?
    this.act = null;
    this.noteNear = null;
    if (g.result || this.isTaken) return;
    if (this.hiddenIn !== null) { this.act = { type: "unhide" }; return; }
    // something to read: close, and roughly in front of me
    let nb = 1.8;
    for (const n of NOTES) {
      const d = Math.hypot(n.x - px, n.z - pz);
      if (d > nb) continue;
      const away = d < 0.3 ? 0 : Math.acos(Math.max(-1, Math.min(1, ((n.x - px) * -Math.sin(this.yaw) + (n.z - pz) * -Math.cos(this.yaw)) / d)));
      if (away < 1.2) { nb = d; this.noteNear = n.id; }
    }
    if (!g.startedAt) { if (this.noteNear !== null) this.act = { type: "read", note: this.noteNear }; return; }
    if (g.pry.some((p) => p[0] === this.opts.me)) return;
    const mine = g.fuses.find((f) => f.by === this.opts.me);
    if (g.power && !g.calledAt && Math.hypot(GOAL.LIFT.x - px, GOAL.LIFT.z - pz) < GOAL.LIFT_R + 1.3) this.act = { type: "call" };
    else if (mine && Math.hypot(GOAL.BOX.x - px, GOAL.BOX.z - pz) < GOAL.REACH) this.act = { type: "install" };
    else if (!mine) { let best: number = GOAL.REACH; for (const f of g.fuses) { if (f.placed || f.by !== null) continue; const d = Math.hypot(f.x - px, f.z - pz); if (d < best) { best = d; this.act = { type: "pickup", fuse: f.id }; } } }
    if (this.act) return;
    if (g.gun && g.gun.by === null && Math.hypot(g.gun.x - px, g.gun.z - pz) < GOAL.REACH) { this.act = { type: "gun" }; return; }
    if (this.noteNear !== null && nb < 1.2) { this.act = { type: "read", note: this.noteNear }; return; }
    let lb: number = HIDE.REACH;
    ECHO_LOCKERS.forEach((_, i) => { if (g.hidden?.some((h) => h[1] === i)) return; const f = lockerFront(i); const d = Math.hypot(f.x - px, f.z - pz); if (d < lb) { lb = d; this.act = { type: "hide", locker: i }; } });
    if (!this.act && this.noteNear !== null) this.act = { type: "read", note: this.noteNear };
  }
  private noteNear: number | null = null;

  /** The pistol: lying by a dead officer, in my hand, or in someone else's. */
  private updateGun(now: number) {
    const g = this.goal?.gun;
    if (!g) return;
    const build = () => {
      const src = this.real?.props.service_pistol;
      if (src) {
        const g = new THREE.Group(), p = src.clone(true);
        p.traverse((n) => { const m = n as THREE.Mesh; if (!m.isMesh) return; m.visible = ["pistol_a", "slide_a", "hammer_a", "trigger_a"].some((k) => m.name.includes(k)); m.castShadow = false; if (m.name.includes("slide_a")) g.userData.slide = m; });
        p.rotation.y = Math.PI / 2; // its barrel points +x; the game's forward is −z
        p.traverse((n) => {
          const m = n as THREE.Mesh; if (!m.isMesh || !m.visible) return;
          // the torch sits ahead of the gun, so it lights the room, not the gun: a faint self-light keeps the steel readable
          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          if (mat.map) { mat.emissiveMap = mat.map; mat.emissive = new THREE.Color(0x45403a); }
          m.material = mat;
        });
        g.add(p); g.userData.real = true; return g;
      }
      const grp = new THREE.Group();
      // unlit: right in front of the torch a lit gun would just glare white
      const dark = new THREE.MeshBasicMaterial({ color: 0x232629 });
      const grip = new THREE.MeshBasicMaterial({ color: 0x15120f });
      const slide = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.036, 0.19), dark); slide.position.set(0, 0.03, -0.03); grp.add(slide);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.02, 0.15), dark); frame.position.set(0, 0.004, -0.02); grp.add(frame);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.11, 0.045), grip); handle.position.set(0, -0.045, 0.045); handle.rotation.x = 0.28; grp.add(handle);
      const guard = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, 4, 10, Math.PI), dark); guard.position.set(0, -0.01, 0.0); guard.rotation.set(Math.PI, Math.PI / 2, 0); grp.add(guard);
      return grp;
    };
    if (!this.gunWorld) {
      const w = build();
      if (w.userData.real) {
        // lying on its side on the floor: roll it about the barrel, then sit it on y = 0
        const roll = new THREE.Group(); roll.add(...w.children); roll.rotation.z = Math.PI / 2; w.add(roll);
        w.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(w, true); roll.position.y = -bb.min.y;
      } else w.scale.setScalar(1.15);
      this.gunWorld = w; this.scene.add(w);
    }
    if (!this.gunHeld) {
      this.gunHeld = build(); this.camera.add(this.gunHeld);
      this.muzzle = new THREE.PointLight(0xffc27a, 0, 9, 2); this.camera.add(this.muzzle); this.muzzle.position.set(0.14, -0.08, -0.6);
      this.muzzleSprite = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.muzzleSprite.position.set(0.15, -0.13, -0.52); this.camera.add(this.muzzleSprite);
    }
    const mine = g.by === this.opts.me && !this.isTaken && this.hiddenIn === null;
    this.gunWorld.visible = g.by === null && !this.goal?.result;
    if (this.gunWorld.visible) {
      if (this.gunWorld.userData.real) { this.gunWorld.position.set(g.x, g.y - 0.055, g.z); this.gunWorld.rotation.set(0, 0.7, 0); } // spots sit 6 cm up for the old drawn gun
      else { this.gunWorld.position.set(g.x, g.y + 0.02, g.z); this.gunWorld.rotation.set(Math.PI / 2, 0.7, 0); }
    }
    this.gunHeld.visible = mine;
    const k = this.recoil;
    if (this.gunHeld.userData.real) {
      this.gunHeld.position.set(0.12, -0.135 + k * 0.03, -0.33 + k * 0.05); this.gunHeld.rotation.set(0.04 + k * 0.35, 0.14, 0);
      const sl = this.gunHeld.userData.slide as THREE.Object3D | undefined;
      if (sl) { if (sl.userData.home === undefined) sl.userData.home = sl.position.x; sl.position.x = sl.userData.home - k * 0.03; }
    } else { this.gunHeld.position.set(0.17, -0.19 + k * 0.03, -0.42 + k * 0.06); this.gunHeld.rotation.set(k * 0.5, 0.06, 0); }
    // brass cases fly out to the right and rattle on the floor
    for (const c of this.casings) {
      if (c.hits > 3) continue;
      const dt = 1 / 60;
      c.v.y -= 9.8 * dt; c.m.position.addScaledVector(c.v, dt); c.m.rotation.x += c.spin.x * dt; c.m.rotation.y += c.spin.y * dt;
      if (c.m.position.y < 0.006) { c.m.position.y = 0.006; c.v.y *= -0.35; c.v.x *= 0.5; c.v.z *= 0.5; c.spin.multiplyScalar(0.5); c.hits++; if (c.hits <= 2) this.hospital?.casing(c.m.position.x, c.m.position.z, 1 / c.hits); }
    }
    const flash = now < this.flashUntil;
    if (this.muzzle) this.muzzle.intensity = flash ? 60 : 0;
    if (this.muzzleSprite) { this.muzzleSprite.visible = flash; this.muzzleSprite.rotation.z = Math.random() * 6; }
  }

  /** Where a bullet stopped: a dark hole, or blood. */
  private markHit(x: number, y: number, z: number, flesh: boolean) {
    const mat = new THREE.MeshBasicMaterial({ color: flesh ? 0x4a0404 : 0x0a0a0a, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const m = new THREE.Mesh(new THREE.CircleGeometry(flesh ? 0.5 + Math.random() * 0.3 : 0.035, flesh ? 9 : 6), mat);
    if (flesh) { m.position.set(x + (Math.random() - 0.5) * 0.4, 0.016, z + (Math.random() - 0.5) * 0.4); m.rotation.x = -Math.PI / 2; }
    else { m.position.set(x, y, z); m.lookAt(this.cur.x, y, this.cur.z); }
    this.scene.add(m); this.hits.push(m);
    if (this.hits.length > 30) { const o = this.hits.shift()!; this.scene.remove(o); o.geometry.dispose(); }
  }

  /** E / Use: what to send to the server, if anything. */
  useAct() { return this.act; }

  /** Debug / tests: where I am. */
  position() { return { x: this.cur.x, z: this.cur.z, yaw: this.yaw }; }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.capture?.stop();
    this.transcriber?.stop();
    for (const [id, v] of [...this.mimics]) this.dropMimic(id, v);
    this.scareFig?.dispose();
    this.voice.destroy();
    this.hospital?.stop();
    this.sounds.close();
    for (const a of this.avatars.values()) a.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mats = (Array.isArray(m.material) ? m.material : [m.material]) as (THREE.Material | undefined)[];
      for (const mat of mats) {
        if (!mat) continue;
        for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
        mat.dispose();
      }
    });
    this.renderer?.dispose();
    this.world?.free();
  }
}
