import { db } from "../client.js";

const getByKey = db.prepare(`
  SELECT url FROM coverart WHERE artist = ? AND album = ? AND status = 'resolved'
`);
const upsert = db.prepare(`
  INSERT INTO coverart (artist, album, mb_release_id, url, status, release_year, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, unixepoch())
  ON CONFLICT(artist, album) DO UPDATE SET
    mb_release_id = excluded.mb_release_id,
    url = excluded.url,
    status = excluded.status,
    release_year = COALESCE(excluded.release_year, coverart.release_year),
    updated_at = unixepoch()
`);
const stalePending = db.prepare(`
  SELECT artist, album FROM coverart
  WHERE status = 'pending' AND updated_at < unixepoch() - 60
  LIMIT ?
`);
const enqueue = db.prepare(`
  INSERT INTO coverart (artist, album, status) VALUES (?, ?, 'pending')
  ON CONFLICT(artist, album) DO NOTHING
`);

export function getCachedCoverArt(artist: string, album: string): string | null {
  const row = getByKey.get(artist, album) as { url: string | null } | undefined;
  return row?.url ?? null;
}

export function enqueueCoverArt(artist: string, album: string): void {
  enqueue.run(artist, album);
}

export function setCoverArt(
  artist: string,
  album: string,
  url: string | null,
  mbReleaseId: string | null,
  status: "resolved" | "missing" = url ? "resolved" : "missing",
  releaseYear: number | null = null,
): void {
  upsert.run(artist, album, mbReleaseId, url, status, releaseYear);
}

export function listPendingCoverArt(limit: number): { artist: string; album: string }[] {
  return stalePending.all(limit) as { artist: string; album: string }[];
}

// Existing rows resolved before release_year was added have no year. This
// listing drives a separate backfill job that updates year only, without
// touching the cover URL.
const missingYearStmt = db.prepare(`
  SELECT artist, album FROM coverart
  WHERE release_year IS NULL AND status = 'resolved'
  LIMIT ?
`);

const setYearStmt = db.prepare(`
  UPDATE coverart SET release_year = ?, mb_release_id = COALESCE(?, mb_release_id)
  WHERE artist = ? AND album = ?
`);

// Sentinel so we don't retry albums whose MB lookup yielded no year. -1 is
// filtered out of the decade aggregation by the > 1900 guard.
const markYearAttemptedStmt = db.prepare(`
  UPDATE coverart SET release_year = -1 WHERE artist = ? AND album = ?
`);

export function listCoverartMissingYear(limit: number): { artist: string; album: string }[] {
  return missingYearStmt.all(limit) as { artist: string; album: string }[];
}

export function setCoverartYear(artist: string, album: string, year: number, mbReleaseId: string | null): void {
  setYearStmt.run(year, mbReleaseId, artist, album);
}

export function markCoverartYearMissing(artist: string, album: string): void {
  markYearAttemptedStmt.run(artist, album);
}
