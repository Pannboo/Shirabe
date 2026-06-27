// In-flight "currently playing" state. Driven by ListenBrainz `playing_now`
// heartbeats from the scrobble intake, enriched by Navidrome's Subsonic
// getNowPlaying for album-id (used to proxy higher-quality cover art).
//
// Persisted in SQLite so server restarts (including tsx-watch hot reloads
// in dev) don't drop the live song. Without persistence, the now-playing
// endpoint falls back to the most recent scrobble — i.e. the *previous*
// song — during the gap between heartbeats.

import { db } from "../db/client.js";
import { getSubsonicNowPlaying } from "../integrations/navidrome.js";

export interface NowPlayingState {
  artist: string;
  track: string;
  album: string | null;
  timestamp: number;
  started_at: number;
  album_id: string | null;
  enriched_at: number | null;
  duration: number | null;
}

interface Row {
  user_id: number;
  artist: string;
  track: string;
  album: string | null;
  timestamp: number;
  started_at: number;
  album_id: string | null;
  enriched_at: number | null;
  duration: number | null;
}

const getStmt = db.prepare(`SELECT * FROM now_playing WHERE user_id = ?`);
const upsertStmt = db.prepare(`
  INSERT INTO now_playing
    (user_id, artist, track, album, timestamp, started_at, album_id, enriched_at, duration)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    artist = excluded.artist,
    track = excluded.track,
    album = excluded.album,
    timestamp = excluded.timestamp,
    started_at = excluded.started_at,
    album_id = excluded.album_id,
    enriched_at = excluded.enriched_at,
    duration = excluded.duration
`);
const deleteStmt = db.prepare(`DELETE FROM now_playing WHERE user_id = ?`);

function readRow(userId: number): NowPlayingState | null {
  const row = getStmt.get(userId) as Row | undefined;
  if (!row) return null;
  return {
    artist: row.artist,
    track: row.track,
    album: row.album,
    timestamp: row.timestamp,
    started_at: row.started_at,
    album_id: row.album_id,
    enriched_at: row.enriched_at,
    duration: row.duration,
  };
}

function writeRow(userId: number, s: NowPlayingState): void {
  upsertStmt.run(
    userId,
    s.artist,
    s.track,
    s.album,
    s.timestamp,
    s.started_at,
    s.album_id,
    s.enriched_at,
    s.duration,
  );
}

export function setNowPlaying(
  userId: number,
  data: Pick<NowPlayingState, "artist" | "track" | "album">,
): void {
  const existing = readRow(userId);
  const sameTrack =
    !!existing &&
    existing.artist === data.artist &&
    existing.track === data.track &&
    existing.album === data.album;
  const now = Math.floor(Date.now() / 1000);
  writeRow(userId, {
    ...data,
    timestamp: now,
    started_at: sameTrack ? existing.started_at : now,
    album_id: sameTrack ? existing.album_id : null,
    enriched_at: sameTrack ? existing.enriched_at : null,
    duration: sameTrack ? existing.duration : null,
  });
}

export function getNowPlaying(
  userId: number,
  windowSeconds: number,
): NowPlayingState | null {
  const cur = readRow(userId);
  if (!cur) return null;
  const now = Math.floor(Date.now() / 1000);
  // Heartbeat-based expiry: drop if no `playing_now` in windowSeconds.
  // Duration-based extension: when we know the track length, keep the
  // row alive at least until started_at + duration + grace, since many
  // players only send one playing_now at track start. Without this, a
  // 100-minute song silently ages out after windowSeconds.
  const heartbeatExpiry = cur.timestamp + windowSeconds;
  const durationExpiry = cur.duration ? cur.started_at + cur.duration + windowSeconds : 0;
  if (now > Math.max(heartbeatExpiry, durationExpiry)) {
    deleteStmt.run(userId);
    return null;
  }
  return cur;
}

// Best-effort enrichment from Navidrome's Subsonic API. Matches by artist+title
// (case-insensitive) against active sessions. Updates the row in place. Returns
// the (possibly enriched) state for the user, or null.
export async function enrichWithSubsonic(
  userId: number,
  username: string,
): Promise<NowPlayingState | null> {
  const cur = readRow(userId);
  if (!cur) return null;

  // Skip if already enriched in the last 3 seconds.
  const now = Math.floor(Date.now() / 1000);
  if (cur.enriched_at && now - cur.enriched_at < 3) return cur;

  const sessions = await getSubsonicNowPlaying();
  const match = sessions.find(
    (s) =>
      (s.username ?? "").toLowerCase() === username.toLowerCase() &&
      (s.artist ?? "").toLowerCase() === cur.artist.toLowerCase() &&
      (s.title ?? "").toLowerCase() === cur.track.toLowerCase(),
  );

  if (!match) {
    const next = { ...cur, enriched_at: now };
    writeRow(userId, next);
    return next;
  }

  const next: NowPlayingState = {
    ...cur,
    album_id: match.albumId ?? cur.album_id,
    enriched_at: now,
    duration: match.duration ?? cur.duration,
  };
  writeRow(userId, next);
  return next;
}
