import { db } from "../db/client.js";
import { getOrEnqueueCoverArt } from "../jobs/resolveCoverArt.js";
import { getReleaseTracks } from "../integrations/musicbrainz.js";

// Aggregates for a single (artist, album) pair. Mirrors the artistDetail
// service shape — same rank pattern, same hero-stat lockup, plus a real
// tracklist that prefers MusicBrainz (with track durations and positions)
// and falls back to scrobble-derived order when the album has no MBID.

const totalsStmt = db.prepare(`
  SELECT
    COUNT(*) AS total_plays,
    COUNT(DISTINCT track) AS unique_tracks,
    MIN(timestamp) AS first_listen_at,
    MAX(timestamp) AS last_listen_at
  FROM scrobbles
  WHERE user_id = ? AND artist = ? AND album = ?
`);

const monthlyStmt = db.prepare(`
  SELECT strftime('%Y-%m', timestamp, 'unixepoch') AS month, COUNT(*) AS count
  FROM scrobbles WHERE user_id = ? AND artist = ? AND album = ?
  GROUP BY month ORDER BY month ASC
`);

const recentStmt = db.prepare(`
  SELECT track, artist, album, timestamp FROM scrobbles
  WHERE user_id = ? AND artist = ? AND album = ?
  ORDER BY timestamp DESC LIMIT 20
`);

const tracksByPlayStmt = db.prepare(`
  SELECT track AS name, COUNT(*) AS play_count FROM scrobbles
  WHERE user_id = ? AND artist = ? AND album = ?
  GROUP BY track ORDER BY play_count DESC
`);

// Rank among the user's albums by play count. Joins make this slightly
// chunkier than the artist rank query but it's a single pass.
const rankStmt = db.prepare(`
  WITH ranked AS (
    SELECT album, artist, RANK() OVER (ORDER BY COUNT(*) DESC) AS rk
    FROM scrobbles
    WHERE user_id = ? AND album IS NOT NULL AND album != ''
    GROUP BY album, artist
  )
  SELECT rk FROM ranked WHERE album = ? AND artist = ?
`);

const coverartLookupStmt = db.prepare(`
  SELECT mb_release_id, release_year FROM coverart WHERE artist = ? AND album = ?
`);

// Per-track play counts indexed by track name (case-sensitive — matches how
// scrobbles are inserted). Used to enrich the MB tracklist with our local
// numbers.
function playCountsByTrack(userId: number, artist: string, album: string): Map<string, number> {
  const rows = tracksByPlayStmt.all(userId, artist, album) as { name: string; play_count: number }[];
  return new Map(rows.map((r) => [r.name, r.play_count]));
}

export interface AlbumTrack {
  position: number;
  title: string;
  play_count: number;
  duration_seconds: number | null;
}

export interface AlbumDetail {
  artist: string;
  album: string;
  total_plays: number;
  unique_tracks: number;
  rank: number | null;
  first_listen_at: number | null;
  last_listen_at: number | null;
  cover_art_url: string | null;
  release_year: number | null;
  mb_release_id: string | null;
  monthly: { month: string; count: number }[];
  tracks: AlbumTrack[];
  recent: { track: string; artist: string; album: string | null; timestamp: number; cover_art_url: string | null }[];
}

export async function albumDetail(userId: number, artist: string, album: string): Promise<AlbumDetail> {
  const totals = totalsStmt.get(userId, artist, album) as {
    total_plays: number;
    unique_tracks: number;
    first_listen_at: number | null;
    last_listen_at: number | null;
  };

  const rankRow = rankStmt.get(userId, album, artist) as { rk: number } | undefined;
  const cover = coverartLookupStmt.get(artist, album) as
    | { mb_release_id: string | null; release_year: number | null }
    | undefined;
  const coverUrl = getOrEnqueueCoverArt(artist, album);

  // Tracklist resolution. Prefer MB when we have a release id — gives us
  // canonical track order and durations. Otherwise derive from scrobbles
  // ordered by play count.
  const counts = playCountsByTrack(userId, artist, album);
  let tracks: AlbumTrack[] = [];
  if (cover?.mb_release_id) {
    try {
      const mbTracks = await getReleaseTracks(cover.mb_release_id);
      if (mbTracks.length > 0) {
        tracks = mbTracks.map((t) => ({
          position: t.position,
          title: t.title,
          play_count: counts.get(t.title) ?? 0,
          duration_seconds: t.duration_seconds,
        }));
      }
    } catch {
      /* fall through to scrobble-derived */
    }
  }
  if (tracks.length === 0) {
    tracks = (Array.from(counts.entries())).map(([name, play_count], i) => ({
      position: i + 1,
      title: name,
      play_count,
      duration_seconds: null,
    }));
  }

  const monthly = monthlyStmt.all(userId, artist, album) as { month: string; count: number }[];
  const recent = (recentStmt.all(userId, artist, album) as {
    track: string;
    artist: string;
    album: string | null;
    timestamp: number;
  }[]).map((s) => ({ ...s, cover_art_url: s.album ? getOrEnqueueCoverArt(s.artist, s.album) : coverUrl }));

  return {
    artist,
    album,
    total_plays: totals.total_plays,
    unique_tracks: totals.unique_tracks,
    rank: rankRow?.rk ?? null,
    first_listen_at: totals.first_listen_at,
    last_listen_at: totals.last_listen_at,
    cover_art_url: coverUrl,
    release_year: cover?.release_year ?? null,
    mb_release_id: cover?.mb_release_id ?? null,
    monthly,
    tracks,
    recent,
  };
}
