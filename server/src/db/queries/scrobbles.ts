import { db } from "../client.js";
import type { Scrobble } from "../../types/domain.js";

const insert = db.prepare(`
  INSERT INTO scrobbles (user_id, track, artist, album, timestamp, source_client)
  VALUES (?, ?, ?, ?, ?, ?)
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
