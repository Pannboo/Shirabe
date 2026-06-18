import { db } from "../db/client.js";
import { getOrEnqueueCoverArt } from "../jobs/resolveCoverArt.js";
import { getOrEnqueueArtistImage } from "../jobs/resolveArtistImage.js";
import { getOrEnqueueArtistLinks } from "../jobs/resolveArtistLinks.js";
import type { ArtistLink } from "../db/queries/artistLinks.js";

const totalsStmt = db.prepare(`
  SELECT
    COUNT(*) as total_scrobbles,
    COUNT(DISTINCT album) as unique_albums,
    COUNT(DISTINCT track) as unique_tracks,
    MIN(timestamp) as first_listen_at
  FROM scrobbles WHERE user_id = ? AND artist = ?
`);

const monthlyStmt = db.prepare(`
  SELECT strftime('%Y-%m', timestamp, 'unixepoch') as month, COUNT(*) as count
  FROM scrobbles WHERE user_id = ? AND artist = ?
  GROUP BY month ORDER BY month ASC
`);

const topAlbumsStmt = db.prepare(`
  SELECT album as name, COUNT(*) as play_count FROM scrobbles
  WHERE user_id = ? AND artist = ? AND album IS NOT NULL AND album != ''
  GROUP BY album ORDER BY play_count DESC LIMIT 20
`);

const topTracksStmt = db.prepare(`
  SELECT track as name, COUNT(*) as play_count FROM scrobbles
  WHERE user_id = ? AND artist = ?
  GROUP BY track ORDER BY play_count DESC LIMIT 20
`);

const recentStmt = db.prepare(`
  SELECT track, artist, album, timestamp FROM scrobbles
  WHERE user_id = ? AND artist = ?
  ORDER BY timestamp DESC LIMIT 20
`);

// Artist's rank among the user's full artist list, by play count. Returns
// null when the user has no scrobbles for them (shouldn't happen in practice
// because the artist page wouldn't load).
const rankStmt = db.prepare(`
  WITH ranked AS (
    SELECT artist, RANK() OVER (ORDER BY COUNT(*) DESC) AS rk
    FROM scrobbles WHERE user_id = ? GROUP BY artist
  )
  SELECT rk FROM ranked WHERE artist = ?
`);

// Cached MB artist id from the artist-image resolver. We piggyback on that
// resolver's MB lookup rather than running our own — both want the MBID.
const mbidStmt = db.prepare(`
  SELECT mb_artist_id FROM artist_images WHERE artist = ?
`);

// Rough proxy for total listening time. We don't store per-track duration
// (would need a separate enrichment pass), so we estimate at 3.5 min per
// scrobble — the median pop track length. Will be displayed as "843 minutes"
// not "14 hours 3 minutes" so a slight inaccuracy is fine.
const MEAN_TRACK_SECONDS = 210;

export interface ArtistDetail {
  artist: string;
  total_scrobbles: number;
  unique_albums: number;
  unique_tracks: number;
  monthly: { month: string; count: number }[];
  top_albums: { name: string; play_count: number; cover_art_url: string | null }[];
  top_tracks: { name: string; play_count: number }[];
  recent: { track: string; artist: string; album: string | null; timestamp: number; cover_art_url: string | null }[];
  // Hero additions for the Koito-style redesign.
  rank: number | null;
  minutes_listened: number;
  first_listen_at: number | null;
  cover_art_url: string | null;     // artist photo or album-cover fallback
  mb_artist_id: string | null;
  links: ArtistLink[];
}

export function artistDetail(userId: number, artist: string): ArtistDetail {
  const totals = totalsStmt.get(userId, artist) as {
    total_scrobbles: number;
    unique_albums: number;
    unique_tracks: number;
    first_listen_at: number | null;
  };
  const monthly = monthlyStmt.all(userId, artist) as { month: string; count: number }[];
  const topAlbums = topAlbumsStmt.all(userId, artist) as { name: string; play_count: number }[];
  const topTracks = topTracksStmt.all(userId, artist) as { name: string; play_count: number }[];
  const recent = recentStmt.all(userId, artist) as {
    track: string;
    artist: string;
    album: string | null;
    timestamp: number;
  }[];

  const rankRow = rankStmt.get(userId, artist) as { rk: number } | undefined;
  const mbidRow = mbidStmt.get(artist) as { mb_artist_id: string | null } | undefined;
  const mbArtistId = mbidRow?.mb_artist_id ?? null;

  // Hero photo — prefer a real artist photo (resolved via the Deezer →
  // ListenBrainz → Last.fm chain into artist_images) and fall back to the
  // top-played album cover while the resolver hasn't filled it in yet.
  // Mirrors the same priority used in services/stats.ts:artistCover().
  const artistPhoto = getOrEnqueueArtistImage(artist);
  const topAlbumName = topAlbums[0]?.name ?? null;
  const coverArtUrl = artistPhoto
    ?? (topAlbumName ? getOrEnqueueCoverArt(artist, topAlbumName) : null);

  return {
    artist,
    total_scrobbles: totals.total_scrobbles,
    unique_albums: totals.unique_albums,
    unique_tracks: totals.unique_tracks,
    monthly,
    top_albums: topAlbums.map((a) => ({
      ...a,
      cover_art_url: getOrEnqueueCoverArt(artist, a.name),
    })),
    top_tracks: topTracks,
    recent: recent.map((s) => ({
      ...s,
      cover_art_url: getOrEnqueueCoverArt(s.artist, s.album),
    })),
    rank: rankRow?.rk ?? null,
    minutes_listened: Math.round((totals.total_scrobbles * MEAN_TRACK_SECONDS) / 60),
    first_listen_at: totals.first_listen_at,
    cover_art_url: coverArtUrl,
    mb_artist_id: mbArtistId,
    links: getOrEnqueueArtistLinks(mbArtistId) ?? [],
  };
}
