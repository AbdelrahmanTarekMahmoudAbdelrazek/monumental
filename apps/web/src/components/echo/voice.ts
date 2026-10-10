import { ECHO, echoWallsBetween, muEncode, type ClipTag } from "@monumental/shared";
import type { SoundBank } from "./sound";
import { RadioFx } from "./radio";

/** A voice piece held on this device (8-bit, 16 kHz). Never sent to the game server. */
export interface BankClip { bytes: Uint8Array; ms: number; tags: ClipTag[] }

/**
 * How a voice at `o` sounds from `me`: full volume within VOICE_NEAR, silent at VOICE_RANGE,
 * quieter and muffled through walls. Real voices and the mimic's copies both use this, so nothing gives the copy away.
 * Everything is also capped at 7 kHz — the band the copies are recorded in.
 */
export function voiceMix(me: { x: number; z: number }, o: { x: number; z: number }) {
  const d = Math.hypot(o.x - me.x, o.z - me.z);
  let v = d <= ECHO.VOICE_NEAR ? 1 : Math.max(0, 1 - (d - ECHO.VOICE_NEAR) / (ECHO.VOICE_RANGE - ECHO.VOICE_NEAR)) ** 1.6;
  const walls = d < ECHO.VOICE_RANGE ? echoWallsBetween(me.x, me.z, o.x, o.z) : 0;
  v *= walls === 0 ? 1 : walls === 1 ? 0.55 : 0.28;
  return { gain: v * 1.4, cutoff: walls === 0 ? 7000 : walls === 1 ? 1300 : 650 };
}

const CHUNK = 16 * 1024;

type Signal = { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit | null; ask?: boolean; gen?: number };
export type PeerStatus = "connecting" | "connected" | "failed";

interface Peer {
  n: number;
  pc: RTCPeerConnection;
  /** The player who joined first makes every offer; the other only ever answers. No collisions. */
  offerer: boolean;
  /** Chrome only routes a remote WebRTC stream into Web Audio if it is also attached to a (muted) media element. */
  sinks: HTMLAudioElement[];
  sources: MediaStreamAudioSourceNode[];
  filter: BiquadFilterNode;
  gain: GainNode;
  panner: PannerNode;
  /** Their voice on Channel 4 (open while they hold the talk button). */
  radio: GainNode;
  onAir: boolean;
  offeredAt: number;
  failedAt: number;
  /** Network candidates that arrived before the other side's description. */
  queued: RTCIceCandidateInit[];
  /** Direct channel for voice pieces. */
  dc: RTCDataChannel;
  incoming: { id: number; ms: number; tags: ClipTag[]; parts: Uint8Array[]; len: number } | null;
  /** Offer numbers: old or repeated offers are recognised. */
  gen: number;
  remoteGen: number;
}

function iceServers(): RTCIceServer[] {
  const list: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  const url = process.env.NEXT_PUBLIC_TURN_URL;
  if (url) list.push({ urls: url.split(","), username: process.env.NEXT_PUBLIC_TURN_USER, credential: process.env.NEXT_PUBLIC_TURN_PASS });
  return list;
}

/**
 * Proximity voice: one direct connection to each other player (max 3).
 * Each friend's voice comes from where they stand, fades out by VOICE_RANGE and is muffled by walls.
 */
export class Voice {
  private peers = new Map<number, Peer>();
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private level = new Uint8Array(256);
  private _muted = false;
  micError: string | null = null;
  /** Voice pieces on this device, key "<owner>:<id>". */
  readonly bank = new Map<string, BankClip>();
  /** Short trace of the connection set-up (debugging). */
  readonly log: string[] = [];
  private trace(m: string) { this.log.push(`${Math.round(performance.now())} ${m}`); if (this.log.length > 60) this.log.shift(); }
  /** A piece from someone else arrived (tell the server we hold it). */
  onClip: (key: string) => void = () => {};
  /** Someone's labels for one of their pieces changed. */
  onTags: (key: string, tags: ClipTag[]) => void = () => {};

  private watchdog: ReturnType<typeof setInterval>;

  /** Channel 4: every walkie in the building. */
  readonly radio: RadioFx;

  constructor(private sounds: SoundBank, private me: number, private send: (to: number, data: Signal) => void, private onStatus: () => void) {
    this.radio = new RadioFx(sounds.ctx, sounds.master);
    // an offer that got no answer is sent again; a dead connection is restarted
    this.watchdog = setInterval(() => {
      const now = performance.now();
      for (const p of this.peers.values()) {
        if (!p.offerer) continue;
        if (p.pc.signalingState === "have-local-offer" && p.pc.localDescription && now - p.offeredAt > 3000) {
          p.offeredAt = now;
          this.trace(`resend #${p.gen}`);
          this.send(p.n, { description: p.pc.localDescription.toJSON(), gen: p.gen });
        }
        const st = p.pc.connectionState;
        if (st === "failed" || st === "disconnected") {
          if (!p.failedAt) p.failedAt = now;
          else if (now - p.failedAt > 4000) { p.failedAt = 0; this.trace("ice restart"); p.pc.restartIce(); }
        } else p.failedAt = 0;
      }
    }, 1000);
  }

  /** Ask for the microphone (must follow a click). Works without one: you then only listen. */
  async startMic() {
    if (this.stream) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const src = this.sounds.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.sounds.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser); // meter only, never to the speakers
      for (const p of this.peers.values()) this.attachMic(p);
      this.micError = null;
      return true;
    } catch (e) {
      this.micError = (e as Error).name === "NotAllowedError" ? "Microphone blocked — allow it in the browser to talk" : "No microphone found — you can still listen";
      return false;
    }
  }

  get hasMic() { return !!this.stream; }
  get micStream() { return this.stream; }

  // ───────── voice pieces ─────────
  /** Keep one of my own pieces and send it straight to everyone connected. */
  shareMine(id: number, pcm: Float32Array, ms: number, tags: ClipTag[]) {
    const bytes = muEncode(pcm);
    this.store(`${this.me}:${id}`, { bytes, ms, tags });
    for (const p of this.peers.values()) this.sendClip(p, id, { bytes, ms, tags });
  }

  /** Better labels for one of my pieces. */
  tagMine(id: number, tags: ClipTag[]) {
    const c = this.bank.get(`${this.me}:${id}`);
    if (c) c.tags = [...new Set([...c.tags, ...tags])];
    const msg = JSON.stringify({ k: "tag", id, tags });
    for (const p of this.peers.values()) if (p.dc.readyState === "open") p.dc.send(msg);
  }

  private store(key: string, c: BankClip) {
    this.bank.set(key, c);
    if (this.bank.size > 240) this.bank.delete(this.bank.keys().next().value!);
  }

  private sendClip(p: Peer, id: number, c: BankClip) {
    if (p.dc.readyState !== "open") return;
    try {
      p.dc.send(JSON.stringify({ k: "clip", id, ms: c.ms, tags: c.tags, len: c.bytes.length }));
      for (let i = 0; i < c.bytes.length; i += CHUNK) p.dc.send(c.bytes.slice(i, i + CHUNK));
      p.dc.send(JSON.stringify({ k: "end", id }));
    } catch { /* channel closed mid-send */ }
  }

  private onData(p: Peer, data: string | ArrayBuffer) {
    if (typeof data !== "string") {
      if (p.incoming && p.incoming.len < 64000) { const b = new Uint8Array(data); p.incoming.parts.push(b); p.incoming.len += b.length; }
      return;
    }
    let m: { k: string; id: number; ms?: number; tags?: ClipTag[]; len?: number };
    try { m = JSON.parse(data); } catch { return; }
    if (m.k === "clip" && Number.isInteger(m.id) && (m.len ?? 0) <= 64000) p.incoming = { id: m.id, ms: Number(m.ms) || 0, tags: Array.isArray(m.tags) ? m.tags : [], parts: [], len: 0 };
    else if (m.k === "end" && p.incoming && p.incoming.id === m.id) {
      const inc = p.incoming;
      p.incoming = null;
      const bytes = new Uint8Array(inc.len);
      let o = 0;
      for (const part of inc.parts) { bytes.set(part, o); o += part.length; }
      const key = `${p.n}:${inc.id}`;
      this.store(key, { bytes, ms: inc.ms, tags: inc.tags });
      this.onClip(key);
    } else if (m.k === "tag" && Array.isArray(m.tags)) {
      const key = `${p.n}:${m.id}`;
      const c = this.bank.get(key);
      if (c) { c.tags = [...new Set([...c.tags, ...m.tags])]; this.onTags(key, c.tags); }
    }
  }
  get muted() { return this._muted; }
  setMuted(m: boolean) {
    this._muted = m;
    this.stream?.getAudioTracks().forEach((t) => { t.enabled = !m; });
  }

  /** 0…1 loudness of my own mic, for the meter. */
  micLevel() {
    if (!this.analyser || this._muted) return 0;
    this.analyser.getByteTimeDomainData(this.level);
    let peak = 0;
    for (const v of this.level) peak = Math.max(peak, Math.abs(v - 128));
    return Math.min(1, peak / 64);
  }

  statuses(): { n: number; status: PeerStatus }[] {
    return [...this.peers.values()].map((p) => {
      const s = p.pc.connectionState;
      return { n: p.n, status: s === "connected" ? "connected" : s === "failed" || s === "closed" ? "failed" : "connecting" };
    });
  }

  /** Keep one connection per other player in the room. */
  sync(others: number[]) {
    for (const n of others) if (!this.peers.has(n)) this.open(n);
    for (const n of [...this.peers.keys()]) if (!others.includes(n)) this.close(n);
  }

  private open(n: number) {
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    const ctx = this.sounds.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 7000;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const panner = this.sounds.panner();
    filter.connect(gain).connect(panner);
    const radio = ctx.createGain();
    radio.gain.value = 0;
    radio.connect(this.radio.input);
    const peer: Peer = { n, pc, offerer: this.me < n, filter, gain, panner, radio, onAir: false, sinks: [], sources: [], offeredAt: 0, failedAt: 0, queued: [], dc: pc.createDataChannel("clips", { negotiated: true, id: 5 }), incoming: null, gen: 0, remoteGen: -1 };
    this.peers.set(n, peer);
    peer.dc.binaryType = "arraybuffer";
    peer.dc.onmessage = (e) => this.onData(peer, e.data);
    // a friend who just connected gets my recent pieces too
    peer.dc.onopen = () => {
      const mine = [...this.bank.entries()].filter(([k]) => k.startsWith(`${this.me}:`)).slice(-40);
      for (const [k, c] of mine) this.sendClip(peer, Number(k.split(":")[1]), c);
    };

    pc.onnegotiationneeded = async () => {
      if (!peer.offerer) return; // the answering side never offers
      try {
        await pc.setLocalDescription();
        peer.offeredAt = performance.now();
        peer.gen++;
        this.trace(`out ${n} offer #${peer.gen}`);
        this.send(n, { description: pc.localDescription!.toJSON(), gen: peer.gen });
      } catch (e) { this.trace(`nego error ${(e as Error).message}`); }
    };
    pc.onicecandidate = (e) => this.send(n, { candidate: e.candidate ? e.candidate.toJSON() : null });
    pc.onconnectionstatechange = () => this.onStatus();
    pc.ontrack = (e) => {
      // a track can arrive on more than one transceiver; mix them all (silent ones add nothing)
      const stream = new MediaStream([e.track]);
      const sink = new Audio();
      sink.muted = true;
      sink.srcObject = stream;
      void sink.play().catch(() => {});
      peer.sinks.push(sink);
      const src = ctx.createMediaStreamSource(stream);
      src.connect(filter);
      src.connect(radio);
      peer.sources.push(src);
    };

    // one two-way audio line from the start: switching the mic on later needs no new offer
    if (peer.offerer) pc.addTransceiver("audio", { direction: "sendrecv" });
    this.attachMic(peer);
  }

  /** Put my mic on every audio line to this friend (no renegotiation needed). */
  private attachMic(p: Peer) {
    const track = this.stream?.getAudioTracks()[0] ?? null;
    if (!track) return;
    for (const t of p.pc.getTransceivers()) if (t.receiver.track?.kind === "audio" && t.sender.track !== track) void t.sender.replaceTrack(track).catch(() => {});
  }

  /** Voice set-up message from another player. */
  async signal(from: number, data: Signal) {
    this.trace(`in ${from} ${data.description ? data.description.type + " #" + (data.gen ?? "") : data.candidate ? "cand" : "end-cand"}`);
    let p = this.peers.get(from);
    if (!p) { this.open(from); p = this.peers.get(from)!; }
    const pc = p.pc;
    try {
      const d = data.description;
      if (d?.type === "offer" && !p.offerer) {
        const g = data.gen ?? 0;
        if (g < p.remoteGen) return; // an old offer
        if (g === p.remoteGen) {
          // the same offer again: they missed our answer
          if (pc.localDescription?.type === "answer") this.send(from, { description: pc.localDescription.toJSON() });
          return;
        }
        await pc.setRemoteDescription(d);
        p.remoteGen = g;
        for (const t of pc.getTransceivers()) if (t.receiver.track?.kind === "audio") t.direction = "sendrecv";
        this.attachMic(p);
        for (const c of p.queued.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        await pc.setLocalDescription();
        this.send(from, { description: pc.localDescription!.toJSON() });
      } else if (d?.type === "answer" && p.offerer) {
        if (pc.signalingState !== "have-local-offer") return; // a late copy
        await pc.setRemoteDescription(d);
        for (const c of p.queued.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      } else if (data.candidate !== undefined) {
        if (!pc.remoteDescription) { if (data.candidate && p.queued.length < 50) p.queued.push(data.candidate); return; }
        await pc.addIceCandidate(data.candidate ?? undefined).catch(() => {});
      }
    } catch (e) { this.trace(`error ${(e as Error).message}`); }
  }

  /**
   * Every frame: put each friend's voice where they stand.
   * Full volume within VOICE_NEAR, silent at VOICE_RANGE; each wall in between muffles it.
   */
  update(me: { x: number; z: number }, others: Map<number, { x: number; y: number; z: number }>) {
    const t = this.sounds.ctx.currentTime;
    for (const p of this.peers.values()) {
      const o = others.get(p.n);
      if (!o) { p.gain.gain.setTargetAtTime(0, t, 0.1); continue; }
      const mix = voiceMix(me, o);
      p.gain.gain.setTargetAtTime(mix.gain, t, 0.08);
      p.filter.frequency.setTargetAtTime(mix.cutoff, t, 0.1);
      this.sounds.place(p.panner, o.x, o.y + 1.5, o.z);
    }
  }

  /** A friend pressed or released their walkie's talk button. */
  setRadio(n: number, on: boolean) {
    const p = this.peers.get(n);
    if (!p || p.onAir === on) return;
    p.onAir = on;
    this.radio.squelch(on);
    p.radio.gain.setTargetAtTime(on ? 1 : 0, this.sounds.ctx.currentTime, 0.03);
  }

  private close(n: number) {
    const p = this.peers.get(n);
    if (!p) return;
    p.dc.close();
    p.pc.close();
    p.sources.forEach((x) => x.disconnect());
    p.sinks.forEach((x) => { x.srcObject = null; });
    p.panner.disconnect();
    p.radio.disconnect();
    if (p.onAir) this.radio.squelch(false);
    this.peers.delete(n);
    this.onStatus();
  }

  destroy() {
    clearInterval(this.watchdog);
    for (const n of [...this.peers.keys()]) this.close(n);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.bank.clear(); // voices are forgotten when you leave
  }
}
