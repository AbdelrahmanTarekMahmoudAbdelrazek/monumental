import { ECHO, MIMIC, echoPath, echoTileOf, echoWallsBetween, pcmEncode, type ClipTag } from "@monumental/shared";
import type { SoundBank } from "./sound";
import { RadioFx } from "./radio";

/** A voice piece held on this device (8-bit, 16 kHz). Never sent to the game server. */
export interface BankClip { bytes: Uint8Array; ms: number; tags: ClipTag[] }

/**
 * How a voice at `o` sounds from `me`: full volume within VOICE_NEAR, silent at VOICE_RANGE,
 * quieter and muffled through walls. Real voices and the mimic's copies both use this, so nothing gives the copy away.
 * Everything is also capped at 11 kHz — the band the copies are recorded in.
 */
export function voiceMix(me: { x: number; z: number }, o: { x: number; z: number }): { gain: number; cutoff: number; x: number; z: number } {
  const d = Math.hypot(o.x - me.x, o.z - me.z);
  const fall = (L: number) => (L <= ECHO.VOICE_NEAR ? 1 : Math.max(0, 1 - (L - ECHO.VOICE_NEAR) / (ECHO.VOICE_RANGE - ECHO.VOICE_NEAR)) ** 1.6);
  let v = fall(d);
  const walls = d < ECHO.VOICE_RANGE ? echoWallsBetween(me.x, me.z, o.x, o.z) : 0;
  v *= walls === 0 ? 1 : walls === 1 ? 0.55 : 0.28;
  const through = { gain: v * 1.4, cutoff: walls === 0 ? 11000 : walls === 1 ? 1300 : 650, x: o.x, z: o.z };
  if (walls === 0 || d > ECHO.VOICE_RANGE * 1.2) return through;
  // v36: sound also goes the long way round, through the doors. If that way is short enough it is louder and clearer
  // than through the wall, and it comes from the doorway you can see — "round the corner", like a real voice.
  const way = doorWay(me, o);
  if (!way || way.len > d * 1.8 || way.len >= ECHO.VOICE_RANGE) return through;
  const vd = fall(way.len) * 0.8 * Math.pow(0.85, Math.max(0, way.turns - 1));
  if (vd * 1.4 <= through.gain) return through;
  const dx = way.seeX - me.x, dz = way.seeZ - me.z, k = way.len / Math.max(0.01, Math.hypot(dx, dz));
  return { gain: vd * 1.4, cutoff: Math.max(1800, 4500 - 700 * (way.turns - 1)), x: me.x + dx * k, z: me.z + dz * k };
}

/** The walk between two points through doors: its length, how many corners, and the furthest point of it I can see. Cached per tile pair. */
const wayCache = new Map<number, [number, number][]>();
function doorWay(me: { x: number; z: number }, o: { x: number; z: number }) {
  const a: [number, number] = [echoTileOf(me.x), echoTileOf(me.z)], b: [number, number] = [echoTileOf(o.x), echoTileOf(o.z)];
  const key = ((a[1] * 64 + a[0]) * 4096) + b[1] * 64 + b[0];
  let tiles = wayCache.get(key);
  if (!tiles) { if (wayCache.size > 6000) wayCache.clear(); tiles = echoPath(a, b); wayCache.set(key, tiles); }
  if (!tiles.length) return null;
  const pts: { x: number; z: number }[] = [me, ...tiles.slice(0, -1).map(([tx, tz]) => ({ x: (tx + 0.5) * ECHO.TILE, z: (tz + 0.5) * ECHO.TILE })), o];
  let len = 0, turns = 0, see = pts[1];
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    if (i >= 2) { const ax = pts[i - 1].x - pts[i - 2].x, az = pts[i - 1].z - pts[i - 2].z, bx = pts[i].x - pts[i - 1].x, bz = pts[i].z - pts[i - 1].z; if (Math.abs(ax * bz - az * bx) > 1e-3) turns++; }
  }
  for (let i = 1; i < pts.length; i++) { if (echoWallsBetween(me.x, me.z, pts[i].x, pts[i].z) === 0) see = pts[i]; else break; }
  return { len, turns, seeX: see.x, seeZ: see.z };
}

const CHUNK = 16 * 1024;
/** A piece at most PIECE_MAX seconds of 16-bit audio, plus a little slack. */
const MAX_BYTES = Math.ceil(MIMIC.PIECE_MAX * MIMIC.RATE * 2) + 4096;

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
  /** v36: the echo send, and which room's echo it feeds. */
  send: GainNode;
  roomNow: ConvolverNode;
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

/** `?ehrelay` in the address: voice only through the relay (to check the relay works). */
const FORCE_RELAY = typeof window !== "undefined" && window.location.search.includes("ehrelay");

/** Fallback when the game server hasn't sent relay logins (yet): public STUN, plus a build-time TURN if one is set. */
function defaultIce(): RTCIceServer[] {
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

  /** Relay logins from the game server (null until they arrive). */
  private ice: RTCIceServer[] | null = null;
  private iceWait = performance.now() + 3000;
  private wanted: number[] | null = null;

  /** New relay logins: used for every connection from now on; stuck ones retry through the relay. */
  setIce(list: RTCIceServer[]) {
    if (!list.length) return;
    this.ice = list;
    if (this.wanted) this.sync(this.wanted);
    const relay = list.some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => u.startsWith("turn")));
    this.trace(`ice servers: ${list.length}${relay ? " (relay)" : ""}`);
    for (const p of this.peers.values()) {
      try {
        p.pc.setConfiguration({ ...p.pc.getConfiguration(), iceServers: list, iceTransportPolicy: FORCE_RELAY ? "relay" : "all" });
        if (relay && (p.pc.connectionState === "failed" || p.pc.connectionState === "disconnected") && p.offerer) { this.trace(`ice restart ${p.n} (relay)`); p.pc.restartIce(); }
      } catch { /* closed */ }
    }
  }

  /** How each voice link travels: "direct" (device to device) or "relay" (through TURN). */
  async routes(): Promise<{ n: number; route: "direct" | "relay" | "none" }[]> {
    const out: { n: number; route: "direct" | "relay" | "none" }[] = [];
    for (const p of this.peers.values()) {
      let route: "direct" | "relay" | "none" = "none";
      try {
        const st = await p.pc.getStats();
        st.forEach((r) => {
          if (r.type !== "transport" || !r.selectedCandidatePairId) return;
          const pair = st.get(r.selectedCandidatePairId);
          const a = pair && st.get(pair.localCandidateId), b = pair && st.get(pair.remoteCandidateId);
          if (a || b) route = a?.candidateType === "relay" || b?.candidateType === "relay" ? "relay" : "direct";
        });
        if (route === "none") st.forEach((r) => {
          if (r.type === "candidate-pair" && r.nominated && r.state === "succeeded") {
            const a = st.get(r.localCandidateId), b = st.get(r.remoteCandidateId);
            route = a?.candidateType === "relay" || b?.candidateType === "relay" ? "relay" : "direct";
          }
        });
      } catch { /* closed */ }
      out.push({ n: p.n, route });
    }
    return out;
  }

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
    const bytes = pcmEncode(pcm);
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
      if (p.incoming && p.incoming.len < MAX_BYTES) { const b = new Uint8Array(data); p.incoming.parts.push(b); p.incoming.len += b.length; }
      return;
    }
    let m: { k: string; id: number; ms?: number; tags?: ClipTag[]; len?: number };
    try { m = JSON.parse(data); } catch { return; }
    if (m.k === "clip" && Number.isInteger(m.id) && (m.len ?? 0) <= MAX_BYTES) p.incoming = { id: m.id, ms: Number(m.ms) || 0, tags: Array.isArray(m.tags) ? m.tags : [], parts: [], len: 0 };
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
    // give the relay logins a moment to arrive, so the first attempt can already use them
    if (!this.ice && performance.now() < this.iceWait) {
      if (!this.wanted) setTimeout(() => this.wanted && this.sync(this.wanted), this.iceWait - performance.now() + 20);
      this.wanted = others;
      return;
    }
    this.wanted = null;
    for (const n of others) if (!this.peers.has(n)) this.open(n);
    for (const n of [...this.peers.keys()]) if (!others.includes(n)) this.close(n);
  }

  private open(n: number) {
    const pc = new RTCPeerConnection({ iceServers: this.ice ?? defaultIce(), iceTransportPolicy: this.ice && FORCE_RELAY ? "relay" : "all" });
    const ctx = this.sounds.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 11000;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const panner = this.sounds.panner();
    filter.connect(gain).connect(panner);
    const send = ctx.createGain();
    send.gain.value = 0.2;
    gain.connect(send).connect(this.sounds.room);
    const roomNow = this.sounds.room;
    const radio = ctx.createGain();
    radio.gain.value = 0;
    radio.connect(this.radio.input);
    const peer: Peer = { n, pc, offerer: this.me < n, filter, gain, panner, radio, send, roomNow, onAir: false, sinks: [], sources: [], offeredAt: 0, failedAt: 0, queued: [], dc: pc.createDataChannel("clips", { negotiated: true, id: 5 }), incoming: null, gen: 0, remoteGen: -1 };
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
      this.sounds.place(p.panner, mix.x, o.y + 1.5, mix.z); // v36: from the doorway when the voice comes round a corner
      const rm = this.sounds.roomAt(o.x, o.z);
      if (rm !== p.roomNow) { try { p.send.disconnect(); } catch { /* fine */ } p.send.connect(rm); p.roomNow = rm; }
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
