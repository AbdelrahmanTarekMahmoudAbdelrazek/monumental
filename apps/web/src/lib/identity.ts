"use client";

const GUEST_KEY = "monumental:guestId";
const NICK_KEY = "monumental:nickname";

function randomId(len = 24) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join("");
}

export function getGuestId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    let id = localStorage.getItem(GUEST_KEY);
    if (!id || !/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
      id = "g_" + randomId(22);
      localStorage.setItem(GUEST_KEY, id);
    }
    return id;
  } catch {
    return "g_" + randomId(22);
  }
}

const ADJ = ["Swift", "Brave", "Tiny", "Mighty", "Lofty", "Ancient", "Golden", "Marble", "Stone", "Granite"];
const NOUN = ["Sphinx", "Obelisk", "Spire", "Pylon", "Dome", "Arch", "Minaret", "Column", "Ziggurat", "Pagoda"];

export function randomNickname() {
  return `${ADJ[Math.floor(Math.random() * ADJ.length)]}${NOUN[Math.floor(Math.random() * NOUN.length)]}${Math.floor(Math.random() * 90 + 10)}`;
}

export function getNickname(): string {
  if (typeof window === "undefined") return "Guest";
  try {
    let n = localStorage.getItem(NICK_KEY);
    if (!n) { n = randomNickname(); localStorage.setItem(NICK_KEY, n); }
    return n;
  } catch {
    return randomNickname();
  }
}

export function setNickname(n: string) {
  try { localStorage.setItem(NICK_KEY, n.trim().slice(0, 20)); } catch { /* ignore */ }
}
