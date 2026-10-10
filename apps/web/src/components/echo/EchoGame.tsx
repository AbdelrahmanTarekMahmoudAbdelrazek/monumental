"use client";
import { useEffect, useRef, useState } from "react";
import type { EchoEvent, EchoMeta } from "@monumental/shared";
import { getSocket, measurePing } from "@/lib/socket";
import { getGuestId, getNickname } from "@/lib/identity";
import type { EchoEngine, EchoHud } from "./engine";
import TeenPicker from "./TeenPicker";
import { ECHO_TEENS, GOAL, type EchoLook } from "@monumental/shared";

const FONT = "font-['IBM_Plex_Sans_Arabic',system-ui,sans-serif]";
const TITLE = "font-['Special_Elite',ui-monospace,monospace]";

export default function EchoGame({ code, userToken, onStory }: { code: string; userToken: string | null; onStory?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<EchoEngine | null>(null);
  const meRef = useRef<number | null>(null);
  /** Voice set-up messages that arrive before the engine exists. */
  const pending = useRef<{ from: number; data: unknown }[]>([]);
  /** Newest room info, even if it arrived while the engine was still loading. */
  const latestMeta = useRef<EchoMeta | null>(null);
  const [meta, setMeta] = useState<EchoMeta | null>(null);
  const [me, setMe] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [entered, setEntered] = useState(false);
  const [hud, setHud] = useState<EchoHud | null>(null);
  const [ping, setPing] = useState<number | null>(null);
  const [mobile, setMobile] = useState(false);
  const [sens, setSens] = useState(1);
  const [copied, setCopied] = useState(false);
  const [consent, setConsent] = useState(false);
  const [smart, setSmart] = useState<string>("off");
  const [toasts, setToasts] = useState<{ id: number; text: string; bad: boolean }[]>([]);
  const [clockOff, setClockOff] = useState(0);
  const [, setTick] = useState(0);
  const metaRef = useRef<EchoMeta | null>(null);
  const toastRef = useRef<(text: string, bad?: boolean) => void>(() => {});
  const doAct = useRef(() => {
    const a = engineRef.current?.useAct();
    if (!a) return;
    getSocket().emit("eh_act", a, (r) => { if (!r.ok && r.error) toastRef.current(r.error, true); });
  }).current;
  const sendLook = useRef((look: EchoLook) => new Promise<string | null>((res) => {
    getSocket().emit("eh_look", { look }, (a) => res(a.ok ? null : a.error ?? "Could not change"));
  })).current;
  useEffect(() => { metaRef.current = meta; if (meta) setClockOff(meta.serverNow - Date.now()); }, [meta]);
  useEffect(() => {
    try { setConsent(localStorage.getItem("eh:consent") === "1"); setSmart(localStorage.getItem("eh:smart") ?? "off"); } catch { /* private mode */ }
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { setMobile(window.matchMedia("(pointer: coarse)").matches); }, []);

  // ── connect, join, build the engine ──
  useEffect(() => {
    const s = getSocket();
    let cancelled = false;
    const makeEngine = async (n: number, spawn: { x: number; z: number }, m: EchoMeta) => {
      if (engineRef.current && meRef.current === n) { engineRef.current.setMeta(m); return; }
      engineRef.current?.destroy();
      engineRef.current = null;
      setReady(false);
      const { EchoEngine } = await import("./engine");
      if (cancelled || !canvasRef.current) return;
      const e = new EchoEngine(canvasRef.current, {
        me: n, spawn, mobile: window.matchMedia("(pointer: coarse)").matches,
        net: {
          sendState: (st) => s.volatile.emit("eh_state", st),
          sendSignal: (to, data) => s.emit("eh_signal", { to, data }),
          sendClip: (p) => s.emit("eh_clip", p),
          sendTag: (p) => s.emit("eh_tag", p),
          sendHave: (key) => s.emit("eh_have", { key }),
          getIce: () => new Promise((res) => s.timeout(8000).emit("eh_ice", (err: unknown, a?: { iceServers: RTCIceServer[] }) => res(err || !a ? [] : a.iceServers))),
        },
        onHud: (h) => setHud(h),
      });
      engineRef.current = e;
      meRef.current = n;
      for (const p of pending.current.splice(0)) void e.voice.signal(p.from, p.data as never);
      await e.init();
      if (cancelled) { e.destroy(); return; }
      e.setMeta(latestMeta.current ?? m);
      if (window.location.search.includes("ehdebug")) (window as unknown as { __echo: EchoEngine }).__echo = e;
      setReady(true);
    };
    const join = () =>
      s.emit("eh_join", { code, nickname: getNickname(), guestId: getGuestId(), userToken: userToken ?? undefined }, (a) => {
        if (cancelled) return;
        if (!a.ok || !a.meta || !a.n || !a.spawn) { setError(a.error ?? "Could not join"); return; }
        setError(null);
        setMe(a.n);
        setMeta(a.meta);
        latestMeta.current = a.meta;
        void makeEngine(a.n, a.spawn, a.meta);
      });
    const onMeta = (m: EchoMeta) => { if (m.code !== code) return; latestMeta.current = m; setMeta(m); engineRef.current?.setMeta(m); };
    const onSnap = (sn: Parameters<EchoEngine["onSnap"]>[0]) => engineRef.current?.onSnap(sn);
    const toast = (text: string, bad = false) => {
      const id = Math.random();
      setToasts((ts) => [...ts.slice(-3), { id, text, bad }]);
      setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 6000);
    };
    toastRef.current = toast;
    const onEvent = (e: EchoEvent) => {
      engineRef.current?.onEvent(e);
      const nm = (n: number) => metaRef.current?.players.find((p) => p.n === n)?.name ?? "Someone";
      const you = (n: number, verb: string, other: string) => (n === meRef.current ? `You ${verb}` : `${nm(n)} ${other}`);
      if (e.type === "pickup") toast(`${you(e.n, "found", "found")} a fuse.${e.n === meRef.current ? " Take it to the fuse box in the boiler room." : ""}`);
      else if (e.type === "drop") toast(`${you(e.n, "dropped", "dropped")} a fuse.`, true);
      else if (e.type === "install") toast(`${you(e.n, "put", "put")} a fuse in. ${Math.min(GOAL.FUSES, (metaRef.current?.goal?.placed ?? 0) + 1)}/${GOAL.FUSES}`);
      else if (e.type === "power") toast("The power is back. Everyone to the lift — all of you, together.");
      if (e.type === "wake") toast("Something in the building is awake.", true);
      else if (e.type === "exposed") toast(`${e.by === meRef.current ? "You" : nm(e.by)} caught a mimic in the light. It ran.`);
      else if (e.type === "taken") {
        const owner = e.lure ? Number(e.lure.split(":")[0]) : null;
        const who = e.n === meRef.current ? "You were" : `${nm(e.n)} was`;
        toast(owner !== null ? `${who} taken — lured with ${owner === meRef.current ? "your" : `${nm(owner)}'s`} voice.` : `${who} taken.`, true);
      }
    };
    const onSignal = (p: { from: number; data: unknown }) => {
      const e = engineRef.current;
      if (e) void e.voice.signal(p.from, p.data as never);
      else if (pending.current.length < 200) {
        const d = p.data as { description?: { type?: string } };
        if (d.description?.type === "offer") pending.current = pending.current.filter((x) => x.from !== p.from || !(x.data as { description?: unknown }).description);
        pending.current.push(p);
      }
    };
    s.on("connect", join);
    s.on("eh_meta", onMeta);
    s.on("eh_snap", onSnap);
    s.on("eh_signal", onSignal);
    s.on("eh_event", onEvent);
    if (s.connected) join();
    const pingTimer = setInterval(() => { void measurePing().then((p) => { if (!cancelled && p >= 0) setPing(p); }); }, 3000);
    return () => {
      cancelled = true;
      clearInterval(pingTimer);
      s.emit("eh_leave");
      s.off("connect", join);
      s.off("eh_meta", onMeta);
      s.off("eh_snap", onSnap);
      s.off("eh_signal", onSignal);
      s.off("eh_event", onEvent);
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, [code, userToken]);

  // ── keyboard + mouse (desktop) ──
  useEffect(() => {
    if (!entered) return;
    const map: Record<string, keyof EchoEngine["keys"]> = { KeyW: "f", ArrowUp: "f", KeyS: "b", ArrowDown: "b", KeyA: "l", ArrowLeft: "l", KeyD: "r", ArrowRight: "r", ShiftLeft: "run", ShiftRight: "run", ControlLeft: "crouch", KeyC: "crouch", KeyV: "radio" };
    const down = (e: KeyboardEvent) => {
      const eng = engineRef.current;
      if (!eng) return;
      const k = map[e.code];
      if (k) { eng.keys[k] = true; e.preventDefault(); }
      if (e.repeat) return;
      if (e.code === "KeyF") eng.toggleTorch();
      if (e.code === "KeyM") eng.toggleMute();
      if (e.code === "KeyE") doAct();
    };
    const up = (e: KeyboardEvent) => { const k = map[e.code]; if (k && engineRef.current) engineRef.current.keys[k] = false; };
    const move = (e: MouseEvent) => { if (document.pointerLockElement === canvasRef.current) engineRef.current?.look(e.movementX, e.movementY); };
    const lockChange = () => {
      const eng = engineRef.current;
      if (!eng) return;
      eng.locked = document.pointerLockElement === canvasRef.current;
      if (!eng.locked) for (const k of Object.keys(eng.keys) as (keyof EchoEngine["keys"])[]) eng.keys[k] = false;
    };
    const blur = () => { const eng = engineRef.current; if (eng) for (const k of Object.keys(eng.keys) as (keyof EchoEngine["keys"])[]) eng.keys[k] = false; };
    const resize = () => engineRef.current?.resize();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    document.addEventListener("mousemove", move);
    document.addEventListener("pointerlockchange", lockChange);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      document.removeEventListener("mousemove", move);
      document.removeEventListener("pointerlockchange", lockChange);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", resize);
    };
  }, [entered]);

  useEffect(() => { if (engineRef.current) engineRef.current.sensitivity = 0.0022 * sens; }, [sens, ready]);

  const enter = async () => {
    const eng = engineRef.current;
    if (!eng || !consent) return;
    try { localStorage.setItem("eh:consent", "1"); localStorage.setItem("eh:smart", smart); } catch { /* private mode */ }
    eng.smartLang = smart === "off" ? null : smart;
    setEntered(true);
    requestAnimationFrame(() => eng.resize());
    await eng.enter();
    getSocket().emit("eh_act", { type: "enter" }, () => {});
    if (mobile) document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const invite = typeof window !== "undefined" ? `${window.location.origin}/echo/${code}` : `/echo/${code}`;
  const copy = () => { void navigator.clipboard?.writeText(invite).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
  const nameOf = (n: number) => meta?.players.find((p) => p.n === n);
  const over = !!meta?.goal?.result;
  const paused = entered && !mobile && hud && !hud.locked && !over;
  // at the end of a match, give the mouse back so the buttons can be clicked
  useEffect(() => { if (over && document.pointerLockElement) document.exitPointerLock?.(); }, [over]);

  return (
    <div className={`${entered && mobile ? "fixed inset-0 z-50 h-[100dvh]" : "relative h-[calc(100dvh-57px)]"} w-full overflow-hidden bg-black text-[#D9DED8] ${FONT}`}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Special+Elite&family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap" rel="stylesheet" />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" data-testid="eh-canvas" onClick={() => { if (entered && !mobile) engineRef.current?.lock(); }} />

      {/* film look: vignette + grain */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(0,0,0,0.75)_100%)]" />
      <div className="eh-grain pointer-events-none absolute inset-[-50%] opacity-[0.07]" />
      <style>{`.eh-grain{background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");animation:ehgrain 0.5s steps(4) infinite}@keyframes ehgrain{0%{transform:translate(0,0)}25%{transform:translate(-3%,2%)}50%{transform:translate(2%,-3%)}75%{transform:translate(-2%,-1%)}100%{transform:translate(1%,3%)}}`}</style>

      {error && (
        <div className="absolute inset-0 grid place-items-center bg-black/90 p-6 text-center">
          <div><p className="text-lg">{error}</p><a href="/echo" className="mt-4 inline-block rounded-xl bg-[#E9E4D6] px-5 py-3 font-semibold text-black">Back</a></div>
        </div>
      )}

      {/* ── before entering ── */}
      {!entered && !error && (
        <div className="absolute inset-0 overflow-y-auto bg-[radial-gradient(ellipse_70%_60%_at_30%_40%,#141A17,#050606_75%)] px-4 py-8 md:px-10">
          <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-[1fr_1.1fr]">
            <div>
              <h1 className={`${TITLE} text-6xl leading-[0.95] text-[#E9E4D6] md:text-7xl`}>ECHO<br />HALLS</h1>
              <p className="mt-4 text-lg text-[#9FA89F]">Marrowfield, fifteen years later. Go down together, stay close, and talk. Something down there is listening.</p>
              {onStory && <button className="mt-2 text-sm text-[#6EE6C8] underline underline-offset-4" onClick={onStory} data-testid="eh-story">▶ Watch the story again</button>}
              <div className="mt-5"><TeenPicker meta={meta} me={me} send={sendLook} /></div>
              <ul className="mt-6 space-y-2 text-[15px] text-[#A6AFA6]">
                <li>Voices are 3D: you hear friends from where they stand.</li>
                <li>Far away they fade out; through a wall they sound muffled.</li>
                <li><b className="text-[#E9E4D6]">Use headphones</b>, or your speakers leak into your mic.</li>
              </ul>
              <div className="mt-6 rounded-xl border border-[#222924] bg-[#0E1210] p-4 text-sm text-[#A6AFA6]">
                {mobile ? <p>Left thumb: move. Right thumb: look. Buttons: torch, crouch, mic, and hold Radio to talk to everyone on Channel 4.</p>
                  : <p><b className="text-[#E9E4D6]">WASD</b> move · <b className="text-[#E9E4D6]">Mouse</b> look · <b className="text-[#E9E4D6]">Shift</b> run · <b className="text-[#E9E4D6]">C / Ctrl</b> crouch · <b className="text-[#E9E4D6]">F</b> torch · <b className="text-[#E9E4D6]">M</b> mute · <b className="text-[#E9E4D6]">V</b> hold to talk on the radio · <b className="text-[#E9E4D6]">E</b> pick up / use · <b className="text-[#E9E4D6]">Esc</b> pause</p>}
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className={`${TITLE} text-2xl text-[#E9E4D6]`}>Your group</h2>
                <div className="flex items-center gap-2"><span className="text-sm text-[#7E887E]">ROOM</span><span className={`${TITLE} rounded-lg border border-[#2A312C] px-3 py-1.5 tracking-[0.2em]`}>{code}</span></div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2" data-testid="eh-players">
                {(meta?.players ?? []).map((p) => (
                  <div key={p.n} className="rounded-xl border border-[#222924] bg-[#101412] px-4 py-3">
                    <div className="font-semibold" style={{ color: p.color }}>{p.name}{p.n === me ? " (you)" : ""}</div>
                    <div className="text-xs text-[#7E887E]">{p.look ? `as ${ECHO_TEENS.find((t) => t.id === p.look!.teen)?.name}` : ""}{p.look ? " · " : ""}{p.id === meta?.hostId ? "Host" : "In the room"}</div>
                  </div>
                ))}
                {Array.from({ length: Math.max(0, 4 - (meta?.players.length ?? 0)) }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-dashed border-[#2A312C] px-4 py-3 text-sm text-[#6E786E]">Empty slot</div>
                ))}
              </div>
              <div className="flex gap-2">
                <input readOnly value={invite} aria-label="Invite link" className="min-w-0 flex-1 rounded-xl border border-[#2A312C] bg-black/40 px-3 py-2 text-sm" />
                <button onClick={copy} className="rounded-xl border border-[#3A433D] px-4 text-sm font-semibold">{copied ? "Copied" : "Copy invite"}</button>
              </div>
              <div className="rounded-xl border border-[#5A2621] bg-[#160E0D] p-4">
                <div className="font-semibold text-[#F1C9C4]">This game uses your voice against you</div>
                <p className="mt-1 text-sm leading-relaxed text-[#C7A7A2]">While you play, short pieces of what you say are cut on your device and sent straight to the other players. The monsters replay them in your voice to trick your friends. Pieces live only in this match and are deleted when you leave. On networks that block direct links they pass through an encrypted relay that cannot listen in or keep them. They never go to our server and are never used to train anything.</p>
                <label className="mt-3 flex items-center gap-3 text-sm text-[#F1C9C4]"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="h-5 w-5 accent-[#D9463B]" data-testid="eh-consent" /> I understand and agree</label>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label htmlFor="eh-smart" className="text-[#9FA89F]">Smart mimic (understands words)</label>
                <select id="eh-smart" value={smart} onChange={(e) => setSmart(e.target.value)} className="rounded-lg border border-[#2A312C] bg-black/40 px-2 py-1.5">
                  <option value="off">Off</option>
                  <option value="en-US">On · English</option>
                  <option value="ar-EG">On · العربية (مصر)</option>
                  <option value="ar-SA">On · العربية (السعودية)</option>
                </select>
                <span className="w-full text-xs text-[#6E786E]">Uses your browser's speech-to-text (in Chrome this sends your audio to Google). Off: the mimic still works, just less clever.</span>
              </div>
              <p className="text-sm text-[#7E887E]">Your browser will ask for the microphone. Without one you can still listen.</p>
              <button disabled={!ready || !consent} onClick={() => void enter()} data-testid="eh-enter" className={`${TITLE} h-16 rounded-2xl bg-[#E9E4D6] text-2xl text-black disabled:opacity-50`}>{!ready ? "Building the hospital…" : consent ? "Enter the halls" : "Agree above to enter"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── HUD ── */}
      {entered && hud && (
        <>
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#E9E4D6]/70" />
          <div className="pointer-events-none absolute left-4 top-3">
            <div className={`${TITLE} text-lg text-[#E9E4D6] md:text-xl`}>{meta?.goal?.power ? "Everyone to the lift" : meta?.night?.awake ? "Trust no voice" : "Find the three fuses"}</div>
            <div className="text-sm text-[#E0D7BE]" data-testid="eh-goal">{goalText(meta, hud.carrying, clockOff)}</div>
            <div className="text-xs text-[#9FA89F] md:text-sm" data-testid="eh-night">{nightText(meta, clockOff)}</div>
            {hud.room && <div className={`${TITLE} mt-1 text-sm text-[#C9C4B4]`} data-testid="eh-room">{hud.room}</div>}
            {hud.peers.filter((p) => p.status !== "connected").map((p) => (
              <div key={p.n} className="mt-1 text-xs text-[#C9A66B]">No voice link with {nameOf(p.n)?.name ?? "a player"} yet — you can't hear each other and the mimic can't copy them.</div>
            ))}
          </div>
          <div className="pointer-events-none absolute right-4 top-3 flex gap-2 text-xs">
            {ping !== null && <span data-testid="eh-ping" className={`rounded-full px-2.5 py-1 ${ping < 100 ? "bg-[#16241C] text-[#7FB89A]" : ping < 180 ? "bg-[#2A2414] text-[#C9A66B]" : "bg-[#2A1512] text-[#E0675C]"}`}>{ping} ms</span>}
            <span className="rounded-full bg-black/50 px-2.5 py-1 text-[#7E887E]">{hud.fps} fps</span>
          </div>
          {!hud.torch && <div className="pointer-events-none absolute left-1/2 top-[58%] -translate-x-1/2 text-sm text-[#7E887E]">Torch off · {mobile ? "tap Torch" : "press F"}</div>}
          {(hud.onAir.length > 0 || hud.fakeAir !== null) && (
            <div className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#5A2621] bg-[#160E0D]/85 px-4 py-1.5 text-sm text-[#F1C9C4]" data-testid="eh-radio">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#E0675C]" />
              CH 4 · {[...new Set([...hud.onAir, ...(hud.fakeAir !== null ? [hud.fakeAir] : [])])].map((n) => (n === 0 || n === me ? "you" : nameOf(n)?.name ?? "someone")).join(", ")}
            </div>
          )}
          {hud.act && !mobile && <div className="pointer-events-none absolute left-1/2 top-[64%] -translate-x-1/2 rounded-full bg-black/60 px-4 py-2 text-sm text-[#E9E4D6]" data-testid="eh-act"><b className="mr-2 rounded border border-[#E9E4D6]/60 px-1.5">E</b>{hud.act}</div>}
          {hud.stamina < 0.99 && (
            <div className="pointer-events-none absolute bottom-20 left-1/2 h-1 w-40 -translate-x-1/2 overflow-hidden rounded-full bg-white/10 md:bottom-24"><div className="h-full bg-[#E9E4D6]/70" style={{ width: `${hud.stamina * 100}%` }} /></div>
          )}
          <div className={`absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#2A312C] bg-[#101412]/85 px-4 py-2 text-sm ${mobile ? "hidden" : ""}`} data-testid="eh-mic">
            <MicIcon off={!hud.mic.has || hud.mic.muted} />
            <span>{!hud.mic.has ? (hud.mic.error ?? "No microphone") : hud.mic.muted ? "Muted · M to talk" : "Mic on · heard up to 15 m · M to mute"}</span>
            <Meter level={hud.mic.level} />
          </div>
        </>
      )}

      {entered && hud && hud.taken > 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/85" data-testid="eh-taken">
          <div className="text-center">
            <div className={`${TITLE} text-6xl text-[#D9463B]`}>Taken</div>
            <p className="mt-2 text-[#A6AFA6]">Back in the safe room in {hud.taken}…</p>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute left-1/2 top-16 flex w-[min(92vw,520px)] -translate-x-1/2 flex-col gap-2" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`rounded-xl px-4 py-2 text-center text-sm ${t.bad ? "bg-[#2A1512]/90 text-[#F1C9C4]" : "bg-[#16241C]/90 text-[#CFE3DA]"}`}>{t.text}</div>)}
      </div>

      {/* ── pause (desktop, pointer released) ── */}
      {paused && (
        <div className="absolute inset-0 grid place-items-center bg-black/70 p-6">
          <div className="w-full max-w-md rounded-2xl border border-[#2A312C] bg-[#0E1210] p-6">
            <div className={`${TITLE} text-3xl text-[#E9E4D6]`}>Paused</div>
            <p className="mt-1 text-sm text-[#9FA89F]">The others keep moving. You're still in the room.</p>
            <label className="mt-5 block text-sm" htmlFor="eh-sens">Mouse sensitivity · {sens.toFixed(1)}×</label>
            <input id="eh-sens" type="range" min={0.3} max={2.5} step={0.1} value={sens} onChange={(e) => setSens(Number(e.target.value))} className="mt-2 w-full accent-[#E9E4D6]" />
            <div className="mt-5 text-sm text-[#7E887E]">Voice</div>
            <ul className="mt-1 space-y-1 text-sm">
              {hud.peers.length === 0 && <li className="text-[#6E786E]">Nobody else here yet — share the invite link.</li>}
              {hud.peers.map((p) => (
                <li key={p.n} className="flex justify-between"><span style={{ color: nameOf(p.n)?.color }}>{nameOf(p.n)?.name ?? "Player"}</span><span className={p.status === "connected" ? "text-[#7FB89A]" : p.status === "failed" ? "text-[#E0675C]" : "text-[#C9A66B]"}>{p.status}</span></li>
              ))}
            </ul>
            <div className="mt-6 flex gap-3">
              <a href="/echo" className="flex h-12 flex-1 items-center justify-center rounded-xl border border-[#3A433D] font-semibold">Leave</a>
              <button onClick={() => engineRef.current?.lock()} className={`${TITLE} h-12 flex-[2] rounded-xl bg-[#E9E4D6] text-xl text-black`}>Continue</button>
            </div>
          </div>
        </div>
      )}

      {entered && mobile && hud && <TouchControls engine={engineRef} hud={hud} onUse={doAct} />}

      {/* ── the end of a match ── */}
      {entered && meta?.goal?.result && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/85 p-6" data-testid="eh-result">
          <div className="w-full max-w-md text-center">
            <div className={`${TITLE} text-5xl ${meta.goal.result === "win" ? "text-[#E9E4D6]" : "text-[#D9463B]"}`}>{meta.goal.result === "win" ? "You got out" : "The lights went out"}</div>
            <p className="mt-3 text-[#A6AFA6]">{meta.goal.result === "win" ? "The lift doors closed on the dark. Everyone who was still with you made it." : "Twenty minutes, and the hospital kept you."}</p>
            <div className="mt-6 grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-xl border border-[#222924] p-3"><div className={`${TITLE} text-2xl text-[#E9E4D6]`}>{fmtTime(((meta.goal.endedAt || meta.serverNow) - meta.goal.startedAt) / 1000)}</div><div className="text-xs text-[#7E887E]">time</div></div>
              <div className="rounded-xl border border-[#222924] p-3"><div className={`${TITLE} text-2xl text-[#E9E4D6]`}>{meta.night?.taken ?? 0}</div><div className="text-xs text-[#7E887E]">times taken</div></div>
              <div className="rounded-xl border border-[#222924] p-3"><div className={`${TITLE} text-2xl text-[#E9E4D6]`}>{meta.night?.exposed ?? 0}</div><div className="text-xs text-[#7E887E]">mimics exposed</div></div>
            </div>
            <button className={`${TITLE} mt-6 h-14 w-full rounded-2xl bg-[#E9E4D6] text-xl text-black`} data-testid="eh-again" onClick={() => getSocket().emit("eh_act", { type: "restart" }, (r) => { if (!r.ok) toastRef.current(r.error ?? "Could not restart", true); })}>Play again</button>
            <a href="/echo" className="mt-3 inline-block text-sm text-[#7E887E] underline">Leave</a>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtTime(sec: number) { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }

function goalText(meta: EchoMeta | null, carrying: boolean, clockOff: number) {
  const g = meta?.goal;
  if (!g || !g.startedAt) return "";
  const left = fmtTime((g.endsAt - (Date.now() + clockOff)) / 1000);
  if (g.power) return `Power on · at the lift ${g.inLift.length}/${g.need} · ${left} left`;
  return `${carrying ? "Carrying a fuse → boiler room · " : ""}Fuses ${g.placed}/${GOAL.FUSES} · ${left} left`;
}

function nightText(meta: EchoMeta | null, clockOff: number) {
  const n = meta?.night;
  if (!n) return "";
  if (n.awake) return `Mimics exposed: ${n.exposed} · taken: ${n.taken}`;
  if (!n.wakeAt) return "Waiting for a second player…";
  const left = Math.max(0, Math.ceil((n.wakeAt - (Date.now() + clockOff)) / 1000));
  return left > 0 ? `The night is calm… for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "Something is stirring…";
}

function MicIcon({ off }: { off: boolean }) {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={off ? "#E0675C" : "#7FB89A"} strokeWidth="2" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />{off && <path d="M4 4l16 16" />}
    </svg>
  );
}

function Meter({ level }: { level: number }) {
  return (
    <span className="flex h-4 items-end gap-[3px]" aria-hidden="true">
      {[0.15, 0.35, 0.55, 0.75].map((t, i) => <span key={i} className="w-1 rounded-sm" style={{ height: 5 + i * 3, background: level > t ? "#7FB89A" : "#3A433D" }} />)}
    </span>
  );
}

/** Phones: left thumb moves, right thumb looks, buttons for torch / crouch / run / mic. */
function TouchControls({ engine, hud, onUse }: { engine: React.MutableRefObject<EchoEngine | null>; hud: EchoHud; onUse: () => void }) {
  const stickId = useRef<number | null>(null);
  const lookId = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const lastLook = useRef({ x: 0, y: 0 });
  const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);

  const start = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX < window.innerWidth * 0.45 && stickId.current === null) {
        stickId.current = t.identifier;
        origin.current = { x: t.clientX, y: t.clientY };
        setKnob({ x: 0, y: 0 });
      } else if (lookId.current === null) {
        lookId.current = t.identifier;
        lastLook.current = { x: t.clientX, y: t.clientY };
      }
    }
  };
  const move = (e: React.TouchEvent) => {
    const eng = engine.current;
    if (!eng) return;
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === stickId.current) {
        const dx = t.clientX - origin.current.x, dy = t.clientY - origin.current.y;
        const d = Math.hypot(dx, dy), max = 55, k = d > max ? max / d : 1;
        setKnob({ x: dx * k, y: dy * k });
        eng.stick = { x: (dx * k) / max, y: (dy * k) / max };
        eng.keys.run = d > max * 1.6; // push far to run
      } else if (t.identifier === lookId.current) {
        const dx = t.clientX - lastLook.current.x, dy = t.clientY - lastLook.current.y;
        lastLook.current = { x: t.clientX, y: t.clientY };
        // precise for small moves, faster for big swipes
        const curve = (v: number) => v * (1.6 + Math.min(2, Math.abs(v) * 0.08));
        eng.look(curve(dx), curve(dy));
      }
    }
  };
  const end = (e: React.TouchEvent) => {
    const eng = engine.current;
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === stickId.current) { stickId.current = null; setKnob(null); if (eng) { eng.stick = { x: 0, y: 0 }; eng.keys.run = false; } }
      if (t.identifier === lookId.current) lookId.current = null;
    }
  };
  const btn = "pointer-events-auto grid h-14 w-14 place-items-center rounded-full border border-[#3A433D] bg-[#101412]/80 text-xs font-semibold text-[#E9E4D6]";
  return (
    <>
      <div className="absolute inset-0" onTouchStart={start} onTouchMove={move} onTouchEnd={end} onTouchCancel={end} />
      {knob && (
        <div className="pointer-events-none absolute h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/25 bg-black/20" style={{ left: origin.current.x, top: origin.current.y }}>
          <div className="absolute left-1/2 top-1/2 h-12 w-12 rounded-full bg-white/30" style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }} />
        </div>
      )}
      {!knob && <div className="pointer-events-none absolute bottom-8 left-8 text-xs text-[#6E786E]">Drag here to move</div>}
      {hud.act && <button className="pointer-events-auto absolute bottom-48 right-5 rounded-2xl border border-[#E9C46A] bg-[#2A2414]/90 px-5 py-4 text-sm font-semibold text-[#F3E3B5]" onTouchStart={(e) => { e.stopPropagation(); onUse(); }} data-testid="eh-use">{hud.act}</button>}
      <div className="pointer-events-none absolute bottom-5 right-5 grid grid-cols-2 gap-3">
        <button className={btn} aria-label="Torch" onTouchStart={(e) => { e.stopPropagation(); engine.current?.toggleTorch(); }}>{hud.torch ? "Torch" : "Off"}</button>
        <button className={btn} aria-label="Crouch" onTouchStart={(e) => { e.stopPropagation(); engine.current?.toggleCrouch(); }}>{hud.crouch ? "Stand" : "Crouch"}</button>
        <button className={`${btn} col-span-2 w-full rounded-2xl ${hud.onAir.includes(0) ? "border-[#E0675C] bg-[#2A1512]/90" : ""}`} aria-label="Hold to talk on the radio" data-testid="eh-radio-btn"
          onTouchStart={(e) => { e.stopPropagation(); if (engine.current) engine.current.keys.radio = true; }} onTouchEnd={(e) => { e.stopPropagation(); if (engine.current) engine.current.keys.radio = false; }} onTouchCancel={() => { if (engine.current) engine.current.keys.radio = false; }}>
          {hud.onAir.includes(0) ? "On air…" : "Hold: Radio"}
        </button>
        <button className={`${btn} col-span-2 h-16 w-full rounded-2xl ${hud.mic.muted || !hud.mic.has ? "border-[#8A3A33]" : "border-[#7FB89A]"}`} aria-label="Microphone" onTouchStart={(e) => { e.stopPropagation(); engine.current?.toggleMute(); }}>
          <span className="flex items-center gap-2"><MicIcon off={!hud.mic.has || hud.mic.muted} />{!hud.mic.has ? "No mic" : hud.mic.muted ? "Muted" : "Mic on"}<Meter level={hud.mic.level} /></span>
        </button>
      </div>
    </>
  );
}
