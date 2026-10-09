import * as THREE from "three";
import { muDecode, MIMIC } from "@monumental/shared";
import type { SoundBank } from "./sound";
import type { BankClip } from "./voice";

/** The thing in the dark: too tall, too thin, arms too long. Almost black, so only a torch shows it. */
export class MimicFigure {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private head: THREE.Group;
  private armL: THREE.Group;
  private armR: THREE.Group;
  private legL: THREE.Group;
  private legR: THREE.Group;
  private walk = 0;
  private lastX = 0;
  private lastZ = 0;
  private twitch = 0;
  speed = 0;

  constructor(shadows: boolean) {
    const skin = new THREE.MeshStandardMaterial({ color: 0x17140f, roughness: 0.95 });
    const face = new THREE.MeshStandardMaterial({ color: 0x5b5750, roughness: 0.8 });
    const eye = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0x2c2a24, roughness: 0.3 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.95, 4, 10), skin);
    torso.position.y = 1.62;
    torso.scale.set(1, 1, 0.75);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.28, 8), skin);
    neck.position.y = 2.25;

    this.head = new THREE.Group();
    this.head.position.y = 2.42;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), face);
    skull.scale.set(0.9, 1.3, 1);
    this.head.add(skull);
    for (const x of [-0.05, 0.05]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), eye);
      e.position.set(x, 0.03, -0.13);
      this.head.add(e);
    }
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.02), eye);
    mouth.position.set(0, -0.09, -0.14);
    this.head.add(mouth);

    const limb = (len: number, r: number, y: number, x: number) => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.6, len, 7), skin);
      m.position.y = -len / 2;
      g.add(m);
      // long fingers
      for (let i = -1; i <= 1; i++) {
        const f = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.005, 0.2, 4), skin);
        f.position.set(i * 0.02, -len - 0.09, 0);
        g.add(f);
      }
      g.position.set(x, y, 0);
      return g;
    };
    this.armL = limb(1.15, 0.045, 2.08, -0.22);
    this.armR = limb(1.15, 0.045, 2.08, 0.22);
    this.legL = limb(1.12, 0.06, 1.12, -0.1);
    this.legR = limb(1.12, 0.06, 1.12, 0.1);

    this.body.add(torso, neck, this.head, this.armL, this.armR, this.legL, this.legR);
    this.body.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = shadows; o.receiveShadow = shadows; } });
    this.root.add(this.body);
  }

  update(x: number, z: number, yaw: number, state: string, speaking: boolean, dt: number, t: number) {
    const moved = Math.hypot(x - this.lastX, z - this.lastZ);
    this.speed = this.speed * 0.8 + (dt > 0 ? moved / dt : 0) * 0.2;
    this.lastX = x; this.lastZ = z;
    this.walk += moved * 2.2;
    this.root.position.set(x, 0, z);
    this.root.rotation.y = yaw;
    const swing = Math.min(1, this.speed / 2) * 0.6;
    this.legL.rotation.x = Math.sin(this.walk) * swing;
    this.legR.rotation.x = -Math.sin(this.walk) * swing;
    this.armL.rotation.x = -Math.sin(this.walk) * swing * 0.6;
    this.armR.rotation.x = Math.sin(this.walk) * swing * 0.6;
    // hunched when it runs at you
    const hunch = state === "chase" ? 0.5 : state === "flee" ? 0.3 : 0.08;
    this.body.rotation.x += (-hunch - this.body.rotation.x) * Math.min(1, dt * 6);
    // a head that twitches, worse while it talks
    if (t > this.twitch) {
      this.twitch = t + (speaking ? 0.12 : 0.6 + Math.random() * 2);
      this.head.rotation.z = (Math.random() - 0.5) * (speaking ? 0.6 : 0.25);
      this.head.rotation.y = (Math.random() - 0.5) * 0.3;
    }
    this.body.position.y = Math.sin(t * 1.3) * 0.02;
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      (m.material as THREE.Material | undefined)?.dispose?.();
    });
  }
}

/** A mimic's sounds: the stolen voices (same 3D chain as real voices), its breathing, its shriek. */
export class MimicSound {
  readonly filter: BiquadFilterNode;
  readonly gain: GainNode;
  readonly panner: PannerNode;
  private breath: GainNode;
  private breathSrc: AudioBufferSourceNode;
  private lfo: OscillatorNode;
  private playing: AudioBufferSourceNode[] = [];

  constructor(private sounds: SoundBank) {
    const ctx = sounds.ctx;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 7000;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.panner = sounds.panner();
    this.filter.connect(this.gain).connect(this.panner);

    // slow, wet breathing: noise through a band filter, swelling in and out
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.breathSrc = ctx.createBufferSource();
    this.breathSrc.buffer = buf;
    this.breathSrc.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 520;
    bp.Q.value = 1.6;
    const swell = ctx.createGain();
    swell.gain.value = 0.5;
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 0.32;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 0.5;
    this.lfo.connect(lfoAmt).connect(swell.gain);
    this.breath = ctx.createGain();
    this.breath.gain.value = 0;
    this.breathSrc.connect(bp).connect(swell).connect(this.breath).connect(this.panner);
    this.breathSrc.start();
    this.lfo.start();
  }

  /** Play stolen pieces one after another, as if a friend said them. */
  say(clips: BankClip[]) {
    const ctx = this.sounds.ctx;
    let at = ctx.currentTime + 0.02;
    for (const c of clips) {
      const pcm = muDecode(c.bytes);
      const buf = ctx.createBuffer(1, pcm.length, MIMIC.RATE);
      buf.getChannelData(0).set(pcm);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.filter);
      src.start(at);
      at += buf.duration + 0.15;
      this.playing.push(src);
      src.onended = () => { this.playing = this.playing.filter((x) => x !== src); };
    }
  }

  /** Every frame: where it is, how loud its voice and breath are for me. */
  update(x: number, z: number, voiceGain: number, cutoff: number, distance: number, walls: number, chasing: boolean) {
    const t = this.sounds.ctx.currentTime;
    this.sounds.place(this.panner, x, 2.1, z);
    this.gain.gain.setTargetAtTime(voiceGain, t, 0.08);
    this.filter.frequency.setTargetAtTime(cutoff, t, 0.1);
    const near = Math.max(0, 1 - distance / (chasing ? 10 : 6)) * (walls === 0 ? 1 : 0.3);
    this.breath.gain.setTargetAtTime(near * (chasing ? 0.35 : 0.16), t, 0.2);
    this.lfo.frequency.setTargetAtTime(chasing ? 1.4 : 0.32, t, 0.3);
  }

  /** The scream when a torch catches it. */
  shriek() {
    const ctx = this.sounds.ctx, t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.5, t + 0.05);
    out.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    out.connect(this.panner);
    for (const f of [620, 910, 1330]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 2.2, t + 0.25);
      o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 1.5);
      const g = ctx.createGain();
      g.gain.value = 0.18;
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 1.7);
    }
  }

  dispose() {
    for (const s of this.playing) { try { s.stop(); } catch { /* done */ } }
    try { this.breathSrc.stop(); this.lfo.stop(); } catch { /* done */ }
    this.panner.disconnect();
  }
}
