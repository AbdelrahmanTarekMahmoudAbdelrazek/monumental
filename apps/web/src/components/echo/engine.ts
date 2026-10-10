import * as THREE from "three";
import type RAPIER_NS from "@dimforge/rapier3d-compat";
import { ECHO, ECHO_ROOMS, GOAL, type EchoGoal, ECHO_TAKEN, ECHO_TEENS, MIMIC_STATES, TEEN_LOOKS, decodeEchoSnap, echoTile, echoTileOf, echoWallsBetween, tagText, type ClipTag, type EchoEvent, type EchoMeta, type EchoPeerState, type EchoSnap2 } from "@monumental/shared";
import { makeTextures } from "./textures";
import { buildLevel, flickerLights, type HospitalLights } from "./hospital";
import { HospitalAudio } from "./hospitalAudio";
import { SoundBank } from "./sound";
import { Voice, voiceMix, type PeerStatus } from "./voice";
import { Avatar } from "./avatars";
import { VoiceCapture, Transcriber } from "./capture";
import { MimicFigure, MimicSound } from "./mimic";

interface MimicView { fig: MimicFigure; snd: MimicSound; hist: { t: number; x: number; z: number; yaw: number; state: string; speaking: boolean }[] }

type Rapier = typeof RAPIER_NS;

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
  private act: { type: "pickup"; fuse: number } | { type: "install" } | null = null;
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
    const level = buildLevel(tex, !mobile, mobile ? 256 : 512);
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
        v = { fig: new MimicFigure(true), snd: new MimicSound(this.sounds), hist: [] };
        this.mimics.set(r[0], v);
        this.scene.add(v.fig.root);
      }
      if (v.hist.length && v.hist[v.hist.length - 1].t >= s.t) continue;
      v.hist.push({ t: s.t, x: r[1] / 100, z: r[2] / 100, yaw: r[3] / 1000, state: MIMIC_STATES[r[4]] ?? "wander", speaking: r[5] === 1 });
      while (v.hist.length > 2 && v.hist[1].t < s.t - 1500) v.hist.shift();
    }
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
    if (e.type === "pickup" || e.type === "install" || e.type === "power" || e.type === "end" || e.type === "drop") this.hospital?.sfx(e.type === "end" ? e.result : e.type);
    if (e.type === "restart") {
      const mine = e.spawns.find((s) => s[0] === this.opts.me);
      if (mine) this.teleport(mine[1], mine[2]);
      this.takenUntil = 0;
      this.doorOpen = 0;
    }
    if (e.type === "radio") {
      const clips = e.clips.map((k) => this.voice.bank.get(k)).filter((c): c is NonNullable<typeof c> => !!c);
      if (clips.length && !this.isTaken) { const d = this.voice.radio.play(clips); this.fakeAir = { as: e.as, until: performance.now() + d * 1000 }; }
    } else if (e.type === "say") {
      const v = this.mimics.get(e.mimic);
      const clips = e.clips.map((k) => this.voice.bank.get(k)).filter((c): c is NonNullable<typeof c> => !!c);
      if (v && clips.length) v.snd.say(clips);
    } else if (e.type === "exposed") {
      this.mimics.get(e.mimic)?.snd.shriek();
    } else if (e.type === "taken") {
      if (e.n === this.opts.me) {
        this.takenUntil = performance.now() + 8000;
        this.sounds.sting();
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
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  // ───────── one physics step (60 per second) ─────────
  private physics(dt: number) {
    const k = this.keys;
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
    const slump = this.isTaken ? 1 : 0;
    this.camera.position.set(px + cos * bobX, feet + this.eye + bobY - slump * 1.2, pz - sin * bobX);
    this.camera.rotation.set(this.pitch + slump * 0.9, this.yaw, -strafe * 0.008 + slump * 0.6, "YXZ");
    this.camera.updateMatrixWorld();

    // ── torch follows the head with a little lag, like a real hand ──
    const off = new THREE.Vector3(0.2, -0.2, -0.15).applyQuaternion(this.camera.quaternion);
    this.torchRig.position.copy(this.camera.position).add(off);
    this.torchRig.quaternion.slerp(this.camera.quaternion, 1 - Math.exp(-dt * 16));
    this.torch.intensity = this.torchOn ? 75 * (0.97 + Math.sin(now * 0.013) * 0.015 + Math.sin(now * 0.0071) * 0.015) : 0;

    flickerLights(this.lights, now / 1000, px, pz);
    this.hospital?.update({ x: px, y: this.camera.position.y, z: pz, yaw: this.yaw }, this.torchOn, this.lights.sources, now / 1000, this.isTaken);
    this.updateGoal(dt, now / 1000, px, pz);

    // ── friends, shown 0.12 s in the past so their movement is smooth ──
    const rt = this.tOff !== null ? now + this.tOff - INTERP_MS : 0;
    const others = new Map<number, { x: number; y: number; z: number }>();
    for (const [num, a] of this.avatars) {
      const s = sample(this.hist.get(num) ?? [], rt);
      if (!s || this.takenSet.has(num)) { a.root.visible = false; continue; }
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
    // ── mimics, drawn in the past like friends ──
    for (const v of this.mimics.values()) {
      const m = sampleMimic(v.hist, rt);
      if (!m) { v.fig.root.visible = false; continue; }
      v.fig.root.visible = m.state !== "dormant";
      v.fig.update(m.x, m.z, m.yaw, m.state, m.speaking, dt, now / 1000);
      const mix = voiceMix({ x: px, z: pz }, m);
      const d = Math.hypot(m.x - px, m.z - pz);
      v.snd.update(m.x, m.z, this.isTaken ? 0 : mix.gain, mix.cutoff, d, d < 20 ? echoWallsBetween(px, pz, m.x, m.z) : 3, m.state === "chase");
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
      this.opts.net.sendState({ x: px, y: feet, z: pz, yaw: this.yaw, pitch: this.pitch, torch: this.torchOn, crouch: crouching, talk: now < this.talkUntil, radio: onAir, seq: ++this.seq });
    }

    this.adaptQuality();
    this.renderer.render(this.scene, this.camera);
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
      act: this.act ? (this.act.type === "pickup" ? "pick up the fuse" : "put the fuse in") : null,
      carrying: !!this.goal?.fuses.some((f) => f.by === this.opts.me),
      onAir: [...(this.wasOnAir ? [0] : []), ...this.onAir],
      fakeAir: this.fakeAir && this.fakeAir.until > now ? this.fakeAir.as : null,
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
        const a = f.by !== null ? this.avatars.get(f.by) : null;
        if (a) { const yaw = a.root.rotation.y; grp.position.set(a.root.position.x - Math.cos(yaw) * 0.3 - Math.sin(yaw) * 0.25, 0.95, a.root.position.z + Math.sin(yaw) * 0.3 - Math.cos(yaw) * 0.25); grp.rotation.set(0, yaw, 0); }
        else { grp.position.set(f.x, f.y + 0.05 + Math.sin(t * 2 + f.id) * 0.01, f.z); grp.rotation.set(0, t * 0.4 + f.id, 0); }
      }
    }
    v.fuseSlots.forEach((m, i) => m.material.color.set(i < g.placed ? (g.power ? 0x3cff8a : 0x2fd27a) : 0x3a0c08));
    // the lift wakes up when the power is back
    this.doorOpen = Math.min(1, Math.max(0, this.doorOpen + (g.power && !g.result ? dt / 2 : g.result === "win" ? -dt / 1.5 : 0)));
    v.liftDoors.forEach((d, i) => { d.position.z = 9 * ECHO.TILE + 0.75 + (i ? 1 : -1) * (0.28 + 0.5 * this.doorOpen); });
    v.cab.color.setRGB(0.04 + 0.85 * this.doorOpen, 0.035 + 0.72 * this.doorOpen, 0.03 + 0.5 * this.doorOpen);
    v.liftLight.base = 6 * this.doorOpen;
    v.liftArrow.color.set(g.power ? (Math.sin(t * 4) > 0 ? 0xffb040 : 0x3a1a10) : 0x3a1a10);
    // what can I do right here?
    this.act = null;
    if (g.result || this.isTaken || !g.startedAt) return;
    const mine = g.fuses.find((f) => f.by === this.opts.me);
    if (mine) { if (Math.hypot(GOAL.BOX.x - px, GOAL.BOX.z - pz) < GOAL.REACH) this.act = { type: "install" }; return; }
    let best: number = GOAL.REACH;
    for (const f of g.fuses) { if (f.placed || f.by !== null) continue; const d = Math.hypot(f.x - px, f.z - pz); if (d < best) { best = d; this.act = { type: "pickup", fuse: f.id }; } }
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
    for (const v of this.mimics.values()) { v.snd.dispose(); v.fig.dispose(); }
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
