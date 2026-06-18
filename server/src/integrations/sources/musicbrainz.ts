import { db } from "../../db/client.js";
import { getAdminId } from "../../db/queries/users.js";
import { findArtistInfo, browseReleaseGroupsForArtist } from "../musicbrainz.js";
import type { RawSeed, Source } from "./index.js";

// How many top artists to crawl per refresh. Each crawl is two MB calls
// (artist lookup if uncached, then release-group browse), so 12 artists ≈
// 24 seconds at the 1 req/s MB queue. Suggestions are deduped so re-runs
// don't pile up.
const TOP_ARTISTS = 12;

// How far back to consider a release "fresh". 90 days catches recent drops
// without polluting the feed with year-old albums.
const FRESH_WINDOW_DAYS = 90;

// Skip release-groups with these primary types — they're usually filler.
const SKIP_TYPES = new Set(["Compilation", "Live", "Remix", "Soundtrack", "Interview", "Audiobook"]);

interface TopArtistRow {
  artist: string;
  play_count: number;
  mb_artist_id: string | null;
}

const topArtistsStmt = db.prepare(`
  SELECT s.artist, COUNT(*) as play_count, ai.mb_artist_id
  FROM scrobbles s
  LEFT JOIN artist_images ai ON ai.artist = s.artist
  WHERE s.user_id = ?
  GROUP BY s.artist
  ORDER BY play_count DESC
  LIMIT ?
`);

function freshCutoffIso(): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - FRESH_WINDOW_DAYS);
  return now.toISOString().slice(0, 10);
}

export const musicbrainzSource: Source = {
  id: "musicbrainz",
  label: "MusicBrainz",
  async fetchSeeds(): Promise<RawSeed[]> {
    const adminId = getAdminId();
    if (!adminId) return [];

    const tops = topArtistsStmt.all(adminId, TOP_ARTISTS) as TopArtistRow[];
    const cutoff = freshCutoffIso();
    const seeds: RawSeed[] = [];

    for (const row of tops) {
      // Use cached MB id when we have one. If not, resolve on the fly —
      // findArtistInfo is the same helper the artist-image resolver uses,
      // and the cache will warm naturally on its next tick.
      let mbid: string | null = row.mb_artist_id;
      if (!mbid) {
        const info = await findArtistInfo(row.artist);
        mbid = info?.id ?? null;
      }
      if (!mbid) continue;

      const groups = await browseReleaseGroupsForArtist(mbid, 25);
      for (const g of groups) {
        if (!g.firstReleaseDate || g.firstReleaseDate < cutoff) continue;
        if (g.primaryType && SKIP_TYPES.has(g.primaryType)) continue;
        seeds.push({
          source: "musicbrainz",
          artist: row.artist,
          title: g.title,
          release_mbid: null, // it's a release-group id, not a release id
          artist_mbid: mbid,
          mode: "album",
          // Heavily weight: it's a confirmed new release from an artist the
          // user already invests in. Scaled by play-count rank.
          score: 0.9,
          reason: `New release · you've played ${row.artist} ${row.play_count} times`,
        });
      }
    }

    return seeds;
  },
};
