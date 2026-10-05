"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { NEON, NEON_COLORS, NEON_POWERS, aimTurn, type NeonCarSnap, type NeonMeta } from "@monumental/shared";
import { useNeon } from "@/lib/useNeon";
import { sfx } from "@/lib/sound";

type Act = ReturnType<typeof useNeon>["act"];

/** Interpolated car for drawing. */
interface DrawCar extends NeonCarSnap { ang: number; steer: number }

/**
 * Integrates the same physics the server uses, for `secs`, from a server state, with the local input.
 * Used to draw your own car ahead of the network so steering feels instant.
 */
function simulate(c: NeonCarSnap, secs: number, turn: number, boost: boolean, aim: number | null, path?: number[]) {
  let x = c.x, y = c.y, a = c.a / 1000, st = c.st / 100;
  const h = 1 / 120;
  const v = NEON.SPEED * (boost && c.fuel > 2 ? NEON.BOOST_MULT : 1) * (c.power === "turbo" ? NEON.TURBO_MULT : 1);
  for (let left = secs; left > 1e-6; left -= h) {
    const dt = Math.min(h, left);
    const want = aim !== null ? aimTurn(a, aim) : turn;
    st += (want - st) * Math.min(1, dt * NEON.STEER_EASE);
    a += st * NEON.TURN * dt;
    x += Math.cos(a) * v * dt;
    y += Math.sin(a) * v * dt;
    path?.push(x, y);
  }
  return { x, y, a, st };
}
const angDiff = (a: number, b: number) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };


export default function NeonGame({ code, userToken }: { code: string; userToken: string | null }) {
  const g = useNeon(code, userToken);
  const { meta, me, world } = g;
  const canvas = useRef<HTMLCanvasElement>(null);
  const metaRef = useRef<NeonMeta | null>(null);
  metaRef.current = meta;
  const meRef = useRef<string | null>(null);
  meRef.current = me;
  const [hud, setHud] = useState<{ fuel: number; power: string | null; powerMs: number; alive: boolean; len: number; boosting: boolean; respawnMs: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** Keyboard keys + mouse/touch steering. `aim` is the world angle toward the pointer (null = not using the pointer). */
  const keys = useRef({ left: false, right: false, boost: false, mouseBoost: false, px: 0, py: 0, pointer: false, aim: null as number | null });
  const sent = useRef({ turn: 9, boost: false, aim: null as number | null, at: 0 });
  const [touch, setTouch] = useState(false);
  const touchRef = useRef(false);
  touchRef.current = touch;

  // ── input ──
  useEffect(() => {
    setTouch("ontouchstart" in window || navigator.maxTouchPoints > 0);
    const push = () => {
      const k = keys.current;
      const turn = (k.right ? 1 : 0) - (k.left ? 1 : 0);
      const boost = k.boost || k.mouseBoost;
      const aim = turn !== 0 ? null : k.aim; // arrow keys override the mouse
      const sa = sent.current.aim;
      const aimMoved = (aim === null) !== (sa === null) || (aim !== null && sa !== null && Math.abs(aim - sa) > 0.015);
      const t = performance.now();
      if (turn !== sent.current.turn || boost !== sent.current.boost || (aimMoved && t - sent.current.at > 40)) {
        sent.current = { turn, boost, aim, at: t };
        g.input(turn, boost, aim);
      }
    };
    const set = (e: KeyboardEvent, v: boolean) => {
      const k = keys.current;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (["ArrowLeft", "a", "A"].includes(e.key)) k.left = v;
      else if (["ArrowRight", "d", "D"].includes(e.key)) k.right = v;
      else if ([" ", "ArrowUp", "w", "W", "Shift"].includes(e.key)) k.boost = v;
      else return;
      e.preventDefault();
      push();
    };
    const down = (e: KeyboardEvent) => set(e, true);
    const up = (e: KeyboardEvent) => set(e, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    (window as unknown as { __neonPush?: () => void }).__neonPush = push;
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const press = (which: "left" | "right" | "boost", v: boolean) => {
    keys.current[which] = v;
    (window as unknown as { __neonPush?: () => void }).__neonPush?.();
  };
  const pointerAt = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const k = keys.current;
    k.px = e.clientX - r.left; k.py = e.clientY - r.top; k.pointer = true;
  };
  const onPointerMove = (e: React.PointerEvent) => { if (e.pointerType === "mouse" || e.buttons) pointerAt(e); };
  const onPointerDown = (e: React.PointerEvent) => {
    pointerAt(e);
    if (e.pointerType === "mouse") { keys.current.mouseBoost = true; (window as unknown as { __neonPush?: () => void }).__neonPush?.(); }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") { keys.current.mouseBoost = false; (window as unknown as { __neonPush?: () => void }).__neonPush?.(); }
  };

  // ── sounds on feed ──
  const lastFeed = useRef(0);
  useEffect(() => {
    const f = meta?.feed[meta.feed.length - 1];
    if (!f || f.at === lastFeed.current) return;
    lastFeed.current = f.at;
    if (f.text.startsWith("💥")) sfx.miss();
    else if (f.text.startsWith("🏆")) sfx.win();
    else if (f.text.startsWith("Round")) sfx.roundStart();
    else sfx.points();
  }, [meta?.feed]);

  // ── render loop ──
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    let raf = 0;
    let cam = { x: 0, y: 0, init: false };
    let hudAt = 0;
    // own-car prediction: base = the server state we extrapolate from; err = smoothly-decaying correction
    const preds = new Map<string, { tick: number; base: NeonCarSnap | null; baseAt: number; errX: number; errY: number; errA: number; alive: boolean }>();
    const look = { x: 0, y: 0 };
    const smoke: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
    let smokeAcc = 0;
    let lastFrame = performance.now();
    const sparks: { x: number; y: number; vx: number; vy: number; c: string; life: number }[] = [];
    const seenDeaths = new Set<string>();

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = cv.clientWidth, H = cv.clientHeight;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const m = metaRef.current;
      const w = world.current;
      const now = performance.now();
      const dtFrame = Math.min(0.1, (now - lastFrame) / 1000);
      lastFrame = now;
      const size = m?.size ?? 2600;
      const colorOf = (id: string) => NEON_COLORS[(m?.players.find((p) => p.id === id)?.color ?? 0) % NEON_COLORS.length];

      // ── bring EVERY car to "now": extrapolate from the newest server state (mine with my live input,
      //    others assuming they keep steering the same way). Everyone is drawn on the same clock, so what
      //    you see touching is what the server sees touching. Corrections fade in instead of jumping. ──
      const LEAD = 0.05;
      const kk = keys.current;
      const turnNow = (kk.right ? 1 : 0) - (kk.left ? 1 : 0);
      const boostNow = kk.boost || kk.mouseBoost;
      const aimNow = turnNow !== 0 ? null : kk.aim;
      const paths = new Map<string, number[]>();
      let mineDraw: DrawCar | null = null;
      const drawCars: DrawCar[] = [];
      const decay = Math.exp(-dtFrame / 0.09);
      const elapsed = Math.min(0.3, (now - w.curAt) / 1000 + LEAD);
      for (const srv of w.cur?.cars ?? []) {
        let pr = preds.get(srv.id);
        if (!pr) { pr = { tick: -1, base: null, baseAt: 0, errX: 0, errY: 0, errA: 0, alive: false }; preds.set(srv.id, pr); }
        if (!srv.alive || !w.cur) {
          pr.alive = false; pr.base = null;
          drawCars.push({ ...srv, ang: srv.a / 1000, steer: 0 });
          continue;
        }
        const isMe = srv.id === meRef.current;
        const turn = isMe ? turnNow : srv.st / 100;
        const boost = isMe ? boostNow : srv.boosting;
        const aim = isMe ? aimNow : null;
        const path: number[] = [];
        const ext = simulate(srv, elapsed, turn, boost, aim, path);
        if (w.cur.tick !== pr.tick) {
          if (pr.base && pr.alive) {
            const old = simulate(pr.base, Math.min(0.3, (now - pr.baseAt) / 1000 + LEAD), isMe ? turnNow : pr.base.st / 100, isMe ? boostNow : pr.base.boosting, aim);
            const dx = old.x + pr.errX - ext.x, dy = old.y + pr.errY - ext.y;
            if (Math.hypot(dx, dy) < 120) { pr.errX = dx; pr.errY = dy; pr.errA = angDiff(old.a + pr.errA, ext.a); }
            else { pr.errX = pr.errY = pr.errA = 0; }
          } else { pr.errX = pr.errY = pr.errA = 0; }
          pr.tick = w.cur.tick; pr.base = srv; pr.baseAt = w.curAt;
        }
        pr.alive = true;
        pr.errX *= decay; pr.errY *= decay; pr.errA *= decay;
        for (let i = 0; i < path.length; i += 2) { const f = (i + 2) / path.length; path[i] += pr.errX * f; path[i + 1] += pr.errY * f; }
        paths.set(srv.id, path);
        const d: DrawCar = { ...srv, x: ext.x + pr.errX, y: ext.y + pr.errY, ang: ext.a + pr.errA, steer: ext.st, alive: true };
        drawCars.push(d);
        if (isMe) mineDraw = d;
      }
      const trace = (window as unknown as { __ndTrace?: number[][] }).__ndTrace;
      if (trace && mineDraw) trace.push([now, mineDraw.x, mineDraw.y]);

      const mine = drawCars.find((c) => c.id === meRef.current);
      const follow = mine?.alive ? mine : drawCars.find((c) => c.alive) ?? mine;
      const zoom = Math.max(W, H) / (W < 700 ? 900 : 1300);
      if (follow) {
        // look a little ahead of the car, eased so turns don't whip the camera
        const lk = 1 - Math.exp(-dtFrame / 0.35);
        look.x += (Math.cos(follow.ang) * 70 - look.x) * lk;
        look.y += (Math.sin(follow.ang) * 70 - look.y) * lk;
        const tx = follow.x + look.x, ty = follow.y + look.y;
        if (!cam.init || Math.hypot(tx - cam.x, ty - cam.y) > 600) cam = { x: tx, y: ty, init: true };
        else if (follow === mineDraw) { cam.x = tx; cam.y = ty; } // locked to the predicted car: zero jitter
        else { const e = 1 - Math.exp(-dtFrame / 0.12); cam.x += (tx - cam.x) * e; cam.y += (ty - cam.y) * e; }
      } else if (!cam.init) cam = { x: size / 2, y: size / 2, init: true };

      // mouse / finger steering: aim from the car (on screen) toward the pointer
      if (kk.pointer && mineDraw) {
        const sx = W / 2 + (mineDraw.x - cam.x) * zoom, sy = H / 2 + (mineDraw.y - cam.y) * zoom;
        if (Math.hypot(kk.px - sx, kk.py - sy) > 14) kk.aim = Math.atan2(kk.py - sy, kk.px - sx);
        (window as unknown as { __neonPush?: () => void }).__neonPush?.();
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#05070f";
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-cam.x, -cam.y);

      // grid
      const vx0 = cam.x - W / 2 / zoom, vy0 = cam.y - H / 2 / zoom, vx1 = cam.x + W / 2 / zoom, vy1 = cam.y + H / 2 / zoom;
      ctx.strokeStyle = "rgba(90,120,255,0.09)";
      ctx.lineWidth = 1 / zoom * 1.2;
      ctx.beginPath();
      for (let x = Math.max(0, Math.floor(vx0 / 100) * 100); x <= Math.min(size, vx1); x += 100) { ctx.moveTo(x, Math.max(0, vy0)); ctx.lineTo(x, Math.min(size, vy1)); }
      for (let y = Math.max(0, Math.floor(vy0 / 100) * 100); y <= Math.min(size, vy1); y += 100) { ctx.moveTo(Math.max(0, vx0), y); ctx.lineTo(Math.min(size, vx1), y); }
      ctx.stroke();
      // arena wall
      ctx.strokeStyle = "#ff3d81";
      ctx.lineWidth = 6;
      ctx.shadowColor = "#ff3d81";
      ctx.shadowBlur = 20;
      ctx.strokeRect(0, 0, size, size);
      ctx.shadowBlur = 0;

      // gas
      const pulse = 1 + Math.sin(now / 250) * 0.15;
      for (const [, [gx, gy]] of w.gas) {
        if (gx < vx0 - 20 || gx > vx1 + 20 || gy < vy0 - 20 || gy > vy1 + 20) continue;
        ctx.fillStyle = "rgba(255,170,40,0.22)";
        ctx.beginPath(); ctx.arc(gx, gy, NEON.GAS_R * 1.9 * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ffb020";
        ctx.beginPath(); ctx.roundRect(gx - 6, gy - 7, 12, 14, 3); ctx.fill();
        ctx.fillStyle = "#7a3f00";
        ctx.fillRect(gx - 3, gy - 10, 6, 3);
      }
      // power-ups
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const p of w.powers) {
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.beginPath(); ctx.arc(p.x, p.y, NEON.POWER_R * 1.5 * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, NEON.POWER_R, 0, Math.PI * 2); ctx.stroke();
        ctx.font = `${NEON.POWER_R * 1.3}px system-ui`;
        ctx.fillText(NEON_POWERS[p.kind].icon, p.x, p.y + 1);
      }

      // trails (glow: wide faint stroke + bright core, additive)
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const c of drawCars) {
        if (!c.alive) continue;
        const tr = w.trails.get(c.id);
        if (!tr || tr.length < 2) continue;

        const col = colorOf(c.id);
        ctx.beginPath();
        ctx.moveTo(tr[0], tr[1]);
        // skip points newer than the moment we're drawing, then end exactly at the car
        for (let i = 2; i < tr.length; i += 2) ctx.lineTo(tr[i], tr[i + 1]);
        const pth = paths.get(c.id) ?? [];
        for (let i = 0; i < pth.length; i += 4) ctx.lineTo(pth[i], pth[i + 1]);
        ctx.lineTo(c.x, c.y);
        ctx.strokeStyle = col.trail + "33";
        ctx.lineWidth = NEON.TRAIL_W * 2.6;
        ctx.stroke();
        ctx.strokeStyle = col.trail + "aa";
        ctx.lineWidth = NEON.TRAIL_W * 1.2;
        ctx.stroke();
        ctx.strokeStyle = "#ffffffcc";
        ctx.lineWidth = NEON.TRAIL_W * 0.35;
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";

      // tyre smoke when drifting hard
      smokeAcc += dtFrame;
      const emit = smokeAcc > 1 / 40;
      if (emit) smokeAcc = 0;
      for (const c of drawCars) {
        if (!emit || !c.alive || Math.abs(c.steer) < 0.55) continue;
        const bx = c.x - Math.cos(c.ang) * 12, by = c.y - Math.sin(c.ang) * 12;
        for (const side of [-1, 1]) smoke.push({ x: bx - Math.sin(c.ang) * 7 * side, y: by + Math.cos(c.ang) * 7 * side, vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 20, life: 1 });
      }
      for (let i = smoke.length - 1; i >= 0; i--) {
        const p = smoke[i];
        p.x += p.vx * dtFrame; p.y += p.vy * dtFrame; p.life -= dtFrame / 0.7;
        if (p.life <= 0) { smoke.splice(i, 1); continue; }
        ctx.fillStyle = `rgba(200,210,230,${0.18 * p.life})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 5 + (1 - p.life) * 9, 0, Math.PI * 2); ctx.fill();
      }
      if (smoke.length > 400) smoke.splice(0, smoke.length - 400);

      // cars
      for (const c of drawCars) {
        if (!c.alive) continue;
        const col = colorOf(c.id);
        ctx.save();
        ctx.translate(c.x, c.y);
        if (c.power === "shield") {
          ctx.strokeStyle = "rgba(120,220,255,0.9)";
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(0, 0, NEON.CAR_R * 2, 0, Math.PI * 2); ctx.stroke();
        }
        // drift: the body yaws into the turn a little beyond the direction of travel
        ctx.rotate(c.ang + c.steer * 0.32);
        if (c.boosting || c.power === "turbo") {
          const fl = 10 + Math.random() * 10;
          ctx.fillStyle = c.power === "turbo" ? "#7cf" : "#ff8a00";
          ctx.beginPath(); ctx.moveTo(-14, -5); ctx.lineTo(-14 - fl, 0); ctx.lineTo(-14, 5); ctx.fill();
        }
        ctx.shadowColor = col.trail;
        ctx.shadowBlur = 16;
        ctx.fillStyle = col.car;
        ctx.beginPath(); ctx.roundRect(-14, -8, 28, 16, 5); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(10,15,30,0.85)";
        ctx.beginPath(); ctx.roundRect(1, -6, 7, 12, 2); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.fillRect(-10, -6, 8, 2); ctx.fillRect(-10, 4, 8, 2);
        ctx.fillStyle = "#fffbe0";
        ctx.fillRect(12, -7, 3, 3); ctx.fillRect(12, 4, 3, 3);
        ctx.restore();
        // name tag
        const name = m?.players.find((p) => p.id === c.id)?.nickname ?? "";
        ctx.font = "bold 12px system-ui";
        ctx.fillStyle = c.id === meRef.current ? "#fff" : "rgba(255,255,255,0.75)";
        ctx.fillText(c.id === meRef.current ? `${name} (you)` : name, c.x, c.y - 24);
      }

      // explosions
      for (const d of w.deaths) {
        if (seenDeaths.has(`${d.id}:${d.at}`)) continue;
        seenDeaths.add(`${d.id}:${d.at}`);
        const col = colorOf(d.id);
        for (let i = 0; i < 40; i++) {
          const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 260;
          sparks.push({ x: d.x, y: d.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, c: i % 3 ? col.trail : "#ffffff", life: 1 });
        }
      }
      ctx.globalCompositeOperation = "lighter";
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx / 60; s.y += s.vy / 60; s.vx *= 0.95; s.vy *= 0.95; s.life -= 1 / 50;
        if (s.life <= 0) { sparks.splice(i, 1); continue; }
        ctx.fillStyle = s.c;
        ctx.globalAlpha = s.life;
        ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.restore();

      // aim line from the car toward the pointer (mouse only)
      if (kk.pointer && mineDraw && !touchRef.current) {
        const sx = W / 2 + (mineDraw.x - cam.x) * zoom, sy = H / 2 + (mineDraw.y - cam.y) * zoom;
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 8]);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(kk.px, kk.py); ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = boostNow ? "rgba(255,150,40,0.9)" : "rgba(255,255,255,0.7)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(kk.px, kk.py, 9, 0, Math.PI * 2); ctx.stroke();
      }

      // minimap
      const mm = W < 700 ? 90 : 140, pad = 12;
      const mx = W - mm - pad, my = H - mm - pad - (W < 700 ? 90 : 0);
      ctx.fillStyle = "rgba(10,14,30,0.75)";
      ctx.strokeStyle = "rgba(255,61,129,0.7)";
      ctx.lineWidth = 1.5;
      ctx.fillRect(mx, my, mm, mm);
      ctx.strokeRect(mx, my, mm, mm);
      const k = mm / size;
      for (const c of drawCars) {
        if (!c.alive) continue;
        const tr = w.trails.get(c.id);
        const col = colorOf(c.id);
        if (tr && tr.length > 2) {
          ctx.strokeStyle = col.trail;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(mx + tr[0] * k, my + tr[1] * k);
          for (let i = 2; i < tr.length; i += 4) ctx.lineTo(mx + tr[i] * k, my + tr[i + 1] * k);
          ctx.stroke();
        }
        ctx.fillStyle = c.id === meRef.current ? "#fff" : col.car;
        ctx.beginPath(); ctx.arc(mx + c.x * k, my + c.y * k, c.id === meRef.current ? 3.5 : 2.5, 0, Math.PI * 2); ctx.fill();
      }

      if (now - hudAt > 150) {
        hudAt = now;
        const mc = w.cur?.cars.find((c) => c.id === meRef.current);
        setHud(mc ? { fuel: mc.fuel, power: mc.power, powerMs: mc.powerMs, alive: mc.alive, len: mc.len, boosting: mc.boosting, respawnMs: mc.respawnMs } : null);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [world]);

  if (g.error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-5xl">🏎️</p>
        <p className="mt-3 text-lg font-bold">{g.error}</p>
        <Link href="/neon" className="btn-primary mt-6">Back to NEON DRIFT</Link>
      </div>
    );
  }

  const act: Act = async (a) => {
    const r = await g.act(a);
    if (!r.ok) { setErr(r.error ?? "Not allowed"); setTimeout(() => setErr(null), 2600); }
    return r;
  };
  const isHost = meta?.hostId === me;
  const rows = [...(meta?.players ?? [])].sort((a, b) => b.score - a.score);

  return (
    <div className="relative h-[calc(100dvh-56px)] w-full select-none overflow-hidden bg-[#05070f] text-white sm:h-[calc(100dvh-57px)]" data-testid="nd-root">
      <canvas
        ref={canvas} data-testid="nd-canvas"
        className={`absolute inset-0 h-full w-full touch-none ${meta?.phase === "playing" ? "cursor-none" : ""}`}
        onPointerMove={onPointerMove} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") { keys.current.mouseBoost = false; (window as unknown as { __neonPush?: () => void }).__neonPush?.(); } }}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* top-left: room + feed */}
      <div className="pointer-events-none absolute left-3 top-3 max-w-[60%] space-y-1">
        <div className="pointer-events-auto flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-black/50 px-3 py-1 font-semibold ring-1 ring-white/15">🏎️ NEON DRIFT · <span className="font-mono">{code}</span></span>
          <InviteButton code={code} />
          {isHost && meta?.phase !== "lobby" && <button className="rounded-full bg-black/50 px-3 py-1 font-semibold ring-1 ring-white/15 hover:bg-black/70" onClick={() => void act({ type: "to_lobby" })}>Lobby</button>}
          {!g.connected && <span className="font-bold text-rose-300">Reconnecting…</span>}
        </div>
        <div className="hidden space-y-0.5 sm:block" data-testid="nd-feed">
          {meta?.feed.slice(-4).map((f) => <div key={f.at + f.text} className="w-fit rounded-lg bg-black/45 px-2 py-0.5 text-xs">{f.text}</div>)}
        </div>
      </div>

      {/* top-right: scoreboard */}
      {meta && meta.phase !== "lobby" && (
        <div className="pointer-events-none absolute right-3 top-3 w-44 rounded-2xl bg-black/50 p-2 text-xs ring-1 ring-white/10 sm:w-52" data-testid="nd-scores">
          {rows.slice(0, 8).map((p, i) => (
            <div key={p.id} className={`flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 ${p.id === me ? "bg-white/15" : ""}`}>
              <span className="w-4 text-white/50">{i + 1}</span>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: NEON_COLORS[p.color % NEON_COLORS.length].car }} />
              <span className="flex-1 truncate font-semibold">{p.nickname}{p.id === me ? " (you)" : ""}</span>
              <span className="text-white/60">💥{p.kills}</span>
              <span className="w-5 text-right font-black">{p.score}</span>
            </div>
          ))}
        </div>
      )}

      {/* bottom-left HUD */}
      {meta?.phase !== "lobby" && hud && (
        <div className={`pointer-events-none absolute left-3 ${touch ? "bottom-28" : "bottom-3"} w-48 space-y-1.5`} data-testid="nd-hud">
          <div className="rounded-xl bg-black/50 p-2 ring-1 ring-white/10">
            <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-white/60"><span>🔥 Boost</span><span>trail {hud.len}</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full ${hud.boosting ? "bg-orange-400" : "bg-cyan-400"}`} style={{ width: `${hud.fuel}%` }} /></div>
          </div>
          {hud.power && (
            <div className="rounded-xl bg-black/60 px-2 py-1.5 text-sm font-bold ring-1 ring-white/20">
              {NEON_POWERS[hud.power as keyof typeof NEON_POWERS].icon} {NEON_POWERS[hud.power as keyof typeof NEON_POWERS].label} · {(hud.powerMs / 1000).toFixed(1)}s
            </div>
          )}
          <div className="text-[10px] text-white/50">{touch ? "Drag anywhere to steer · 🔥 to boost" : "🖱️ Move the mouse to steer · hold click to boost (or ← → and Space)"}</div>
        </div>
      )}

      {/* banners */}
      {meta?.phase === "playing" && hud && !hud.alive && (
        <Banner title="💥 You crashed!" sub={hud.respawnMs > 0 ? `Back on the road in ${Math.ceil(hud.respawnMs / 1000)}…` : "Respawning…"} />
      )}

      {/* touch controls */}
      {touch && meta?.phase !== "lobby" && (
        <div className="pointer-events-none absolute bottom-0 right-0 p-4 pb-6">
          <div className="pointer-events-auto"><TouchBtn label="🔥" wide onDown={() => press("boost", true)} onUp={() => press("boost", false)} testid="nd-boost" /></div>
        </div>
      )}

      {meta?.phase === "lobby" && <Lobby meta={meta} me={me} isHost={isHost} act={act} err={err} />}
      {!meta && <div className="absolute inset-0 grid place-items-center text-sm text-white/70">{g.connected ? "Joining…" : "Waking up the game server… (can take ~30 s)"}</div>}
      {err && meta?.phase !== "lobby" && <div className="absolute left-1/2 top-16 -translate-x-1/2 rounded-xl bg-rose-600 px-3 py-1 text-sm font-bold">{err}</div>}
    </div>
  );
}

function Banner({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-[22%] -translate-x-1/2 animate-[slideL_.3s_ease-out] rounded-3xl bg-black/65 px-6 py-4 text-center ring-1 ring-white/20 backdrop-blur" data-testid="nd-banner">
      <div className="text-2xl font-black md:text-3xl">{title}</div>
      <div className="mt-1 text-sm text-white/70">{sub}</div>
    </div>
  );
}

function TouchBtn({ label, onDown, onUp, wide, testid }: { label: string; onDown: () => void; onUp: () => void; wide?: boolean; testid: string }) {
  return (
    <button
      type="button" data-testid={testid}
      onPointerDown={(e) => { e.preventDefault(); try { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* synthetic events */ } onDown(); }}
      onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onUp}
      onContextMenu={(e) => e.preventDefault()}
      className={`grid h-20 touch-none place-items-center rounded-3xl bg-white/10 text-3xl font-black ring-1 ring-white/25 backdrop-blur active:bg-white/30 ${wide ? "w-24" : "w-24 sm:w-28"}`}
    >
      {label}
    </button>
  );
}

function InviteButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = `${window.location.origin}/neon/${code}`;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share && /Mobi|Android/i.test(navigator.userAgent)) { try { await nav.share({ title: "Race me in NEON DRIFT", url }); return; } catch { /* fall through */ } }
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  };
  return <button onClick={share} className="rounded-full bg-black/50 px-3 py-1 font-semibold ring-1 ring-white/15 hover:bg-black/70">{copied ? "Copied ✓" : "🔗 Invite"}</button>;
}

function Lobby({ meta, me, isHost, act, err }: { meta: NeonMeta; me: string | null; isHost: boolean; act: Act; err: string | null }) {
  const url = typeof window !== "undefined" ? `${window.location.origin}/neon/${meta.code}` : `/neon/${meta.code}`;
  const humans = meta.players.filter((p) => !p.isBot);
  return (
    <div className="absolute inset-0 overflow-y-auto bg-[#05070f]/80 px-3 py-6 backdrop-blur-sm">
      <div className="mx-auto max-w-2xl rounded-3xl bg-[#0c1124] p-5 ring-1 ring-fuchsia-500/40" data-testid="nd-lobby">
        <h1 className="text-3xl font-black">🏎️ NEON DRIFT <span className="text-base font-bold text-white/50">· garage</span></h1>
        <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-white/60">Invite link</label>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <code className="flex-1 truncate rounded-xl bg-black/40 px-3 py-2 text-sm" data-testid="nd-invite">{url}</code>
          <InviteButton code={meta.code} />
        </div>
        <h3 className="mt-4 text-xs font-black uppercase tracking-wider text-white/60">Drivers {humans.length}</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {humans.map((p) => (
            <span key={p.id} className={`inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold ${p.id === me ? "ring-2 ring-white" : ""}`}>
              <span className="h-3 w-5 rounded" style={{ background: NEON_COLORS[p.color % NEON_COLORS.length].car, boxShadow: `0 0 10px ${NEON_COLORS[p.color % NEON_COLORS.length].trail}` }} />
              {p.nickname}{p.id === me ? " (you)" : ""}{p.id === meta.hostId ? " · host" : ""}
            </span>
          ))}
        </div>
        {isHost ? (
          <div className="mt-5 flex flex-wrap items-end gap-4">
            <label className="text-xs font-bold uppercase tracking-wider text-white/60">Arena
              <select className="mt-1 block rounded-xl bg-black/40 px-3 py-2 text-sm normal-case" value={meta.settings.arena} onChange={(e) => void act({ type: "settings", settings: { arena: e.target.value as "medium" } })}>
                <option value="small">Small (close fights)</option>
                <option value="medium">Medium</option>
                <option value="large">Large (big groups)</option>
              </select>
            </label>
            <label className="text-xs font-bold uppercase tracking-wider text-white/60">Bots
              <select className="mt-1 block rounded-xl bg-black/40 px-3 py-2 text-sm normal-case" value={meta.settings.bots} onChange={(e) => void act({ type: "settings", settings: { bots: Number(e.target.value) } })} data-testid="nd-bots">
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n} bot{n === 1 ? "" : "s"}</option>)}
              </select>
            </label>
            <button className="btn ml-auto bg-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/40 hover:bg-fuchsia-400" data-testid="nd-start" onClick={() => void act({ type: "start" })}>Start racing ▶</button>
          </div>
        ) : (
          <p className="mt-5 text-sm text-white/70">Waiting for <b>{meta.players.find((p) => p.id === meta.hostId)?.nickname ?? "the host"}</b> to start…</p>
        )}
        {err && <p className="mt-3 text-sm font-bold text-rose-300">{err}</p>}
        <Rules />
      </div>
    </div>
  );
}

export function Rules() {
  return (
    <details className="mt-5 text-sm" open>
      <summary className="cursor-pointer font-black">How to play</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-white/80">
        <li>Your car never stops. <b>Move the mouse</b> and the car drives toward it — <b>hold click to boost</b>. On a phone, drag anywhere to steer and hold 🔥 to boost. (Keyboard works too: ← → and Space.)</li>
        <li>You leave a glowing trail. <b>Touch someone else&apos;s trail or a wall and you crash.</b> Your own trail is safe — cut across it any time.</li>
        <li>Grab ⛽ gas to make your trail longer. Crashed cars drop their gas.</li>
        <li>Cut in front of rivals so they hit your trail: <b>+1</b> per kill. No rounds — crash and you&apos;re back in 3 seconds with a short trail and a moment of 🛡️ protection.</li>
        <li>Power-ups: 🛡️ Shield (drive through trails, 5s) · ⚡ Turbo (free speed, 5s) · 🧲 Magnet (pull gas, 8s).</li>
      </ul>
    </details>
  );
}
