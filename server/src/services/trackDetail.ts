import { db } from "../db/client.js";
import { getOrEnqueueCoverArt } from "../jobs/resolveCoverArt.js";

// Per-track aggregates. Tracks can appear on multiple albums (compilations,
// reissues, singles + albums), so we surface every album it's shown up on
// along with the per-album play count.

const totalsStmt = db.prepare(`
  SELECT
    COUNT(*) AS total_plays,
    MIN(timestamp) AS first_listen_at,
    MAX(timestamp) AS last_listen_at
  FROM scrobbles
  WHERE user_id = ? AND artist = ? AND track = ?
`);

const monthlyStmt = db.prepare(`
  SELECT strftime('%Y-%m', timestamp, 'unixepoch') AS month, COUNT(*) AS count
  FROM scrobbles WHERE user_id = ? AND artist = ? AND track = ?
  GROUP BY month ORDER BY month ASC
`);

const recentStmt = db.prepare(`
  SELECT timestamp, album FROM scrobbles
  WHERE user_id = ? AND artist = ? AND track = ?
  ORDER BY timestamp DESC LIMIT 50
`);

const albumsAppearedOnStmt = db.prepare(`
  SELECT album AS name, COUNT(*) AS play_count
  FROM scrobbles WHERE user_id = ? AND artist = ? AND track = ?
    AND album IS NOT NULL AND album != ''
  GROUP BY album ORDER BY play_count DESC
`);

const rankStmt = db.prepare(`
  WITH ranked AS (
    SELECT track, artist, RANK() OVER (ORDER BY COUNT(*) DESC) AS rk
    FROM scrobbles WHERE user_id = ? GROUP BY track, artist
  )
  SELECT rk FROM ranked WHERE track = ? AND artist = ?
`);

// "Primary" album = the album the user has scrobbled this track on most
// often. Used to pick a cover for the hero and to link to a single album
// page from the track header.
const primaryAlbumStmt = db.prepare(`
  SELECT album FROM scrobbles
  WHERE user_id = ? AND artist = ? AND track = ?
    AND album IS NOT NULL AND album != ''
  GROUP BY album ORDER BY COUNT(*) DESC LIMIT 1
`);

export interface TrackAlbumAppearance {
  name: string;
  play_count: number;
  cover_art_url: string | null;
}

export interface TrackDetail {
  artist: string;
  track: string;
  primary_album: string | null;
  total_plays: number;
  rank: number | null;
  first_listen_at: number | null;
  last_listen_at: number | null;
  cover_art_url: string | null;
  monthly: { month: string; count: number }[];
  recent_plays: { timestamp: number; album: string | null }[];
  albums_appeared_on: TrackAlbumAppearance[];
}

export function trackDetail(userId: number, artist: string, track: string): TrackDetail {
  const totals = totalsStmt.get(userId, artist, track) as {
    total_plays: number;
    first_listen_at: number | null;
    last_listen_at: number | null;
  };
  const rankRow = rankStmt.get(userId, track, artist) as { rk: number } | undefined;
  const primaryRow = primaryAlbumStmt.get(userId, artist, track) as { album: string } | undefined;
  const primaryAlbum = primaryRow?.album ?? null;
  const coverUrl = primaryAlbum ? getOrEnqueueCoverArt(artist, primaryAlbum) : null;

  const monthly = monthlyStmt.all(userId, artist, track) as { month: string; count: number }[];
  const recent = recentStmt.all(userId, artist, track) as { timestamp: number; album: string | null }[];
  const albumsAppearedOn = (albumsAppearedOnStmt.all(userId, artist, track) as {
    name: string;
    play_count: number;
  }[]).map((a) => ({
    ...a,
    cover_art_url: getOrEnqueueCoverArt(artist, a.name),
  }));

  return {
    artist,
    track,
    primary_album: primaryAlbum,
    total_plays: totals.total_plays,
    rank: rankRow?.rk ?? null,
    first_listen_at: totals.first_listen_at,
    last_listen_at: totals.last_listen_at,
    cover_art_url: coverUrl,
    monthly,
    recent_plays: recent,
    albums_appeared_on: albumsAppearedOn,
  };
}
