import { createHmac } from "node:crypto";

/**
 * Network routes for Echo Halls voice.
 *
 * Voice goes straight between players' devices. Some home / school / mobile networks block that,
 * so a TURN relay passes the (encrypted) audio along instead. The relay cannot hear it and stores nothing.
 *
 * Set ONE of these on the server (Render → Environment). Nothing is needed in the web app.
 *   Cloudflare:  CF_TURN_KEY_ID + CF_TURN_API_TOKEN
 *   Metered:     METERED_DOMAIN (e.g. howbig.metered.live) + METERED_API_KEY
 *   Own coturn:  TURN_URLS + TURN_SECRET          (static-auth-secret, short-lived logins)
 *   Fixed login: TURN_URLS + TURN_USER + TURN_PASS
 * TURN_URLS is comma separated, e.g. "turn:turn.example.com:3478,turns:turn.example.com:5349".
 */

export interface IceServer { urls: string | string[]; username?: string; credential?: string }

const STUN: IceServer = { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] };
/** Logins we hand out last this long (seconds). */
const TTL = 4 * 3600;

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

export function iceProvider(env: Env = process.env): "cloudflare" | "metered" | "coturn" | "static" | "none" {
  if (env.CF_TURN_KEY_ID && env.CF_TURN_API_TOKEN) return "cloudflare";
  if (env.METERED_DOMAIN && env.METERED_API_KEY) return "metered";
  if (env.TURN_URLS && env.TURN_SECRET) return "coturn";
  if (env.TURN_URLS && env.TURN_USER && env.TURN_PASS) return "static";
  return "none";
}

const urlList = (s: string) => s.split(",").map((u) => u.trim()).filter(Boolean);

/** Keep only well-formed entries, so a provider hiccup can't break the client. */
function clean(list: unknown): IceServer[] {
  const arr = Array.isArray(list) ? list : list ? [list] : [];
  const out: IceServer[] = [];
  for (const raw of arr) {
    const s = raw as { urls?: unknown; url?: unknown; username?: unknown; credential?: unknown };
    const urls = (Array.isArray(s?.urls) ? s.urls : [s?.urls ?? s?.url]).filter((u): u is string => typeof u === "string" && /^(stuns?|turns?):/.test(u));
    if (!urls.length) continue;
    const e: IceServer = { urls };
    if (typeof s.username === "string") e.username = s.username;
    if (typeof s.credential === "string") e.credential = s.credential;
    out.push(e);
  }
  return out;
}

async function fromProvider(env: Env, f: Fetch): Promise<IceServer[]> {
  switch (iceProvider(env)) {
    case "cloudflare": {
      const r = await f(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.CF_TURN_KEY_ID!)}/credentials/generate-ice-servers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.CF_TURN_API_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: TTL }),
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) throw new Error(`cloudflare ${r.status}`);
      return clean(((await r.json()) as { iceServers?: unknown }).iceServers);
    }
    case "metered": {
      const host = env.METERED_DOMAIN!.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      const r = await f(`https://${host}/api/v1/turn/credentials?apiKey=${encodeURIComponent(env.METERED_API_KEY!)}`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`metered ${r.status}`);
      return clean(await r.json());
    }
    case "coturn": {
      const username = `${Math.floor(Date.now() / 1000) + TTL}:howbig`;
      const credential = createHmac("sha1", env.TURN_SECRET!).update(username).digest("base64");
      return [{ urls: urlList(env.TURN_URLS!), username, credential }];
    }
    case "static":
      return [{ urls: urlList(env.TURN_URLS!), username: env.TURN_USER, credential: env.TURN_PASS }];
    default:
      return [];
  }
}

/** Hands out relay logins, reusing them for a while so we don't call the provider for every player. */
export class IceService {
  private cache: { at: number; list: IceServer[] } | null = null;
  private pending: Promise<IceServer[]> | null = null;
  lastError: string | null = null;

  constructor(private env: Env = process.env, private f: Fetch = fetch, private now: () => number = Date.now) {}

  get provider() { return iceProvider(this.env); }

  async get(): Promise<IceServer[]> {
    if (this.provider === "none") return [STUN];
    const t = this.now();
    // reuse for a quarter of the login's life (failures retry after 30 s)
    const keep = this.cache?.list.length ? (TTL * 1000) / 4 : 30_000;
    if (this.cache && t - this.cache.at < keep) return [STUN, ...this.cache.list];
    this.pending ??= fromProvider(this.env, this.f)
      .then((list) => { this.lastError = list.length ? null : "provider returned no servers"; return list; })
      .catch((e: unknown) => { this.lastError = e instanceof Error ? e.message : String(e); return [] as IceServer[]; })
      .then((list) => { this.cache = { at: this.now(), list }; this.pending = null; return list; });
    return [STUN, ...(await this.pending)];
  }
}
export const iceService = new IceService();
