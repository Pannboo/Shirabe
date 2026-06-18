import {
  enqueueCoverArt,
  getCachedCoverArt,
  listPendingCoverArt,
  setCoverArt,
} from "../db/queries/coverart.js";
import { getCoverArtUrl } from "../integrations/coverart.js";
import { findRelease } from "../integrations/musicbrainz.js";
import { getLastFmAlbumImage } from "../integrations/lastfm.js";
import { getLbAlbumCover } from "../integrations/listenbrainz.js";

// Public helper: returns a URL if already cached, else enqueues for the background worker.
export function getOrEnqueueCoverArt(artist: string, album: string | null): string | null {
  if (!album) return null;
  const cached = getCachedCoverArt(artist, album);
  if (cached) return cached;
  enqueueCoverArt(artist, album);
  return null;
}

// Background worker: resolves a few pending (artist, album) pairs per tick.
// Tries Cover Art Archive (via MusicBrainz release lookup) first because it's
// the highest-quality source, then falls back to ListenBrainz and Last.fm so
// cast recordings / compilations / niche releases still get artwork.
export async function resolveCoverArtBatch(): Promise<void> {
  const pending = listPendingCoverArt(10);
  for (const { artist, album } of pending) {
    let url: string | null = null;
    let mbReleaseId: string | null = null;
    let year: number | null = null;

    const release = await findRelease(artist, album);
    if (release) {
      mbReleaseId = release.releaseId;
      year = release.year;
      url = await getCoverArtUrl(release.releaseId);
    }

    if (!url) url = await getLbAlbumCover(artist, album);
    if (!url) url = await getLastFmAlbumImage(artist, album);

    setCoverArt(artist, album, url, mbReleaseId, url ? "resolved" : "missing", year);
  }
}
