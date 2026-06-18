import { db } from "../db/client.js";
import { getOrEnqueueCoverArt } from "../jobs/resolveCoverArt.js";

// Light personality features — "on this day in previous years",
// per-artist day streaks, and "first played" lookups. None of these are
// expensive: they all hit `scrobbles` with cheap aggregates, no joins
// beyond the optional coverart lookup.

// Plays on this calendar date (month + day) from past years. Returns
// distinct (year, artist, track) so we collapse same-track-played-twice
// rows. Limited to the 12 most recent past years so the response stays
// tight even for long-time scrobblers.
const onThisDayStmt = db.prepare(`
  WITH today AS (
    SELECT
      CAST(strftime('%m', 'now', 'localtime') AS INTEGER) AS mm,
      CAST(strftime('%d', 'now', 'localtime') AS INTEGER) AS dd
  )
  SELECT
    CAST(strftime('%Y', timestamp, 'unixepoch', 'localtime') AS INTEGER) AS year,
    artist,
    track,
    album,
    COUNT(*) AS plays
  FROM scrobbles, today
  WHERE user_id = ?
    AND CAST(strftime('%m', timestamp, 'unixepoch', 'localtime') AS INTEGER) = today.mm
    AND CAST(strftime('%d', timestamp, 'unixepoch', 'localtime') AS INTEGER) = today.dd
    AND CAST(strftime('%Y', timestamp, 'unixepoch', 'localtime') AS INTEGER) < CAST(strftime('%Y', 'now', 'localtime') AS INTEGER)
  GROUP BY year, artist, track
  ORDER BY year DESC, plays DESC
  LIMIT 12
`);

const firstPlayedArtistStmt = db.prepare(`
  SELECT MIN(timestamp) AS first_at FROM scrobbles WHERE user_id = ? AND artist = ?
`);
const firstPlayedAlbumStmt = db.prepare(`
  SELECT MIN(timestamp) AS first_at FROM scrobbles WHERE user_id = ? AND artist = ? AND album = ?
`);
const firstPlayedTrackStmt = db.prepare(`
  SELECT MIN(timestamp) AS first_at FROM scrobbles WHERE user_id = ? AND artist = ? AND track = ?
`);

// Longest consecutive-days streak for a single artist. Mirrors the
// stats.ts longest-streak helper but scoped to one artist.
const artistDaysStmt = db.prepare(`
  SELECT DISTINCT date(timestamp, 'unixepoch') AS d
  FROM scrobbles WHERE user_id = ? AND artist = ?
  ORDER BY d ASC
`);

export interface OnThisDayItem {
  year: number;
  artist: string;
  track: string;
  album: string | null;
  plays: number;
  cover_art_url: string | null;
}

export function onThisDay(userId: number): OnThisDayItem[] {
  const rows = onThisDayStmt.all(userId) as {
    year: number;
    artist: string;
    track: string;
    album: string | null;
    plays: number;
  }[];
  return rows.map((r) => ({
    ...r,
    cover_art_url: r.album ? getOrEnqueueCoverArt(r.artist, r.album) : null,
  }));
}

export function firstPlayedAt(
  userId: number,
  kind: "artist" | "album" | "track",
  artist: string,
  secondary?: string,
): number | null {
  if (kind === "artist") {
    const r = firstPlayedArtistStmt.get(userId, artist) as { first_at: number | null } | undefined;
    return r?.first_at ?? null;
  }
  if (!secondary) return null;
  const stmt = kind === "album" ? firstPlayedAlbumStmt : firstPlayedTrackStmt;
  const r = stmt.get(userId, artist, secondary) as { first_at: number | null } | undefined;
  return r?.first_at ?? null;
}

export function longestStreakDaysForArtist(userId: number, artist: string): number {
  const rows = artistDaysStmt.all(userId, artist) as { d: string }[];
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
