<img width="435" height="532" alt="image" src="https://github.com/user-attachments/assets/dee80ed2-c9e0-4d94-b74d-ecde64a42c6e" />
# Shirabe

Self-hosted music curator and scrobbler. Public Koito-style stats dashboard at `/`, private curator tools (discovery → slskd → beets → review) behind Navidrome-backed auth, and a ListenBrainz-compatible scrobble intake that relays to Last.fm + ListenBrainz.

## Quick start (dev)

```bash
cp .env.example .env
# edit SECRET_KEY
npm install
npm run dev
```

- Server: http://localhost:3000
- Client: http://localhost:5173 (proxies `/api` and `/1` to the server)

## Deploy to a homelab

The whole stack (shirabe + slskd + navidrome + flaresolverr) ships as one
`docker compose up`.

```bash
git clone <repo> shirabe && cd shirabe
cp .env.example .env
# Edit .env:
#   1. Set SECRET_KEY (openssl rand -hex 48)
#   2. (Optional) Fill in any BOOT_* vars to skip the first-run
#      Settings walkthrough — Last.fm key, slskd API key, etc.
docker compose up -d --build
```

First boot takes ~3 minutes (vite + tsc + apt install). Visit
`http://<host>:3000` and log in with your Navidrome admin credentials —
that user automatically becomes the Shirabe admin.

**Shared host paths** (declared in `docker-compose.yml`):
- `./data` — Shirabe's SQLite database (do not delete)
- `./downloads` — slskd ↔ shirabe (slskd drops files here, shirabe
  organises them into `./music`)
- `./music` — shirabe ↔ navidrome (shirabe writes here via beets,
  navidrome scans it)
- `./slskd`, `./navidrome` — each tool's own config

After deploy, walk through `Settings`:
- **Cloudflare bypass**: paste `http://flaresolverr:8191/v1` so RYM/AOTY
  scraper sources work.
- **Last.fm / ListenBrainz / Navidrome / slskd** — fill in anything you
  didn't seed via `BOOT_*`.
- **Download quality** — set lossless-only or adjust extensions; defaults
  to FLAC/MP3/M4A/OGG with 192kbps minimum for lossy.

**Updates:** `git pull && docker compose up -d --build`. The SQLite
schema migrates automatically on boot.

`slskd` and `navidrome` are stubbed in `docker-compose.yml` — swap them
for your existing configs if you already run them, just keep the
`./downloads` and `./music` bind-mounts in sync.

## Scrobble intake

Point any ListenBrainz-compatible client at `http://shirabe.yourdomain.com/1` with `Token <navidrome_user_id>` as the auth token. Navidrome's "ListenBrainz" integration works out of the box: use your Navidrome user id as the token.

## Public widget API

Versioned, rate-limited (60 req/min/IP), CORS-allowlisted (`ALLOWED_ORIGINS`):

- `GET /api/v1/public/now-playing`
- `GET /api/v1/public/recent?limit=10`
- `GET /api/v1/public/top-artists?period=week`
- `GET /api/v1/public/top-albums?period=week`
- `GET /api/v1/public/top-tracks?period=week`
- `GET /api/v1/public/heatmap?year=2026`

All responses include `X-Shirabe-Version: 1`.

## Credits

Shirabe stands on the shoulders of two projects in particular:

- **[Koito](https://koito.mnrva.dev/)** — the design of the public stats
  dashboard, artist page hero, and overall "comfy listening journal" feel
  is heavily inspired by Koito's UI. The display-serif headings,
  big-art-hero artist page, and stat-lockup typography all come from
  studying how Koito presents the same shape of data.
- **[edideaur/AOTY-api](https://github.com/edideaur/AOTY-api)** —
  the AlbumOfTheYear scraper in `server/src/integrations/sources/aoty.ts`
  uses the CSS selectors and HTML structure documented by that project.
  Their HTMLRewriter-based Cloudflare Worker is the source-of-truth for
  what AOTY's live HTML looks like; this codebase translates the same
  selectors into regex form for the Node.js server.

Plus the usual cast: MusicBrainz / Cover Art Archive / ListenBrainz /
Last.fm / Deezer for metadata; slskd / Navidrome / beets for the
download + library plumbing; FlareSolverr for unblocking the scraper
sources that sit behind Cloudflare.

