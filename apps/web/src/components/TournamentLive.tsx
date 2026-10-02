"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getSocket } from "@/lib/socket";
import { getGuestId, getNickname } from "@/lib/identity";

/**
 * While a tournament is live, this listens for `tournament_update` pushes
 * (sent to the player's identity channel) and offers the room link.
 * The player must have joined any room once so the server knows their identity;
 * we join the level-1 lobby quietly for that purpose.
 */
export default function TournamentLive({ tournamentId }: { tournamentId: string }) {
  const [update, setUpdate] = useState<{ message: string; roomId?: string; status: string } | null>(null);
  useEffect(() => {
    const s = getSocket();
    const onT = (t: { tournamentId: string; message: string; roomId?: string; status: string }) => { if (t.tournamentId === tournamentId) setUpdate(t); };
    s.on("tournament_update", onT);
    fetch("/api/socket-token").then((r) => r.json()).then((d) => {
      s.emit("join_room", { levelId: 1, nickname: getNickname(), guestId: getGuestId(), userToken: d.token ?? undefined }, () => {});
    }).catch(() => {});
    return () => { s.off("tournament_update", onT); s.emit("leave_room"); };
  }, [tournamentId]);
  return (
    <div className="card mt-4 border border-emerald-500/40 bg-emerald-500/5 text-sm">
      <b>Live now.</b> {update ? update.message : "If you're registered, your room link appears here when your stage starts."}
      {update?.roomId && <Link href={`/play/room/${encodeURIComponent(update.roomId)}`} className="btn-primary ml-3">Join your room →</Link>}
    </div>
  );
}
