import { db } from "../client.js";

export interface ArtistLink {
  brand: string;      // "spotify" | "youtube" | "discogs" | "wikipedia" | "twitter" | ...
  label: string;      // user-facing display label
  url: string;
}

const getByMbid = db.prepare(`
  SELECT links_json FROM artist_links WHERE mb_artist_id = ? AND status = 'resolved'
`);
const upsert = db.prepare(`
  INSERT INTO artist_links (mb_artist_id, links_json, status, updated_at)
  VALUES (?, ?, ?, unixepoch())
  ON CONFLICT(mb_artist_id) DO UPDATE SET
    links_json = excluded.links_json,
    status = excluded.status,
    updated_at = unixepoch()
`);
const enqueue = db.prepare(`
  INSERT INTO artist_links (mb_artist_id, status) VALUES (?, 'pending')
  ON CONFLICT(mb_artist_id) DO NOTHING
`);
// 60s stale window matches the cover-art / artist-image pattern. Within that
// window an enqueued row is still in flight; after it the worker re-tries.
const stalePending = db.prepare(`
  SELECT mb_artist_id FROM artist_links
  WHERE status = 'pending' AND updated_at < unixepoch() - 60
  LIMIT ?
`);

export function getCachedArtistLinks(mbArtistId: string): ArtistLink[] | null {
  const row = getByMbid.get(mbArtistId) as { links_json: string | null } | undefined;
  if (!row?.links_json) return null;
  try {
    return JSON.parse(row.links_json) as ArtistLink[];
  } catch {
    return null;
  }
}

export function enqueueArtistLinks(mbArtistId: string): void {
  enqueue.run(mbArtistId);
}

export function setArtistLinks(
  mbArtistId: string,
  links: ArtistLink[] | null,
  status: "resolved" | "missing" = links && links.length > 0 ? "resolved" : "missing",
): void {
  upsert.run(mbArtistId, links ? JSON.stringify(links) : null, status);
}

export function listPendingArtistLinks(limit: number): { mb_artist_id: string }[] {
  return stalePending.all(limit) as { mb_artist_id: string }[];
}

// === Diagnostics + admin actions ===========================================

const statsByStatus = db.prepare(`
  SELECT status, COUNT(*) as count FROM artist_links GROUP BY status
`);
const recentMissing = db.prepare(`
  SELECT al.mb_artist_id, ai.artist AS artist_name, al.updated_at
  FROM artist_links al
  LEFT JOIN artist_images ai ON ai.mb_artist_id = al.mb_artist_id
  WHERE al.status = 'missing'
  ORDER BY al.updated_at DESC LIMIT ?
`);
const resetAllMissing = db.prepare(`
  UPDATE artist_links SET status = 'pending', updated_at = 0 WHERE status = 'missing'
`);
const truncateAll = db.prepare(`DELETE FROM artist_links`);
const reseedFromImages = db.prepare(`
  INSERT INTO artist_links (mb_artist_id, status, updated_at)
  SELECT DISTINCT mb_artist_id, 'pending', 0
  FROM artist_images
  WHERE mb_artist_id IS NOT NULL AND mb_artist_id != ''
  ON CONFLICT(mb_artist_id) DO UPDATE SET status = 'pending', updated_at = 0
`);

export interface ArtistLinksStats {
  status: Record<string, number>;
  recent_missing: { mb_artist_id: string; artist_name: string | null; updated_at: number }[];
}

export function artistLinksStats(): ArtistLinksStats {
  const rows = statsByStatus.all() as { status: string; count: number }[];
  const status: Record<string, number> = {};
  for (const r of rows) status[r.status] = r.count;
  const recent = recentMissing.all(30) as {
    mb_artist_id: string;
    artist_name: string | null;
    updated_at: number;
  }[];
  return { status, recent_missing: recent };
}

export function requeueAllMissingArtistLinks(): number {
  return resetAllMissing.run().changes;
}

// Wipe the entire artist_links cache and pre-enqueue every MBID we already
// know about from the artist-image resolver. After this, the resolver cron
// will work through them at 1/30s. No need to visit each artist page.
export function reseedArtistLinks(): { wiped: number; queued: number } {
  const wiped = truncateAll.run().changes;
  const queued = reseedFromImages.run().changes;
  return { wiped, queued };
}
