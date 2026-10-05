"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_CUSTOM_SETTINGS, type CustomRoomSettings } from "@monumental/shared";
import { getSocket } from "@/lib/socket";
import { getGuestId, getNickname, setNickname } from "@/lib/identity";
import RoomSettingsForm from "./RoomSettingsForm";

const KEY = "howbig:hostSettings";

/** /host — pick settings, create a room, land in its lobby with an invite link. */
export default function HostRoom() {
  const router = useRouter();
  const [settings, setSettings] = useState<CustomRoomSettings>(DEFAULT_CUSTOM_SETTINGS);
  const [nick, setNick] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setNick(getNickname());
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setSettings({ ...DEFAULT_CUSTOM_SETTINGS, ...JSON.parse(saved) });
    } catch { /* ignore */ }
  }, []);

  const create = async () => {
    setBusy(true); setErr(null);
    setNickname(nick || getNickname());
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
    const token = await fetch("/api/socket-token").then((r) => r.json()).then((d) => d.token ?? undefined).catch(() => undefined);
    getSocket().emit("create_room", { settings, nickname: nick || getNickname(), guestId: getGuestId(), userToken: token }, (a) => {
      setBusy(false);
      if (!a.ok || !a.roomId) return setErr(a.error ?? "Could not create the room — is the game server awake? Try again in 30 s.");
      router.push(`/r/${a.roomId.replace(/^c:/, "")}`);
    });
  };

  return (
    <div className="mx-auto max-w-3xl px-3 py-6 md:px-4">
      <h1 className="text-3xl font-black">Host a game</h1>
      <p className="mt-1 text-sm text-ink-600 dark:text-ink-200">
        Set it up your way, share the invite link, and press Start when everyone is in. No schedule, no waiting for strangers.
      </p>
      <div className="card mt-5">
        <div className="mb-4">
          <label className="label">Your name</label>
          <input className="input max-w-xs" maxLength={20} value={nick} onChange={(e) => setNick(e.target.value)} />
        </div>
        <RoomSettingsForm value={settings} onChange={setSettings} />
        {err && <p className="mt-4 text-sm font-semibold text-rose-500">{err}</p>}
        <button className="btn-primary mt-5 w-full sm:w-auto" disabled={busy} onClick={create}>
          {busy ? "Creating…" : "Create room & get invite link →"}
        </button>
      </div>
    </div>
  );
}
