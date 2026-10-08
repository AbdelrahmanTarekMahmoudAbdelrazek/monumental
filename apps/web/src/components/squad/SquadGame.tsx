"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  SQ, SQ_BUSHES, SQ_OBSTACLES, SQ_POWERS, SQ_ROLES, SQ_SHIELD, SQ_HEAL_PULSE, sqMove,
  type SqInput, type SqMeta, type SqPower, type SqRole, type SqTeam, type SqUnit,
} from "@monumental/shared";
import { useSquad } from "@/lib/useSquad";
import { serverNow } from "@/lib/socket";
import { sfx } from "@/lib/sound";
import { buildMap, buildSprites, drawBushes, SPRITE, TEAM_COLORS, type SpriteSet } from "./sprites";

type Act = ReturnType<typeof useSquad>["act"];
interface Hud {
  life: SqUnit["life"]; hp: number; maxHp: number; ammo: number; mag: number; reloading: boolean;
  cd: number; act: boolean; power: SqPower | null; powerMs: number; bubble: number; timer: number;
  role: SqRole; team: SqTeam; rev: number; prompt: string | null;
}
const LEAD = 0.05;
const ROLE_KEYS: SqRole[] = ["healer", "tank", "fighter"];

export default function SquadGame({ code, userToken }: { code: string; userToken: string | null }) {
  const g = useSquad(code, userToken);
  const { meta, me, world } = g;
  const canvas = useRef<HTMLCanvasElement>(null);
  const metaRef = useRef<SqMeta | null>(null);
  metaRef.current = meta;
  const meRef = useRef<string | null>(null);
  meRef.current = me;
  const [hud, setHud] = useState<Hud | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [touch, setTouch] = useState(false);
  const keys = useRef({ up: false, down: false, left: false, right: false, fire: false, ability: false, revive: false, reload: false });
  const mouse = useRef({ x: 0, y: 0, on: false });
  const sticks = useRef<{ move: { id: number; ox: number; oy: number; x: number; y: number } | null; aim: { id: number; ox: number; oy: number; x: number; y: number } | null }>({ move: null, aim: null });

  // ── keyboard + mouse ──
  useEffect(() => {
    setTouch("ontouchstart" in window || navigator.maxTouchPoints > 0);
    const map: Record<string, keyof typeof keys.current> = {
      w: "up", arrowup: "up", s: "down", arrowdown: "down", a: "left", arrowleft: "left", d: "right", arrowright: "right",
      e: "revive", f: "revive", r: "reload", q: "ability", shift: "ability", " ": "ability",
    };
    const set = (e: KeyboardEvent, v: boolean) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const k = map[e.key.toLowerCase()];
      if (!k) return;
      keys.current[k] = v;
      e.preventDefault();
    };
    const down = (e: KeyboardEvent) => set(e, true);
    const up = (e: KeyboardEvent) => set(e, false);
    const blur = () => { for (const k of Object.keys(keys.current) as (keyof typeof keys.current)[]) keys.current[k] = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);

  // ── sounds from the kill feed ──
  const lastFeed = useRef(0);
  useEffect(() => {
    const f = meta?.feed[meta.feed.length - 1];
    if (!f || f.at === lastFeed.current) return;
    lastFeed.current = f.at;
    if (f.verb === "eliminated") sfx.miss();
    else if (f.verb === "revived") sfx.points();
    else if (f.verb === "knocked down") sfx.tick();
  }, [meta?.feed]);
  const phase = meta?.phase;
  useEffect(() => { if (phase === "ended") sfx.win(); if (phase === "playing") sfx.roundStart(); }, [phase]);

  // ── render loop ──
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    let raf = 0;
    let sprites: Record<string, SpriteSet> | null = null;
    const mapCanvas = buildMap();
    void buildSprites().then((s) => { sprites = s; });
    const preds = new Map<string, { tick: number; base: SqUnit | null; baseAt: number; ex: number; ey: number }>();
    const ghosts = new Map<string, { x: number; y: number; a: number; at: number }[]>();
    const cam = { x: SQ.MAP_W / 2, y: SQ.MAP_H / 2, init: false, lx: 0, ly: 0 };
    let aim = 0;
    let sent: SqInput | null = null;
    let sentAt = 0;
    let seq = 0;
    let last = performance.now();
    let hudAt = 0;
    let shake = 0;

    /** Where a unit is "now": the newest server state pushed forward by elapsed time (mine with my live keys). */
    const extrapolate = (u: SqUnit, secs: number, mine: boolean, mx: number, my: number) => {
      let x = u.x, y = u.y;
      if (u.life === "dead") return [x, y] as const;
      if (!mine || u.act) { [x, y] = sqMove(x, y, u.vx * secs, u.vy * secs); return [x, y] as const; }
      const def = SQ_ROLES[u.role];
      const speed = u.life === "down" ? SQ.CRAWL_SPEED : def.speed * (u.power === "speed" ? 1.35 : 1);
      const l = Math.hypot(mx, my) || 1;
      const h = 1 / 120;
      for (let left = secs; left > 1e-6; left -= h) {
        const dt = Math.min(h, left);
        [x, y] = sqMove(x, y, (mx / Math.max(1, l)) * speed * dt, (my / Math.max(1, l)) * speed * dt);
      }
      return [x, y] as const;
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = cv.clientWidth, H = cv.clientHeight;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const m = metaRef.current;
      const w = world.current;
      const cur = w.cur;
      const myId = meRef.current;
      const elapsed = cur ? Math.min(0.25, (now - w.curAt) / 1000 + LEAD) : 0;
      const T = cur ? cur.t + elapsed * 1000 : 0;

      // input direction
      const k = keys.current;
      let mx = (k.right ? 1 : 0) - (k.left ? 1 : 0), my = (k.down ? 1 : 0) - (k.up ? 1 : 0);
      const st = sticks.current;
      if (st.move) { const dx = st.move.x - st.move.ox, dy = st.move.y - st.move.oy, d = Math.hypot(dx, dy); if (d > 8) { mx = dx / Math.max(d, 50); my = dy / Math.max(d, 50); } }
      const ml = Math.hypot(mx, my);
      if (ml > 1) { mx /= ml; my /= ml; }

      // units at "now"
      const draw: (SqUnit & { dx: number; dy: number; ang: number })[] = [];
      let mine: (typeof draw)[number] | null = null;
      const decay = Math.exp(-dt / 0.08);
      for (const u of cur?.units ?? []) {
        let pr = preds.get(u.id);
        if (!pr) { pr = { tick: -1, base: null, baseAt: 0, ex: 0, ey: 0 }; preds.set(u.id, pr); }
        const isMe = u.id === myId;
        if (u.life === "dead") { pr.base = null; continue; }
        const [x, y] = extrapolate(u, elapsed, isMe, mx, my);
        if (cur && pr.tick !== cur.tick) {
          if (pr.base && pr.base.life === u.life) {
            const [ox, oy] = extrapolate(pr.base, Math.min(0.25, (now - pr.baseAt) / 1000 + LEAD), isMe, mx, my);
            const ex = ox + pr.ex - x, ey = oy + pr.ey - y;
            if (Math.hypot(ex, ey) < 90) { pr.ex = ex; pr.ey = ey; } else { pr.ex = pr.ey = 0; }
          } else { pr.ex = pr.ey = 0; }
          pr.tick = cur.tick; pr.base = u; pr.baseAt = w.curAt;
        }
        pr.ex *= decay; pr.ey *= decay;
        const d = { ...u, dx: x + pr.ex, dy: y + pr.ey, ang: isMe ? aim : u.a / 1000 };
        draw.push(d);
        if (isMe) mine = d;
      }

      // camera: follow me, leaning toward the mouse / aim stick
      const zoom = Math.max(W, H) / (W < 700 ? 1000 : 1500);
      const focus = mine ?? draw.find((u) => u.team === m?.players.find((p) => p.id === myId)?.team) ?? null;
      if (focus) {
        let lx = 0, ly = 0;
        if (mouse.current.on && !touch) { lx = (mouse.current.x - W / 2) * 0.25 / zoom; ly = (mouse.current.y - H / 2) * 0.25 / zoom; }
        else if (st.aim) { lx = (st.aim.x - st.aim.ox) * 1.2; ly = (st.aim.y - st.aim.oy) * 1.2; }
        const le = 1 - Math.exp(-dt / 0.25);
        cam.lx += (lx - cam.lx) * le; cam.ly += (ly - cam.ly) * le;
        const tx = focus.dx + cam.lx, ty = focus.dy + cam.ly;
        if (!cam.init || Math.hypot(tx - cam.x, ty - cam.y) > 500) { cam.x = tx; cam.y = ty; cam.init = true; }
        else if (focus === mine) { cam.x = tx; cam.y = ty; }
        else { const e = 1 - Math.exp(-dt / 0.15); cam.x += (tx - cam.x) * e; cam.y += (ty - cam.y) * e; }
      }
      const hurtMe = myId ? w.hurt.get(myId) ?? 0 : 0;
      if (now - hurtMe < 40) shake = 7;
      shake *= Math.exp(-dt / 0.07);
      const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;

      // aim (world angle from my character to the pointer / aim stick)
      if (mine) {
        if (st.aim) { const dx = st.aim.x - st.aim.ox, dy = st.aim.y - st.aim.oy; if (Math.hypot(dx, dy) > 10) aim = Math.atan2(dy, dx); }
        else if (mouse.current.on) {
          const px = W / 2 + (mine.dx - cam.x) * zoom, py = H / 2 + (mine.dy - cam.y) * zoom;
          aim = Math.atan2(mouse.current.y - py, mouse.current.x - px);
        }
      }

      // send input when it changes
      const stickFire = !!st.aim && Math.hypot(st.aim.x - st.aim.ox, st.aim.y - st.aim.oy) > 28;
      const inp: SqInput = { mx: Math.round(mx * 100) / 100, my: Math.round(my * 100) / 100, aim: Math.round(aim * 1000) / 1000, fire: k.fire || stickFire, ability: k.ability, revive: k.revive, reload: k.reload, seq };
      if (m?.phase === "playing") {
        const changed = !sent || sent.mx !== inp.mx || sent.my !== inp.my || sent.fire !== inp.fire || sent.ability !== inp.ability || sent.revive !== inp.revive || sent.reload !== inp.reload;
        const aimMoved = !!sent && Math.abs(sent.aim - inp.aim) > 0.015 && now - sentAt > 33;
        if (changed || aimMoved || now - sentAt > 500) { inp.seq = ++seq; g.input(inp); sent = inp; sentAt = now; }
      }

      // ── world ──
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#0B1118";
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2 + sx, H / 2 + sy);
      ctx.scale(zoom, zoom);
      ctx.translate(-cam.x, -cam.y);
      ctx.drawImage(mapCanvas, 0, 0);

      // power-ups
      for (const p of w.powers) {
        const bob = Math.sin(now / 300 + p.id) * 4;
        const col = SQ_POWERS[p.kind].color;
        ctx.save();
        ctx.translate(p.x, p.y + bob);
        ctx.shadowColor = col; ctx.shadowBlur = 22;
        ctx.fillStyle = "rgba(11,17,24,0.85)";
        ctx.strokeStyle = col; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.roundRect(-22, -22, 44, 44, 11); ctx.fill(); ctx.stroke();
        ctx.shadowBlur = 0;
        drawPowerIcon(ctx, p.kind, col);
        ctx.restore();
      }

      // heal pulses
      for (let i = w.fx.pulses.length - 1; i >= 0; i--) {
        const p = w.fx.pulses[i];
        const a = (now - p.at) / 600;
        if (a > 1) { w.fx.pulses.splice(i, 1); continue; }
        ctx.strokeStyle = `rgba(61,214,140,${1 - a})`;
        ctx.lineWidth = 8 * (1 - a) + 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, SQ_HEAL_PULSE.radius * Math.min(1, a * 1.4), 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = `rgba(61,214,140,${0.12 * (1 - a)})`;
        ctx.fill();
      }

      // units (lower ones drawn last)
      draw.sort((a, b) => a.dy - b.dy);
      for (const u of draw) {
        const spr = sprites?.[`${u.role}:${u.team}`];
        const col = TEAM_COLORS[u.team];
        // dash ghosts
        const gh = ghosts.get(u.id) ?? [];
        if (u.act && u.role === "fighter") { gh.push({ x: u.dx, y: u.dy, a: u.ang, at: now }); ghosts.set(u.id, gh); }
        for (let i = gh.length - 1; i >= 0; i--) {
          const age = (now - gh[i].at) / 250;
          if (age > 1) { gh.splice(i, 1); continue; }
          if (!spr) continue;
          ctx.save(); ctx.globalAlpha = 0.35 * (1 - age); ctx.translate(gh[i].x, gh[i].y); ctx.rotate(gh[i].a);
          ctx.drawImage(spr.white, -SPRITE / 2, -SPRITE / 2, SPRITE, SPRITE); ctx.restore();
        }
        ctx.save();
        ctx.translate(u.dx, u.dy);
        if (u.life === "down") {
          // knocked down: grey, lying, bleed-out timer + revive progress
          ctx.save(); ctx.rotate(u.ang + 1.3);
          if (spr) ctx.drawImage(spr.grey, -SPRITE / 2, -SPRITE / 2, SPRITE, SPRITE);
          ctx.restore();
          const bleed = Math.max(0, Math.min(1, u.timer / SQ.BLEED_MS));
          ctx.strokeStyle = "rgba(229,72,77,0.85)"; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(0, 0, 34, -Math.PI / 2, -Math.PI / 2 + bleed * Math.PI * 2); ctx.stroke();
          if (u.rev > 0) {
            ctx.strokeStyle = "#3DD68C"; ctx.lineWidth = 7; ctx.shadowColor = "#3DD68C"; ctx.shadowBlur = 14;
            ctx.beginPath(); ctx.arc(0, 0, 42, -Math.PI / 2, -Math.PI / 2 + (u.rev / 100) * Math.PI * 2); ctx.stroke();
            ctx.shadowBlur = 0;
          }
        } else {
          const moving = Math.hypot(u.vx, u.vy) > 20;
          const bob = moving ? Math.sin(now / 65) * 0.04 : 0;
          const flashAge = now - (w.fx.flashes.get(u.id) ?? 0);
          const recoil = flashAge < 90 ? -5 * (1 - flashAge / 90) * (u.role === "tank" ? 1.6 : 1) : 0;
          if (u.power === "speed") {
            ctx.strokeStyle = "rgba(125,211,252,0.5)"; ctx.lineWidth = 2;
            for (let i = 0; i < 3; i++) { const o = (i - 1) * 9; ctx.beginPath(); ctx.moveTo(-Math.cos(u.ang) * 26 - Math.sin(u.ang) * o, -Math.sin(u.ang) * 26 + Math.cos(u.ang) * o); ctx.lineTo(-Math.cos(u.ang) * 44 - Math.sin(u.ang) * o, -Math.sin(u.ang) * 44 + Math.cos(u.ang) * o); ctx.stroke(); }
          }
          ctx.save();
          ctx.rotate(u.ang);
          ctx.scale(1 + bob, 1 - bob);
          if (spr) {
            ctx.drawImage(spr.normal, -SPRITE / 2 + recoil, -SPRITE / 2, SPRITE, SPRITE);
            const hurt = now - (w.hurt.get(u.id) ?? 0);
            if (hurt < 120) { ctx.globalAlpha = 0.75 * (1 - hurt / 120); ctx.drawImage(spr.white, -SPRITE / 2 + recoil, -SPRITE / 2, SPRITE, SPRITE); ctx.globalAlpha = 1; }
          } else {
            ctx.fillStyle = col.main; ctx.beginPath(); ctx.arc(0, 0, SQ.R, 0, Math.PI * 2); ctx.fill();
          }
          if (flashAge < 60) {
            const tip = u.role === "fighter" ? 46 : u.role === "tank" ? 46 : 40;
            const grd = ctx.createRadialGradient(tip, 0, 0, tip, 0, 18);
            grd.addColorStop(0, "rgba(255,246,214,1)"); grd.addColorStop(0.4, "rgba(255,178,36,0.9)"); grd.addColorStop(1, "rgba(255,178,36,0)");
            ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(tip, 0, 18, 0, Math.PI * 2); ctx.fill();
          }
          if (u.role === "tank" && u.act) {
            ctx.strokeStyle = col.text; ctx.lineWidth = 9; ctx.lineCap = "round";
            ctx.shadowColor = col.main; ctx.shadowBlur = 18;
            ctx.beginPath(); ctx.arc(0, 0, SQ_SHIELD.radius, -SQ_SHIELD.halfAngle, SQ_SHIELD.halfAngle); ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(0, 0, SQ_SHIELD.radius + 5, -SQ_SHIELD.halfAngle * 0.8, SQ_SHIELD.halfAngle * 0.8); ctx.stroke();
          }
          ctx.restore();
          if (u.bubble > 0) {
            ctx.strokeStyle = `rgba(196,181,253,${0.55 + Math.sin(now / 150) * 0.2})`; ctx.lineWidth = 3;
            ctx.fillStyle = "rgba(196,181,253,0.12)";
            ctx.beginPath(); ctx.arc(0, 0, SQ.R + 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          }
        }
        // name + health
        const p = m?.players.find((x) => x.id === u.id);
        const isMe = u.id === myId;
        ctx.textAlign = "center";
        ctx.font = "bold 13px Barlow, system-ui, sans-serif";
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillText(isMe ? "You" : p?.nickname ?? "", 1, -45);
        ctx.fillStyle = isMe ? "#FFFFFF" : col.text;
        ctx.fillText(isMe ? "You" : p?.nickname ?? "", 0, -46);
        const bw = 50, pct = Math.max(0, Math.min(1, u.hp / u.maxHp));
        ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(-bw / 2 - 1, -40, bw + 2, 7);
        ctx.fillStyle = u.life === "down" ? "#E5484D" : isMe ? "#3DD68C" : col.main;
        ctx.fillRect(-bw / 2, -39, bw * pct, 5);
        if (u.life === "down") { ctx.font = "bold 11px Barlow, sans-serif"; ctx.fillStyle = "#FF8A8E"; ctx.fillText("DOWN", 0, 52); }
        ctx.restore();
      }

      // bullets
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      for (const [id, b] of w.bullets) {
        const dist = ((T - b.t0) / 1000) * b.speed;
        const max = b.stopDist ?? b.range;
        if (dist >= max) {
          if (b.stopDist !== null) w.fx.sparks.push({ x: b.x0 + Math.cos(b.a) * max, y: b.y0 + Math.sin(b.a) * max, at: now, kind: b.stopKind });
          w.bullets.delete(id);
          continue;
        }
        if (dist < 0) continue;
        const d0 = Math.max(0, dist - 46), d1 = Math.min(dist, max);
        const x0 = b.x0 + Math.cos(b.a) * d0, y0 = b.y0 + Math.sin(b.a) * d0, x1 = b.x0 + Math.cos(b.a) * d1, y1 = b.y0 + Math.sin(b.a) * d1;
        const tc = b.team === 0 ? "255,150,120" : "140,190,255";
        ctx.strokeStyle = `rgba(${tc},0.35)`; ctx.lineWidth = 7;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.strokeStyle = "rgba(255,240,200,0.95)"; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
      // impact sparks
      for (let i = w.fx.sparks.length - 1; i >= 0; i--) {
        const s = w.fx.sparks[i];
        const a = (now - s.at) / 260;
        if (a > 1) { w.fx.sparks.splice(i, 1); continue; }
        const c = s.kind === 1 ? "255,120,110" : s.kind === 2 ? "140,190,255" : "220,210,190";
        ctx.strokeStyle = `rgba(${c},${1 - a})`; ctx.lineWidth = 2.5;
        for (let j = 0; j < 7; j++) {
          const an = j * 0.9 + s.x * 0.01, r0 = 4 + a * 10, r1 = 8 + a * 22;
          ctx.beginPath(); ctx.moveTo(s.x + Math.cos(an) * r0, s.y + Math.sin(an) * r0); ctx.lineTo(s.x + Math.cos(an) * r1, s.y + Math.sin(an) * r1); ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = "source-over";

      // bushes over everything (you can hide); see-through when you're inside one
      drawBushes(ctx, (i) => (mine && Math.hypot(SQ_BUSHES[i].x - mine.dx, SQ_BUSHES[i].y - mine.dy) < SQ_BUSHES[i].r + 10 ? 0.45 : 1));

      // damage numbers
      ctx.textAlign = "center";
      for (let i = w.fx.numbers.length - 1; i >= 0; i--) {
        const n = w.fx.numbers[i];
        const a = (now - n.at) / 750;
        if (a > 1) { w.fx.numbers.splice(i, 1); continue; }
        ctx.globalAlpha = 1 - a * a;
        ctx.font = `bold ${n.amount === 0 ? 14 : 18 + Math.min(10, n.amount / 3)}px "Chakra Petch", system-ui, sans-serif`;
        ctx.fillStyle = "#000";
        const label = n.amount === 0 ? "BLOCKED" : `-${n.amount}`;
        ctx.fillText(label, n.x + 2, n.y - 18 - a * 40 + 2);
        ctx.fillStyle = n.amount === 0 ? "#C4B5FD" : "#FFD27A";
        ctx.fillText(label, n.x, n.y - 18 - a * 40);
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // ── screen space: minimap + crosshair ──
      const mmW = W < 700 ? 120 : 210, mmH = mmW * (SQ.MAP_H / SQ.MAP_W), mx0 = 16, my0 = 16;
      ctx.fillStyle = "rgba(11,17,24,0.82)"; ctx.fillRect(mx0, my0, mmW, mmH);
      ctx.strokeStyle = "#2A3848"; ctx.lineWidth = 1.5; ctx.strokeRect(mx0, my0, mmW, mmH);
      const kk = mmW / SQ.MAP_W;
      ctx.fillStyle = "#56636F";
      for (const o of SQ_OBSTACLES) ctx.fillRect(mx0 + o.x * kk, my0 + o.y * kk, Math.max(2, o.w * kk), Math.max(2, o.h * kk));
      const myTeam = mine?.team ?? m?.players.find((p) => p.id === myId)?.team;
      for (const u of draw) {
        // enemies only show on the map when they're shooting
        if (u.team !== myTeam && now - (w.fx.flashes.get(u.id) ?? 0) > 1500) continue;
        ctx.fillStyle = u.id === myId ? "#FFFFFF" : TEAM_COLORS[u.team].main;
        ctx.beginPath(); ctx.arc(mx0 + u.dx * kk, my0 + u.dy * kk, u.id === myId ? 4 : 3, 0, Math.PI * 2); ctx.fill();
      }
      if (mouse.current.on && !touch && m?.phase === "playing") {
        const { x, y } = mouse.current;
        ctx.strokeStyle = k.fire ? "#FFB224" : "rgba(255,255,255,0.9)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 18, y); ctx.lineTo(x - 13, y); ctx.moveTo(x + 13, y); ctx.lineTo(x + 18, y); ctx.moveTo(x, y - 18); ctx.lineTo(x, y - 13); ctx.moveTo(x, y + 13); ctx.lineTo(x, y + 18); ctx.stroke();
      }

      // HUD state (throttled)
      if (now - hudAt > 100) {
        hudAt = now;
        const u = cur?.units.find((x) => x.id === myId);
        if (u) {
          let prompt: string | null = null;
          if (u.life === "alive" && mine) {
            const d = draw.find((o) => o.team === u.team && o.life === "down" && Math.hypot(o.dx - mine!.dx, o.dy - mine!.dy) < SQ.REVIVE_RANGE + 30);
            if (d) prompt = m?.players.find((p) => p.id === d.id)?.nickname ?? "teammate";
          }
          setHud({
            life: u.life, hp: u.hp, maxHp: u.maxHp, ammo: u.ammo, mag: SQ_ROLES[u.role].weapon.mag, reloading: u.reloading,
            cd: u.cd, act: u.act, power: u.power, powerMs: u.powerMs, bubble: u.bubble, timer: u.timer, role: u.role, team: u.team, rev: u.rev, prompt,
          });
        } else setHud(null);
      }
      (window as unknown as { __sqTrace?: number[][] }).__sqTrace?.push([now, mine?.dx ?? 0, mine?.dy ?? 0]);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [world, touch]); // eslint-disable-line react-hooks/exhaustive-deps

  if (g.error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-lg font-bold">{g.error}</p>
        <Link href="/squad" className="btn-primary mt-6">Back to SQUAD RUSH</Link>
      </div>
    );
  }

  const act: Act = async (a) => {
    const r = await g.act(a);
    if (!r.ok) { setErr(r.error ?? "Not allowed"); setTimeout(() => setErr(null), 2600); }
    return r;
  };
  const isHost = meta?.hostId === me;
  const myP = meta?.players.find((p) => p.id === me);
  const secs = meta?.endsAt ? Math.max(0, Math.ceil((meta.endsAt - serverNow()) / 1000)) : 0;

  // pointer handling on the canvas
  const onPointerMove = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (e.pointerType === "mouse") { mouse.current = { x: e.clientX - r.left, y: e.clientY - r.top, on: true }; return; }
    const st = sticks.current;
    if (st.move?.id === e.pointerId) { st.move.x = e.clientX; st.move.y = e.clientY; }
    if (st.aim?.id === e.pointerId) { st.aim.x = e.clientX; st.aim.y = e.clientY; }
  };
  const onPointerDown = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (e.pointerType === "mouse") {
      mouse.current = { x: e.clientX - r.left, y: e.clientY - r.top, on: true };
      if (e.button === 0) keys.current.fire = true;
      if (e.button === 2) keys.current.ability = true;
      return;
    }
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const st = sticks.current;
    const s = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
    if (e.clientX - r.left < r.width / 2) st.move = s; else st.aim = s;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") {
      if (e.button === 0) keys.current.fire = false;
      if (e.button === 2) keys.current.ability = false;
      return;
    }
    const st = sticks.current;
    if (st.move?.id === e.pointerId) st.move = null;
    if (st.aim?.id === e.pointerId) st.aim = null;
  };
  const hold = (k: "ability" | "revive" | "reload") => ({
    onPointerDown: (e: React.PointerEvent) => { e.stopPropagation(); keys.current[k] = true; },
    onPointerUp: () => { keys.current[k] = false; },
    onPointerLeave: () => { keys.current[k] = false; },
    onPointerCancel: () => { keys.current[k] = false; },
  });

  const mySquad = meta?.players.filter((p) => p.team === myP?.team) ?? [];
  const units = world.current.cur?.units ?? [];

  return (
    <div className="relative h-[calc(100dvh-56px)] w-full select-none overflow-hidden bg-[#0B1118] font-['Barlow',system-ui,sans-serif] text-white" data-testid="sq-root">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@600;700&family=Barlow:wght@400;600;700&display=swap" rel="stylesheet" />
      <canvas
        ref={canvas} data-testid="sq-canvas"
        className={`absolute inset-0 h-full w-full touch-none ${meta?.phase === "playing" && !touch ? "cursor-none" : ""}`}
        onPointerMove={onPointerMove} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") { keys.current.fire = false; mouse.current.on = false; } }}
        onContextMenu={(e) => e.preventDefault()}
      />

      {meta?.phase === "playing" && (
        <>
          {/* score + time */}
          <div className="pointer-events-none absolute right-3 top-3 flex items-stretch overflow-hidden rounded-2xl sm:right-auto sm:left-1/2 sm:-translate-x-1/2 border border-[#2A3848] bg-[#0B1118]/90" data-testid="sq-score">
            <div className="bg-[#E5484D]/25 px-5 py-1.5 text-center"><div className="text-[10px] font-bold tracking-[0.16em] text-[#FF8A8E]">RED</div><div className="font-['Chakra_Petch',system-ui,sans-serif] text-3xl font-bold leading-none">{meta.score.red}</div></div>
            <div className="flex flex-col items-center justify-center px-4"><div className="font-['Chakra_Petch',system-ui,sans-serif] text-xl font-bold">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</div><div className="text-[10px] text-[#8A97A8]">first to {meta.settings.target}</div></div>
            <div className="bg-[#3E8BFF]/25 px-5 py-1.5 text-center"><div className="text-[10px] font-bold tracking-[0.16em] text-[#8AB8FF]">BLUE</div><div className="font-['Chakra_Petch',system-ui,sans-serif] text-3xl font-bold leading-none">{meta.score.blue}</div></div>
          </div>
          {/* kill feed */}
          <div className="pointer-events-none absolute right-3 top-3 hidden flex-col items-end gap-1 sm:flex" data-testid="sq-feed">
            {meta.feed.slice(-5).map((f) => (
              <div key={f.at + f.b + f.verb} className="flex items-center gap-2 rounded-lg bg-[#0B1118]/80 px-3 py-1 text-sm font-semibold">
                <span style={{ color: f.at_ ? TEAM_COLORS[f.at_].text : "#C9D3DF" }}>{f.a}</span>
                <span className="text-xs text-[#8A97A8]">{f.verb}</span>
                <span style={{ color: f.bt ? TEAM_COLORS[f.bt].text : "#C9D3DF" }}>{f.b}</span>
              </div>
            ))}
          </div>
          {/* invite + lobby */}
          <div className="absolute left-4 flex gap-2 text-xs" style={{ top: touch ? 16 + 82 : 16 + 135 }}>
            <InviteButton code={code} />
            {isHost && <button className="rounded-full border border-[#2A3848] bg-[#0B1118]/80 px-3 py-1 font-semibold" onClick={() => void act({ type: "to_lobby" })}>End match</button>}
          </div>

          {hud && (
            <>
              {/* my status */}
              <div className={`pointer-events-none absolute left-3 ${touch ? "top-[136px] w-52 p-2" : "bottom-3 w-72 p-3"} flex items-center gap-3 rounded-2xl border border-[#2A3848] bg-[#0B1118]/90`} data-testid="sq-me">
                <div className="flex-1">
                  <div className="flex items-baseline justify-between">
                    <span className="font-['Chakra_Petch',system-ui,sans-serif] text-lg font-bold tracking-wide" style={{ color: SQ_ROLES[hud.role].accent }}>{SQ_ROLES[hud.role].label.toUpperCase()}</span>
                    <span className="text-sm font-bold">{Math.ceil(hud.hp)} / {hud.maxHp}</span>
                  </div>
                  <div className="mt-1 h-3 overflow-hidden rounded-full bg-[#1E2834]"><div className="h-full rounded-full" style={{ width: `${Math.max(0, (hud.hp / hud.maxHp) * 100)}%`, background: hud.life === "down" ? "#E5484D" : "linear-gradient(90deg,#2FCB7E,#3DD68C)" }} /></div>
                  <div className="mt-1 text-xs text-[#8A97A8]">{SQ_ROLES[hud.role].weapon.name} · {hud.reloading ? <b className="text-[#FFB224]">reloading…</b> : <><b className="text-white">{hud.ammo}</b> / {hud.mag}</>}{hud.power ? <> · <b style={{ color: SQ_POWERS[hud.power].color }}>{SQ_POWERS[hud.power].label}{hud.powerMs ? ` ${(hud.powerMs / 1000).toFixed(0)}s` : ""}</b></> : null}</div>
                </div>
              </div>
              {/* abilities */}
              {!touch && (
                <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2" data-testid="sq-abilities">
                  <Slot k="LMB" label="Shoot" color="#E8EDF3" />
                  <Slot k="RMB" label={SQ_ROLES[hud.role].ability.name} color={SQ_ROLES[hud.role].accent} cd={hud.cd} active={hud.act} />
                  <Slot k="E" label="Revive" color="#3DD68C" dim={!hud.prompt} />
                  <Slot k="R" label="Reload" color="#C9D3DF" />
                </div>
              )}
              {/* squad */}
              <div className="pointer-events-none absolute bottom-3 right-3 hidden w-60 flex-col gap-1.5 rounded-2xl border border-[#2A3848] bg-[#0B1118]/90 p-3 md:flex" data-testid="sq-squad">
                <span className="text-[10px] font-bold tracking-[0.16em] text-[#8A97A8]">YOUR SQUAD</span>
                {mySquad.map((p) => {
                  const u = units.find((x) => x.id === p.id);
                  const state = !u ? "—" : u.life === "dead" ? `RESPAWN ${Math.ceil(u.timer / 1000)}` : u.life === "down" ? `DOWN ${Math.ceil(u.timer / 1000)}s` : SQ_ROLES[u.role].label.toUpperCase();
                  return (
                    <div key={p.id} className="grid grid-cols-[70px_minmax(0,1fr)_76px] items-center gap-2">
                      <span className="truncate text-sm font-bold">{p.id === me ? "You" : p.nickname}</span>
                      <div className="h-1.5 overflow-hidden rounded bg-[#1E2834]"><div className="h-full" style={{ width: `${u && u.life === "alive" ? (u.hp / u.maxHp) * 100 : 0}%`, background: u ? SQ_ROLES[u.role].accent : "#8A97A8" }} /></div>
                      <span className="text-right text-[10px] font-bold tracking-wider" style={{ color: u?.life === "down" ? "#FF8A8E" : u?.life === "dead" ? "#8A97A8" : u ? SQ_ROLES[u.role].accent : "#8A97A8" }}>{state}</span>
                    </div>
                  );
                })}
              </div>
              {/* prompts */}
              {hud.life === "alive" && hud.prompt && (
                <div className="pointer-events-none absolute left-1/2 top-[64%] flex -translate-x-1/2 items-center gap-2 rounded-xl border border-[#3DD68C] bg-[#0B1118]/90 px-4 py-2" data-testid="sq-prompt">
                  <span className="rounded-md bg-[#3DD68C] px-2 py-0.5 font-['Chakra_Petch',system-ui,sans-serif] text-xs font-bold text-[#0B1118]">{touch ? "HOLD ✚" : "HOLD E"}</span>
                  <span className="text-sm font-bold">Revive {hud.prompt} · {SQ_ROLES[hud.role].reviveMs / 1000}s</span>
                </div>
              )}
              {hud.life === "down" && (
                <Banner title="KNOCKED DOWN" sub={hud.rev > 0 ? `Being revived… ${hud.rev}%` : `Crawl to a teammate! Bleeding out in ${Math.ceil(hud.timer / 1000)}s`} color="#FF8A8E" />
              )}
            </>
          )}
          {/* dead → role switch */}
          {hud?.life === "dead" && (
            <div className="absolute left-1/2 top-[18%] w-[min(92vw,560px)] -translate-x-1/2 rounded-3xl border border-[#2A3848] bg-[#0B1118]/92 p-5 text-center" data-testid="sq-dead">
              <div className="font-['Chakra_Petch',system-ui,sans-serif] text-3xl font-bold tracking-wide text-[#FF8A8E]">ELIMINATED</div>
              <div className="mt-1 text-sm text-[#B6C1CE]">Back in {Math.ceil(hud.timer / 1000)}s — switch role if your squad needs it</div>
              <RolePicker value={myP?.role ?? hud.role} onPick={(r) => void act({ type: "role", role: r })} compact team={hud.team} />
            </div>
          )}
          {/* touch buttons */}
          {touch && hud && (
            <div className="absolute bottom-4 right-4 flex flex-col items-end gap-3">
              <button type="button" className="h-16 w-16 rounded-full border-2 bg-[#0B1118]/70 text-xs font-bold" style={{ borderColor: SQ_ROLES[hud.role].accent, color: SQ_ROLES[hud.role].accent, opacity: hud.cd > 0 ? 0.5 : 1 }} {...hold("ability")}>{hud.cd > 0 ? Math.ceil(hud.cd / 1000) : SQ_ROLES[hud.role].ability.name}</button>
              <div className="flex gap-3">
                <button type="button" className="h-14 w-14 rounded-full border-2 border-[#C9D3DF] bg-[#0B1118]/70 text-xs font-bold" {...hold("reload")}>Reload</button>
                <button type="button" className="h-14 w-14 rounded-full border-2 border-[#3DD68C] bg-[#0B1118]/70 text-2xl font-bold text-[#3DD68C]" aria-label="Revive" {...hold("revive")}>✚</button>
              </div>
            </div>
          )}
          {!touch && <div className="pointer-events-none absolute bottom-[112px] left-1/2 -translate-x-1/2 text-[11px] text-white/45">WASD move · mouse aim · click shoot · right-click {hud ? SQ_ROLES[hud.role].ability.name : "ability"} · hold E revive · R reload</div>}
          {touch && <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 text-[11px] text-white/50">Left thumb: move · Right thumb: aim & shoot</div>}
        </>
      )}

      {meta?.phase === "lobby" && <TeamRoom meta={meta} me={me} isHost={isHost} act={act} err={err} />}
      {meta?.phase === "ended" && <Results meta={meta} me={me} isHost={isHost} act={act} />}
      {!meta && <div className="absolute inset-0 grid place-items-center text-sm text-white/70">{g.connected ? "Joining…" : "Waking up the game server… (can take ~30 s)"}</div>}
      {err && meta?.phase !== "lobby" && <div className="absolute left-1/2 top-20 -translate-x-1/2 rounded-xl bg-rose-600 px-3 py-1 text-sm font-bold">{err}</div>}
    </div>
  );
}

function drawPowerIcon(g: CanvasRenderingContext2D, kind: SqPower, col: string) {
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 3.5; g.lineCap = "round"; g.lineJoin = "round";
  g.beginPath();
  if (kind === "triple") { g.moveTo(-10, 0); g.lineTo(10, 0); g.moveTo(-10, -2); g.lineTo(8, -10); g.moveTo(-10, 2); g.lineTo(8, 10); g.stroke(); }
  else if (kind === "speed") { g.moveTo(3, -12); g.lineTo(-6, 2); g.lineTo(1, 2); g.lineTo(-3, 12); g.lineTo(7, -3); g.lineTo(0, -3); g.closePath(); g.fill(); }
  else if (kind === "medkit") { g.moveTo(0, -11); g.lineTo(0, 11); g.moveTo(-11, 0); g.lineTo(11, 0); g.lineWidth = 6; g.stroke(); }
  else { g.arc(0, 0, 11, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(-3, -3, 3, 0, Math.PI * 2); g.fill(); }
}

function Slot({ k, label, color, cd = 0, active, dim }: { k: string; label: string; color: string; cd?: number; active?: boolean; dim?: boolean }) {
  return (
    <div className="relative flex h-[78px] w-[84px] flex-col items-center justify-center gap-1 rounded-2xl border-2 bg-[#0B1118]/90" style={{ borderColor: active ? color : "#2A3848", opacity: dim ? 0.55 : 1 }}>
      <span className="absolute -top-2.5 rounded-md bg-[#243140] px-1.5 font-['Chakra_Petch',system-ui,sans-serif] text-[11px] font-bold text-[#C9D3DF]">{k}</span>
      <span className="px-1 text-center text-xs font-bold leading-tight" style={{ color }}>{label}</span>
      {cd > 0 && <div className="absolute inset-0 grid place-items-center rounded-[14px] bg-[#0B1118]/70 font-['Chakra_Petch',system-ui,sans-serif] text-2xl font-bold">{Math.ceil(cd / 1000)}</div>}
    </div>
  );
}

function Banner({ title, sub, color }: { title: string; sub: string; color: string }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-[20%] -translate-x-1/2 rounded-3xl border border-[#2A3848] bg-[#0B1118]/85 px-6 py-3 text-center" data-testid="sq-banner">
      <div className="font-['Chakra_Petch',system-ui,sans-serif] text-3xl font-bold tracking-wide" style={{ color }}>{title}</div>
      <div className="mt-1 text-sm text-[#B6C1CE]">{sub}</div>
    </div>
  );
}

function RoleIcon({ role, team, size = 64 }: { role: SqRole; team: SqTeam; size?: number }) {
  const [src, setSrc] = useState<string>("");
  useEffect(() => {
    void import("./sprites").then((m) => setSrc("data:image/svg+xml;charset=utf-8," + encodeURIComponent(m.characterSvg(role, team))));
  }, [role, team]);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" width={size} height={size} style={{ transform: "rotate(-90deg)" }} /> : <span style={{ width: size, height: size, display: "inline-block" }} />;
}

function RolePicker({ value, onPick, compact, team }: { value: SqRole; onPick: (r: SqRole) => void; compact?: boolean; team: SqTeam }) {
  return (
    <div className={`mt-4 grid grid-cols-3 gap-2 ${compact ? "" : "sm:gap-3"}`} data-testid="sq-roles">
      {ROLE_KEYS.map((r) => {
        const d = SQ_ROLES[r];
        const on = value === r;
        return (
          <button key={r} type="button" onClick={() => onPick(r)} data-testid={`sq-role-${r}`}
            className="flex flex-col items-center rounded-2xl border-2 p-2 text-center transition hover:bg-white/5"
            style={{ borderColor: on ? "#FFB224" : "#243140", background: on ? "#1A1A12" : "#111922" }}>
            <RoleIcon role={r} team={team} size={compact ? 52 : 72} />
            <span className="font-['Chakra_Petch',system-ui,sans-serif] text-sm font-bold tracking-wide" style={{ color: d.accent }}>{d.label.toUpperCase()}</span>
            {!compact && <span className="mt-0.5 text-[11px] leading-tight text-[#8A97A8]">{d.hp} HP · {d.weapon.name}</span>}
            <span className="mt-0.5 text-[11px] leading-tight text-[#B6C1CE]">{d.ability.name} · revive {d.reviveMs / 1000}s</span>
          </button>
        );
      })}
    </div>
  );
}

function InviteButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = `${window.location.origin}/squad/${code}`;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share && /Mobi|Android/i.test(navigator.userAgent)) { try { await nav.share({ title: "Join my squad in SQUAD RUSH", url }); return; } catch { /* fall through */ } }
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  };
  return <button onClick={share} className="rounded-full border border-[#FFB224] bg-[#0B1118]/80 px-3 py-1 font-semibold text-[#FFB224]">{copied ? "Copied ✓" : "Copy invite link"}</button>;
}

function TeamRoom({ meta, me, isHost, act, err }: { meta: SqMeta; me: string | null; isHost: boolean; act: Act; err: string | null }) {
  const myP = meta.players.find((p) => p.id === me);
  const url = typeof window !== "undefined" ? `${window.location.origin}/squad/${meta.code}` : `/squad/${meta.code}`;
  const team = (t: SqTeam) => meta.players.filter((p) => p.team === t && !p.isBot);
  return (
    <div className="absolute inset-0 overflow-y-auto bg-[#0B1118] bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:40px_40px] px-4 py-5" data-testid="sq-lobby">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-['Chakra_Petch',system-ui,sans-serif] text-3xl font-bold tracking-[0.06em]">SQUAD RUSH</div>
            <div className="text-xs tracking-[0.18em] text-[#8A97A8]">TEAM ROOM · DOCKYARD · TEAM DEATHMATCH</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-xl border border-[#243140] bg-[#141D27] px-4 py-2">
              <span className="text-[11px] tracking-[0.14em] text-[#8A97A8]">ROOM CODE</span>
              <span className="font-['Chakra_Petch',system-ui,sans-serif] text-xl font-bold tracking-[0.2em]" data-testid="sq-code">{meta.code}</span>
            </div>
            <InviteButton code={meta.code} />
          </div>
        </header>
        <code className="mt-2 block truncate text-xs text-[#6F7D8E]" data-testid="sq-invite">{url}</code>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.15fr_1fr]">
          {(["red", "blue"] as SqTeam[]).map((t, i) => (
            <section key={t} className={`flex flex-col gap-2 rounded-2xl border border-[#1F2B38] bg-[#111922] p-4 ${i === 1 ? "lg:order-3" : "lg:order-1"}`} style={{ boxShadow: `inset 0 3px 0 ${TEAM_COLORS[t].main}` }} data-testid={`sq-team-${t}`}>
              <div className="flex items-center justify-between">
                <h2 className="font-['Chakra_Petch',system-ui,sans-serif] text-xl font-bold tracking-[0.08em]" style={{ color: TEAM_COLORS[t].text }}>{t.toUpperCase()} TEAM</h2>
                <span className="text-sm text-[#8A97A8]">{team(t).length} / {meta.settings.teamSize}</span>
              </div>
              {team(t).map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-xl border border-[#22313F] bg-[#172230] p-2">
                  <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-lg bg-[#0E151D]"><RoleIcon role={p.role} team={t} size={44} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold">{p.nickname}{p.id === me ? " (you)" : ""}</div>
                    <div className="flex gap-1.5 text-[11px] font-bold tracking-wider">
                      <span className="rounded px-1.5 py-0.5" style={{ color: SQ_ROLES[p.role].accent, background: "rgba(255,255,255,0.05)" }}>{SQ_ROLES[p.role].label.toUpperCase()}</span>
                      {p.id === meta.hostId && <span className="rounded bg-[#2A2312] px-1.5 py-0.5 text-[#FFB224]">HOST</span>}
                    </div>
                  </div>
                </div>
              ))}
              {Array.from({ length: Math.max(0, meta.settings.teamSize - team(t).length) }, (_, k) => (
                <div key={k} className="flex h-[66px] items-center rounded-xl border-[1.5px] border-dashed border-[#2A3848] px-4 text-sm text-[#6F7D8E]">Open slot — a bot will play here</div>
              ))}
              {myP?.team !== t && <button className="mt-auto h-10 rounded-lg border font-bold" style={{ borderColor: TEAM_COLORS[t].main, color: TEAM_COLORS[t].text }} onClick={() => void act({ type: "team", team: t })} data-testid={`sq-join-${t}`}>Join {t}</button>}
            </section>
          ))}

          <section className="flex flex-col gap-4 lg:order-2">
            <div className="rounded-2xl border border-[#1F2B38] bg-[#111922] p-4">
              <div className="text-xs font-bold tracking-[0.14em] text-[#8A97A8]">YOUR ROLE</div>
              <RolePicker value={myP?.role ?? "fighter"} onPick={(r) => void act({ type: "role", role: r })} team={myP?.team ?? "red"} />
            </div>
            {isHost ? (
              <div className="grid grid-cols-3 gap-2">
                <Setting label="Win at" value={meta.settings.target} options={[10, 15, 25, 40, 60]} suffix=" kills" onChange={(v) => void act({ type: "settings", settings: { target: v } })} />
                <Setting label="Time" value={meta.settings.minutes} options={[3, 5, 6, 8, 10, 15]} suffix=" min" onChange={(v) => void act({ type: "settings", settings: { minutes: v } })} />
                <Setting label="Team size" value={meta.settings.teamSize} options={[1, 2, 3, 4, 5, 6]} suffix="v" onChange={(v) => void act({ type: "settings", settings: { teamSize: v } })} testid="sq-teamsize" />
              </div>
            ) : (
              <p className="text-sm text-[#8A97A8]">Waiting for <b className="text-white">{meta.players.find((p) => p.id === meta.hostId)?.nickname ?? "the host"}</b> to start · first to {meta.settings.target} · {meta.settings.minutes} min · {meta.settings.teamSize}v{meta.settings.teamSize}</p>
            )}
            {isHost && (
              <button className="flex h-16 items-center justify-center gap-3 rounded-2xl bg-[#FFB224] font-['Chakra_Petch',system-ui,sans-serif] text-2xl font-bold tracking-[0.12em] text-[#0B1118] shadow-[0_8px_30px_rgba(255,178,36,0.25)]" onClick={() => void act({ type: "start" })} data-testid="sq-start">
                START MATCH
              </button>
            )}
            {err && <p className="text-sm font-bold text-rose-300">{err}</p>}
            <ul className="list-disc space-y-1 pl-5 text-sm text-[#B6C1CE]">
              <li>WASD to move, mouse to aim, click to shoot, right-click for your ability. On a phone: two thumbs.</li>
              <li>At 0 HP you&apos;re <b>knocked down</b>. A teammate holds <b>E</b> next to you to revive — the Healer does it in 1 second.</li>
              <li>Finish off downed enemies before they get revived. Each elimination is a point for your team.</li>
              <li>Grab glowing power-ups: Triple Shot, Speed, Medkit, Bubble Shield.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function Setting({ label, value, options, suffix, onChange, testid }: { label: string; value: number; options: number[]; suffix: string; onChange: (v: number) => void; testid?: string }) {
  return (
    <label className="rounded-xl border border-[#1F2B38] bg-[#111922] p-2 text-[11px] font-bold tracking-[0.12em] text-[#8A97A8]">
      {label.toUpperCase()}
      <select className="mt-1 block w-full rounded-lg bg-[#0B1118] px-2 py-1.5 text-base font-bold tracking-normal text-white" value={value} onChange={(e) => onChange(Number(e.target.value))} data-testid={testid}>
        {options.map((o) => <option key={o} value={o}>{suffix === "v" ? `${o}v${o}` : `${o}${suffix}`}</option>)}
      </select>
    </label>
  );
}

function Results({ meta, me, isHost, act }: { meta: SqMeta; me: string | null; isHost: boolean; act: Act }) {
  const mvp = meta.players.find((p) => p.id === meta.mvpId);
  const title = meta.winner === "draw" ? "DRAW" : `${meta.winner?.toUpperCase()} TEAM WINS`;
  return (
    <div className="absolute inset-0 overflow-y-auto bg-[#0B1118]/92 px-4 py-6" data-testid="sq-results">
      <div className="mx-auto max-w-4xl text-center">
        <div className="font-['Chakra_Petch',system-ui,sans-serif] text-5xl font-bold tracking-[0.06em]" style={{ color: meta.winner && meta.winner !== "draw" ? TEAM_COLORS[meta.winner].text : "#E8EDF3" }}>{title}</div>
        <div className="mt-1 font-['Chakra_Petch',system-ui,sans-serif] text-2xl font-bold">{meta.score.red} — {meta.score.blue}</div>
        {mvp && (
          <div className="mx-auto mt-4 flex w-fit items-center gap-3 rounded-2xl border border-[#FFB224] bg-[#1A1A12] px-4 py-2">
            <RoleIcon role={mvp.role} team={mvp.team} size={48} />
            <div className="text-left"><div className="text-[11px] font-bold tracking-[0.16em] text-[#FFB224]">MVP</div><div className="text-lg font-bold">{mvp.nickname}{mvp.id === me ? " (you)" : ""}</div></div>
          </div>
        )}
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {(["red", "blue"] as SqTeam[]).map((t) => (
            <table key={t} className="w-full overflow-hidden rounded-2xl border border-[#1F2B38] bg-[#111922] text-sm">
              <thead><tr className="text-[11px] tracking-[0.12em] text-[#8A97A8]"><th className="p-2 text-left" style={{ color: TEAM_COLORS[t].text }}>{t.toUpperCase()}</th><th>KILLS</th><th>KNOCKS</th><th>REVIVES</th><th>DMG</th></tr></thead>
              <tbody>
                {meta.players.filter((p) => p.team === t).sort((a, b) => b.kills - a.kills).map((p) => (
                  <tr key={p.id} className={`border-t border-[#1F2B38] ${p.id === me ? "bg-white/5" : ""}`}>
                    <td className="p-2 text-left font-bold">{p.nickname}{p.isBot ? " 🤖" : ""} <span className="text-[10px] font-bold" style={{ color: SQ_ROLES[p.role].accent }}>{SQ_ROLES[p.role].label.toUpperCase()}</span></td>
                    <td>{p.kills}</td><td>{p.knocks}</td><td>{p.revives}</td><td>{p.damage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {isHost ? (
            <>
              <button className="rounded-2xl bg-[#FFB224] px-8 py-3 font-['Chakra_Petch',system-ui,sans-serif] text-xl font-bold tracking-[0.1em] text-[#0B1118]" onClick={() => void act({ type: "start" })} data-testid="sq-again">PLAY AGAIN</button>
              <button className="rounded-2xl border border-[#2A3848] px-6 py-3 font-bold" onClick={() => void act({ type: "to_lobby" })}>Team room</button>
            </>
          ) : <p className="text-[#8A97A8]">Waiting for the host…</p>}
        </div>
      </div>
    </div>
  );
}
