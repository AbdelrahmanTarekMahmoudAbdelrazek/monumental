# Echo Halls — voice relay (TURN)

Voice in Echo Halls goes straight from one player's device to another. Some networks (school/office Wi-Fi,
some mobile carriers) block that. A **TURN relay** fixes it: it passes the encrypted audio along without being
able to hear it or keep it. Our own game server still never receives voice.

Without a relay the game works exactly as before; players on strict networks just can't hear each other.

## Set it up (pick ONE provider)

All settings go on the **game server** (Render → monumental-server → Environment). Nothing goes in Vercel.
After saving, Render redeploys by itself.

### Option A — Cloudflare (recommended)
1. Cloudflare dashboard → **Realtime** → **TURN Server** → *Create*.
2. Copy the **Turn Token ID** and the **API Token**.
3. On Render add:
   - `CF_TURN_KEY_ID` = the Turn Token ID
   - `CF_TURN_API_TOKEN` = the API Token

### Option B — Metered
1. metered.ca → create a TURN app (e.g. `howbig`), open **Developers** and copy the API key.
2. On Render add:
   - `METERED_DOMAIN` = `howbig.metered.live` (your app's domain)
   - `METERED_API_KEY` = the API key

### Option C — your own coturn server
- `TURN_URLS` = `turn:turn.example.com:3478,turns:turn.example.com:5349`
- `TURN_SECRET` = the `static-auth-secret` from coturn's config

(Or a fixed login: `TURN_URLS` + `TURN_USER` + `TURN_PASS`.)

## Check it works
1. Open https://monumental-server.onrender.com/health — `voiceRelay` shows the provider
   (`cloudflare`, `metered`, …) and `voiceRelayError` should be `null`.
2. Two people open the same Echo Halls room with `?ehrelay` at the end of the address
   (e.g. `/echo/ABCD?ehrelay`). That forces voice through the relay only — if you can hear each other,
   the relay works. Remove `?ehrelay` for normal play (direct when possible, relay only when needed).

## How it works
- The server asks the provider for short-lived logins (4 h) and reuses them for an hour, so the
  provider isn't called for every player. Your API token never leaves the server.
- Players ask for logins over the game socket (`eh_ice`) only while they are in an Echo Halls room.
- If the provider is down, players fall back to direct connections and retry the provider after 30 s.
