# Shirabe — Claude Code Prompt

## Project Overview

Build a self-hosted music curator and scrobbler web app called **Shirabe**. It has two distinct faces:

**Public face** (no login required) — a Koito-style stats dashboard showing listening history, top artists, top albums, heatmap, and yearly rewind. This is the front door of the app — visiting `shirabe.yourdomain.com` loads the public stats profile directly, no login wall.

**Private face** (login required) — the curator and management tools: discovery feed, download queue, review queue, scrobbler relay settings, and per-user private stats.

The app combines:
- A **public stats dashboard** — Koito-aesthetic, clean and themeable, accessible without authentication
- A **discovery/download curator** that pulls artist and album suggestions from Last.fm, ListenBrainz, and MusicBrainz, lets the admin approve them, and pushes downloads to slskd
- A **post-download organiser** that runs beets for well-matched releases and flags patchy ones for manual Picard review
- A **full scrobbler** that replaces Koito — receiving scrobbles from Navidrome and relaying them to Last.fm and ListenBrainz

---

## Stack

- **Frontend**: React (Vite), Tailwind CSS, shadcn/ui
- **Backend**: Node.js + Express
- **Database**: SQLite via better-sqlite3
- **Job scheduling**: node-cron
- **Docker**: single Docker Compose setup with the app container, slskd, and Navidrome as dependencies

---

## Core Features

### 1. Suggestion Feed

- Pull suggestions from three sources:
  - **Last.fm** — similar artists and recommended albums based on the configured Last.fm username and API key
  - **ListenBrainz** — recommendations from the ListenBrainz recommendations API using a configured user token
  - **MusicBrainz** — artist/release lookups to resolve and enrich suggestions with structured metadata
- Each suggestion is displayed as a **card** containing:
  - Artist name
  - Album/release title (if resolved to an album) or track title (if a single)
  - Cover art via MusicBrainz Cover Art Archive
  - Source badge (Last.fm / ListenBrainz)
  - MusicBrainz resolution status (Matched / Unmatched / Ambiguous)
  - A **mode toggle**: "Grab Album" or "Grab Track" — defaulting to Album where a release is resolved, Track otherwise
  - Approve and Dismiss buttons
- Auto-pull runs on a configurable schedule (default: every 6 hours via node-cron)
- A **Force Refresh** button triggers an immediate pull
- Dismissed suggestions are stored and not re-surfaced for a configurable number of days

### 2. Download Queue

- Approving a suggestion pushes a search to the **slskd HTTP API**
  - Album mode: searches for the full release by artist + album title
  - Track mode: searches for the individual track by artist + title
- A **Queue view** shows:
  - All pending and in-progress downloads pulled live from the slskd API
  - Status per item (searching, downloading, complete, failed)
  - Source (which suggestion triggered it)
- On completion, the app triggers the post-download organisation step

### 3. Post-Download Organisation

- On download completion, the app calls **beets** to attempt auto-import:
  - If beets matches with high confidence → imports and organises automatically
  - If beets match confidence is low, ambiguous, or fails → the release is moved to a **Review Queue** and flagged
- The **Review Queue** view shows:
  - All flagged releases with their downloaded file path
  - The beets match attempt result (what it tried to match, confidence score)
  - A note that these should be processed manually with MusicBrainz Picard
  - A "Mark as Done" button to clear the item once the user has manually handled it
- Beets configuration is mounted via a custom `beets_config.yaml` — the app does not manage beets config directly

### 4. Scrobbler (Koito Replacement)

- Expose a **ListenBrainz-compatible API endpoint** so any client that supports a custom ListenBrainz URL (Navidrome, Maloja, etc.) can scrobble to MusiCurator
- Store all scrobbles locally in SQLite with: track, artist, album, timestamp, source client
- **Relay** each incoming scrobble to:
  - Last.fm (via Last.fm API with session key auth)
  - ListenBrainz (via ListenBrainz API with user token)
  - Both, one, or neither — configurable per relay target in settings
- Relay failures are logged and retried on next app start

### 5. Stats Dashboard

The stats dashboard is the **public front door** of Shirabe — it loads without any login and is designed to be shareable, similar to a Last.fm or Koito public profile.

**Public stats (no auth — shows admin's profile by default)**
- Top artists, top albums, top tracks — by week, month, year, all time
- Listening activity heatmap (GitHub-style)
- Recent listens feed
- Per-artist detail page: listen count over time, albums scrobbled
- Spotify Wrapped-style yearly rewind view
- All data sourced from local SQLite scrobble store — no external API calls needed

**Private stats (auth required — scoped to logged-in user)**
- Same views as above but scoped to the authenticated user's own scrobble history
- Accessible at `/me` or `/dashboard` after login
- The listener (family member) sees only their own stats here — not the admin's public profile

### 6. Multi-User Support

Shirabe supports two user tiers — **admin** and **listener** — both authenticated via Navidrome credentials (Shirabe validates login against the Navidrome API, no separate password management).

**Unauthenticated visitors**
- See the public stats dashboard — the admin's listening profile
- Cannot access any curator tools or private user stats
- This is the intended experience for anyone visiting the URL without an account

**Admin (single user — the server owner)**
- Full access to all features: discovery, suggestion approval, download queue, review queue, settings
- Last.fm and ListenBrainz credentials configured in settings drive the suggestion feed
- Their scrobbles are relayed to Last.fm and ListenBrainz per relay settings
- Their stats are what appears on the public dashboard

**Listener (family member / secondary user)**
- Logs in to see their own private stats dashboard scoped to their own scrobble history
- No discovery, download controls, or settings access
- No Last.fm or ListenBrainz account required — stats sourced purely from local scrobble store
- Cannot see the admin's private curator tools

**Auth flow**
- Login page at `/login` — accepts Navidrome username + password
- Shirabe calls the Navidrome API to validate credentials and retrieve the user's Navidrome role
- On success, issues a signed JWT (using SECRET_KEY env var) stored in localStorage
- JWT contains: navidrome_user_id, navidrome_username, role ('admin' | 'listener')
- All private API routes check JWT and enforce role — admin-only routes return 403 to listeners
- The scrobble intake endpoint maps incoming scrobbles to the correct local user via the Navidrome user token

**Route access by role**

| Route | Public | Listener | Admin |
|---|---|---|---|
| / (public stats dashboard) | ✅ admin's profile | ✅ admin's profile | ✅ admin's profile |
| /login | ✅ | ✅ | ✅ |
| /me (private stats) | ❌ | ✅ own stats | ✅ own stats |
| /discover | ❌ | ❌ | ✅ |
| /queue | ❌ | ❌ | ✅ |
| /review | ❌ | ❌ | ✅ |
| /settings | ❌ | ❌ | ✅ |

### 7. Settings Page

- Last.fm API key + username
- ListenBrainz username + token
- slskd URL + API key
- Navidrome URL (for future integration)
- Relay toggles: enable/disable Last.fm relay, enable/disable ListenBrainz relay
- Suggestion schedule interval
- Number of days before dismissed suggestions can resurface
- Beets config path

---

## Database Schema (SQLite)

```sql
-- Local user profiles (synced from Navidrome on first login)
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  navidrome_user_id TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'listener', -- 'admin' | 'listener'
  created_at INTEGER DEFAULT (unixepoch())
);

-- Scrobbles received and stored locally
CREATE TABLE scrobbles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) NOT NULL,
  track TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  timestamp INTEGER NOT NULL,
  source_client TEXT,
  relayed_lastfm INTEGER DEFAULT 0,
  relayed_listenbrainz INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Suggestions pulled from Last.fm / ListenBrainz / MusicBrainz
CREATE TABLE suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL, -- 'lastfm' | 'listenbrainz' | 'musicbrainz'
  artist TEXT NOT NULL,
  title TEXT, -- album or track title
  mb_release_id TEXT, -- MusicBrainz release ID if resolved
  mb_artist_id TEXT,
  cover_art_url TEXT,
  match_status TEXT DEFAULT 'unresolved', -- 'matched' | 'unmatched' | 'ambiguous'
  mode TEXT DEFAULT 'album', -- 'album' | 'track'
  status TEXT DEFAULT 'pending', -- 'pending' | 'approved' | 'dismissed' | 'downloading' | 'complete'
  dismissed_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Download queue items sent to slskd
CREATE TABLE downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suggestion_id INTEGER REFERENCES suggestions(id),
  slskd_search_id TEXT,
  mode TEXT NOT NULL, -- 'album' | 'track'
  status TEXT DEFAULT 'queued', -- 'queued' | 'searching' | 'downloading' | 'complete' | 'failed'
  download_path TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  completed_at INTEGER
);

-- Post-download review queue for patchy/unmatched releases
CREATE TABLE review_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  download_id INTEGER REFERENCES downloads(id),
  file_path TEXT NOT NULL,
  beets_attempt TEXT, -- JSON blob of beets match attempt result
  confidence REAL,
  status TEXT DEFAULT 'pending', -- 'pending' | 'done'
  created_at INTEGER DEFAULT (unixepoch())
);

-- App settings key-value store
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

---

## API Routes (Express)

```
-- Public routes (no auth required) --
GET  /api/public/stats/top-artists    - Admin's top artists (period param: week/month/year/all)
GET  /api/public/stats/top-albums     - Admin's top albums
GET  /api/public/stats/top-tracks     - Admin's top tracks
GET  /api/public/stats/heatmap        - Admin's daily listen counts
GET  /api/public/stats/rewind/:year   - Admin's yearly rewind
GET  /api/public/scrobbles            - Admin's recent scrobbles (paginated)

-- Auth routes --
POST /api/auth/login           - Validate Navidrome credentials, return JWT
GET  /api/auth/me              - Return current user profile from JWT

-- Private stats (auth required, scoped to logged-in user) --
GET  /api/me/stats/top-artists
GET  /api/me/stats/top-albums
GET  /api/me/stats/top-tracks
GET  /api/me/stats/heatmap
GET  /api/me/stats/rewind/:year
GET  /api/me/scrobbles

-- Curator routes (admin only) --
GET  /api/suggestions
POST /api/suggestions/refresh
POST /api/suggestions/:id/approve
POST /api/suggestions/:id/dismiss
PATCH /api/suggestions/:id/mode

GET  /api/queue
GET  /api/review
PATCH /api/review/:id/done

GET  /api/settings
POST /api/settings

-- Scrobble intake (ListenBrainz-compatible, maps to user via token) --
POST /1/api/scrobbles
GET  /1/api/validate-token
```

---

## UI Structure

```
-- Public (no auth) --
/                      - Public stats dashboard (admin's profile — Koito-style front door)
/artists               - Admin's top artists (public)
/albums                - Admin's top albums (public)
/rewind                - Admin's yearly rewind (public)
/login                 - Login page

-- Private (auth required) --
/me                    - Logged-in user's own stats dashboard
/me/artists            - Own top artists
/me/albums             - Own top albums
/me/rewind             - Own yearly rewind

-- Admin only --
/discover              - Suggestion feed
/queue                 - Download queue
/review                - Review queue
/settings              - App settings
```

---

## Visual Design

- Dark theme by default, with a theme switcher in settings
- Koito-inspired aesthetic throughout: clean card-based layouts, muted dark backgrounds, accent colours on stats and badges
- The **public dashboard** should feel polished and self-contained — like visiting someone's Last.fm profile. No UI chrome that implies there's a private side unless the user is logged in
- A subtle **Login** link in the corner of the public dashboard is the only entry point to the private side
- Cover art prominently displayed on suggestion cards and stats views
- Source badges (Last.fm red, ListenBrainz orange, MusicBrainz purple) on suggestion cards
- Status pills on download queue items
- GitHub-style contribution heatmap for listening activity

---

## Public API / Widget Support

Shirabe exposes a stable, versioned public API intended for external consumption by sites like `pannboo.dev`. This is separate from the internal API routes used by Shirabe's own frontend.

### CORS

Configure Express CORS middleware to allow requests from external origins. Allowed origins should be configurable in settings (e.g. `ALLOWED_ORIGINS=https://pannboo.dev,https://www.pannboo.dev`). The internal Shirabe frontend origin is always allowed. All other origins are blocked by default.

### Versioned Public API Routes

All widget-facing routes live under `/api/v1/public/` and are:
- Unauthenticated — no JWT required
- Always scoped to the admin user's data
- Stable — response shapes must not change without a version bump
- Rate limited — 60 requests per minute per IP to prevent abuse

```
GET /api/v1/public/now-playing
GET /api/v1/public/recent
GET /api/v1/public/top-artists
GET /api/v1/public/top-albums
GET /api/v1/public/top-tracks
GET /api/v1/public/heatmap
```

### Response Shapes

**GET /api/v1/public/now-playing**
Returns the most recent scrobble with a `is_live` boolean — true if the scrobble timestamp is within the last 4 minutes (Navidrome scrobbles on track completion, so this is a reasonable window).
```json
{
  "is_live": true,
  "track": "Kimi no Shiranai Monogatari",
  "artist": "supercell",
  "album": "Today Is A Beautiful Day",
  "timestamp": 1718123456,
  "cover_art_url": "https://coverartarchive.org/..."
}
```
Returns `null` if no scrobbles exist yet.

**GET /api/v1/public/recent?limit=10**
```json
{
  "scrobbles": [
    {
      "track": "string",
      "artist": "string",
      "album": "string",
      "timestamp": 1718123456,
      "cover_art_url": "string | null"
    }
  ]
}
```
`limit` param: 1–50, default 10.

**GET /api/v1/public/top-artists?period=week**
**GET /api/v1/public/top-albums?period=week**
**GET /api/v1/public/top-tracks?period=week**
`period` param: `week` | `month` | `year` | `all` — default `week`.
```json
{
  "period": "week",
  "items": [
    {
      "name": "string",
      "play_count": 42,
      "cover_art_url": "string | null"
    }
  ]
}
```

**GET /api/v1/public/heatmap?year=2026**
```json
{
  "year": 2026,
  "data": [
    { "date": "2026-01-01", "count": 12 }
  ]
}
```

### Implementation Notes

- Response shapes are the contract — internal refactors must not change field names or types in `/api/v1/public/*` routes
- Add an `X-Shirabe-Version` response header to all v1 public routes so external consumers can detect the API version
- Cover art URLs should prefer MusicBrainz Cover Art Archive. Return `null` rather than a broken URL if no art is available
- The `is_live` window on now-playing (4 minutes) should be configurable in settings

---

## Docker Compose

Provide a `docker-compose.yml` that includes:
- `shirabe` — the app container (port 3000)
- Volume mounts for SQLite data, beets config, and the music/downloads directories
- Environment variables for all secrets (no hardcoded keys)
- `slskd` and `navidrome` as named services the user can plug their existing configs into, with comments explaining the shared volume requirements (downloads path must be shared between shirabe and slskd; music path must be shared between shirabe and navidrome)

---

## Notes for Implementation

- The app is called **Shirabe** — use this name throughout the UI, page titles, and Docker service name
- The root `/` route is the **public stats dashboard** — it must render without any authentication check. Do not redirect unauthenticated users to `/login`
- The public dashboard shows the admin user's scrobble stats by default — query scrobbles WHERE user role = 'admin'
- A small unobtrusive Login link in the top corner of the public dashboard is the only entry point to the private side
- Authentication is handled by validating credentials against the Navidrome API — Shirabe never stores passwords, only JWTs
- The first Navidrome admin user to log in is automatically assigned the 'admin' role in Shirabe; all other users get 'listener'
- Private stats at `/me/*` must be scoped strictly to the authenticated user's ID — never return another user's data
- The ListenBrainz-compatible scrobble endpoint must accept the standard `POST /1/api/scrobbles` payload format so Navidrome can point directly at Shirabe without any client-side changes
- MusicBrainz API calls must respect the 1 request/second rate limit — use a simple request queue
- slskd API polling for download status should use a 10-second interval, not a tight loop
- Beets should be called via child_process exec, not a library — keep it simple and inspectable
- All API keys and credentials stored in the SQLite settings table, not in environment variables (env vars only for bootstrap secrets like SECRET_KEY and DATABASE_URL)
- The app should start and be usable even if slskd or Navidrome are unreachable — show connection status indicators in the admin UI and degrade gracefully. The public dashboard should always render even if backend services are down, showing cached/stored scrobble data from SQLite
