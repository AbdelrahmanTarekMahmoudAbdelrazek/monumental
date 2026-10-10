import { ECHO } from "@monumental/shared";
import type { LightSource } from "./hospital";

const T = ECHO.TILE;
const HT = 3.2;
const CLIPS = ["cry", "v_look_radio", "v_look_whisper", "v_here", "v_hate", "v_earth"] as const;
type Clip = (typeof CLIPS)[number];
const RADIO = { x: 16 * T, y: 1.0, z: 2.6 * T }; // the radio at the nurses' station
const CRY_SPOTS: [number, number][] = [[12.5 * T, 10 * T], [7.5 * T, 2 * T], [17.5 * T, 10.5 * T], [2 * T, 10 * T], [63, 31.5], [46.5, 58], [24, 60], [80, 12]];
/** Places that are never quiet: children crying where there are no children, people in pain, a dead radio still talking. */
const ZONES: { x: number; z: number; r: number; kind: "child" | "moan" | "radio" }[] = [
  { x: 63, z: 31.5, r: 17, kind: "child" }, { x: 37.5, z: 9, r: 14, kind: "child" }, { x: 46.5, z: 58, r: 18, kind: "moan" },
  { x: 64, z: 65.5, r: 14, kind: "moan" }, { x: 40, z: 31, r: 12, kind: "moan" }, { x: 76, z: 32, r: 14, kind: "radio" }, { x: 12, z: 58, r: 14, kind: "moan" },
];
// a little original tune for the music box in the children's ward
const TUNE = [76, 72, 74, 71, 72, 69, 71, 68, 69, 72, 76, 81, 79, 76, 77, 74, 76];

export interface Ears { x: number; y: number; z: number; yaw: number }

/**
 * The hospital's sound: a drone you feel more than hear, the buzz of dying tubes, drips, knocks and groans
 * somewhere you can't see, a music box, crying down the halls, voices on a radio, whispering behind you,
 * and your own heartbeat when your torch is off. Uses the game's AudioContext and listener.
 */
export class HospitalAudio {
  private send!: GainNode;
  private bus!: GainNode;
  private buzz!: GainNode;
  private buzzPan!: PannerNode;
  private beat!: GainNode;
  private buf: Partial<Record<Clip, AudioBuffer>> = {};
  private nodes: AudioScheduledSourceNode[] = [];
  private noiseCache = new Map<string, AudioBuffer>();
  private next = { event: 0, music: 0, drip: 0, voice: 0, cry: 0, zone: 0, gliss: 0, boom: 0, pad: 0, scream: 0 };
  private padGain!: GainNode;
  private highGain!: GainNode;
  private padOsc: OscillatorNode[] = [];
  private danger = 0;
  private voiceOrder: string[] = [];
  private heart = 0;
  private lastBeat = 0;
  private started = false;
  private timers: number[] = [];

  constructor(private ctx: AudioContext, private out: AudioNode) {}

  start() {
    if (this.started) return;
    this.started = true;
    const ac = this.ctx;
    this.bus = ac.createGain(); this.bus.gain.value = 0; this.bus.gain.linearRampToValueAtTime(1, ac.currentTime + 4); this.bus.connect(this.out);
    const verb = ac.createConvolver(); verb.buffer = this.ir(4.5); const vg = ac.createGain(); vg.gain.value = 0.55; verb.connect(vg).connect(this.bus);
    this.send = ac.createGain(); this.send.connect(verb);
    // drone: low notes plus audible partners so small speakers still carry it, the filter slowly breathing
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420; lp.Q.value = 5;
    const dg = ac.createGain(); dg.gain.value = 0.05; lp.connect(dg).connect(this.bus); dg.connect(this.send);
    for (const f of [55, 55.4, 82.4, 110.9, 164.8, 233.1]) this.osc("sawtooth", f, lp);
    const lfo = this.osc("sine", 0.05); const lg = ac.createGain(); lg.gain.value = 260; lfo.connect(lg).connect(lp.frequency);
    // a dissonant high tone that swells in and out
    const hg = ac.createGain(); hg.gain.value = 0; this.osc("sine", 1979, hg); this.osc("sine", 1987, hg); hg.connect(this.send);
    const hl = this.osc("sine", 0.031); const hlg = ac.createGain(); hlg.gain.value = 0.006; hl.connect(hlg).connect(hg.gain);
    // air: rumble, room tone, thin hiss
    this.loop(this.noise(8, true), [["lowpass", 260, 0.7]], 0.32);
    this.loop(this.noise(6, false), [["bandpass", 420, 1.1]], 0.04);
    this.loop(this.noise(4, false), [["bandpass", 5200, 0.7]], 0.006);
    // the buzz of the nearest dying tube
    this.buzzPan = this.panner(0, HT, 0, 1.5);
    const bf = ac.createBiquadFilter(); bf.type = "bandpass"; bf.frequency.value = 900; bf.Q.value = 1.4;
    this.buzz = ac.createGain(); this.buzz.gain.value = 0;
    this.osc("sawtooth", 100, bf); this.osc("square", 120, bf); bf.connect(this.buzz).connect(this.buzzPan);
    this.beat = ac.createGain(); this.beat.connect(this.bus);
    const now = ac.currentTime;
    this.next = { event: now + 4, music: now + 30, drip: now + 1, voice: now + 12, cry: now + 22, zone: now + 6, gliss: now + 25, boom: now + 40, pad: now, scream: now + 70 };
    this.startScore();
    for (const name of CLIPS) {
      fetch(`/echo/sfx/${name}.mp3`).then((r) => r.arrayBuffer()).then((b) => ac.decodeAudioData(b)).then((b) => { this.buf[name] = b; }).catch(() => {});
    }
  }

  stop() {
    for (const n of this.nodes) { try { n.stop(); } catch { /* already stopped */ } }
    for (const t of this.timers) clearTimeout(t);
    try { this.bus?.disconnect(); } catch { /* gone */ }
    this.nodes = [];
  }

  /** Every frame. `sources` are the level's light sources (for the tube buzz); `torch` is my torch. */
  update(ears: Ears, torch: boolean, sources: LightSource[], t: number, quiet: boolean, danger = 0) {
    if (!this.started) return;
    const ac = this.ctx, now = ac.currentTime;
    this.bus.gain.setTargetAtTime(quiet ? 0.15 : 1, now, 0.3);
    // the nearest tube that is on buzzes, and crackles when it flickers
    let best: LightSource | null = null, bd = 1e9;
    for (const s of sources) if (s.kind === "fluoro") { const d = Math.hypot(s.pos.x - ears.x, s.pos.z - ears.z); if (d < bd) { bd = d; best = s; } }
    if (best) {
      this.place(this.buzzPan, best.pos.x, best.pos.y, best.pos.z);
      this.buzz.gain.setTargetAtTime(best.cur > 0 ? 0.09 : 0, now, 0.01);
      if (best.toggled && t - best.toggled < 0.05 && best.cur > 0) this.thud(this.buzzPan, now, 900, 0.05);
    }
    // heartbeat in the dark
    // heartbeat in the dark, and racing while something runs at you
    this.heart += (Math.max(torch ? 0 : 0.7, danger) - this.heart) * (danger > this.heart ? 0.12 : 0.02);
    const bpm = 62 + this.heart * 70;
    if (this.heart > 0.05 && now - this.lastBeat > 60 / bpm) {
      this.lastBeat = now;
      this.tone("triangle", 88, this.beat, now, 0.55 * this.heart, 0.16);
      this.tone("triangle", 76, this.beat, now + 0.22, 0.4 * this.heart, 0.18);
    }
    this.danger = danger;
    this.score(now, danger, torch);
    if (quiet) return;
    // the nearest place that is never quiet
    if (now > this.next.zone) {
      const z = ZONES.map((q) => ({ q, d: Math.hypot(q.x - ears.x, q.z - ears.z) })).filter((o) => o.d < o.q.r).sort((a, b) => a.d - b.d)[0];
      this.next.zone = now + (z ? 5 + Math.random() * 8 : 3);
      if (z) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 3;
        const p = this.panner(z.q.x + Math.cos(a) * r, z.q.kind === "child" ? 0.9 : 0.6, z.q.z + Math.sin(a) * r, 2.2);
        if (z.q.kind === "child") { if (Math.random() < 0.35) this.clip("cry", p, 1.2, 0.95 + Math.random() * 0.15); else this.childCry(p); }
        else if (z.q.kind === "moan") this.moan(p);
        else { this.staticBurst(p); if (Math.random() < 0.5) this.timers.push(window.setTimeout(() => this.clip("v_look_radio", p, 1.6, 0.9), 600)); }
        this.timers.push(window.setTimeout(() => { try { p.disconnect(); } catch { /* gone */ } }, 9000));
      }
    }
    // far away, someone screams
    if (now > this.next.scream) {
      this.next.scream = now + 55 + Math.random() * 70;
      const a = Math.random() * Math.PI * 2, far = 22 + Math.random() * 14;
      const p = this.panner(ears.x + Math.cos(a) * far, 1.4, ears.z + Math.sin(a) * far, 4);
      this.scream(p);
    }
    if (now > this.next.drip) { this.next.drip = now + 0.8 + Math.random() * 3; this.drip(ears); }
    if (now > this.next.music) { this.next.music = now + 45 + Math.random() * 40; this.musicBox(); }
    if (now > this.next.voice) { this.next.voice = now + 18 + Math.random() * 20; this.voiceEvent(ears); }
    if (now > this.next.cry) {
      this.next.cry = now + 35 + Math.random() * 30;
      const far = CRY_SPOTS.filter((q) => Math.hypot(q[0] - ears.x, q[1] - ears.z) > 9);
      const q = far[Math.floor(Math.random() * far.length)];
      if (q) { const p = this.panner(q[0], 1.0, q[1], 3); if (Math.random() < 0.5) this.clip("cry", p, 1.4, 0.92 + Math.random() * 0.12); else this.childCry(p); }
    }
    if (now > this.next.event) {
      this.next.event = now + 6 + Math.random() * 10;
      const a = Math.random() * Math.PI * 2, far = 7 + Math.random() * 12;
      const p = this.panner(ears.x + Math.cos(a) * far, 1.2, ears.z + Math.sin(a) * far, 2.5);
      const r = Math.random();
      if (r < 0.2) this.knocks(p); else if (r < 0.34) this.groan(p); else if (r < 0.44) this.moan(p); else if (r < 0.58) this.squeak(p); else if (r < 0.7) this.slam(p);
      else if (r < 0.82) this.staticBurst(this.panner(RADIO.x, RADIO.y, RADIO.z, 2));
      else { const b = ears.yaw; this.breath(this.panner(ears.x + Math.sin(b) * 1.6, 1.55, ears.z + Math.cos(b) * 1.6, 1)); } // right behind you
    }
  }

  /** Goal sounds: a fuse picked up / dropped / installed, the power coming back, the end. */
  sfx(kind: "pickup" | "drop" | "install" | "power" | "win" | "lose" | "call" | "lift" | "reveal" | "powerdown") {
    if (!this.started) return;
    const ac = this.ctx, t0 = ac.currentTime, out = this.bus;
    if (kind === "pickup") { this.tone("triangle", 880, out, t0, 0.12, 0.12); this.tone("triangle", 1320, out, t0 + 0.08, 0.1, 0.2); }
    if (kind === "drop") { this.thud(out, t0, 300, 0.25); this.tone("sine", 2400, out, t0 + 0.02, 0.05, 0.3); }
    if (kind === "install") { this.thud(out, t0, 90, 0.7); this.burst(out, t0 + 0.05, 0.3, "bandpass", 2500, 2, 0.15); this.tone("sawtooth", 60, out, t0 + 0.1, 0.06, 1.2); }
    if (kind === "power") {
      this.thud(out, t0, 45, 1); const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(40, t0); o.frequency.exponentialRampToValueAtTime(120, t0 + 3);
      const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 700; const g = ac.createGain(); this.env(g, t0, 1.5, 0.25, 2.5); o.connect(f).connect(g).connect(out); o.connect(f); g.connect(this.send); o.start(t0); o.stop(t0 + 4.2);
      for (let i = 0; i < 2; i++) this.tone("sine", 1318.5, out, t0 + 3 + i * 0.35, 0.12, 1.4); // the lift bell
    }
    if (kind === "call") { this.tone("square", 660, out, t0, 0.05, 0.12); this.thud(out, t0 + 0.4, 50, 0.6); this.tone("sawtooth", 48, out, t0 + 0.4, 0.07, 6); } // the button, then the motor far above
    if (kind === "powerdown") {
      // the hum winds down, a relay clunks, far away something answers in the dark
      const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(100, t0); o.frequency.exponentialRampToValueAtTime(28, t0 + 1.4);
      const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 500; const g = ac.createGain(); this.env(g, t0, 0.02, 0.16, 1.4); o.connect(f).connect(g).connect(out); o.start(t0); o.stop(t0 + 1.6);
      this.thud(out, t0 + 0.05, 55, 0.7);
      this.burst(out, t0 + 0.03, 0.08, "highpass", 3000, 1, 0.25);
    }
    if (kind === "lift") { this.thud(out, t0, 60, 0.9); for (let i = 0; i < 2; i++) this.tone("sine", 1318.5, out, t0 + 0.3 + i * 0.35, 0.14, 1.4); }
    if (kind === "reveal") {
      // a wet tearing and a scream, the lights blowing
      this.burst(out, t0, 0.5, "lowpass", 600, 1, 0.5, 0.01);
      this.burst(out, t0 + 0.05, 0.25, "bandpass", 3200, 3, 0.35);
      this.thud(out, t0 + 0.02, 38, 1);
      const o = this.ctx.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(900, t0); o.frequency.exponentialRampToValueAtTime(260, t0 + 0.9);
      const g = this.ctx.createGain(); this.env(g, t0, 0.02, 0.18, 0.9); o.connect(g).connect(out); o.start(t0); o.stop(t0 + 1.1);
    }
    if (kind === "win") { [523.3, 659.3, 784, 1046.5].forEach((f, i) => this.tone("triangle", f, out, t0 + i * 0.18, 0.12, 1.6)); }
    if (kind === "lose") { this.thud(out, t0, 40, 1); [220, 207.7, 196, 185].forEach((f, i) => this.tone("sawtooth", f, out, t0 + i * 0.5, 0.05, 1.2)); }
  }

  /** A fuse being prised out of its clips: metal scraping, from where it is. */
  scrape(x: number, y: number, z: number) {
    if (!this.started) return;
    const p = this.panner(x, y, z, 3), t0 = this.ctx.currentTime;
    for (let i = 0; i < 6; i++) {
      const at = t0 + i * 0.38 + Math.random() * 0.1;
      this.burst(p, at, 0.22, "bandpass", 2600 + Math.random() * 1800, 6, 0.22, 0.02);
      this.tone("square", 180 + Math.random() * 90, p, at, 0.03, 0.18);
    }
    this.burst(p, t0 + 2.3, 0.1, "highpass", 4000, 1, 0.3);
    this.timers.push(window.setTimeout(() => { try { p.disconnect(); } catch { /* gone */ } }, 3500));
  }

  /** A gunshot from (x, y, z): the crack, the slap back off the tiles, and (close by) the ringing in your ears. */
  gunshot(x: number, y: number, z: number, d: number) {
    if (!this.started) return;
    const ac = this.ctx, t0 = ac.currentTime, p = this.panner(x, y, z, 6);
    const near = Math.max(0, 1 - d / 40);
    this.burst(p, t0, 0.09, "highpass", 1800, 0.7, 1.4 * (0.3 + near), 0.0008);
    this.burst(p, t0, 0.35, "lowpass", 900, 0.8, 1.1 * (0.3 + near), 0.001);
    this.thud(p, t0, 48, 1);
    const s = ac.createGain(); s.gain.value = 1.4; p.connect(s).connect(this.send);
    if (d < 7) { const o = ac.createOscillator(); o.frequency.value = 3900 + Math.random() * 300; const g = ac.createGain(); this.env(g, t0 + 0.05, 0.05, 0.035 * (1 - d / 7), 4); o.connect(g).connect(this.out); o.start(t0); o.stop(t0 + 4.3); }
    this.timers.push(window.setTimeout(() => { try { p.disconnect(); } catch { /* gone */ } }, 6000));
  }
  /** A bullet hitting something soft. */
  impact(x: number, y: number, z: number) { if (!this.started) return; const p = this.panner(x, y, z, 2), t0 = this.ctx.currentTime; this.burst(p, t0, 0.12, "lowpass", 500, 1, 0.9, 0.002); this.thud(p, t0, 80, 0.6); }
  /** A locker door: shut quietly, or torn open. */
  locker(x: number, z: number, hard: boolean) {
    if (!this.started) return;
    const p = this.panner(x, 1.2, z, hard ? 4 : 1.5), t0 = this.ctx.currentTime;
    for (const [f, a] of [[318, 1], [547, 0.6], [893, 0.45], [1311, 0.3], [2033, 0.2]]) this.tone("triangle", f * (hard ? 0.9 : 1), p, t0, (hard ? 0.18 : 0.05) * a, hard ? 1.6 : 0.5);
    this.thud(p, t0, hard ? 60 : 120, hard ? 1 : 0.25);
    if (hard) this.burst(p, t0, 0.6, "bandpass", 2600, 2, 0.3, 0.004);
    this.timers.push(window.setTimeout(() => { try { p.disconnect(); } catch { /* gone */ } }, 3000));
  }

  // ── the score: a cluster that never resolves, strings scraping, something huge falling far below ──
  private startScore() {
    const ac = this.ctx;
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900; lp.Q.value = 0.7;
    this.padGain = ac.createGain(); this.padGain.gain.value = 0; lp.connect(this.padGain); this.padGain.connect(this.bus); this.padGain.connect(this.send);
    for (const f of [73.4, 77.8, 103.8, 146.8, 155.6]) for (const det of [-7, 6]) { const o = this.osc("sawtooth", f, lp); o.detune.value = det; this.padOsc.push(o); }
    // the high strings: a minor second that sits on your nerves
    const hp = ac.createBiquadFilter(); hp.type = "bandpass"; hp.frequency.value = 1300; hp.Q.value = 1.2;
    this.highGain = ac.createGain(); this.highGain.gain.value = 0; hp.connect(this.highGain); this.highGain.connect(this.send); this.highGain.connect(this.bus);
    for (const f of [1174.7, 1244.5, 1661.2]) { const o = this.osc("sawtooth", f, hp); const v = this.osc("sine", 5.3 + Math.random()); const vg = ac.createGain(); vg.gain.value = 6; v.connect(vg).connect(o.frequency); }
  }
  private score(now: number, danger: number, torch: boolean) {
    if (!this.padGain) return;
    if (now > this.next.pad) {
      // swells in and out; the chord slides somewhere worse
      this.next.pad = now + 7 + Math.random() * 9;
      const lvl = (0.012 + Math.random() * 0.03) * (1 + danger * 2.5) * (torch ? 1 : 1.4);
      this.padGain.gain.setTargetAtTime(lvl, now, 2.5);
      const k = [1, 0.944, 1.059, 0.891, 1.122][Math.floor(Math.random() * 5)];
      this.padOsc.forEach((o, i) => o.frequency.setTargetAtTime([73.4, 77.8, 103.8, 146.8, 155.6][Math.floor(i / 2)] * k, now, 4));
    }
    this.highGain.gain.setTargetAtTime(danger > 0.25 ? 0.012 + danger * 0.03 : 0.0015 + 0.002 * Math.max(0, Math.sin(now * 0.07)), now, danger > 0.25 ? 0.15 : 3);
    if (now > this.next.gliss) {
      this.next.gliss = now + 22 + Math.random() * 30;
      // a violin bow dragged across one string, too slowly
      const ac = this.ctx, o = ac.createOscillator(); o.type = "sawtooth"; const up = Math.random() < 0.5;
      o.frequency.setValueAtTime(up ? 900 : 2100, now); o.frequency.exponentialRampToValueAtTime(up ? 2300 : 700, now + 4);
      const v = ac.createOscillator(); v.frequency.value = 6.5; const vg = ac.createGain(); vg.gain.value = 18; v.connect(vg).connect(o.frequency);
      const f = ac.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1800; f.Q.value = 2.5;
      const g = ac.createGain(); this.env(g, now, 1.6, 0.03, 3.2); o.connect(f).connect(g); g.connect(this.send); g.connect(this.bus);
      o.start(now); v.start(now); o.stop(now + 5); v.stop(now + 5);
    }
    if (now > this.next.boom) {
      this.next.boom = now + 45 + Math.random() * 45;
      // a swell of air rushing in... then something enormous hits the floor far below
      this.burst(this.send, now, 2.8, "lowpass", 1400, 0.5, 0.14, 2.6);
      this.thud(this.send, now + 2.9, 32, 1); this.thud(this.bus, now + 2.9, 32, 0.6);
    }
  }

  /** A synthetic voice: a buzzing source shaped by vowel formants, its pitch drawn along a contour. */
  private voice(p: AudioNode, t0: number, dur: number, f0: number, contour: [number, number][], formants: [number, number, number][], peak: number, opts: { vib?: number; breath?: number; rough?: number; attack?: number } = {}) {
    const ac = this.ctx;
    const o = ac.createOscillator(); o.type = "sawtooth";
    o.frequency.setValueAtTime(f0 * contour[0][1], t0);
    for (const [k, m] of contour.slice(1)) o.frequency.linearRampToValueAtTime(f0 * m, t0 + k * dur);
    const v = ac.createOscillator(); v.frequency.value = 5 + Math.random() * 2.5; const vg = ac.createGain(); vg.gain.value = f0 * (opts.vib ?? 0.025); v.connect(vg).connect(o.frequency);
    const j = ac.createOscillator(); j.frequency.value = 13 + Math.random() * 5; const jg = ac.createGain(); jg.gain.value = f0 * 0.012; j.connect(jg).connect(o.frequency);
    const env = ac.createGain(); this.env(env, t0, opts.attack ?? Math.min(0.25, dur * 0.2), peak, dur);
    let src: AudioNode = o;
    if (opts.rough) { const ws = ac.createWaveShaper(); const n = 512, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; c[i] = Math.tanh(x * (1 + opts.rough * 6)); } ws.curve = c; o.connect(ws); src = ws; }
    for (const [f, q, gn] of formants) { const b = ac.createBiquadFilter(); b.type = "bandpass"; b.frequency.value = f; b.Q.value = q; const g = ac.createGain(); g.gain.value = gn; src.connect(b).connect(g).connect(env); }
    if (opts.breath) { const n = ac.createBufferSource(); n.buffer = this.noise(Math.ceil(dur + 1), false); const b = ac.createBiquadFilter(); b.type = "bandpass"; b.frequency.value = formants[1][0]; b.Q.value = 1.5; const g = ac.createGain(); g.gain.value = opts.breath; n.connect(b).connect(g).connect(env); n.start(t0); n.stop(t0 + dur + 0.6); }
    env.connect(p);
    o.start(t0); v.start(t0); j.start(t0); const end = t0 + dur + 0.5; o.stop(end); v.stop(end); j.stop(end);
  }
  /** A small child sobbing: wails that rise and break, gasps in between. */
  private childCry(p: AudioNode) {
    const t0 = this.ctx.currentTime; let t = t0;
    const f0 = 430 + Math.random() * 120, n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const d = 0.55 + Math.random() * 0.9;
      this.voice(p, t, d, f0 * (1 + (Math.random() - 0.5) * 0.1), [[0, 0.85], [0.2, 1.18], [0.6, 1.05], [1, 0.72]], [[1100, 6, 1.2], [1900, 8, 0.7], [3300, 9, 0.35]], 0.22, { vib: 0.04, breath: 0.25, rough: 0.35, attack: 0.06 });
      t += d + 0.05;
      // the catch of breath
      this.burst(p, t, 0.22, "bandpass", 2400, 1.5, 0.06, 0.12);
      t += 0.28 + Math.random() * 0.35;
    }
  }
  /** Someone in pain: a long low groan that swells, catches, and fades. */
  private moan(p: AudioNode) {
    const t0 = this.ctx.currentTime, female = Math.random() < 0.4, f0 = female ? 190 + Math.random() * 40 : 98 + Math.random() * 30;
    const d = 1.6 + Math.random() * 1.8;
    const vowel: [number, number, number][] = Math.random() < 0.5 ? [[480, 7, 1.3], [820, 8, 0.7], [2600, 8, 0.15]] : [[640, 7, 1.2], [1100, 8, 0.6], [2500, 8, 0.15]];
    this.voice(p, t0, d, f0, [[0, 0.95], [0.3, 1.1], [0.55, 1.02], [0.7, 1.16], [1, 0.82]], vowel, 0.35, { vib: 0.03, breath: 0.35, rough: 0.25, attack: 0.5 });
    if (Math.random() < 0.5) this.voice(p, t0 + d + 0.6, d * 0.6, f0 * 1.1, [[0, 1], [0.4, 1.25], [1, 0.9]], vowel, 0.25, { vib: 0.05, breath: 0.4, rough: 0.4, attack: 0.15 });
  }
  /** A scream, far off. */
  private scream(p: AudioNode) {
    const t0 = this.ctx.currentTime, f0 = 620 + Math.random() * 260, d = 0.9 + Math.random() * 0.8;
    this.voice(p, t0, d, f0, [[0, 0.8], [0.12, 1.12], [0.7, 1.0], [1, 0.62]], [[950, 5, 1.2], [1550, 6, 0.8], [2900, 7, 0.4]], 0.5, { vib: 0.05, breath: 0.4, rough: 0.8, attack: 0.03 });
    this.timers.push(window.setTimeout(() => { try { (p as PannerNode).disconnect(); } catch { /* gone */ } }, 4000));
  }

  // ── building blocks ──
  private ir(sec: number) { const ac = this.ctx, n = Math.floor(ac.sampleRate * sec), b = ac.createBuffer(2, n, ac.sampleRate); for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2); } return b; }
  private noise(sec: number, brown: boolean) {
    const key = `${sec}:${brown}`; const hit = this.noiseCache.get(key); if (hit) return hit;
    const ac = this.ctx, n = Math.floor(ac.sampleRate * sec), b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0); let l = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; if (brown) { l = (l + 0.02 * w) / 1.02; d[i] = l * 3.5; } else d[i] = w; }
    this.noiseCache.set(key, b); return b;
  }
  private osc(type: OscillatorType, f: number, to?: AudioNode) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; if (to) o.connect(to); o.start(); this.nodes.push(o); return o; }
  private loop(buf: AudioBuffer, filters: [BiquadFilterType, number, number][], gain: number) {
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; let n: AudioNode = s;
    for (const [type, f, q] of filters) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; n.connect(b); n = b; }
    const g = this.ctx.createGain(); g.gain.value = gain; n.connect(g).connect(this.bus); s.start(); this.nodes.push(s);
  }
  private panner(x: number, y: number, z: number, ref = 2) {
    const p = this.ctx.createPanner(); p.panningModel = "HRTF"; p.distanceModel = "inverse"; p.refDistance = ref * 1.6; p.rolloffFactor = 1; p.maxDistance = 60;
    this.place(p, x, y, z); p.connect(this.bus); const s = this.ctx.createGain(); s.gain.value = 0.6; p.connect(s).connect(this.send); return p;
  }
  private place(p: PannerNode, x: number, y: number, z: number) {
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else (p as unknown as { setPosition: (a: number, b: number, c: number) => void }).setPosition(x, y, z);
  }
  private env(g: GainNode, t0: number, a: number, peak: number, d: number) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); }
  private tone(type: OscillatorType, f: number, to: AudioNode, t0: number, peak: number, d: number) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; const g = this.ctx.createGain(); this.env(g, t0, 0.01, peak, d); o.connect(g).connect(to); o.start(t0); o.stop(t0 + d + 0.1); }
  private burst(p: AudioNode, t0: number, d: number, type: BiquadFilterType, f: number, q: number, peak: number, a = 0.003) { const n = this.ctx.createBufferSource(); n.buffer = this.noise(Math.max(0.1, Math.ceil(d * 10) / 10), false); const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; const g = this.ctx.createGain(); this.env(g, t0, a, peak, d); n.connect(b).connect(g).connect(p); n.start(t0); n.stop(t0 + a + d + 0.05); }
  private clip(name: Clip, p: AudioNode, gain = 1, rate = 1) { const b = this.buf[name]; if (!b) return; const s = this.ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate; const g = this.ctx.createGain(); g.gain.value = gain; s.connect(g).connect(p); s.start(); }
  private thud(p: AudioNode, t0: number, f = 70, v = 0.5) {
    const o = this.ctx.createOscillator(); o.frequency.setValueAtTime(f * 1.6, t0); o.frequency.exponentialRampToValueAtTime(f, t0 + 0.05);
    const g = this.ctx.createGain(); this.env(g, t0, 0.004, v, 0.35); const l = this.ctx.createBiquadFilter(); l.type = "lowpass"; l.frequency.value = 600;
    o.connect(l).connect(g).connect(p); o.start(t0); o.stop(t0 + 0.5); this.burst(p, t0, 0.06, "bandpass", 1400, 1, v * 0.3, 0.002);
  }
  private knocks(p: AudioNode) { const t0 = this.ctx.currentTime; const n = 2 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) this.thud(p, t0 + i * (0.28 + Math.random() * 0.12), 110, 0.55); }
  private groan(p: AudioNode) {
    const ac = this.ctx, t0 = ac.currentTime, d = 2.5 + Math.random() * 2;
    const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(90 + Math.random() * 40, t0); o.frequency.linearRampToValueAtTime(60 + Math.random() * 20, t0 + d);
    const f = ac.createBiquadFilter(); f.type = "bandpass"; f.frequency.setValueAtTime(500, t0); f.frequency.linearRampToValueAtTime(220, t0 + d); f.Q.value = 9;
    const g = ac.createGain(); this.env(g, t0, d * 0.4, 0.6, d * 0.6); o.connect(f).connect(g).connect(p); o.start(t0); o.stop(t0 + d + 0.1);
  }
  private squeak(p: AudioNode) { const ac = this.ctx, t0 = ac.currentTime; for (let i = 0; i < 5; i++) { const s0 = t0 + i * 0.42 + Math.random() * 0.08; const o = ac.createOscillator(); o.frequency.setValueAtTime(1900 + Math.random() * 500, s0); o.frequency.linearRampToValueAtTime(2300, s0 + 0.12); const g = ac.createGain(); this.env(g, s0, 0.02, 0.05, 0.12); o.connect(g).connect(p); o.start(s0); o.stop(s0 + 0.2); } }
  private slam(p: AudioNode) { const t0 = this.ctx.currentTime; this.thud(p, t0, 70, 0.95); this.burst(p, t0 + 0.04, 0.5, "bandpass", 3000, 3, 0.14, 0.005); }
  private staticBurst(p: AudioNode) {
    const ac = this.ctx, t0 = ac.currentTime, d = 0.8 + Math.random() * 1.4;
    const n = ac.createBufferSource(); n.buffer = this.noise(2.4, false); const f = ac.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1800; f.Q.value = 0.8;
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t0); for (let k = 0; k < 14; k++) g.gain.setValueAtTime(Math.random() < 0.6 ? 0.1 + Math.random() * 0.12 : 0.003, t0 + (k * d) / 14); g.gain.setValueAtTime(0.0001, t0 + d);
    n.connect(f).connect(g).connect(p); n.start(t0); n.stop(t0 + d + 0.05);
  }
  private breath(p: AudioNode) { const t0 = this.ctx.currentTime; for (let i = 0; i < 2; i++) this.burst(p, t0 + i * 1.7, 0.8, "bandpass", i ? 700 : 1100, 1.2, 0.09, 0.5); }
  private drip(ears: Ears) { const ac = this.ctx, t0 = ac.currentTime, a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 10; const p = this.panner(ears.x + Math.cos(a) * r, 0.2, ears.z + Math.sin(a) * r, 1); const o = ac.createOscillator(); o.frequency.setValueAtTime(1600 + Math.random() * 1600, t0); o.frequency.exponentialRampToValueAtTime(600, t0 + 0.08); const g = ac.createGain(); this.env(g, t0, 0.003, 0.18, 0.15); o.connect(g).connect(p); o.start(t0); o.stop(t0 + 0.25); }
  private musicBox() {
    const ac = this.ctx, p = this.panner(13 * T, 1.0, 3 * T, 1.5); let tt = ac.currentTime;
    TUNE.forEach((m, i) => { const f = 440 * Math.pow(2, (m - 69) / 12) * (1 + (Math.random() - 0.5) * 0.012); this.tone("triangle", f, p, tt, 0.11, 1.6); this.tone("sine", f * 2.01, p, tt, 0.03, 1.2); tt += 0.42 + i * i * 0.004; });
  }
  private voiceEvent(ears: Ears) {
    if (!this.voiceOrder.length) this.voiceOrder = ["v_here", "v_look_radio", "v_hate", "v_earth", "whisper", "v_here", "v_earth"].sort(() => Math.random() - 0.5);
    const v = this.voiceOrder.pop()!;
    if (v === "whisper") { const b = ears.yaw; this.clip("v_look_whisper", this.panner(ears.x + Math.sin(b) * 1.4, 1.6, ears.z + Math.cos(b) * 1.4, 0.8), 1.3); return; }
    const d = Math.hypot(ears.x - RADIO.x, ears.z - RADIO.z), a = Math.random() * Math.PI * 2, far = 6 + Math.random() * 5;
    const p = d < 16 ? this.panner(RADIO.x, RADIO.y, RADIO.z, 2.5) : this.panner(ears.x + Math.cos(a) * far, 1.0, ears.z + Math.sin(a) * far, 2.5);
    this.staticBurst(p);
    this.timers.push(window.setTimeout(() => this.clip(v as Clip, p, 2.6), 700));
  }
}
