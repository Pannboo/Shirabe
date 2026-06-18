import {
  listCoverartMissingYear,
  markCoverartYearMissing,
  setCoverartYear,
} from "../db/queries/coverart.js";
import { findRelease } from "../integrations/musicbrainz.js";

// Backfills MusicBrainz release year onto coverart rows resolved before the
// release_year column existed. Drives the "By release decade" chart for
// users with pre-existing scrobble history. Uses an UPDATE that only writes
// year + mb_release_id — never touches the cover url, so the resolved
// artwork is preserved even if the MB re-search returns nothing.
//
// Rate-limited by MusicBrainz (1 req/sec global queue), so processing ~50
// rows per tick at 5-minute intervals stays well within that budget while
// chewing through the backlog at roughly 600 albums/hour.
export async function backfillReleaseYears(): Promise<void> {
  const rows = listCoverartMissingYear(50);
  for (const { artist, album } of rows) {
    const release = await findRelease(artist, album);
    if (release?.year) {
      setCoverartYear(artist, album, release.year, release.releaseId);
    } else {
      markCoverartYearMissing(artist, album);
    }
  }
}
