import {
  enqueueArtistImage,
  getCachedArtistImage,
  listPendingArtistImages,
  setArtistImage,
} from "../db/queries/artistImages.js";
import { findArtistInfo } from "../integrations/musicbrainz.js";
import { getLbArtistImageByMbid } from "../integrations/listenbrainz.js";
import { getLastFmArtistImage } from "../integrations/lastfm.js";
import { getDeezerArtistImage } from "../integrations/deezer.js";
import { publicUrlForArtist } from "../services/imageCache.js";

// Returns a stable /api/image/artist/{hash} URL even before resolution
// completes — the route serves a transparent placeholder until the
// background worker fills the row.
export function getOrEnqueueArtistImage(artist: string): string | null {
  if (!artist) return null;
  if (!getCachedArtistImage(artist)) enqueueArtistImage(artist);
  return publicUrlForArtist(artist);
}

// Resolution strategy:
//   1. Deezer  — primary; no auth, no rate limit, wide coverage. Returns
//      real artist photos for nearly everything Deezer indexes.
//   2. MusicBrainz artist lookup — always called so we cache the MBID for
//      downstream sources (e.g. the MB fresh-releases Discover source).
//      Doesn't itself yield an image.
//   3. ListenBrainz artist metadata — kept as a courtesy fallback; rarely
//      returns an image URL.
//   4. Last.fm artist.search — kept for resilience but Last.fm fully
//      removed real artist images in 2022, so this almost always misses.
//      The function already filters their star placeholder.
//
// We log the contribution of each step so the operator can see whether the
// resolver is silently failing for a particular artist.
export async function resolveArtistImageBatch(): Promise<void> {
  const pending = listPendingArtistImages(10);
  for (const { artist } of pending) {
    // Always resolve the MBID — cheap (already on the MB rate-limit queue)
    // and useful even if we don't get an image from any source.
    const mbArtist = await findArtistInfo(artist);
    const mbArtistId = mbArtist?.id ?? null;

    let url: string | null = await getDeezerArtistImage(artist);
    const fromDeezer = !!url;

    let fromLb = false;
    if (!url && mbArtistId) {
      url = await getLbArtistImageByMbid(mbArtistId);
      fromLb = !!url;
    }

    let fromLfm = false;
    if (!url) {
      url = await getLastFmArtistImage(artist);
      fromLfm = !!url;
    }

    console.log(
      `[artist-image] ${artist} → mb=${mbArtistId ? "yes" : "no"}` +
      ` deezer=${fromDeezer ? "yes" : "no"}` +
      ` lb=${fromLb ? "yes" : "no"}` +
      ` lfm=${fromLfm ? "yes" : "no"}` +
      ` result=${url ? "resolved" : "missing"}`,
    );

    setArtistImage(artist, url, mbArtistId, url ? "resolved" : "missing");
  }
}
