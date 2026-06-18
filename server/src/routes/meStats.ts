import { Router } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../auth/middleware.js";
import { getRecentByUser } from "../db/queries/scrobbles.js";
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
import { listLibrary, type LibraryFilter, type LibrarySort } from "../services/library.js";
import { onThisDay } from "../services/trivia.js";
import type { Period } from "../types/domain.js";

export const meStatsRouter = Router();
meStatsRouter.use(requireAuth);

const periodSchema = z.enum(["week", "month", "year", "all"]).default("week");

meStatsRouter.get("/stats/top-artists", (req, res) => {
  const period = periodSchema.parse(req.query.period ?? "week") as Period;
  res.json({ period, items: topArtists(req.user!.user_id, period) });
});

meStatsRouter.get("/stats/top-albums", (req, res) => {
  const period = periodSchema.parse(req.query.period ?? "week") as Period;
  res.json({ period, items: topAlbums(req.user!.user_id, period) });
});

meStatsRouter.get("/stats/top-tracks", (req, res) => {
  const period = periodSchema.parse(req.query.period ?? "week") as Period;
  res.json({ period, items: topTracks(req.user!.user_id, period) });
});

meStatsRouter.get("/stats/summary", (req, res) => {
  res.json(summary(req.user!.user_id));
});

meStatsRouter.get("/stats/time-of-day", (req, res) => {
  res.json({ cells: timeOfDay(req.user!.user_id) });
});

meStatsRouter.get("/stats/decades", (req, res) => {
  res.json(decades(req.user!.user_id));
});

meStatsRouter.get("/stats/heatmap", (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  res.json({ year, data: heatmap(req.user!.user_id, year) });
});

meStatsRouter.get("/stats/rewind/:year", (req, res) => {
  const year = Number(req.params.year);
  res.json(rewind(req.user!.user_id, year));
});

meStatsRouter.get("/artists/:name", (req, res) => {
  res.json(artistDetail(req.user!.user_id, req.params.name));
});

// :artist/:album so React Router and Express agree on the segmentation.
// Both halves come pre-encoded from the client (encodeURIComponent), so
// Express decodes them once and the service gets the raw names.
meStatsRouter.get("/albums/:artist/:album", async (req, res) => {
  res.json(await albumDetail(req.user!.user_id, req.params.artist, req.params.album));
});

meStatsRouter.get("/tracks/:artist/:track", (req, res) => {
  res.json(trackDetail(req.user!.user_id, req.params.artist, req.params.track));
});

meStatsRouter.get("/trivia/on-this-day", (req, res) => {
  res.json({ items: onThisDay(req.user!.user_id) });
});

const sortSchema = z.enum([
  "last_played", "most_played", "alphabetical", "artist", "recently_added",
]).optional();
const filterSchema = z.enum([
  "all", "never_played", "played_recently", "played_this_year", "lost_gems",
]).optional();

// Library browse is admin-scoped — it's keyed on the Navidrome mirror which
// is per-server, not per-user.
meStatsRouter.get("/library", requireAdmin, (req, res) => {
  const sort = sortSchema.parse(req.query.sort) as LibrarySort | undefined;
  const filter = filterSchema.parse(req.query.filter) as LibraryFilter | undefined;
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const page = Number(req.query.page) || 0;
  res.json(listLibrary(req.user!.user_id, { sort, filter, search, page }));
});

meStatsRouter.get("/scrobbles", (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const scrobbles = getRecentByUser(req.user!.user_id, limit).map((s) => ({
    ...s,
    cover_art_url: getOrEnqueueCoverArt(s.artist, s.album),
  }));
  res.json({ scrobbles });
});
