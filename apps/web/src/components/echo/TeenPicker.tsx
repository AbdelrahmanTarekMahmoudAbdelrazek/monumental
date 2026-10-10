"use client";
import { useEffect, useRef, useState } from "react";
import { ECHO_TEENS, LOOK_OPTS, TEEN_LOOKS, cleanLook, type EchoLook, type EchoMeta, type EchoTeenId } from "@monumental/shared";
import type { TeenMove, TeenRig } from "./teen";

const TITLE = "font-['Special_Elite',ui-monospace,monospace]";
const SKIN = ["#f3d2b5", "#e6b892", "#c99168", "#a86f48", "#7d4e30", "#55331f"];
const HAIRC = ["#141110", "#3b2516", "#6b3f22", "#a8642f", "#d3b07a", "#7a7d80"];
const COATC = ["#3c4a36", "#2a3340", "#5a2a2c", "#6f5a33", "#2c2e30", "#3f5f6a", "#7a3d1f", "#d8d2c2"];
const PANTC = ["#28344a", "#1d1f22", "#4a4535", "#3a3f35"];
const LABEL: Record<string, string> = {
  short: "Short", curly: "Curly", curlylong: "Long curls", pony: "Ponytail", bob: "Bob", buzz: "Buzz cut",
  none: "None", beanie: "Beanie", cap: "Cap", capback: "Cap, backwards", hood: "Hood up", headlamp: "Headlamp", bucket: "Bucket hat",
  hoodie: "Hoodie", rain: "Rain jacket", puffer: "Puffer", denim: "Denim + sherpa", varsity: "Varsity", flannel: "Flannel",
  jeans: "Jeans", cargo: "Cargo", joggers: "Joggers", sneakers: "Sneakers", boots: "Boots",
  school: "School bag", hiking: "Hiking pack", sling: "Sling bag", slim: "Slim", mid: "Average", broad: "Broad",
  torch: "Torch", walkie: "Walkie-talkie", phone: "Phone", cutters: "Bolt cutters",
};
const STORE = "eh:look";
export function savedLook(): EchoLook | null {
  try { return cleanLook(JSON.parse(localStorage.getItem(STORE) ?? "null")); } catch { return null; }
}
function storeLook(l: EchoLook) { try { localStorage.setItem(STORE, JSON.stringify(l)); } catch { /* private mode */ } }

/**
 * Lobby: pick one of the four teens and dress them. The server keeps teens unique;
 * `send` resolves with an error message when the pick was refused.
 */
export default function TeenPicker({ meta, me, send }: { meta: EchoMeta | null; me: number | null; send: (l: EchoLook) => Promise<string | null> }) {
  const mine = meta?.players.find((p) => p.n === me);
  const serverLook = mine?.look ?? null;
  const [look, setLook] = useState<EchoLook | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [move, setMove] = useState<TeenMove>("idle");
  const sentSaved = useRef(false);
  const pendingSend = useRef<number | null>(null);

  // first time we know who we are: ask for the teen and outfit we used last time
  useEffect(() => {
    if (!serverLook || sentSaved.current) return;
    sentSaved.current = true;
    const saved = savedLook();
    if (saved && JSON.stringify(saved) !== JSON.stringify(serverLook)) {
      setLook(saved);
      void send(saved).then((e) => {
        if (!e) return;
        // that teen is taken: keep my outfit choices on the teen I was given
        const kept = cleanLook({ ...saved, teen: serverLook.teen }) ?? serverLook;
        setLook(kept);
        void send(kept);
      });
    } else setLook(serverLook);
  }, [serverLook, send]);
  // follow the server when nothing of mine is in flight
  useEffect(() => { if (serverLook && pendingSend.current === null && sentSaved.current) setLook((l) => l ?? serverLook); }, [serverLook]);

  const change = (next: EchoLook) => {
    const clean = cleanLook(next);
    if (!clean) return;
    setLook(clean); storeLook(clean); setErr(null);
    if (pendingSend.current !== null) window.clearTimeout(pendingSend.current);
    pendingSend.current = window.setTimeout(() => {
      pendingSend.current = null;
      void send(clean).then((e) => { if (e) { setErr(e); if (serverLook) setLook(serverLook); } });
    }, 250);
  };
  const pickTeen = (id: EchoTeenId) => {
    if (!look || id === look.teen) return;
    // the teen comes with their own look; you can change it after
    change({ ...TEEN_LOOKS[id] });
    setMove("wave");
    window.setTimeout(() => setMove("idle"), 2200);
  };

  const cur = look ?? serverLook;
  const takenBy = (id: EchoTeenId) => meta?.players.find((p) => p.n !== me && p.look?.teen === id)?.name ?? null;
  const teen = ECHO_TEENS.find((t) => t.id === cur?.teen);
  const set = <K extends keyof EchoLook>(k: K, v: EchoLook[K]) => cur && change({ ...cur, [k]: v });

  return (
    <section className="rounded-2xl border border-[#222924] bg-[#0C100E] p-4" data-testid="eh-teen">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className={`${TITLE} text-2xl text-[#E9E4D6]`}>Your teen</h2>
        <span className="text-xs text-[#6E786E]">Your friends see you as them</span>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
        <div className="relative">
          <Preview look={cur} move={move} />
          <div className="mt-2 flex flex-wrap gap-1">
            {(["idle", "walk", "crouch", "radio"] as TeenMove[]).map((m) => (
              <button key={m} onClick={() => setMove(m)} aria-pressed={move === m}
                className={`rounded-md border px-2 py-1 text-[11px] ${move === m ? "border-[#6EE6C8] text-[#6EE6C8]" : "border-[#2A312C] text-[#9FA89F]"}`}>
                {m === "idle" ? "Idle" : m === "walk" ? "Walk" : m === "crouch" ? "Sneak" : "Radio"}
              </button>
            ))}
          </div>
        </div>
        <div className="min-w-0">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Pick a teen">
            {ECHO_TEENS.map((t) => {
              const by = takenBy(t.id);
              const sel = cur?.teen === t.id;
              return (
                <button key={t.id} disabled={!!by || !cur} onClick={() => pickTeen(t.id)} aria-pressed={sel} data-testid={`eh-teen-${t.id}`}
                  className={`min-w-0 rounded-xl border px-3 py-2 text-left transition ${sel ? "border-[#6EE6C8] bg-[#13201C]" : "border-[#222924] bg-[#101412]"} disabled:opacity-45`}>
                  <span className={`${TITLE} block text-lg leading-tight text-[#E9E4D6]`}>{t.name}</span>
                  <span className="block truncate text-[11px] text-[#7E887E]">{by ? `Taken by ${by}` : t.role}</span>
                </button>
              );
            })}
          </div>
          {teen && (
            <p className="mt-3 text-sm leading-relaxed text-[#A6AFA6]">
              <b className="text-[#E9E4D6]">{teen.role}.</b> Kit: {LABEL[teen.item]}. <span className="text-[#6EE6C8]">Perk: {teen.perk}.</span>
            </p>
          )}
          {err && <p className="mt-2 rounded-lg bg-[#2A1512] px-3 py-2 text-sm text-[#F1C9C4]">{err}</p>}
          <button onClick={() => setOpen((o) => !o)} className="mt-3 rounded-lg border border-[#3A433D] px-3 py-1.5 text-sm font-semibold" aria-expanded={open} data-testid="eh-outfit">
            {open ? "Done dressing" : "Change outfit"}
          </button>
        </div>
      </div>

      {open && cur && (
        <div className="mt-4 grid gap-4 border-t border-dashed border-[#222924] pt-4">
          <Row title="Coat" opts={LOOK_OPTS.coat} value={cur.coat} onPick={(v) => set("coat", v)}>
            <Swatches colors={COATC} value={cur.coatC} onPick={(v) => set("coatC", v)} label="Coat colour" />
            {cur.coat === "varsity" && <Swatches colors={COATC} value={cur.coatC2} onPick={(v) => set("coatC2", v)} label="Sleeve colour" note="Sleeves" />}
          </Row>
          <Row title="On the head" opts={LOOK_OPTS.hat} value={cur.hat} onPick={(v) => set("hat", v)} />
          <Row title="Hair" opts={LOOK_OPTS.hair} value={cur.hair} onPick={(v) => set("hair", v)}>
            <Swatches colors={HAIRC} value={cur.hairC} onPick={(v) => set("hairC", v)} label="Hair colour" />
          </Row>
          <Row title="Skin & build" opts={LOOK_OPTS.build} value={cur.build} onPick={(v) => set("build", v)}>
            <Swatches colors={SKIN} value={cur.skin} onPick={(v) => set("skin", v)} label="Skin tone" />
          </Row>
          <Row title="Trousers" opts={LOOK_OPTS.pants} value={cur.pants} onPick={(v) => set("pants", v)}>
            <Swatches colors={PANTC} value={cur.pantsC} onPick={(v) => set("pantsC", v)} label="Trouser colour" />
          </Row>
          <Row title="Shoes" opts={LOOK_OPTS.shoes} value={cur.shoes} onPick={(v) => set("shoes", v)} />
          <Row title="Bag" opts={LOOK_OPTS.pack} value={cur.pack} onPick={(v) => set("pack", v)} />
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7E887E]">Extras</div>
            <div className="flex flex-wrap gap-1.5">
              {(["scarf", "glasses", "gloves"] as const).map((k) => (
                <button key={k} onClick={() => set(k, !cur[k])} aria-pressed={cur[k]} className={chip(cur[k])}>{k[0].toUpperCase() + k.slice(1)}</button>
              ))}
              <button onClick={() => change({ ...TEEN_LOOKS[cur.teen] })} className="ml-auto rounded-lg px-2 py-1 text-xs text-[#7E887E] underline">Reset to {teen?.name}&apos;s look</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

const chip = (on: boolean) => `rounded-lg border px-2.5 py-1.5 text-xs font-medium ${on ? "border-[#E9E4D6] bg-[#E9E4D6] text-black" : "border-[#2A312C] bg-[#121715] text-[#D9DED8]"}`;

function Row<T extends string>({ title, opts, value, onPick, children }: { title: string; opts: readonly T[]; value: T; onPick: (v: T) => void; children?: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7E887E]">{title}</div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={title}>
        {opts.map((o) => <button key={o} onClick={() => onPick(o)} aria-pressed={value === o} className={chip(value === o)}>{LABEL[o] ?? o}</button>)}
      </div>
      {children}
    </div>
  );
}

function Swatches({ colors, value, onPick, label, note }: { colors: string[]; value: number; onPick: (v: number) => void; label: string; note?: string }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {note && <span className="mr-1 text-[10px] uppercase tracking-wider text-[#7E887E]">{note}</span>}
      {colors.map((c, i) => (
        <button key={c + i} onClick={() => onPick(i)} aria-label={`${label} ${i + 1}`} aria-pressed={value === i}
          className={`h-6 w-6 rounded-full border-2 ${value === i ? "border-[#E9E4D6]" : "border-transparent"}`} style={{ background: c, boxShadow: "inset 0 0 0 1px rgba(255,255,255,.12)" }} />
      ))}
    </div>
  );
}

/** A small turntable of my teen, lit by their own light and a cold glow. */
function Preview({ look, move }: { look: EchoLook | null; move: TeenMove }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rigRef = useRef<TeenRig | null>(null);
  const moveRef = useRef(move);
  const lookKey = useRef("");
  const lookRef = useRef(look);
  lookRef.current = look;
  const [failed, setFailed] = useState(false);
  useEffect(() => { moveRef.current = move; }, [move]);
  useEffect(() => {
    let raf = 0, alive = true;
    let cleanup = () => {};
    void (async () => {
      const THREE = await import("three");
      const { TeenRig } = await import("./teen");
      if (!alive || !ref.current) return;
      let renderer: import("three").WebGLRenderer;
      try { renderer = new THREE.WebGLRenderer({ canvas: ref.current, antialias: true, alpha: false }); } catch { setFailed(true); return; }
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#0b0f0d");
      const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
      cam.position.set(0, 1.2, 4.1); cam.lookAt(0, 0.9, 0);
      scene.add(new THREE.HemisphereLight("#c9d6dc", "#1d1f1c", 0.9));
      const key = new THREE.DirectionalLight("#fff3e2", 1.6); key.position.set(2, 4, 3); scene.add(key);
      const rim = new THREE.DirectionalLight("#6ee6c8", 1.4); rim.position.set(-3, 2, -3); scene.add(rim);
      const floor = new THREE.Mesh(new THREE.CircleGeometry(1.1, 40), new THREE.MeshStandardMaterial({ color: "#1a1d1b", roughness: 0.8 }));
      floor.rotation.x = -Math.PI / 2; scene.add(floor);
      const rig = new TeenRig({ intensity: 6, distance: 6, decay: 2, shadows: false, beam: 0.05 }, false);
      rigRef.current = rig;
      scene.add(rig.root);
      const size = () => {
        const c = ref.current; if (!c) return;
        const w = c.clientWidth, h = c.clientHeight;
        renderer.setSize(w, h, false); cam.aspect = w / Math.max(1, h); cam.updateProjectionMatrix();
      };
      size();
      const ro = new ResizeObserver(size); ro.observe(ref.current);
      let last = performance.now();
      const loop = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        if (rig.look) {
          rig.root.rotation.y = Math.sin(now / 2600) * 0.7 + 0.25;
          rig.update(dt, { move: moveRef.current, pitch: -0.1, lightOn: moveRef.current === "walk" || moveRef.current === "crouch" });
          renderer.render(scene, cam);
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      cleanup = () => { ro.disconnect(); rig.dispose(); renderer.dispose(); };
      const l0 = lookRef.current;
      if (l0) { lookKey.current = JSON.stringify(l0); rig.build(l0); }
    })();
    return () => { alive = false; cancelAnimationFrame(raf); cleanup(); rigRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const k = JSON.stringify(look);
    if (!look || !rigRef.current || k === lookKey.current) return;
    lookKey.current = k;
    rigRef.current.build(look);
  }, [look]);
  if (failed) return <div className="grid aspect-[4/5] w-full place-items-center rounded-xl bg-[#0b0f0d] text-xs text-[#6E786E]">3D preview unavailable</div>;
  return <canvas ref={ref} className="aspect-[4/5] w-full rounded-xl" aria-label="Preview of your teen" />;
}
