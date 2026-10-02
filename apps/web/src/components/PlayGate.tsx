"use client";
import { useEffect, useState } from "react";
import PlayRoom from "./PlayRoom";

/** Fetches a socket token for signed-in users, then mounts the room. */
export default function PlayGate({ roomId, levelId }: { roomId?: string; levelId?: number }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    fetch("/api/socket-token").then((r) => r.json()).then((d) => setToken(d.token ?? null)).catch(() => setToken(null));
  }, []);
  if (token === undefined) return <div className="p-10 text-center text-sm text-ink-500">Loading…</div>;
  return <PlayRoom roomId={roomId} levelId={levelId} userToken={token} />;
}
