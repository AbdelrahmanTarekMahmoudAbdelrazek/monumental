"use client";

/** Tiny synthesized SFX (no audio assets, no copyright). */
let ctx: AudioContext | null = null;
let muted = false;
const KEY = "monumental:muted";

export function isMuted() {
  if (typeof window === "undefined") return true;
  try { muted = localStorage.getItem(KEY) === "1"; } catch { /* ignore */ }
  return muted;
}
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem(KEY, m ? "1" : "0"); } catch { /* ignore */ }
}

function ac() {
  if (typeof window === "undefined") return null;
  if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType = "sine", gain = 0.08, when = 0, slideTo?: number) {
  const c = ac();
  if (!c || muted) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + when);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + when + dur);
  g.gain.setValueAtTime(0, c.currentTime + when);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + when + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + when + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + when);
  o.stop(c.currentTime + when + dur + 0.02);
}

export const sfx = {
  tick: () => tone(1200, 0.03, "square", 0.02),
  lock: () => { tone(520, 0.08, "triangle", 0.1); tone(780, 0.12, "triangle", 0.1, 0.07); },
  roundStart: () => { tone(440, 0.1, "sine", 0.08); tone(660, 0.15, "sine", 0.08, 0.1); },
  reveal: () => tone(300, 0.6, "sine", 0.06, 0, 900),
  win: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, "triangle", 0.09, i * 0.09)); },
  points: () => { tone(880, 0.08, "triangle", 0.07); tone(1175, 0.12, "triangle", 0.07, 0.08); },
  miss: () => tone(220, 0.25, "sawtooth", 0.04, 0, 160),
  countdown: () => tone(900, 0.06, "square", 0.03),
};
