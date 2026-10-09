import { MIMIC } from "@monumental/shared";

export interface Piece {
  id: number;
  /** Mono, 16 kHz. */
  pcm: Float32Array;
  ms: number;
  peak: number;
  endedAt: number;
}

const RATE = MIMIC.RATE;
const FRAME = 320; // 20 ms at 16 kHz
const PRE_ROLL = 6; // frames kept from just before speech starts
const HANG = 13; // frames of quiet that end a piece (~260 ms)
const MIN_MS = 400;

// Forwards raw mic samples to the main thread in blocks of 2048.
const WORKLET = `
class EhCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) { this.buf[this.n++] = ch[i]; if (this.n === 2048) { this.port.postMessage(this.buf.slice(0)); this.n = 0; } }
    return true;
  }
}
registerProcessor("eh-capture", EhCapture);
`;

/**
 * Cuts my own speech into short pieces (0.4–3 s) at the pauses, on my device.
 * Nothing leaves this file except the finished pieces handed to `onPiece`.
 */
export class VoiceCapture {
  private node: AudioNode | null = null;
  private sink: GainNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private ratio: number;
  private carry = 0; // resampler position
  private frame = new Float32Array(FRAME);
  private fi = 0;
  private recent: Float32Array[] = [];
  private current: Float32Array[] | null = null;
  private quiet = 0;
  private loud = 0;
  private floor = 0.004;
  private nextId = 1;
  enabled = true;

  constructor(private ctx: AudioContext, private stream: MediaStream, private onPiece: (p: Piece) => void) {
    this.ratio = ctx.sampleRate / RATE;
  }

  async start() {
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0;
    this.sink.connect(this.ctx.destination);
    try {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const w = new AudioWorkletNode(this.ctx, "eh-capture");
      w.port.onmessage = (e) => this.push(e.data as Float32Array);
      this.node = w;
    } catch {
      // older browsers
      const sp = this.ctx.createScriptProcessor(2048, 1, 1);
      sp.onaudioprocess = (e) => this.push(e.inputBuffer.getChannelData(0).slice(0));
      this.node = sp;
    }
    this.src.connect(this.node).connect(this.sink);
  }

  /** Resample to 16 kHz and feed 20 ms frames to the voice detector. */
  private push(block: Float32Array) {
    let pos = this.carry;
    while (pos < block.length - 1) {
      const i = Math.floor(pos), f = pos - i;
      this.frame[this.fi++] = block[i] * (1 - f) + block[i + 1] * f;
      if (this.fi === FRAME) { this.onFrame(this.frame.slice(0)); this.fi = 0; }
      pos += this.ratio;
    }
    this.carry = pos - block.length;
    if (this.carry < 0) this.carry = 0;
  }

  private onFrame(f: Float32Array) {
    let sum = 0;
    for (const v of f) sum += v * v;
    const rms = Math.sqrt(sum / f.length);
    // the room's background noise level, slowly adapting
    if (!this.current) this.floor = rms < this.floor ? this.floor * 0.9 + rms * 0.1 : this.floor * 0.998 + rms * 0.002;
    const speaking = this.enabled && rms > Math.max(0.012, this.floor * 3.5);

    if (!this.current) {
      this.recent.push(f);
      if (this.recent.length > PRE_ROLL) this.recent.shift();
      this.loud = speaking ? this.loud + 1 : 0;
      if (this.loud >= 2) { this.current = [...this.recent]; this.recent = []; this.quiet = 0; }
      return;
    }
    this.current.push(f);
    this.quiet = speaking ? 0 : this.quiet + 1;
    const frames = this.current.length;
    if (this.quiet >= HANG || frames * 20 >= MIMIC.PIECE_MAX * 1000) this.finish();
  }

  private finish() {
    const frames = this.current!;
    this.current = null;
    this.loud = 0;
    // trim the trailing quiet, keep a short tail so it doesn't sound cut off
    const keep = Math.max(1, frames.length - Math.max(0, this.quiet - 4));
    const used = frames.slice(0, keep);
    const ms = used.length * 20;
    if (ms < MIN_MS) return;
    const pcm = new Float32Array(used.length * FRAME);
    used.forEach((fr, i) => pcm.set(fr, i * FRAME));
    let peak = 0;
    for (const v of pcm) peak = Math.max(peak, Math.abs(v));
    // gentle fade in/out against clicks
    const fade = 160;
    for (let i = 0; i < fade && i < pcm.length; i++) { pcm[i] *= i / fade; pcm[pcm.length - 1 - i] *= i / fade; }
    this.onPiece({ id: this.nextId++, pcm, ms, peak, endedAt: performance.now() });
  }

  stop() {
    try { this.src?.disconnect(); this.node?.disconnect(); this.sink?.disconnect(); } catch { /* already gone */ }
  }
}

type Rec = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };

/** Optional "smart mimic": the browser's speech-to-text labels my pieces (Chrome sends audio to Google for this). */
export class Transcriber {
  private rec: Rec | null = null;
  private stopped = false;

  static available() {
    return typeof window !== "undefined" && !!((window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);
  }

  start(lang: string, onText: (text: string) => void) {
    const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const C = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!C) return false;
    const rec = new C();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) onText(e.results[i][0].transcript);
    };
    rec.onend = () => { if (!this.stopped) { try { rec.start(); } catch { /* restarting too fast */ } } };
    rec.onerror = () => {};
    try { rec.start(); } catch { return false; }
    this.rec = rec;
    return true;
  }

  stop() { this.stopped = true; try { this.rec?.stop(); } catch { /* not running */ } }
}
