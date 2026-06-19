import { db } from "../client.js";

const getByArtist = db.prepare(`
  SELECT url FROM artist_images WHERE artist = ? AND status = 'resolved'
`);
const upsert = db.prepare(`
  INSERT INTO artist_images (artist, mb_artist_id, url, status, updated_at)
  VALUES (?, ?, ?, ?, unixepoch())
  ON CONFLICT(artist) DO UPDATE SET
    mb_artist_id = excluded.mb_artist_id,
    url = excluded.url,
    status = excluded.status,
    updated_at = unixepoch()
`);
const enqueue = db.prepare(`
  INSERT INTO artist_images (artist, status) VALUES (?, 'pending')
  ON CONFLICT(artist) DO NOTHING
`);
const stalePending = db.prepare(`
  SELECT artist FROM artist_images
  WHERE status = 'pending' AND updated_at < unixepoch() - 60
  LIMIT ?
`);

export function getCachedArtistImage(artist: string): string | null {
  const row = getByArtist.get(artist) as { url: string | null } | undefined;
  return row?.url ?? null;
}

export function enqueueArtistImage(artist: string): void {
  enqueue.run(artist);
}

export function setArtistImage(
  artist: string,
  url: string | null,
  mbArtistId: string | null,
  status: "resolved" | "missing" = url ? "resolved" : "missing",
): void {
  upsert.run(artist, mbArtistId, url, status);
}

export function listPendingArtistImages(limit: number): { artist: string }[] {
  return stalePending.all(limit) as { artist: string }[];
}

// Diagnostics: counts by status + the most recent 'missing' rows so the
// admin can see which artists the resolver gave up on.
const statsByStatus = db.prepare(`
  SELECT status, COUNT(*) as count FROM artist_images GROUP BY status
`);
const recentMissing = db.prepare(`
  SELECT artist, updated_at FROM artist_images
  WHERE status = 'missing' ORDER BY updated_at DESC LIMIT ?
`);
const resetAllMissing = db.prepare(`
  UPDATE artist_images SET status = 'pending', updated_at = 0 WHERE status = 'missing'
`);
const truncateAll = db.prepare(`DELETE FROM artist_images`);
const enqueueWithBackdate = db.prepare(`
  INSERT INTO artist_images (artist, status, updated_at) VALUES (?, 'pending', 0)
  ON CONFLICT(artist) DO UPDATE SET status = 'pending', updated_at = 0
`);

export interface ArtistImageStats {
  status: Record<string, number>;
  recent_missing: { artist: string; updated_at: number }[];
}

export function artistImageStats(): ArtistImageStats {
  const rows = statsByStatus.all() as { status: string; count: number }[];
  const status: Record<string, number> = {};
  for (const r of rows) status[r.status] = r.count;
  const recent = recentMissing.all(50) as { artist: string; updated_at: number }[];
  return { status, recent_missing: recent };
}

// Requeue every 'missing' row for another resolver pass. updated_at is set
// to 0 so the stale-pending window check passes immediately.
export function requeueAllMissingArtistImages(): number {
  const r = resetAllMissing.run();
  return r.changes;
}

// Wipe the entire artist_images cache and pre-enqueue every distinct artist
// in the given list as 'pending'. Lets the operator force a full re-resolve
// from the UI without having to load the dashboard first to trigger the
// lazy enqueue path. updated_at=0 so the resolver's stale-window check
// passes on the next tick.
export function reseedArtistImages(artists: string[]): { wiped: number; queued: number } {
  const wiped = truncateAll.run().changes;
  const tx = db.transaction((names: string[]) => {
    for (const a of names) {
      if (a && a.trim()) enqueueWithBackdate.run(a);
    }
  });
  tx(artists);
  return { wiped, queued: artists.length };
}

// === Local image cache lookups (services/imageCache.ts) ====================

export interface ArtistImageRow {
  artist: string;
  url: string | null;
  local_path: string | null;
  content_type: string | null;
}

// Mirror of coverart.listAllCoverartWithUrl — used by the hash-based
// /api/image/artist/:hash route to find the matching row.
const allArtistImagesWithUrl = db.prepare(`
  SELECT artist, url, local_path, content_type
  FROM artist_images WHERE url IS NOT NULL
`);

export function listAllArtistImagesWithUrl(): ArtistImageRow[] {
  return allArtistImagesWithUrl.all() as ArtistImageRow[];
}

const setArtistImageLocalPath = db.prepare(`
  UPDATE artist_images SET local_path = ?, content_type = ?, updated_at = unixepoch()
  WHERE artist = ?
`);

export function setArtistImageLocal(
  artist: string,
  localPath: string,
  contentType: string,
): void {
  setArtistImageLocalPath.run(localPath, contentType, artist);
}

const resolvedWithoutLocalStmt = db.prepare(`
  SELECT artist, url, local_path, content_type
  FROM artist_images
  WHERE status = 'resolved' AND url IS NOT NULL AND local_path IS NULL
  LIMIT ?
`);

export function listResolvedArtistImagesWithoutLocal(limit: number): ArtistImageRow[] {
  return resolvedWithoutLocalStmt.all(limit) as ArtistImageRow[];
}
