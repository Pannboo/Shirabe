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

// === Unified media cache (album cover art + artist images) ===============
//
// Single panel in Settings drives both caches at once. Keeps the per-cache
// endpoints (artist-images/*) for backwards compat and edge cases, but the
// UI uses these aggregated routes so a "Wipe + re-seed all" rebuilds both
// in one click.

settingsRouter.get("/media-cache", (_req, res) => {
  res.json({
    cover_art: coverartStats(),
    artist_images: artistImageStats(),
  });
});

settingsRouter.post("/media-cache/requeue", (req, res) => {
  const userId = req.user!.user_id;
  if (req.query.all === "true") {
    // Re-seed both from scrobble history. For artist_images we pull the
    // distinct artist list from scrobbles ourselves (the helper takes a
    // list); coverart's reseed talks to the scrobbles table directly.
    const artists = (db.prepare(`SELECT DISTINCT artist FROM scrobbles WHERE user_id = ?`)
      .all(userId) as { artist: string }[])
      .map((r) => r.artist);
    const cover = reseedCoverart(userId);
    const ai = reseedArtistImages(artists);
    res.json({
      mode: "reseed",
      cover_art: cover,
      artist_images: ai,
    });
    return;
  }
  const cover = requeueAllMissingCoverart();
  const ai = requeueAllMissingArtistImages();
  res.json({
    mode: "missing_only",
    cover_art: { requeued: cover },
    artist_images: { requeued: ai },
  });
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
