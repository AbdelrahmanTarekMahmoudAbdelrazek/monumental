import { ECHO, echoWallsBetween } from "@monumental/shared";
import type { SoundBank } from "./sound";

type Signal = { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit | null };
export type PeerStatus = "connecting" | "connected" | "failed";

interface Peer {
  n: number;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** Chrome only routes a remote WebRTC stream into Web Audio if it is also attached to a (muted) media element. */
  sinks: HTMLAudioElement[];
  sources: MediaStreamAudioSourceNode[];
  filter: BiquadFilterNode;
  gain: GainNode;
  panner: PannerNode;
  status: PeerStatus;
  offeredAt: number;
  /** Network candidates that arrived before the other side's description. */
  queued: RTCIceCandidateInit[];
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
  /** True once we know whether there is a mic (until then new connections wait for it). */
  private micDecided = false;

  private watchdog: ReturnType<typeof setInterval>;

  constructor(private sounds: SoundBank, private me: number, private send: (to: number, data: Signal) => void, private onStatus: () => void) {
    // an offer that got no answer (message lost while the other side was loading) is sent again
    this.watchdog = setInterval(() => {
      const now = performance.now();
      for (const p of this.peers.values()) {
        if (p.pc.signalingState === "have-local-offer" && p.pc.localDescription && now - p.offeredAt > 3000) {
          p.offeredAt = now;
          this.send(p.n, { description: p.pc.localDescription.toJSON() });
        }
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
      for (const p of this.peers.values()) this.addLocalTrack(p);
      this.micError = null;
      this.micDecided = true;
      return true;
    } catch (e) {
      this.micError = (e as Error).name === "NotAllowedError" ? "Microphone blocked — allow it in the browser to talk" : "No microphone found — you can still listen";
      this.micDecided = true;
      for (const p of this.peers.values()) if (!p.pc.getTransceivers().length) p.pc.addTransceiver("audio", { direction: "recvonly" });
      return false;
    }
  }

  get hasMic() { return !!this.stream; }
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
    filter.frequency.value = 18000;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const panner = this.sounds.panner();
    filter.connect(gain).connect(panner);
    const peer: Peer = { n, pc, polite: this.me > n, makingOffer: false, ignoreOffer: false, filter, gain, panner, status: "connecting", sinks: [], sources: [], offeredAt: 0, queued: [] };
    this.peers.set(n, peer);

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        peer.offeredAt = performance.now();
        this.send(n, { description: pc.localDescription!.toJSON() });
      } catch { /* the other side will retry */ } finally { peer.makingOffer = false; }
    };
    pc.onicecandidate = (e) => this.send(n, { candidate: e.candidate ? e.candidate.toJSON() : null });
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      peer.status = s === "connected" ? "connected" : s === "failed" || s === "closed" ? "failed" : "connecting";
      if (s === "failed") pc.restartIce();
      this.onStatus();
    };
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
      peer.sources.push(src);
    };

    if (this.stream) this.addLocalTrack(peer);
    else if (this.micDecided) pc.addTransceiver("audio", { direction: "recvonly" }); // no mic: listen only
  }

  private addLocalTrack(p: Peer) {
    if (!this.stream) return;
    const track = this.stream.getAudioTracks()[0];
    if (!track) return;
    const tr = p.pc.getTransceivers().find((t) => t.receiver.track?.kind === "audio" && !t.sender.track);
    if (tr) { void tr.sender.replaceTrack(track); tr.direction = "sendrecv"; }
    else p.pc.addTrack(track, this.stream);
  }

  /** Voice set-up message from another player (standard "perfect negotiation"). */
  async signal(from: number, data: Signal) {
    let p = this.peers.get(from);
    if (!p) { this.open(from); p = this.peers.get(from)!; }
    const pc = p.pc;
    try {
      if (data.description) {
        const collision = data.description.type === "offer" && (p.makingOffer || pc.signalingState !== "stable");
        p.ignoreOffer = !p.polite && collision;
        if (p.ignoreOffer) return;
        await pc.setRemoteDescription(data.description);
        for (const c of p.queued.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        if (data.description.type === "offer") {
          await pc.setLocalDescription();
          this.send(from, { description: pc.localDescription!.toJSON() });
        }
      } else if (data.candidate !== undefined) {
        if (!pc.remoteDescription) { if (data.candidate && p.queued.length < 50) p.queued.push(data.candidate); return; }
        try { await pc.addIceCandidate(data.candidate ?? undefined); } catch (e) { if (!p.ignoreOffer) throw e; }
      }
    } catch { /* a broken message: ICE restart will recover */ }
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
      const d = Math.hypot(o.x - me.x, o.z - me.z);
      let v = d <= ECHO.VOICE_NEAR ? 1 : Math.max(0, 1 - (d - ECHO.VOICE_NEAR) / (ECHO.VOICE_RANGE - ECHO.VOICE_NEAR)) ** 1.6;
      const walls = d < ECHO.VOICE_RANGE ? echoWallsBetween(me.x, me.z, o.x, o.z) : 0;
      v *= walls === 0 ? 1 : walls === 1 ? 0.55 : 0.28;
      p.gain.gain.setTargetAtTime(v * 1.4, t, 0.08);
      p.filter.frequency.setTargetAtTime(walls === 0 ? 18000 : walls === 1 ? 1300 : 650, t, 0.1);
      this.sounds.place(p.panner, o.x, o.y + 1.5, o.z);
    }
  }

  private close(n: number) {
    const p = this.peers.get(n);
    if (!p) return;
    p.pc.close();
    p.sources.forEach((x) => x.disconnect());
    p.sinks.forEach((x) => { x.srcObject = null; });
    p.panner.disconnect();
    this.peers.delete(n);
    this.onStatus();
  }

  destroy() {
    clearInterval(this.watchdog);
    for (const n of [...this.peers.keys()]) this.close(n);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
