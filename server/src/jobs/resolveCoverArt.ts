import {
  enqueueCoverArt,
  getCachedCoverArt,
  listPendingCoverArt,
  setCoverArt,
} from "../db/queries/coverart.js";
import { getCoverArtUrl } from "../integrations/coverart.js";
import { findRelease, searchReleases } from "../integrations/musicbrainz.js";
import { getLastFmAlbumImage } from "../integrations/lastfm.js";
import { lookupLbRelease, lookupLbReleaseByTitle } from "../integrations/listenbrainz.js";
import { publicUrlForAlbum } from "../services/imageCache.js";

// Public helper: always returns a stable /api/image/album/{hash} URL when
// an album is known, and enqueues the row if it isn't resolved yet. The
// image route returns a transparent placeholder until the resolver
// populates the row, so clients never see broken images.
export function getOrEnqueueCoverArt(artist: string, album: string | null): string | null {
  if (!album) return null;
  if (!getCachedCoverArt(artist, album)) enqueueCoverArt(artist, album);
  return publicUrlForAlbum(artist, album);
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
    let fromMbTitle = false;
    let fromLbTitle = false;
    let fromLfm = false;

    const release = await findRelease(artist, album);
    if (release) {
      mbReleaseId = release.releaseId;
      year = release.year;
      url = await getCoverArtUrl(release.releaseId);
      if (url) fromMb = true;
    }

    // ListenBrainz fallback. Routes the LB-suggested MBID through CAA's
    // JSON API so we get the canonical URL and pick up the year on the way.
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

    // Title-only MusicBrainz fallback. Catches cast / compilation /
    // soundtrack releases where the scrobbled "artist" is a credited
    // vocalist that doesn't match the album-level release artist
    // (e.g. "Anthony Ramos" on Hamilton: An American Musical → the
    // release is credited to "Original Broadway Cast", not Anthony).
    if (!url) {
      const results = await searchReleases(album, 5);
      const best = results[0];
      if (best && best.score >= 75) {
        if (!mbReleaseId) mbReleaseId = best.releaseId;
        if (year === null) year = best.year;
        url = await getCoverArtUrl(best.releaseId);
        if (url) fromMbTitle = true;
      }
    }

    // Title-only ListenBrainz fallback. LB's release-only lookup is
    // notably fuzzier than MB's structured search and sometimes catches
    // releases MB ranks too low (special editions, region masters, etc).
    if (!url) {
      const lb = await lookupLbReleaseByTitle(album);
      const lbMbid = lb?.caa_release_mbid ?? lb?.release_mbid ?? null;
      if (lbMbid) {
        if (!mbReleaseId) mbReleaseId = lbMbid;
        if (year === null && lb?.year) year = lb.year;
        url = await getCoverArtUrl(lbMbid);
        if (url) fromLbTitle = true;
      }
    }

    if (!url) {
      url = await getLastFmAlbumImage(artist, album);
      if (url) fromLfm = true;
    }

    console.log(
      `[coverart] ${artist} — ${album} → mb=${fromMb ? "yes" : "no"}` +
      ` lb=${fromLb ? "yes" : "no"}` +
      ` mb-title=${fromMbTitle ? "yes" : "no"}` +
      ` lb-title=${fromLbTitle ? "yes" : "no"}` +
      ` lfm=${fromLfm ? "yes" : "no"}` +
      ` result=${url ? "resolved" : "missing"}`,
    );

    setCoverArt(artist, album, url, mbReleaseId, url ? "resolved" : "missing", year);
  }
}
