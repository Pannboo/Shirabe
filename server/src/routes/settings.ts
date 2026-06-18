import { Router } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../auth/middleware.js";
import { getAllSettings, updateSettings } from "../db/queries/settings.js";
import { registerCron } from "../jobs/scheduler.js";
import { pullSuggestions } from "../jobs/pullSuggestions.js";
import { syncNavidromeLibrary } from "../jobs/syncNavidromeLibrary.js";
import { libraryAlbumCount, libraryLastSync } from "../db/queries/library.js";
import { artistImageStats, requeueAllMissingArtistImages, reseedArtistImages } from "../db/queries/artistImages.js";
import { artistLinksStats, requeueAllMissingArtistLinks, reseedArtistLinks } from "../db/queries/artistLinks.js";
import { coverartStats, requeueAllMissingCoverart, reseedCoverart } from "../db/queries/coverart.js";
import { getImportStatus, importLastFmHistory, importListenBrainzHistory } from "../jobs/importHistory.js";
import { db } from "../db/client.js";
import { getAdminId } from "../db/queries/users.js";

export const settingsRouter = Router();
settingsRouter.use(requireAuth, requireAdmin);

// No .strict() — unknown / read-only fields (session_key, session_username,
// pending_token) sent back by the frontend are silently dropped instead of
// erroring out the save.
const settingsSchema = z.object({
  lastfm_api_key: z.string().optional(),
  lastfm_shared_secret: z.string().optional(),
  lastfm_username: z.string().optional(),
  listenbrainz_username: z.string().optional(),
  listenbrainz_token: z.string().optional(),
  slskd_url: z.string().optional(),
  slskd_api_key: z.string().optional(),
  navidrome_url: z.string().optional(),
  navidrome_admin_username: z.string().optional(),
  navidrome_admin_password: z.string().optional(),
  relay_lastfm: z.boolean().optional(),
  relay_listenbrainz: z.boolean().optional(),
  suggestion_schedule: z.string().optional(),
  dismiss_cooldown_days: z.number().int().nonnegative().optional(),
  beets_config_path: z.string().optional(),
  now_playing_window_seconds: z.number().int().positive().optional(),
  theme: z.string().optional(),
  download_allowed_extensions: z.string().optional(),
  download_lossless_only: z.boolean().optional(),
  download_min_kbps: z.number().int().nonnegative().optional(),
  download_min_files_per_album: z.number().int().nonnegative().optional(),
  flaresolverr_url: z.string().optional(),
});

settingsRouter.get("/", (_req, res) => {
  res.json(getAllSettings());
});

settingsRouter.post("/", (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }
  const updated = updateSettings(parsed.data);
  // If the schedule changed, re-register the cron.
  if (parsed.data.suggestion_schedule) {
    registerCron("pullSuggestions", updated.suggestion_schedule, pullSuggestions);
  }
  res.json(updated);
});

settingsRouter.get("/library", (_req, res) => {
  res.json({ albums: libraryAlbumCount(), last_synced_at: libraryLastSync() });
});

settingsRouter.get("/artist-images", (_req, res) => {
  res.json(artistImageStats());
});

// Two requeue modes:
//   POST /artist-images/requeue          → just flip 'missing' rows to 'pending'
//   POST /artist-images/requeue?all=true → wipe everything + reseed from
//     every distinct artist in scrobbles. Use when the resolver chain itself
//     changed (e.g. swapped a source) and we want to force a full pass.
settingsRouter.post("/artist-images/requeue", (req, res) => {
  if (req.query.all === "true") {
    const id = getAdminId();
    const artists = id
      ? (db.prepare(`SELECT DISTINCT artist FROM scrobbles WHERE user_id = ?`).all(id) as { artist: string }[])
          .map((r) => r.artist)
      : [];
    const result = reseedArtistImages(artists);
    res.json({ mode: "reseed", ...result });
    return;
  }
  const requeued = requeueAllMissingArtistImages();
  res.json({ mode: "missing_only", requeued });
});

settingsRouter.get("/artist-links", (_req, res) => {
  res.json(artistLinksStats());
});

// Two requeue modes, same shape as the artist-images endpoint:
//   POST /artist-links/requeue          → flip 'missing' rows to 'pending'
//   POST /artist-links/requeue?all=true → wipe + re-seed from every known
//     MBID in artist_images.  No scrobble-table query needed; we just reuse
//     the MBIDs the artist-image resolver already mapped.
settingsRouter.post("/artist-links/requeue", (req, res) => {
  if (req.query.all === "true") {
    const result = reseedArtistLinks();
    res.json({ mode: "reseed", ...result });
    return;
  }
  const requeued = requeueAllMissingArtistLinks();
  res.json({ mode: "missing_only", requeued });
});

// === Unified media cache (cover art + artist images + artist links) ======
//
// Single panel in Settings drives all three caches at once. Keeps the
// per-cache endpoints (artist-images/*, artist-links/*) for backwards
// compat and edge cases, but the UI uses these aggregated routes so a
// "Wipe + re-seed all" rebuilds everything in one click.

settingsRouter.get("/media-cache", (_req, res) => {
  res.json({
    cover_art: coverartStats(),
    artist_images: artistImageStats(),
    artist_links: artistLinksStats(),
  });
});

settingsRouter.post("/media-cache/requeue", (req, res) => {
  const userId = req.user!.user_id;
  if (req.query.all === "true") {
    // Order matters. reseedArtistLinks reads its MBID seed list from
    // artist_images, so capture that BEFORE we wipe artist_images.
    // Otherwise the link reseed sees an empty source table and ends up
    // with zero pending rows.
    const al = reseedArtistLinks();

    // Then the other two re-seed from scrobble history. For artist_images
    // we pull the distinct artist list from scrobbles ourselves (the
    // helper takes a list); coverart's reseed talks to scrobbles directly.
    const artists = (db.prepare(`SELECT DISTINCT artist FROM scrobbles WHERE user_id = ?`)
      .all(userId) as { artist: string }[])
      .map((r) => r.artist);
    const cover = reseedCoverart(userId);
    const ai = reseedArtistImages(artists);
    res.json({
      mode: "reseed",
      cover_art: cover,
      artist_images: ai,
      artist_links: al,
    });
    return;
  }
  const cover = requeueAllMissingCoverart();
  const ai = requeueAllMissingArtistImages();
  const al = requeueAllMissingArtistLinks();
  res.json({
    mode: "missing_only",
    cover_art: { requeued: cover },
    artist_images: { requeued: ai },
    artist_links: { requeued: al },
  });
});

// === Scraper debug =======================================================
//
// Fetches a scraper source URL with browser-like headers and returns the
// raw response so the operator can see what HTML actually came back when
// a parser produced 0 rows. Bypasses FlareSolverr — useful for figuring
// out which sources need the proxy vs which just need a parser fix.
//
// curl -H "Authorization: Bearer <token>" \
//   'http://shirabe:3000/api/settings/scraper-debug?source=aoty'

settingsRouter.get("/scraper-debug", async (req, res) => {
  const source = String(req.query.source ?? "");
  const limit = Math.min(Math.max(Number(req.query.limit) || 4000, 500), 100_000);
  const year = new Date().getUTCFullYear();
  const targets: Record<string, string> = {
    aoty: `https://www.albumoftheyear.org/must-hear/${year}/`,
    rym: `https://rateyourmusic.com/charts/top/album/year/${year}/`,
    stereogum_aotw: "https://www.stereogum.com/category/album-of-the-week/feed/",
    stereogum_premature: "https://www.stereogum.com/category/premature-evaluation/feed/",
    npr: "https://feeds.npr.org/1039/rss.xml",
  };
  const url = targets[source];
  if (!url) {
    res.status(400).json({
      error: "unknown_source",
      available: Object.keys(targets),
    });
    return;
  }
  const browserHeaders: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
  };
  try {
    const r = await fetch(url, { headers: browserHeaders });
    const text = await r.text();
    res.json({
      source,
      url,
      status: r.status,
      content_type: r.headers.get("content-type"),
      content_length: text.length,
      preview: text.slice(0, limit),
    });
  } catch (err) {
    res.status(502).json({
      source,
      url,
      error: err instanceof Error ? err.message : "unknown",
    });
  }
});

// === Scrobble history import =============================================

settingsRouter.get("/import/status", (req, res) => {
  void req;
  res.json(getImportStatus());
});

// Fire-and-forget — the route returns immediately; the actual import runs
// in the background. UI polls /import/status while phase === "running".
settingsRouter.post("/import/lastfm", (req, res) => {
  const userId = req.user!.user_id;
  void importLastFmHistory(userId);
  res.json({ ok: true });
});

settingsRouter.post("/import/listenbrainz", (req, res) => {
  const userId = req.user!.user_id;
  void importListenBrainzHistory(userId);
  res.json({ ok: true });
});

settingsRouter.post("/library/sync", async (_req, res) => {
  try {
    const result = await syncNavidromeLibrary();
    res.json({ ...result, last_synced_at: libraryLastSync() });
  } catch (err) {
    res.status(502).json({ error: "sync_failed", message: err instanceof Error ? err.message : "unknown" });
  }
});
