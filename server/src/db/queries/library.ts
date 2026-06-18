import { db } from "../client.js";

function normalise(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

const upsertStmt = db.prepare(`
  INSERT INTO library_albums (artist_key, album_key, artist, album, navidrome_album_id, mb_release_id, last_seen_at)
  VALUES (?, ?, ?, ?, ?, ?, unixepoch())
  ON CONFLICT(artist_key, album_key) DO UPDATE SET
    artist = excluded.artist,
    album = excluded.album,
    navidrome_album_id = excluded.navidrome_album_id,
    mb_release_id = COALESCE(excluded.mb_release_id, library_albums.mb_release_id),
    last_seen_at = unixepoch()
`);

const existsByKeyStmt = db.prepare(`
  SELECT 1 FROM library_albums WHERE artist_key = ? AND album_key = ? LIMIT 1
`);

const existsByMbStmt = db.prepare(`
  SELECT 1 FROM library_albums WHERE mb_release_id = ? LIMIT 1
`);

const countStmt = db.prepare(`SELECT COUNT(*) as n FROM library_albums`);

const lastSyncStmt = db.prepare(`SELECT MAX(last_seen_at) as ts FROM library_albums`);

const pruneStmt = db.prepare(`DELETE FROM library_albums WHERE last_seen_at < ?`);

export interface LibraryAlbumInput {
  artist: string;
  album: string;
  navidromeAlbumId: string | null;
  mbReleaseId: string | null;
}

export function upsertLibraryAlbum(input: LibraryAlbumInput): void {
  upsertStmt.run(
    normalise(input.artist),
    normalise(input.album),
    input.artist,
    input.album,
    input.navidromeAlbumId,
    input.mbReleaseId,
  );
}

export function isAlbumOwned(artist: string, album: string | null, mbReleaseId: string | null): boolean {
  if (mbReleaseId && existsByMbStmt.get(mbReleaseId)) return true;
  if (!album) return false;
  return existsByKeyStmt.get(normalise(artist), normalise(album)) !== undefined;
}

export function libraryAlbumCount(): number {
  const row = countStmt.get() as { n: number } | undefined;
  return row?.n ?? 0;
}

export function libraryLastSync(): number | null {
  const row = lastSyncStmt.get() as { ts: number | null } | undefined;
  return row?.ts ?? null;
}

export function pruneLibraryOlderThan(cutoffEpoch: number): void {
  pruneStmt.run(cutoffEpoch);
}
