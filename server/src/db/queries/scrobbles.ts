import { db } from "../client.js";
import type { Scrobble } from "../../types/domain.js";

const insert = db.prepare(`
  INSERT INTO scrobbles (user_id, track, artist, album, timestamp, source_client)
  VALUES (?, ?, ?, ?, ?, ?)
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

export function insertScrobble(
  userId: number,
  track: string,
  artist: string,
  album: string | null,
  timestamp: number,
  sourceClient: string | null,
): Scrobble {
  const result = insert.run(userId, track, artist, album, timestamp, sourceClient);
  return byId.get(result.lastInsertRowid) as Scrobble;
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
