"use client";
import { useEffect, useState } from "react";
import { MONUMENTS, MONUMENT_MAP, type Monument } from "@monumental/shared";
import { SOCKET_URL } from "./socket";

let cache: Record<string, Monument> = { ...MONUMENT_MAP };
let fetched = false;
const listeners = new Set<() => void>();

async function load() {
  if (fetched) return;
  fetched = true;
  try {
    const res = await fetch(`${SOCKET_URL}/monuments`, { cache: "no-store" });
    if (!res.ok) return;
    const list = (await res.json()) as Monument[];
    if (Array.isArray(list) && list.length) {
      cache = Object.fromEntries(list.map((m) => [m.id, m]));
      listeners.forEach((l) => l());
    }
  } catch { /* offline: built-in dataset */ }
}

/** Live monument catalogue: built-in dataset, overlaid with admin additions from the server. */
export function useCatalog() {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    void load();
    return () => void listeners.delete(l);
  }, []);
  return {
    get: (id: string): Monument => cache[id] ?? MONUMENT_MAP[id] ?? MONUMENTS[0],
    all: (): Monument[] => Object.values(cache),
  };
}
