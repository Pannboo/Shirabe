// Versioned public widget API for external consumers (e.g. pannboo.dev).
// CORS allowlist + 60 req/min rate limit + X-Shirabe-Version: 1 header.

import { Router } from "express";
import { z } from "zod";
import cors from "cors";
import { config } from "../config.js";
import { getAdminId } from "../db/queries/users.js";
import { getAllSettings } from "../db/queries/settings.js";
import { getLatestByUser, getRecentByUser } from "../db/queries/scrobbles.js";
import { getNowPlaying } from "../services/nowPlaying.js";
import { getOrEnqueueCoverArt } from "../jobs/resolveCoverArt.js";
import {
  heatmap,
  topAlbums,
  topArtists,
  topTracks,
} from "../services/stats.js";
import { rateLimit } from "../services/rateLimit.js";
import type { Period } from "../types/domain.js";

export const widgetRouter = Router();

const allowed = new Set([...config.allowedOrigins, config.PUBLIC_FRONTEND_ORIGIN]);

widgetRouter.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (allowed.has(origin)) return cb(null, true);
      cb(new Error("origin_not_allowed"));
    },
  }),
);

widgetRouter.use((_req, res, next) => {
  res.setHeader("X-Shirabe-Version", "1");
  next();
});

widgetRouter.use(rateLimit);

function admin(): number | null {
  return getAdminId();
}

widgetRouter.get("/now-playing", (_req, res) => {
  const id = admin();
  if (id === null) {
    res.json(null);
    return;
  }
  const window = getAllSettings().now_playing_window_seconds;
  const live = getNowPlaying(id, window);
  if (live) {
    res.json({
      is_live: true,
      track: live.track,
      artist: live.artist,
      album: live.album,
      timestamp: live.timestamp,
      cover_art_url: getOrEnqueueCoverArt(live.artist, live.album),
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
  });
});

widgetRouter.get("/recent", (req, res) => {
  const id = admin();
  if (id === null) {
    res.json({ scrobbles: [] });
    return;
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  const rows = getRecentByUser(id, limit);
  res.json({
    scrobbles: rows.map((s) => ({
      track: s.track,
      artist: s.artist,
      album: s.album,
      timestamp: s.timestamp,
      cover_art_url: getOrEnqueueCoverArt(s.artist, s.album),
    })),
  });
});

const periodSchema = z.enum(["week", "month", "year", "all"]).default("week");

widgetRouter.get("/top-artists", (req, res) => {
  const id = admin();
  if (id === null) {
    res.json({ period: "week", items: [] });
    return;
  }
  const period = periodSchema.parse(req.query.period ?? "week") as Period;
  res.json({ period, items: topArtists(id, period) });
});

widgetRouter.get("/top-albums", (req, res) => {
  const id = admin();
  if (id === null) {
    res.json({ period: "week", items: [] });
    return;
  }
  const period = periodSchema.parse(req.query.period ?? "week") as Period;
  res.json({ period, items: topAlbums(id, period) });
});

widgetRouter.get("/top-tracks", (req, res) => {
  const id = admin();
  if (id === null) {
    res.json({ period: "week", items: [] });
    return;
  }
  const period = periodSchema.parse(req.query.period ?? "week") as Period;
  res.json({ period, items: topTracks(id, period) });
});

widgetRouter.get("/heatmap", (req, res) => {
  const id = admin();
  if (id === null) {
    res.json({ year: new Date().getFullYear(), data: [] });
    return;
  }
  const year = Number(req.query.year) || new Date().getFullYear();
  res.json({ year, data: heatmap(id, year) });
});
