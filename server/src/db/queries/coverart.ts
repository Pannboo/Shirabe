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

// === Diagnostics + admin actions ===========================================
//
// Mirror of the artist_images query layer so the unified "Media cache"
// settings panel can act on coverart with the same shape of operations.

const statsByStatus = db.prepare(`
  SELECT status, COUNT(*) as count FROM coverart GROUP BY status
`);
const resetAllMissing = db.prepare(`
  UPDATE coverart SET status = 'pending', updated_at = 0 WHERE status = 'missing'
`);
const truncateAll = db.prepare(`DELETE FROM coverart`);

// Re-seed from every distinct (artist, album) pair the user has scrobbled.
// updated_at=0 so the stale-pending window check fires immediately.
const reseedFromScrobblesStmt = db.prepare(`
  INSERT INTO coverart (artist, album, status, updated_at)
  SELECT DISTINCT artist, album, 'pending', 0
  FROM scrobbles
  WHERE user_id = ? AND album IS NOT NULL AND album != ''
  ON CONFLICT(artist, album) DO UPDATE SET status = 'pending', updated_at = 0
`);

export interface CoverartStats {
  status: Record<string, number>;
}

export function coverartStats(): CoverartStats {
  const rows = statsByStatus.all() as { status: string; count: number }[];
  const status: Record<string, number> = {};
  for (const r of rows) status[r.status] = r.count;
  return { status };
}

export function requeueAllMissingCoverart(): number {
  return resetAllMissing.run().changes;
}

// Wipes the cache and re-seeds from scrobbles in a single transaction.
// Returns counts so the UI can confirm what just happened.
export function reseedCoverart(userId: number): { wiped: number; queued: number } {
  let wiped = 0;
  let queued = 0;
  db.transaction(() => {
    wiped = truncateAll.run().changes;
    queued = reseedFromScrobblesStmt.run(userId).changes;
  })();
  return { wiped, queued };
}

// === Local image cache lookups (services/imageCache.ts) ====================

export interface CoverartRow {
  artist: string;
  album: string;
  url: string | null;
  local_path: string | null;
  content_type: string | null;
}

// Hash-based lookup. The /api/image/album/:hash route gets a 16-hex
// content hash; we scan resolved rows and find the match by recomputing
// the hash here. SQLite has no native sha1 and resolved-row count is
// small (~hundreds), so a per-request scan is fine.
const allResolvedCoverart = db.prepare(`
  SELECT artist, album, url, local_path, content_type
  FROM coverart WHERE url IS NOT NULL
`);

export function listAllCoverartWithUrl(): CoverartRow[] {
  return allResolvedCoverart.all() as CoverartRow[];
}

const setCoverartLocalPath = db.prepare(`
  UPDATE coverart SET local_path = ?, content_type = ?, updated_at = unixepoch()
  WHERE artist = ? AND album = ?
`);

export function setCoverartLocal(
  artist: string,
  album: string,
  localPath: string,
  contentType: string,
): void {
  setCoverartLocalPath.run(localPath, contentType, artist, album);
}

// Eager-warm worklist: resolved rows that don't yet have a local file.
const resolvedWithoutLocalStmt = db.prepare(`
  SELECT artist, album, url, local_path, content_type
  FROM coverart
  WHERE status = 'resolved' AND url IS NOT NULL AND local_path IS NULL
  LIMIT ?
`);

export function listResolvedCoverartWithoutLocal(limit: number): CoverartRow[] {
  return resolvedWithoutLocalStmt.all(limit) as CoverartRow[];
}
