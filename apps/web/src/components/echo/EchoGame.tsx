"use client";
import { useEffect, useRef, useState } from "react";
import type { EchoMeta } from "@monumental/shared";
import { getSocket, measurePing } from "@/lib/socket";
import { getGuestId, getNickname } from "@/lib/identity";
import type { EchoEngine, EchoHud } from "./engine";

const FONT = "font-['IBM_Plex_Sans_Arabic',system-ui,sans-serif]";
const TITLE = "font-['Special_Elite',ui-monospace,monospace]";

export default function EchoGame({ code, userToken }: { code: string; userToken: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<EchoEngine | null>(null);
  const meRef = useRef<number | null>(null);
  /** Voice set-up messages that arrive before the engine exists. */
  const pending = useRef<{ from: number; data: unknown }[]>([]);
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
        },
        onHud: (h) => setHud(h),
      });
      engineRef.current = e;
      meRef.current = n;
      for (const p of pending.current.splice(0)) void e.voice.signal(p.from, p.data as never);
      await e.init();
      if (cancelled) { e.destroy(); return; }
      e.setMeta(m);
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
        void makeEngine(a.n, a.spawn, a.meta);
      });
    const onMeta = (m: EchoMeta) => { if (m.code !== code) return; setMeta(m); engineRef.current?.setMeta(m); };
    const onSnap = (sn: Parameters<EchoEngine["onSnap"]>[0]) => engineRef.current?.onSnap(sn);
    const onSignal = (p: { from: number; data: unknown }) => {
      const e = engineRef.current;
      if (e) void e.voice.signal(p.from, p.data as never);
      else if (pending.current.length < 200) pending.current.push(p);
    };
    s.on("connect", join);
    s.on("eh_meta", onMeta);
    s.on("eh_snap", onSnap);
    s.on("eh_signal", onSignal);
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
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, [code, userToken]);

  // ── keyboard + mouse (desktop) ──
  useEffect(() => {
    if (!entered) return;
    const map: Record<string, keyof EchoEngine["keys"]> = { KeyW: "f", ArrowUp: "f", KeyS: "b", ArrowDown: "b", KeyA: "l", ArrowLeft: "l", KeyD: "r", ArrowRight: "r", ShiftLeft: "run", ShiftRight: "run", ControlLeft: "crouch", KeyC: "crouch" };
    const down = (e: KeyboardEvent) => {
      const eng = engineRef.current;
      if (!eng) return;
      const k = map[e.code];
      if (k) { eng.keys[k] = true; e.preventDefault(); }
      if (e.repeat) return;
      if (e.code === "KeyF") eng.toggleTorch();
      if (e.code === "KeyM") eng.toggleMute();
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
    if (!eng) return;
    setEntered(true);
    requestAnimationFrame(() => eng.resize());
    await eng.enter();
    if (mobile) document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const invite = typeof window !== "undefined" ? `${window.location.origin}/echo/${code}` : `/echo/${code}`;
  const copy = () => { void navigator.clipboard?.writeText(invite).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
  const nameOf = (n: number) => meta?.players.find((p) => p.n === n);
  const paused = entered && !mobile && hud && !hud.locked;

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
              <p className="mt-4 text-lg text-[#9FA89F]">Phase 1 test: walk the ward together in the dark and talk.</p>
              <ul className="mt-6 space-y-2 text-[15px] text-[#A6AFA6]">
                <li>Voices are 3D: you hear friends from where they stand.</li>
                <li>Far away they fade out; through a wall they sound muffled.</li>
                <li><b className="text-[#E9E4D6]">Use headphones</b>, or your speakers leak into your mic.</li>
              </ul>
              <div className="mt-6 rounded-xl border border-[#222924] bg-[#0E1210] p-4 text-sm text-[#A6AFA6]">
                {mobile ? <p>Left thumb: move. Right thumb: look. Buttons: torch, crouch, run, mic.</p>
                  : <p><b className="text-[#E9E4D6]">WASD</b> move · <b className="text-[#E9E4D6]">Mouse</b> look · <b className="text-[#E9E4D6]">Shift</b> run · <b className="text-[#E9E4D6]">C / Ctrl</b> crouch · <b className="text-[#E9E4D6]">F</b> torch · <b className="text-[#E9E4D6]">M</b> mute · <b className="text-[#E9E4D6]">Esc</b> pause</p>}
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
                    <div className="text-xs text-[#7E887E]">{p.id === meta?.hostId ? "Host" : "In the room"}</div>
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
              <p className="text-sm text-[#7E887E]">Your browser will ask for the microphone. Without one you can still listen.</p>
              <button disabled={!ready} onClick={() => void enter()} data-testid="eh-enter" className={`${TITLE} h-16 rounded-2xl bg-[#E9E4D6] text-2xl text-black disabled:opacity-50`}>{ready ? "Enter the halls" : "Building the ward…"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── HUD ── */}
      {entered && hud && (
        <>
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#E9E4D6]/70" />
          <div className="pointer-events-none absolute left-4 top-3">
            <div className={`${TITLE} text-lg text-[#E9E4D6] md:text-xl`}>Explore the ward together</div>
            <div className="text-xs text-[#9FA89F] md:text-sm">Phase 1 test · room {code}</div>
          </div>
          <div className="pointer-events-none absolute right-4 top-3 flex gap-2 text-xs">
            {ping !== null && <span data-testid="eh-ping" className={`rounded-full px-2.5 py-1 ${ping < 100 ? "bg-[#16241C] text-[#7FB89A]" : ping < 180 ? "bg-[#2A2414] text-[#C9A66B]" : "bg-[#2A1512] text-[#E0675C]"}`}>{ping} ms</span>}
            <span className="rounded-full bg-black/50 px-2.5 py-1 text-[#7E887E]">{hud.fps} fps</span>
          </div>
          {!hud.torch && <div className="pointer-events-none absolute left-1/2 top-[58%] -translate-x-1/2 text-sm text-[#7E887E]">Torch off · {mobile ? "tap Torch" : "press F"}</div>}
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

      {entered && mobile && hud && <TouchControls engine={engineRef} hud={hud} />}
    </div>
  );
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
function TouchControls({ engine, hud }: { engine: React.MutableRefObject<EchoEngine | null>; hud: EchoHud }) {
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
      <div className="pointer-events-none absolute bottom-5 right-5 grid grid-cols-2 gap-3">
        <button className={btn} aria-label="Torch" onTouchStart={(e) => { e.stopPropagation(); engine.current?.toggleTorch(); }}>{hud.torch ? "Torch" : "Off"}</button>
        <button className={btn} aria-label="Crouch" onTouchStart={(e) => { e.stopPropagation(); engine.current?.toggleCrouch(); }}>{hud.crouch ? "Stand" : "Crouch"}</button>
        <button className={`${btn} col-span-2 h-16 w-full rounded-2xl ${hud.mic.muted || !hud.mic.has ? "border-[#8A3A33]" : "border-[#7FB89A]"}`} aria-label="Microphone" onTouchStart={(e) => { e.stopPropagation(); engine.current?.toggleMute(); }}>
          <span className="flex items-center gap-2"><MicIcon off={!hud.mic.has || hud.mic.muted} />{!hud.mic.has ? "No mic" : hud.mic.muted ? "Muted" : "Mic on"}<Meter level={hud.mic.level} /></span>
        </button>
      </div>
    </>
  );
}
