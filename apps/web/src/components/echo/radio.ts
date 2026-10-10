import { muDecode } from "@monumental/shared";
import type { BankClip } from "./voice";

/** A walkie-talkie sound: narrow band, a little crunch, static underneath, a squelch at both ends. */
export class RadioFx {
  readonly input: AudioNode;
  private staticGain: GainNode;
  private noise: AudioBuffer;
  private open = 0;

  constructor(private ctx: AudioContext, out: AudioNode) {
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 420;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2900;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(x * 3.2) / Math.tanh(3.2); }
    shaper.curve = curve;
    const g = ctx.createGain(); g.gain.value = 1.5;
    hp.connect(lp).connect(shaper).connect(g).connect(out);
    this.input = hp;
    const n = Math.floor(ctx.sampleRate * 2);
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    // a steady hiss whenever any channel is open
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2200; bp.Q.value = 0.6;
    this.staticGain = ctx.createGain(); this.staticGain.gain.value = 0;
    s.connect(bp).connect(this.staticGain).connect(out); s.start();
  }

  /** The click-and-hiss of a channel opening or closing. */
  squelch(open: boolean) {
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = open ? 2600 : 1800; bp.Q.value = 0.9;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + (open ? 0.12 : 0.2));
    s.connect(bp).connect(g).connect(this.input); s.start(t, Math.random()); s.stop(t + 0.3);
    this.open = Math.max(0, this.open + (open ? 1 : -1));
    this.staticGain.gain.setTargetAtTime(this.open > 0 ? 0.018 : 0, t, 0.05);
  }

  /** A burst of static with nobody on the channel (Theo's walkie, when something is close). */
  crackle(strength: number) {
    const c = this.ctx, t = c.currentTime;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const at = t + i * (0.06 + Math.random() * 0.09);
      const s = c.createBufferSource(); s.buffer = this.noise;
      const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1400 + Math.random() * 2200; bp.Q.value = 1.2;
      const g = c.createGain(); const len = 0.03 + Math.random() * 0.08;
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.12 * strength, at + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      s.connect(bp).connect(g).connect(this.input); s.start(at, Math.random()); s.stop(at + len + 0.02);
    }
  }

  /** Play voice pieces as if someone were talking on Channel 4. Returns how long it lasts (s). */
  play(clips: BankClip[]) {
    const c = this.ctx;
    let t = c.currentTime + 0.18;
    this.squelch(true);
    for (const clip of clips) {
      const pcm = muDecode(clip.bytes);
      const b = c.createBuffer(1, pcm.length, 16000);
      b.getChannelData(0).set(pcm);
      const s = c.createBufferSource(); s.buffer = b;
      const g = c.createGain(); g.gain.value = 1.3;
      s.connect(g).connect(this.input); s.start(t);
      t += b.duration + 0.1;
    }
    const dur = t - c.currentTime + 0.1;
    window.setTimeout(() => this.squelch(false), dur * 1000);
    return dur;
  }
}
