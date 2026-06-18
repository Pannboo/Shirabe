# Shirabe — Open questions for a one-pass finish

Answer inline (just edit this file or paste replies). Anything left blank, I'll use the **Default** noted at the end of each item.

---

## 1. Blocking decisions (need answers before I code)

### 1.1 Last.fm scrobble relay flow

Last.fm relay needs more than the API key — it needs a **shared secret** + a per-account **session key** obtained via an OAuth-ish dance (request a token → user authorizes in browser → exchange for session key). Pick one:

- [X] **A — Full Connect-Account flow.** Settings page gets a "Connect Last.fm" button → opens last.fm/api/auth in a new tab → on callback Shirabe exchanges the token for a session key and stores it. ~80 lines, the "right" way.
- [ ] **B — Manual paste.** I add `lastfm_shared_secret` + `lastfm_session_key` fields in Settings; you generate them yourself once and paste them in. Fast, ugly.
- [ ] **C — Skip Last.fm relay for v1.** LB relay only. Last.fm pulls (for suggestions) still work since those only need the API key.

**Default if unanswered:** C (skip relay) — easy to add later without touching anything else.

> Your answer: A

---

### 1.2 Navidrome → Shirabe scrobble token

Right now: the token Navidrome sends to Shirabe IS the user's `navidrome_user_id` (Shirabe looks them up by that). Simple but means anyone who knows the user id can post fake scrobbles for them.

- [X] **A — Keep it as `navidrome_user_id`** (simple, low-stakes self-host)
- [ ] **B — Generate a separate Shirabe scrobble token** shown in `/me` settings; user pastes it into Navidrome's LB token field. Adds a `users.scrobble_token` column.

**Default if unanswered:** A (keep simple).

> Your answer: A

---

### 1.3 Yearly Rewind — how theatrical?

Spec says "Spotify Wrapped-style yearly rewind view." Right now I have a year selector + headline counts + top 10 artists/albums/tracks. Pick the level:

- [X] **A — Keep what's there** (data-dense one-page summary)
- [ ] **B — Add a slide deck** (you click through ~6 panels: scrobble count → top artist → top album → top track → most-active day → final summary, with big type and fade transitions)
- [ ] **C — Add slide deck AND a "share image" export button** for posting to social

**Default if unanswered:** A.

> Your answer: A

---

## 2. Polish items I called out — confirm which to bundle into the one-pass

All small, all good ideas, just confirming you want them now vs later:

- [X] **Per-artist detail page** (`/artist/:name`) — listen count over time + albums-scrobbled list. Spec §5 mentions it; I didn't build it.
- [X] **Theme switcher works dynamically** — currently saves the choice but doesn't swap. Tiny fix: read setting on app load + apply class to `<html>`.
- [X] **Integration status indicators in admin nav** — green/red dots for Navidrome / slskd / Last.fm / ListenBrainz, sourced from `/api/health/integrations` which already exists.
- [X] **Cover art on scrobble feeds + stat lists** — currently `null`. Would need a cache (`coverart` table) keyed on `(artist, album)` → MB lookup with the 1 req/s queue. Larger than the others.
- [X] **slskd queue view "live" from the API** — currently reads local DB updated by the poll job. Live means fetching slskd's transfers list on every request. More accurate, more chatty.

**Default if unanswered:** do the first three (per-artist, theme, indicators). Skip cover-art-cache and live-slskd unless you tick them.

---

## 3. Cosmetic / branding (optional, just gives me direction)

- **Accent color** — currently a purple (HSL 280° 65% 60%). Want a different one? (e.g. ListenBrainz orange, Last.fm red, custom hex)
- **Logo / favicon** — currently a blank favicon and just the text "Shirabe" in the header. Got a logo file or a Lucide icon name to use?
- **Header tagline under "Shirabe"** — e.g. "what I'm listening to" or similar? Or leave plain?

> Your answers:

---

## 4. Runtime credentials you'll need on hand (NOT blocking — fill via Settings on first run)

Listing here so you can collect them before first launch:

| Service | What you need | Where to get it |
|---|---|---|
| **Last.fm** | API key + username | https://www.last.fm/api/account/create |
| **Last.fm relay** *(only if §1.1 = A or B)* | Shared secret | Issued with the API key above |
| **ListenBrainz** | Username + user token | https://listenbrainz.org/profile/ |
| **slskd** | URL (e.g. `http://slskd:5030`) + API key | You set the API key in your slskd config |
| **Navidrome** | URL (e.g. `http://navidrome:4533`) — set in `.env` as `NAVIDROME_URL` | Wherever yours is running |

**Required environment variable** (in `.env` at repo root):
- `SECRET_KEY` — anything ≥16 chars. Used for JWT signing.

Other `.env` vars (`PORT`, `DATABASE_URL`, `ALLOWED_ORIGINS`, `BEETS_BIN`, etc.) are optional with sensible defaults — see `.env.example`.
Application name 	Shirabe - Dev
API key 	1e169210b812e219c7d3394cf2fed03d
Shared secret 	21cb4bb11287932510afb24422a2fa8e
Registered to 	Pannboo

ListenBrainz: b0f2ffc6-93d1-44e1-887e-9fa2b63093d5 - Pannboo
http://10.0.251.76:5030/ as right now this code isn't running on the same box as slskd - SoulSync-slskd-local-20260503 is the api key
Navidrome: http://10.0.251.76:4533/ - Username for admin is matt and password is Dreamzyftw123

I've not got beets setup yet.
---

## 5. Things I'm assuming unless you say otherwise

These are working assumptions baked into the current code. Tell me if any are wrong:

1. **First admin = first Navidrome admin to log in.** Subsequent logins (even Navidrome admins) are listeners.
2. **JWT lives 30 days, stored in `localStorage`.** No refresh flow.
3. **Suggestions:** default cron `0 */6 * * *` (every 6h), default dismiss cooldown 30 days.
4. **slskd poll interval:** every 10 seconds (per spec).
5. **MusicBrainz queue:** 1.1s spacing between calls (just above the 1 req/s ToS limit).
6. **Now-playing live window:** 240s (4 min), configurable in Settings.
7. **Widget API rate limit:** 60 req/min/IP, in-memory bucket. Survives a single process but not restarts.
8. **Allowed origins for widget API:** comma-separated in `ALLOWED_ORIGINS` env (e.g. `https://pannboo.dev,https://www.pannboo.dev`). The Shirabe frontend origin is always allowed.
9. **Beets**: called as `beet -c <config> import -q <path>`. Confidence is parsed from `"Similarity: X%"` in stdout. Threshold for auto-accept is 0.8 — anything below or ambiguous goes to Review.
10. **Docker `slskd` and `navidrome` services in `docker-compose.yml`** are *placeholders* using public images — you'll swap in your existing configs / volumes.

Flag any you want changed.

---

## 6. Anything else?

If there's something you want that's not in the spec (a feature, a UI behaviour, an integration), drop it here:

> 

---

When you're done, tell me "go" and I'll do the one-pass with whatever's filled in (and the defaults for what's not).
