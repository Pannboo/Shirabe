import { db } from "../db/client.js";
import { getOrEnqueueCoverArt } from "../jobs/resolveCoverArt.js";
import { getOrEnqueueArtistImage } from "../jobs/resolveArtistImage.js";
import type { Period } from "../types/domain.js";

function periodCutoff(period: Period): number {
  const now = Math.floor(Date.now() / 1000);
  switch (period) {
    case "week":
      return now - 7 * 86400;
    case "month":
      return now - 30 * 86400;
    case "year":
      return now - 365 * 86400;
    case "all":
      return 0;
  }
}

export interface RankedItem {
  name: string;
  play_count: number;
  cover_art_url: string | null;
  artist?: string;
}

const topArtistsStmt = db.prepare(`
  SELECT artist as name, COUNT(*) as play_count
  FROM scrobbles
  WHERE user_id = ? AND timestamp >= ?
  GROUP BY artist
  ORDER BY play_count DESC
  LIMIT ?
`);

const topAlbumsStmt = db.prepare(`
  SELECT album as name, artist, COUNT(*) as play_count
  FROM scrobbles
  WHERE user_id = ? AND timestamp >= ? AND album IS NOT NULL AND album != ''
  GROUP BY album, artist
  ORDER BY play_count DESC
  LIMIT ?
`);

const topTracksStmt = db.prepare(`
  SELECT track as name, artist, COUNT(*) as play_count
  FROM scrobbles
  WHERE user_id = ? AND timestamp >= ?
  GROUP BY track, artist
  ORDER BY play_count DESC
  LIMIT ?
`);

const heatmapStmt = db.prepare(`
  SELECT date(timestamp, 'unixepoch') as date, COUNT(*) as count
  FROM scrobbles
  WHERE user_id = ? AND timestamp >= ? AND timestamp < ?
  GROUP BY date
  ORDER BY date ASC
`);

const trackTopAlbumStmt = db.prepare(`
  SELECT album FROM scrobbles
  WHERE user_id = ? AND artist = ? AND track = ? AND album IS NOT NULL AND album != ''
  GROUP BY album ORDER BY COUNT(*) DESC LIMIT 1
`);

const artistTopAlbumStmt = db.prepare(`
  SELECT album FROM scrobbles
  WHERE user_id = ? AND artist = ? AND album IS NOT NULL AND album != ''
  GROUP BY album ORDER BY COUNT(*) DESC LIMIT 1
`);

// Resolve an image for the artist tile. Prefer a real artist photo from the
// artist-image cache (LB/CAA/Last.fm) and fall back to the most-played
// album cover if no photo is available. Both paths enqueue async resolution
// on cache miss, so the next render — within the page's 60s poll — will
// usually pick up the better image.
function artistCover(userId: number, artist: string): string | null {
  const photo = getOrEnqueueArtistImage(artist);
  if (photo) return photo;
  const row = artistTopAlbumStmt.get(userId, artist) as { album: string } | undefined;
  if (!row?.album) return null;
  return getOrEnqueueCoverArt(artist, row.album);
}

export function topArtists(userId: number, period: Period, limit = 20): RankedItem[] {
  return topArtistsStmt
    .all(userId, periodCutoff(period), limit)
    .map((r) => {
      const item = r as RankedItem;
      return { ...item, cover_art_url: artistCover(userId, item.name) };
    });
}

export function topAlbums(userId: number, period: Period, limit = 20): RankedItem[] {
  return topAlbumsStmt
    .all(userId, periodCutoff(period), limit)
    .map((r) => {
      const item = r as RankedItem;
      return {
        ...item,
        cover_art_url: item.artist ? getOrEnqueueCoverArt(item.artist, item.name) : null,
      };
    });
}

export function topTracks(userId: number, period: Period, limit = 20): RankedItem[] {
  return topTracksStmt
    .all(userId, periodCutoff(period), limit)
    .map((r) => {
      const item = r as RankedItem;
      if (!item.artist) return { ...item, cover_art_url: null };
      const album = trackTopAlbumStmt.get(userId, item.artist, item.name) as { album: string } | undefined;
      return {
        ...item,
        cover_art_url: album ? getOrEnqueueCoverArt(item.artist, album.album) : null,
      };
    });
}

export interface HeatmapPoint {
  date: string;
  count: number;
}

export function heatmap(userId: number, year: number): HeatmapPoint[] {
  const start = Math.floor(new Date(`${year}-01-01T00:00:00Z`).getTime() / 1000);
  const end = Math.floor(new Date(`${year + 1}-01-01T00:00:00Z`).getTime() / 1000);
  return heatmapStmt.all(userId, start, end) as HeatmapPoint[];
}

export interface RewindHighlight {
  artist: string;
  track: string;
  album: string | null;
  timestamp: number;
  cover_art_url: string | null;
}

export interface Rewind {
  year: number;
  total_scrobbles: number;
  unique_artists: number;
  unique_albums: number;
  unique_tracks: number;
  top_artists: RankedItem[];
  top_albums: RankedItem[];
  top_tracks: RankedItem[];
  // Story-mode additions for the redesigned Rewind page.
  longest_streak_days: number;
  biggest_day: { date: string; count: number } | null;
  biggest_week: { start_date: string; count: number } | null;
  biggest_month: { month: string; count: number } | null;
  first_scrobble_of_year: RewindHighlight | null;
  last_scrobble_of_year: RewindHighlight | null;
  new_artists_discovered: number;
  new_albums_discovered: number;
}

const rewindCountsStmt = db.prepare(`
  SELECT
    COUNT(*) as total_scrobbles,
    COUNT(DISTINCT artist) as unique_artists,
    COUNT(DISTINCT album) as unique_albums,
    COUNT(DISTINCT track || '||' || artist) as unique_tracks
  FROM scrobbles
  WHERE user_id = ? AND timestamp >= ? AND timestamp < ?
`);

const rewindTopArtistsStmt = db.prepare(`
  SELECT artist as name, COUNT(*) as play_count FROM scrobbles
  WHERE user_id = ? AND timestamp >= ? AND timestamp < ?
  GROUP BY artist ORDER BY play_count DESC LIMIT 10
`);

const rewindTopAlbumsStmt = db.prepare(`
  SELECT album as name, artist, COUNT(*) as play_count FROM scrobbles
  WHERE user_id = ? AND timestamp >= ? AND timestamp < ? AND album IS NOT NULL AND album != ''
  GROUP BY album, artist ORDER BY play_count DESC LIMIT 10
`);

const rewindTopTracksStmt = db.prepare(`
  SELECT track as name, artist, COUNT(*) as play_count FROM scrobbles
  WHERE user_id = ? AND timestamp >= ? AND timestamp < ?
  GROUP BY track, artist ORDER BY play_count DESC LIMIT 10
`);

// === Rewind story helpers ==================================================
//
// All scoped to a single year (start/end unix epoch).

const biggestDayStmt = db.prepare(`
  SELECT date(timestamp, 'unixepoch', 'localtime') AS date, COUNT(*) AS count
  FROM scrobbles
  WHERE user_id = ? AND timestamp >= ? AND timestamp < ?
  GROUP BY date
  ORDER BY count DESC
  LIMIT 1
`);

const biggestMonthStmt = db.prepare(`
  SELECT strftime('%Y-%m', timestamp, 'unixepoch', 'localtime') AS month, COUNT(*) AS count
  FROM scrobbles
  WHERE user_id = ? AND timestamp >= ? AND timestamp < ?
  GROUP BY month
  ORDER BY count DESC
  LIMIT 1
`);

// SQLite week-of-year format %W (Monday-first, 00–53). Pairing it with the
// year keeps weeks unique across a year boundary even if we ever query
// multi-year. Returns the Monday of the winning week as start_date.
const biggestWeekStmt = db.prepare(`
  SELECT
    strftime('%Y-%W', timestamp, 'unixepoch', 'localtime') AS yearweek,
    MIN(date(timestamp, 'unixepoch', 'localtime', 'weekday 1', '-7 days')) AS start_date,
    COUNT(*) AS count
  FROM scrobbles
  WHERE user_id = ? AND timestamp >= ? AND timestamp < ?
  GROUP BY yearweek
  ORDER BY count DESC
  LIMIT 1
`);

const firstScrobbleOfYearStmt = db.prepare(`
  SELECT artist, track, album, timestamp FROM scrobbles
  WHERE user_id = ? AND timestamp >= ? AND timestamp < ?
  ORDER BY timestamp ASC LIMIT 1
`);

const lastScrobbleOfYearStmt = db.prepare(`
  SELECT artist, track, album, timestamp FROM scrobbles
  WHERE user_id = ? AND timestamp >= ? AND timestamp < ?
  ORDER BY timestamp DESC LIMIT 1
`);

// "Discovered this year" = first-ever scrobble of the artist/album landed
// inside this year's window. We compute MIN(timestamp) per artist/album
// across all of history, then count the ones falling inside [start, end).
const newArtistsThisYearStmt = db.prepare(`
  SELECT COUNT(*) AS n FROM (
    SELECT artist, MIN(timestamp) AS first_ts FROM scrobbles
    WHERE user_id = ? GROUP BY artist
  ) WHERE first_ts >= ? AND first_ts < ?
`);

const newAlbumsThisYearStmt = db.prepare(`
  SELECT COUNT(*) AS n FROM (
    SELECT album, artist, MIN(timestamp) AS first_ts FROM scrobbles
    WHERE user_id = ? AND album IS NOT NULL AND album != ''
    GROUP BY album, artist
  ) WHERE first_ts >= ? AND first_ts < ?
`);

const activeDaysInYearStmt = db.prepare(`
  SELECT DISTINCT date(timestamp, 'unixepoch') AS d
  FROM scrobbles WHERE user_id = ? AND timestamp >= ? AND timestamp < ?
  ORDER BY d ASC
`);

function longestStreakInRange(userId: number, start: number, end: number): number {
  const rows = activeDaysInYearStmt.all(userId, start, end) as { d: string }[];
  if (rows.length === 0) return 0;
  let best = 1;
  let cur = 1;
  for (let i = 1; i < rows.length; i++) {
    const prev = new Date(rows[i - 1]!.d + "T00:00:00Z").getTime();
    const next = new Date(rows[i]!.d + "T00:00:00Z").getTime();
    if (Math.round((next - prev) / 86_400_000) === 1) {
      cur += 1;
      if (cur > best) best = cur;
    } else {
      cur = 1;
    }
  }
  return best;
}

function highlightWithCover(
  row: { artist: string; track: string; album: string | null; timestamp: number } | undefined,
): RewindHighlight | null {
  if (!row) return null;
  return {
    artist: row.artist,
    track: row.track,
    album: row.album,
    timestamp: row.timestamp,
    cover_art_url: row.album ? getOrEnqueueCoverArt(row.artist, row.album) : null,
  };
}

export function rewind(userId: number, year: number): Rewind {
  const start = Math.floor(new Date(`${year}-01-01T00:00:00Z`).getTime() / 1000);
  const end = Math.floor(new Date(`${year + 1}-01-01T00:00:00Z`).getTime() / 1000);
  const counts = rewindCountsStmt.get(userId, start, end) as {
    total_scrobbles: number;
    unique_artists: number;
    unique_albums: number;
    unique_tracks: number;
  };

  const bDay = biggestDayStmt.get(userId, start, end) as { date: string; count: number } | undefined;
  const bWeek = biggestWeekStmt.get(userId, start, end) as { start_date: string; count: number } | undefined;
  const bMonth = biggestMonthStmt.get(userId, start, end) as { month: string; count: number } | undefined;
  const firstRow = firstScrobbleOfYearStmt.get(userId, start, end) as
    | { artist: string; track: string; album: string | null; timestamp: number }
    | undefined;
  const lastRow = lastScrobbleOfYearStmt.get(userId, start, end) as
    | { artist: string; track: string; album: string | null; timestamp: number }
    | undefined;
  const newArtists = (newArtistsThisYearStmt.get(userId, start, end) as { n: number }).n;
  const newAlbums = (newAlbumsThisYearStmt.get(userId, start, end) as { n: number }).n;

  return {
    year,
    ...counts,
    top_artists: rewindTopArtistsStmt
      .all(userId, start, end)
      .map((r) => {
        const item = r as RankedItem;
        return { ...item, cover_art_url: artistCover(userId, item.name) };
      }),
    top_albums: rewindTopAlbumsStmt
      .all(userId, start, end)
      .map((r) => {
        const item = r as RankedItem;
        return {
          ...item,
          cover_art_url: item.artist ? getOrEnqueueCoverArt(item.artist, item.name) : null,
        };
      }),
    top_tracks: rewindTopTracksStmt
      .all(userId, start, end)
      .map((r) => {
        const item = r as RankedItem;
        if (!item.artist) return { ...item, cover_art_url: null };
        const album = trackTopAlbumStmt.get(userId, item.artist, item.name) as { album: string } | undefined;
        return {
          ...item,
          cover_art_url: album ? getOrEnqueueCoverArt(item.artist, album.album) : null,
        };
      }),
    longest_streak_days: longestStreakInRange(userId, start, end),
    biggest_day: bDay ?? null,
    biggest_week: bWeek ?? null,
    biggest_month: bMonth ?? null,
    first_scrobble_of_year: highlightWithCover(firstRow),
    last_scrobble_of_year: highlightWithCover(lastRow),
    new_artists_discovered: newArtists,
    new_albums_discovered: newAlbums,
  };
}

export interface Summary {
  plays: number;
  tracks: number;
  albums: number;
  artists: number;
  days_active: number;
  longest_streak_days: number;
  avg_daily_plays: number;
  first_scrobble_at: number | null;
}

const summaryCountsStmt = db.prepare(`
  SELECT
    COUNT(*) as plays,
    COUNT(DISTINCT track || '||' || artist) as tracks,
    COUNT(DISTINCT album || '||' || artist) as albums,
    COUNT(DISTINCT artist) as artists,
    COUNT(DISTINCT date(timestamp, 'unixepoch')) as days_active,
    MIN(timestamp) as first_scrobble_at
  FROM scrobbles
  WHERE user_id = ?
`);

const allActiveDaysStmt = db.prepare(`
  SELECT DISTINCT date(timestamp, 'unixepoch') as d
  FROM scrobbles WHERE user_id = ?
  ORDER BY d ASC
`);

function longestStreak(userId: number): number {
  const rows = allActiveDaysStmt.all(userId) as { d: string }[];
  if (rows.length === 0) return 0;
  let best = 1;
  let cur = 1;
  for (let i = 1; i < rows.length; i++) {
    const prevRow = rows[i - 1]!;
    const nextRow = rows[i]!;
    const prev = new Date(prevRow.d + "T00:00:00Z").getTime();
    const next = new Date(nextRow.d + "T00:00:00Z").getTime();
    const diffDays = Math.round((next - prev) / 86_400_000);
    if (diffDays === 1) {
      cur += 1;
      if (cur > best) best = cur;
    } else {
      cur = 1;
    }
  }
  return best;
}

export interface TimeOfDayCell {
  day_of_week: number; // 0 = Sunday … 6 = Saturday
  hour: number;        // 0–23
  count: number;
}

const timeOfDayStmt = db.prepare(`
  SELECT
    CAST(strftime('%w', timestamp, 'unixepoch', 'localtime') AS INTEGER) AS day_of_week,
    CAST(strftime('%H', timestamp, 'unixepoch', 'localtime') AS INTEGER) AS hour,
    COUNT(*) AS count
  FROM scrobbles
  WHERE user_id = ?
  GROUP BY day_of_week, hour
`);

export function timeOfDay(userId: number): TimeOfDayCell[] {
  return timeOfDayStmt.all(userId) as TimeOfDayCell[];
}

export interface DecadeRow {
  decade: number;
  count: number;
}

// Joins scrobbles to the coverart year cache; unresolved albums (no MB
// release year yet) are excluded so the chart isn't skewed by zeros. As the
// resolver works through the queue, more rows will surface here.
const decadesStmt = db.prepare(`
  SELECT (c.release_year / 10) * 10 AS decade, COUNT(*) AS count
  FROM scrobbles s
  JOIN coverart c ON c.artist = s.artist AND c.album = s.album
  WHERE s.user_id = ? AND c.release_year IS NOT NULL AND c.release_year > 1900
  GROUP BY decade
  ORDER BY decade ASC
`);

const decadesResolutionStmt = db.prepare(`
  SELECT
    COUNT(DISTINCT s.album || '||' || s.artist) AS total,
    COUNT(DISTINCT CASE WHEN c.release_year > 1900 THEN s.album || '||' || s.artist END) AS resolved
  FROM scrobbles s
  LEFT JOIN coverart c ON c.artist = s.artist AND c.album = s.album
  WHERE s.user_id = ? AND s.album IS NOT NULL AND s.album != ''
`);

export interface DecadeResponse {
  decades: DecadeRow[];
  // Coverage info so the UI can flag "still resolving" when most albums
  // don't have a year yet.
  albums_resolved: number;
  albums_total: number;
}

export function decades(userId: number): DecadeResponse {
  const rows = decadesStmt.all(userId) as DecadeRow[];
  const cov = decadesResolutionStmt.get(userId) as { total: number; resolved: number };
  return {
    decades: rows,
    albums_total: cov.total,
    albums_resolved: cov.resolved,
  };
}

export function summary(userId: number): Summary {
  const counts = summaryCountsStmt.get(userId) as {
    plays: number;
    tracks: number;
    albums: number;
    artists: number;
    days_active: number;
    first_scrobble_at: number | null;
  };
  const streak = longestStreak(userId);
  const avgDaily = counts.days_active > 0 ? counts.plays / counts.days_active : 0;
  return {
    plays: counts.plays,
    tracks: counts.tracks,
    albums: counts.albums,
    artists: counts.artists,
    days_active: counts.days_active,
    longest_streak_days: streak,
    avg_daily_plays: Math.round(avgDaily * 10) / 10,
    first_scrobble_at: counts.first_scrobble_at,
  };
}
