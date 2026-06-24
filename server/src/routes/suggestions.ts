import { Router } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../auth/middleware.js";
import {
  dismissSuggestion,
  getSuggestion,
  listPendingSuggestions,
  setSuggestionMode,
  setSuggestionStatus,
} from "../db/queries/suggestions.js";
import {
  insertDownload,
  setDownloadSearchId,
  setDownloadSlskdTarget,
  setDownloadStatus,
} from "../db/queries/downloads.js";
import { isAlbumOwned } from "../db/queries/library.js";
import { pullSuggestions } from "../jobs/pullSuggestions.js";
import { syncNavidromeLibrary } from "../jobs/syncNavidromeLibrary.js";
import {
  expandCandidateFolders,
  getSlskdSearch,
  queueSlskdFiles,
  rankCandidates,
  startSlskdSearch,
} from "../integrations/slskd.js";
import {
  getLastFmAlbumTracks,
  searchLastFmAlbums,
} from "../integrations/lastfm.js";
import { getReleaseTracks, searchReleases } from "../integrations/musicbrainz.js";

export const suggestionsRouter = Router();
suggestionsRouter.use(requireAuth, requireAdmin);

suggestionsRouter.get("/", (req, res) => {
  const includeOwned = req.query.include_owned === "true";
  let suggestions = listPendingSuggestions();
  if (!includeOwned) {
    suggestions = suggestions.filter(
      (s) => !isAlbumOwned(s.artist, s.title, s.mb_release_id),
    );
  }
  res.json({ suggestions });
});

suggestionsRouter.post("/refresh", async (_req, res) => {
  const result = await pullSuggestions();
  res.json(result);
});

suggestionsRouter.post("/library/sync", async (_req, res) => {
  const result = await syncNavidromeLibrary();
  res.json(result);
});

suggestionsRouter.post("/:id/approve", async (req, res) => {
  const id = Number(req.params.id);
  const s = getSuggestion(id);
  if (!s) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const query =
    s.mode === "album"
      ? `${s.artist} ${s.title ?? ""}`.trim()
      : `${s.artist} ${s.title ?? ""}`.trim();
  const searchId = await startSlskdSearch(query);
  const download = insertDownload(s.id, searchId, s.mode, { artist: s.artist, title: s.title });
  if (searchId) setDownloadSearchId(download.id, searchId);
  setSuggestionStatus(s.id, "approved");
  res.json({ download });
});

suggestionsRouter.post("/:id/dismiss", (req, res) => {
  const id = Number(req.params.id);
  if (!getSuggestion(id)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  dismissSuggestion(id);
  res.json({ ok: true });
});

// ===== Free-text album search ============================================
//
// Queries Last.fm album.search and MusicBrainz release search in parallel,
// merges + dedupes (case-insensitive artist+title), and returns a unified
// ranked list. MB entries carry their release id so the client can ask for
// a track listing immediately; Last.fm entries usually carry a cover URL.

suggestionsRouter.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) {
    res.json({ results: [] });
    return;
  }
  const [lfm, mb] = await Promise.all([
    searchLastFmAlbums(q, 12).catch(() => []),
    searchReleases(q, 12).catch(() => []),
  ]);

  const seen = new Set<string>();
  const results: Array<{
    artist: string;
    title: string;
    cover_art_url: string | null;
    mb_release_id: string | null;
    year: number | null;
    source: "lastfm" | "musicbrainz";
    is_owned: boolean;
  }> = [];

  function push(entry: Omit<(typeof results)[number], "is_owned">): void {
    results.push({
      ...entry,
      is_owned: isAlbumOwned(entry.artist, entry.title, entry.mb_release_id),
    });
  }

  // MB first — gives the client an mbid for track lookups when available.
  for (const m of mb.slice(0, 8)) {
    const key = `${m.artistName.toLowerCase()}|${m.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    push({
      artist: m.artistName,
      title: m.title,
      cover_art_url: null,
      mb_release_id: m.releaseId,
      year: m.year,
      source: "musicbrainz",
    });
  }
  for (const l of lfm) {
    const key = `${l.artist.toLowerCase()}|${l.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    push({
      artist: l.artist,
      title: l.name,
      cover_art_url: l.cover_art_url,
      mb_release_id: l.mbid,
      year: null,
      source: "lastfm",
    });
  }

  res.json({ results });
});

// ===== Album track listing ================================================
//
// MusicBrainz first (richer/cleaner data, durations in ms), Last.fm fallback
// when no MB release id is supplied or MB lookup returns nothing.

suggestionsRouter.get("/album-tracks", async (req, res) => {
  const mbReleaseId = typeof req.query.mb_release_id === "string" ? req.query.mb_release_id : null;
  const artist = typeof req.query.artist === "string" ? req.query.artist : null;
  const title = typeof req.query.title === "string" ? req.query.title : null;

  if (mbReleaseId) {
    const tracks = await getReleaseTracks(mbReleaseId);
    if (tracks.length > 0) {
      res.json({ source: "musicbrainz", tracks });
      return;
    }
  }
  if (artist && title) {
    const tracks = await getLastFmAlbumTracks(artist, title);
    res.json({
      source: "lastfm",
      tracks: tracks.map((t, i) => ({
        position: i + 1,
        title: t.name,
        duration_seconds: t.duration_seconds,
      })),
    });
    return;
  }
  res.json({ source: null, tracks: [] });
});

// ===== slskd download preview =============================================
//
// Starts a slskd search for the requested query, waits briefly for peers to
// respond, then returns the top filtered candidates so the user can pick
// which one to queue. The filter respects the user's quality settings
// (allowed extensions, lossless-only, min bitrate, min files per album).
//
// We block-wait for up to ~6s — slskd typically has the first responses in
// 1-3s. If nothing comes back, the response includes the search_id so the
// client can poll.

const previewSchema = z.object({
  artist: z.string().min(1),
  title: z.string().min(1),
  mode: z.enum(["album", "track"]).default("album"),
});

suggestionsRouter.post("/slskd-preview", async (req, res) => {
  const parsed = previewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const { artist, title, mode } = parsed.data;
  const query = `${artist} ${title}`.trim();
  const searchId = await startSlskdSearch(query);
  if (!searchId) {
    res.status(502).json({ error: "slskd_not_configured" });
    return;
  }

  // Short initial wait so the fastest peers — usually 1–2 seconds — land in
  // the first response without forcing the client to immediately poll. Most
  // results arrive later (10–30s); the client uses /slskd-search/:id to keep
  // pulling in candidates as they show up.
  await new Promise((r) => setTimeout(r, 2_000));
  const detail = await getSlskdSearch(searchId);
  const ranked = detail
    ? rankCandidates(detail, { mode, strict: true })
    : { candidates: [], total_peers: 0, total_files: 0 };
  // Expand the visible candidates' folders so the UI shows real file counts
  // (and Grab queues the full folder including cover art / lyrics). Skip for
  // track mode — we're only picking a single file, browsing is wasted work.
  const visible = ranked.candidates.slice(0, 15);
  const expanded = mode === "album"
    ? await expandCandidateFolders(visible, { strict: true })
    : visible;
  res.json({
    search_id: searchId,
    candidates: expanded,
    total_peers: ranked.total_peers,
    total_files: ranked.total_files,
    complete: !!detail?.isComplete,
  });
});

suggestionsRouter.get("/slskd-search/:id", async (req, res) => {
  const mode = req.query.mode === "track" ? "track" : "album";
  const strict = req.query.strict !== "false";
  const detail = await getSlskdSearch(req.params.id);
  if (!detail) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const ranked = rankCandidates(detail, { mode, strict });
  const visible = ranked.candidates.slice(0, 30);
  const expanded = mode === "album"
    ? await expandCandidateFolders(visible, { strict, limit: 15 })
    : visible;
  res.json({
    search_id: req.params.id,
    candidates: expanded,
    total_peers: ranked.total_peers,
    total_files: ranked.total_files,
    complete: !!detail.isComplete,
  });
});

// Queue the user-picked candidate. The body is the candidate the client
// already received from /slskd-preview — we just forward to slskd and
// create a download row so it shows up on the Queue page.
const queueSchema = z.object({
  username: z.string().min(1),
  files: z.array(z.object({ filename: z.string(), size: z.number() })).min(1),
  mode: z.enum(["album", "track"]).default("album"),
  artist: z.string().optional(),
  title: z.string().optional(),
});

suggestionsRouter.post("/slskd-queue", async (req, res) => {
  const parsed = queueSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const ok = await queueSlskdFiles(parsed.data.username, parsed.data.files);
  if (!ok) {
    res.status(502).json({ error: "slskd_queue_failed" });
    return;
  }
  // No suggestion-id: this came from search, not a curated suggestion.
  // Skip the queued→searching→downloading state machine since we've already
  // told slskd to download. Carry artist/title so the Queue page can render
  // the download meaningfully.
  const download = insertDownload(null, null, parsed.data.mode, {
    artist: parsed.data.artist ?? null,
    title: parsed.data.title ?? null,
  });

  // Persist slskd correlation target so pollDownloads can match this row
  // against the live transfer list. Without these the row would sit in
  // "downloading" forever (no slskd_search_id to drive the state machine,
  // no username/folder to correlate by). Folder is the parent directory
  // of any one of the queued files — they should all share the same
  // folder since that's how Candidate is grouped upstream.
  const first = parsed.data.files[0];
  if (first) {
    const sep = Math.max(first.filename.lastIndexOf("\\"), first.filename.lastIndexOf("/"));
    const folder = sep < 0 ? "" : first.filename.slice(0, sep);
    setDownloadSlskdTarget(download.id, parsed.data.username, folder);
  }
  setDownloadStatus(download.id, "downloading");
  res.json({ download });
});

const modeSchema = z.object({ mode: z.enum(["album", "track"]) });
suggestionsRouter.patch("/:id/mode", (req, res) => {
  const id = Number(req.params.id);
  const parsed = modeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  if (!getSuggestion(id)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  setSuggestionMode(id, parsed.data.mode);
  res.json({ ok: true });
});
