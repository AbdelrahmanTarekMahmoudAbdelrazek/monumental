import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { IceService, iceProvider } from "./ice";

const json = (body: unknown, ok = true, status = 200) => Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response);

describe("voice relay (TURN)", () => {
  it("without settings hands out STUN only", async () => {
    const s = new IceService({}, vi.fn());
    expect(s.provider).toBe("none");
    const l = await s.get();
    expect(l).toHaveLength(1);
    expect(String(l[0].urls)).toContain("stun:");
  });

  it("picks the provider from the settings", () => {
    expect(iceProvider({ CF_TURN_KEY_ID: "k", CF_TURN_API_TOKEN: "t" })).toBe("cloudflare");
    expect(iceProvider({ METERED_DOMAIN: "x.metered.live", METERED_API_KEY: "k" })).toBe("metered");
    expect(iceProvider({ TURN_URLS: "turn:a", TURN_SECRET: "s" })).toBe("coturn");
    expect(iceProvider({ TURN_URLS: "turn:a", TURN_USER: "u", TURN_PASS: "p" })).toBe("static");
    expect(iceProvider({ TURN_URLS: "turn:a" })).toBe("none");
  });

  it("Cloudflare: asks for logins and caches them", async () => {
    const f = vi.fn(() => json({ iceServers: [{ urls: ["turn:turn.cloudflare.com:3478?transport=udp", "https://bad"], username: "u", credential: "c" }] }));
    let t = 0;
    const s = new IceService({ CF_TURN_KEY_ID: "key", CF_TURN_API_TOKEN: "tok" }, f as unknown as typeof fetch, () => t);
    const [a, b] = await Promise.all([s.get(), s.get()]);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = (f.mock.calls[0] as unknown as [string, RequestInit]);
    expect(url).toBe("https://rtc.live.cloudflare.com/v1/turn/keys/key/credentials/generate-ice-servers");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(a).toEqual(b);
    expect(a[1]).toEqual({ urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "u", credential: "c" });
    t = 30 * 60_000; await s.get(); expect(f).toHaveBeenCalledTimes(1);
    t = 61 * 60_000; await s.get(); expect(f).toHaveBeenCalledTimes(2);
  });

  it("Cloudflare older reply shape (single object) works too", async () => {
    const s = new IceService({ CF_TURN_KEY_ID: "k", CF_TURN_API_TOKEN: "t" }, (() => json({ iceServers: { urls: ["turns:x:5349"], username: "u", credential: "c" } })) as unknown as typeof fetch);
    expect((await s.get())[1].urls).toEqual(["turns:x:5349"]);
  });

  it("Metered: reads the list", async () => {
    const f = vi.fn(() => json([{ urls: "stun:stun.relay.metered.ca:80" }, { urls: "turn:global.relay.metered.ca:80", username: "u", credential: "c" }]));
    const s = new IceService({ METERED_DOMAIN: "https://howbig.metered.live/", METERED_API_KEY: "k y" }, f as unknown as typeof fetch);
    const l = await s.get();
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("https://howbig.metered.live/api/v1/turn/credentials?apiKey=k%20y");
    expect(l).toHaveLength(3);
  });

  it("coturn shared secret: short-lived login the relay can check", async () => {
    const s = new IceService({ TURN_URLS: "turn:t.example.com:3478, turns:t.example.com:5349", TURN_SECRET: "sec" }, vi.fn());
    const r = (await s.get())[1];
    expect(r.urls).toEqual(["turn:t.example.com:3478", "turns:t.example.com:5349"]);
    expect(Number(r.username!.split(":")[0])).toBeGreaterThan(Date.now() / 1000 + 3600);
    expect(r.credential).toBe(createHmac("sha1", "sec").update(r.username!).digest("base64"));
  });

  it("a provider failure falls back to STUN and retries later", async () => {
    let t = 0;
    const f = vi.fn(() => json({}, false, 401));
    const s = new IceService({ CF_TURN_KEY_ID: "k", CF_TURN_API_TOKEN: "t" }, f as unknown as typeof fetch, () => t);
    expect(await s.get()).toHaveLength(1);
    expect(s.lastError).toBe("cloudflare 401");
    t = 10_000; await s.get(); expect(f).toHaveBeenCalledTimes(1);
    t = 31_000; await s.get(); expect(f).toHaveBeenCalledTimes(2);
  });
});
