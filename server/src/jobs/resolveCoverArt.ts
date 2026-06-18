import {
  enqueueCoverArt,
  getCachedCoverArt,
  listPendingCoverArt,
  setCoverArt,
} from "../db/queries/coverart.js";
import { getCoverArtUrl } from "../integrations/coverart.js";
import { findRelease } from "../integrations/musicbrainz.js";
import { getLastFmAlbumImage } from "../integrations/lastfm.js";
import { lookupLbRelease } from "../integrations/listenbrainz.js";

// Public helper: returns a URL if already cached, else enqueues for the background worker.
export function getOrEnqueueCoverArt(artist: string, album: string | null): string | null {
  if (!album) return null;
  const cached = getCachedCoverArt(artist, album);
  if (cached) return cached;
  enqueueCoverArt(artist, album);
  return null;
}

// Resolves a few pending (artist, album) pairs per tick.
//
// Resolution order, each step falling through to the next on miss:
//   1. MusicBrainz release search → CAA front-cover JSON API
//   2. ListenBrainz /metadata/lookup → caa_release_mbid → CAA JSON API
//      (LB does release-group-level canonicalization so it often finds
//      the right MBID when MB's direct search misses — eg. for tracks
//      released as singles on multiple compilations)
//   3. Last.fm album.getInfo (last resort — image quality varies wildly)
//
// Always pipe MBIDs through getCoverArtUrl() rather than constructing
// CAA URLs by hand; CAA's filename conventions aren't predictable
// (caa_id vs front-500 vs custom name), so the JSON API is the only
// reliable way to get the actual download URL.
//
// Per-album log line shows which step contributed:
//   [coverart] Artist — Album → mb=yes lb=no lfm=no result=resolved
export async function resolveCoverArtBatch(): Promise<void> {
  const pending = listPendingCoverArt(10);
  for (const { artist, album } of pending) {
    let url: string | null = null;
    let mbReleaseId: string | null = null;
    let year: number | null = null;
    let fromMb = false;
    let fromLb = false;
    let fromLfm = false;

    const release = await findRelease(artist, album);
    if (release) {
      mbReleaseId = release.releaseId;
      year = release.year;
      url = await getCoverArtUrl(release.releaseId);
      if (url) fromMb = true;
    }

    // ListenBrainz fallback. Routes the LB-suggested MBID through CAA's
    // JSON API so we get the canonical URL and pick up the year on the
    // way. Records the MBID on the coverart row even when CAA ends up
    // having no art for it — so subsequent passes don't re-query MB.
    if (!url) {
      const lb = await lookupLbRelease(artist, album);
      const lbMbid = lb?.caa_release_mbid ?? lb?.release_mbid ?? null;
      if (lbMbid) {
        if (!mbReleaseId) mbReleaseId = lbMbid;
        if (year === null && lb?.year) year = lb.year;
        url = await getCoverArtUrl(lbMbid);
        if (url) fromLb = true;
      }
    }

    if (!url) {
      url = await getLastFmAlbumImage(artist, album);
      if (url) fromLfm = true;
    }

    console.log(
      `[coverart] ${artist} — ${album} → mb=${fromMb ? "yes" : "no"}` +
      ` lb=${fromLb ? "yes" : "no"} lfm=${fromLfm ? "yes" : "no"}` +
      ` result=${url ? "resolved" : "missing"}`,
    );

    setCoverArt(artist, album, url, mbReleaseId, url ? "resolved" : "missing", year);
  }
}
