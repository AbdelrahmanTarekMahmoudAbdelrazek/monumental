/** All game audio shares one AudioContext: footsteps, the building's hum, and (in voice.ts) friends' voices. */
export class SoundBank {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  private noise: AudioBuffer;
  private ambience: AudioNode[] = [];

  constructor() {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    const len = Math.floor(this.ctx.sampleRate * 0.4);
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  /** Must run inside a click / tap (browsers start audio paused). */
  async resume() { if (this.ctx.state !== "running") await this.ctx.resume().catch(() => {}); }

  /** A 3D sound position in the world. Distance fall-off is done by hand in `place`. */
  panner(out: AudioNode = this.master) {
    const p = this.ctx.createPanner();
    p.panningModel = "HRTF";
    p.distanceModel = "linear";
    p.refDistance = 1;
    p.maxDistance = 10000;
    p.rolloffFactor = 0;
    p.connect(out);
    return p;
  }

  place(p: PannerNode, x: number, y: number, z: number) {
    const t = this.ctx.currentTime;
    if (p.positionX) { p.positionX.setTargetAtTime(x, t, 0.03); p.positionY.setTargetAtTime(y, t, 0.03); p.positionZ.setTargetAtTime(z, t, 0.03); }
    else (p as unknown as { setPosition: (a: number, b: number, c: number) => void }).setPosition(x, y, z);
  }

  /** Where my ears are and which way they face. */
  listener(x: number, y: number, z: number, yaw: number) {
    const l = this.ctx.listener;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(x, t, 0.02); l.positionY.setTargetAtTime(y, t, 0.02); l.positionZ.setTargetAtTime(z, t, 0.02);
      l.forwardX.setTargetAtTime(fx, t, 0.02); l.forwardY.setTargetAtTime(0, t, 0.02); l.forwardZ.setTargetAtTime(fz, t, 0.02);
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      const old = l as unknown as { setPosition: (a: number, b: number, c: number) => void; setOrientation: (a: number, b: number, c: number, d: number, e: number, f: number) => void };
      old.setPosition(x, y, z);
      old.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  /** One footstep on linoleum. `out` is a panner for other players, the master for me. */
  step(volume: number, out: AudioNode = this.master, heavy = false) {
    const c = this.ctx;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = (heavy ? 260 : 420) + Math.random() * 200;
    bp.Q.value = 1.1;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2400;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + (heavy ? 0.16 : 0.11));
    src.connect(bp).connect(lp).connect(g).connect(out);
    src.start(t, Math.random() * 0.2, 0.2);
    // a low thump under the click
    const o = c.createOscillator();
    o.frequency.setValueAtTime(heavy ? 90 : 120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.08);
    const og = c.createGain();
    og.gain.setValueAtTime(volume * 0.5, t);
    og.gain.exponentialRampToValueAtTime(0.0008, t + 0.09);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.1);
  }

  /** Torch switch click. */
  click() {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = "square";
    o.frequency.value = 1800;
    const g = c.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.03);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.04);
  }

  /** The building: a low electrical hum, air in the vents, now and then a distant creak. */
  startAmbience() {
    if (this.ambience.length) return;
    const c = this.ctx;
    const bus = c.createGain();
    bus.gain.value = 0.0;
    bus.gain.linearRampToValueAtTime(0.5, c.currentTime + 3);
    bus.connect(this.master);
    for (const [f, v] of [[50, 0.05], [100, 0.025], [150.5, 0.01]] as const) {
      const o = c.createOscillator();
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.value = v;
      o.connect(g).connect(bus);
      o.start();
      this.ambience.push(o);
    }
    const air = c.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 380;
    const ag = c.createGain();
    ag.gain.value = 0.05;
    air.connect(lp).connect(ag).connect(bus);
    air.start();
    this.ambience.push(air, bus);
  }

  /** A far-off creak or knock, played at a random spot in the building. */
  distantNoise(out: AudioNode) {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = "sawtooth";
    const f = 60 + Math.random() * 90;
    o.frequency.setValueAtTime(f, t);
    o.frequency.linearRampToValueAtTime(f * (0.7 + Math.random() * 0.6), t + 0.9);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 500;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 1.1);
    o.connect(lp).connect(g).connect(out);
    o.start(t);
    o.stop(t + 1.2);
  }

  /** Sudden hit when something grabs you. */
  sting() {
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const g = c.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(4000, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + 1.1);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(80, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 1.4);
    const og = c.createGain();
    og.gain.setValueAtTime(0.4, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 1.6);
  }

  /** A short human cry from someone being taken, played at their spot. */
  cry(out: AudioNode, volume: number) {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(420, t);
    o.frequency.linearRampToValueAtTime(700, t + 0.15);
    o.frequency.exponentialRampToValueAtTime(260, t + 0.9);
    const vib = c.createOscillator();
    vib.frequency.value = 7;
    const vg = c.createGain();
    vg.gain.value = 25;
    vib.connect(vg).connect(o.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1);
    o.connect(g).connect(out);
    o.start(t); vib.start(t);
    o.stop(t + 1.05); vib.stop(t + 1.05);
  }

  close() {
    for (const n of this.ambience) { try { (n as AudioScheduledSourceNode).stop?.(); } catch { /* already stopped */ } }
    void this.ctx.close().catch(() => {});
  }
}
