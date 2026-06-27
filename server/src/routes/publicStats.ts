import { Router } from "express";
import { z } from "zod";
import { getAdminId } from "../db/queries/users.js";
import { getLatestByUser, getRecentByUser } from "../db/queries/scrobbles.js";
import { getSetting } from "../db/queries/settings.js";
import { enrichWithSubsonic, getNowPlaying } from "../services/nowPlaying.js";
import { buildSubsonicCoverArtUrl } from "../integrations/navidrome.js";
import { getUserById } from "../db/queries/users.js";
import { getOrEnqueueCoverArt } from "../jobs/resolveCoverArt.js";
import {
  decades,
  heatmap,
  rewind,
  summary,
  timeOfDay,
  topAlbums,
  topArtists,
  topTracks,
} from "../services/stats.js";
import { artistDetail } from "../services/artistDetail.js";
import { albumDetail } from "../services/albumDetail.js";
import { trackDetail } from "../services/trackDetail.js";
import type { Period } from "../types/domain.js";

export const publicStatsRouter = Router();

const periodSchema = z.enum(["week", "month", "year", "all"]).default("week");

function adminOr404(res: import("express").Response): number | null {
  const id = getAdminId();
  if (!id) {
    res.status(503).json({ error: "no_admin_yet" });
    return null;
  }
  return id;
}

publicStatsRouter.get("/stats/top-artists", (req, res) => {
  const id = adminOr404(res);
  if (id === null) return;
  const period = periodSchema.parse(req.query.period ?? "week") as Period;
  res.json({ period, items: topArtists(id, period) });
});

publicStatsRouter.get("/stats/top-albums", (req, res) => {
  const id = adminOr404(res);
  if (id === null) return;
  const period = periodSchema.parse(req.query.period ?? "week") as Period;
  res.json({ period, items: topAlbums(id, period) });
});

publicStatsRouter.get("/stats/top-tracks", (req, res) => {
  const id = adminOr404(res);
  if (id === null) return;
  const period = periodSchema.parse(req.query.period ?? "week") as Period;
  res.json({ period, items: topTracks(id, period) });
});

publicStatsRouter.get("/stats/summary", (_req, res) => {
  const id = adminOr404(res);
  if (id === null) return;
  res.json(summary(id));
});

publicStatsRouter.get("/stats/time-of-day", (_req, res) => {
  const id = adminOr404(res);
  if (id === null) return;
  res.json({ cells: timeOfDay(id) });
});

publicStatsRouter.get("/stats/decades", (_req, res) => {
  const id = adminOr404(res);
  if (id === null) return;
  res.json(decades(id));
});

publicStatsRouter.get("/stats/heatmap", (req, res) => {
  const id = adminOr404(res);
  if (id === null) return;
  const year = Number(req.query.year) || new Date().getFullYear();
  res.json({ year, data: heatmap(id, year) });
});

publicStatsRouter.get("/stats/rewind/:year", (req, res) => {
  const id = adminOr404(res);
  if (id === null) return;
  const year = Number(req.params.year);
  if (!Number.isFinite(year)) {
    res.status(400).json({ error: "invalid_year" });
    return;
  }
  res.json(rewind(id, year));
});

publicStatsRouter.get("/theme", (_req, res) => {
  res.json({ theme: getSetting("theme") });
});

publicStatsRouter.get("/artists/:name", (req, res) => {
  const id = adminOr404(res);
  if (id === null) return;
  res.json(artistDetail(id, req.params.name));
});

publicStatsRouter.get("/albums/:artist/:album", async (req, res) => {
  const id = adminOr404(res);
  if (id === null) return;
  res.json(await albumDetail(id, req.params.artist, req.params.album));
});

publicStatsRouter.get("/tracks/:artist/:track", (req, res) => {
  const id = adminOr404(res);
  if (id === null) return;
  res.json(trackDetail(id, req.params.artist, req.params.track));
});

publicStatsRouter.get("/now-playing", async (_req, res) => {
  const id = adminOr404(res);
  if (id === null) return;
  const window = getSetting("now_playing_window_seconds");
  let live = getNowPlaying(id, window);
  if (live) {
    const adminUser = getUserById(id);
    if (adminUser) {
      live = (await enrichWithSubsonic(id, adminUser.username)) ?? live;
    }
    res.json({
      is_live: true,
      track: live.track,
      artist: live.artist,
      album: live.album,
      timestamp: live.timestamp,
      // Unified on the image-cache URL for both live and historical
      // scrobbles — used to branch on live.album_id to a Subsonic-proxy
      // URL, which meant the cover swapped mid-listen when a track
      // stopped being "now playing" and became a historical row. Image
      // cache is the single source of truth.
      cover_art_url: getOrEnqueueCoverArt(live.artist, live.album),
      duration: live.duration,
      started_at: live.started_at,
    });
    return;
  }
  const latest = getLatestByUser(id);
  if (!latest) {
    res.json(null);
    return;
  }
  const isLive = Math.floor(Date.now() / 1000) - latest.timestamp < window;
  res.json({
    is_live: isLive,
    track: latest.track,
    artist: latest.artist,
    album: latest.album,
    timestamp: latest.timestamp,
    cover_art_url: getOrEnqueueCoverArt(latest.artist, latest.album),
    duration: null,
    started_at: latest.timestamp,
  });
});

// Cover-art proxy: streams Subsonic getCoverArt through Shirabe so we don't
// have to expose Navidrome admin credentials to the public dashboard.
publicStatsRouter.get("/cover-art/:id", async (req, res) => {
  const url = buildSubsonicCoverArtUrl(req.params.id, Math.min(Math.max(Number(req.query.size) || 300, 32), 1024));
  if (!url) {
    res.status(404).end();
    return;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6_000);
  try {
    const upstream = await fetch(url, { signal: ctrl.signal });
    if (!upstream.ok) {
      res.status(upstream.status || 502).end();
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.end(buf);
  } catch {
    res.status(502).end();
  } finally {
    clearTimeout(timer);
  }
});

publicStatsRouter.get("/scrobbles", (req, res) => {
  const id = adminOr404(res);
  if (id === null) return;
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const scrobbles = getRecentByUser(id, limit).map((s) => ({
    ...s,
    cover_art_url: getOrEnqueueCoverArt(s.artist, s.album),
  }));
  res.json({ scrobbles });
});
