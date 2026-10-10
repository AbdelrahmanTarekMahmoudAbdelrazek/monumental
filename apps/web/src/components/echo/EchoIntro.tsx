"use client";
import { useEffect, useRef, useState } from "react";

const TITLE = "font-['Special_Elite',ui-monospace,monospace]";

/**
 * The Marrowfield cold open. Plays before entering a room; Skip at any time.
 * If the browser blocks autoplay with sound (e.g. an invite link opened fresh), it waits for a tap.
 */
export default function EchoIntro({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [needTap, setNeedTap] = useState(false);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const done = useRef(false);
  const finish = () => { if (!done.current) { done.current = true; ref.current?.pause(); onDone(); } };

  useEffect(() => {
    const v = ref.current; if (!v) return;
    v.play().catch(() => setNeedTap(true));
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter") finish(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = () => { setNeedTap(false); ref.current?.play().catch(finish); };

  return (
    <div className="fixed inset-0 z-50 bg-black text-[#D9DED8]" data-testid="eh-intro">
      <link href="https://fonts.googleapis.com/css2?family=Special+Elite&display=swap" rel="stylesheet" />
      <video
        ref={ref}
        className="h-full w-full object-contain"
        playsInline
        preload="auto"
        onPlaying={() => setReady(true)}
        onTimeUpdate={(e) => { const v = e.currentTarget; if (v.duration) setProgress(v.currentTime / v.duration); }}
        onEnded={finish}
      >
        <source src="/echo/cold-open.mp4" type="video/mp4" />
        {/* last source failing means nothing can play here: go straight to the room */}
        <source src="/echo/cold-open.webm" type="video/webm" onError={finish} />
      </video>
      {!ready && !needTap && <div className="absolute inset-0 grid place-items-center text-sm text-[#7E887E]">Loading…</div>}
      {needTap && (
        <div className="absolute inset-0 grid place-items-center bg-black/80 px-6 text-center">
          <div>
            <p className={`${TITLE} text-4xl text-[#E9E4D6]`}>MARROWFIELD, 2011</p>
            <p className="mt-2 text-sm text-[#9FA89F]">2½ minutes · sound on · headphones recommended</p>
            <button className={`${TITLE} mt-6 h-14 rounded-xl bg-[#E9E4D6] px-8 text-xl text-black`} onClick={start} data-testid="eh-intro-play">Play the story</button>
            <button className="mt-4 block w-full text-sm text-[#7E887E] underline" onClick={finish}>Skip — go straight to the room</button>
          </div>
        </div>
      )}
      {!needTap && (
        <button
          className="absolute right-4 top-4 rounded-full border border-white/25 bg-black/50 px-4 py-2 text-sm text-white/80 backdrop-blur hover:bg-black/70"
          style={{ top: "max(1rem, env(safe-area-inset-top))" }}
          onClick={finish}
          data-testid="eh-intro-skip"
        >
          Skip intro ›
        </button>
      )}
      <div className="absolute bottom-0 left-0 h-[3px] bg-[#6EE6C8]/60" style={{ width: `${progress * 100}%` }} />
    </div>
  );
}
