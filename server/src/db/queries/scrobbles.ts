import { db } from "../client.js";
import type { Scrobble } from "../../types/domain.js";

// INSERT OR IGNORE so a Navidrome retry (or any other client re-POSTing the
// same listen after a flap) is a no-op instead of throwing a UNIQUE-constraint
// error against uniq_scrobble and crashing the process.
const insert = db.prepare(`
  INSERT OR IGNORE INTO scrobbles (user_id, track, artist, album, timestamp, source_client)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const byUniq = db.prepare(`
  SELECT * FROM scrobbles
  WHERE user_id = ? AND artist = ? AND track = ? AND timestamp = ?
`);

// Used by the history-import flow. INSERT OR IGNORE so re-runs (or
// importing the same scrobble from both Last.fm and LB) are idempotent
// against the uniq_scrobble index. relayed_lastfm / relayed_listenbrainz
// are set up-front because the imported row already exists on that
// service — we don't want the relay job to round-trip it back.
const insertHistorical = db.prepare(`
  INSERT OR IGNORE INTO scrobbles
    (user_id, track, artist, album, timestamp, source_client,
     relayed_lastfm, relayed_listenbrainz)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const markRelay = {
  lastfm: db.prepare(`UPDATE scrobbles SET relayed_lastfm = 1 WHERE id = ?`),
  listenbrainz: db.prepare(`UPDATE scrobbles SET relayed_listenbrainz = 1 WHERE id = ?`),
};

const unrelayed = db.prepare(`
  SELECT * FROM scrobbles
  WHERE (relayed_lastfm = 0 OR relayed_listenbrainz = 0)
    AND timestamp > unixepoch() - 7 * 86400
  ORDER BY timestamp DESC
`);

const recentByUser = db.prepare(`
  SELECT * FROM scrobbles WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?
`);

const latestByUser = db.prepare(`
  SELECT * FROM scrobbles WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1
`);

const byId = db.prepare(`SELECT * FROM scrobbles WHERE id = ?`);

export interface InsertScrobbleResult {
  scrobble: Scrobble;
  inserted: boolean;
}

export function insertScrobble(
  userId: number,
  track: string,
  artist: string,
  album: string | null,
  timestamp: number,
  sourceClient: string | null,
): InsertScrobbleResult {
  const result = insert.run(userId, track, artist, album, timestamp, sourceClient);
  if (result.changes > 0) {
    return { scrobble: byId.get(result.lastInsertRowid) as Scrobble, inserted: true };
  }
  // Duplicate against uniq_scrobble — return the existing row so callers can
  // still decide what to do (we skip relay dispatch for dupes).
  return { scrobble: byUniq.get(userId, artist, track, timestamp) as Scrobble, inserted: false };
}

export function markRelayed(id: number, target: "lastfm" | "listenbrainz"): void {
  markRelay[target].run(id);
}

export function getUnrelayedScrobbles(): Scrobble[] {
  return unrelayed.all() as Scrobble[];
}

export function getRecentByUser(userId: number, limit: number): Scrobble[] {
  return recentByUser.all(userId, limit) as Scrobble[];
}

export function getLatestByUser(userId: number): Scrobble | undefined {
  return latestByUser.get(userId) as Scrobble | undefined;
}

export interface HistoricalRow {
  track: string;
  artist: string;
  album: string | null;
  timestamp: number;
  source_client: string;
  relayed_lastfm: boolean;
  relayed_listenbrainz: boolean;
}

// Bulk insert wrapped in a single transaction — better-sqlite3 is fastest
// when many statements share one transaction (~10x). Returns the number
// of rows actually inserted (the rest were dupes already in the table).
export function insertHistoricalBatch(userId: number, rows: HistoricalRow[]): number {
  const tx = db.transaction((batch: HistoricalRow[]) => {
    let inserted = 0;
    for (const r of batch) {
      const result = insertHistorical.run(
        userId,
        r.track,
        r.artist,
        r.album,
        r.timestamp,
        r.source_client,
        r.relayed_lastfm ? 1 : 0,
        r.relayed_listenbrainz ? 1 : 0,
      );
      if (result.changes > 0) inserted += 1;
    }
    return inserted;
  });
  return tx(rows);
}
