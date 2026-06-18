import { listAllNavidromeAlbums } from "../integrations/navidrome.js";
import { pruneLibraryOlderThan, upsertLibraryAlbum } from "../db/queries/library.js";

// Pulls every album from Navidrome and mirrors (artist, album) into
// library_albums so Discover can skip already-owned releases. Runs at startup
// and on a daily cron; Settings exposes a manual trigger.
export async function syncNavidromeLibrary(): Promise<{ albums: number }> {
  const startedAt = Math.floor(Date.now() / 1000);
  const albums = await listAllNavidromeAlbums();
  for (const a of albums) {
    if (!a.artist || !a.name) continue;
    upsertLibraryAlbum({
      artist: a.artist,
      album: a.name,
      navidromeAlbumId: a.id ?? null,
      mbReleaseId: a.musicBrainzId ?? null,
    });
  }
  // Stale rows (deleted from Navidrome) older than this sync run drop out.
  // Allow a 30-minute slack so a partially-completed sync doesn't wipe rows.
  if (albums.length > 0) pruneLibraryOlderThan(startedAt - 1800);
  return { albums: albums.length };
}
