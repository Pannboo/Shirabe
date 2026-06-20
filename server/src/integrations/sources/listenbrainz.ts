import {
  fetchListenBrainzAllFreshReleases,
  fetchListenBrainzFreshReleases,
  fetchListenBrainzSuggestions,
} from "../listenbrainz.js";
import type { RawSeed, Source } from "./index.js";

// Two complementary LB endpoints, with the album-shaped one prioritised
// since that's what Shirabe is built to download:
//
//   1. /user/{user}/fresh_releases — new albums by artists already in
//      the user's listening history. Highest-signal album discovery LB
//      offers and the closest match to the user's existing taste.
//   2. /cf/recommendation/user/{user}/recording — collaborative-filtered
//      recordings (often skinnier; some come back as singles/tracks).
//      Kept as a secondary feed because the matching strategy is
//      different from fresh-releases (other-users' taste vs. your own
//      artists' calendar).
//
// Both streams are deduped against each other and tagged separately so
// the Discover UI can show *why* a release surfaced.

export const listenbrainzSource: Source = {
  id: "listenbrainz",
  label: "ListenBrainz",
  async fetchSeeds(): Promise<RawSeed[]> {
    const [fresh, allFresh, cf] = await Promise.all([
      fetchListenBrainzFreshReleases(),
      fetchListenBrainzAllFreshReleases(30),
      fetchListenBrainzSuggestions(),
    ]);

    const seeds: RawSeed[] = [];
    const seen = new Set<string>();
    const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

    // Three streams, ranked by signal strength:
    //   fresh    (0.85) — new releases by your scrobbled artists
    //   allFresh (0.6)  — DeepCrate-style firehose of all new releases
    //   cf       (0.7)  — collaborative-filtering recordings
    // Higher-scored stream wins dedupe when an album appears in more
    // than one of them.
    const push = (s: { artist: string; title: string; release_mbid: string | null; artist_mbid: string | null; mode: "album" | "track" }, score: number, reason: string): void => {
      const k = `${norm(s.artist)}|${norm(s.title)}`;
      if (seen.has(k)) return;
      seen.add(k);
      seeds.push({
        source: "listenbrainz",
        artist: s.artist,
        title: s.title,
        release_mbid: s.release_mbid,
        artist_mbid: s.artist_mbid,
        mode: s.mode,
        score,
        reason,
      });
    };

    for (const s of fresh) push(s, 0.85, "New release from an artist you listen to");
    for (const s of cf) push(s, 0.7, "Listeners with similar taste also play this");
    for (const s of allFresh) push(s, 0.6, "Newly released this month");

    console.log(
      `[lb-source] ${seeds.length} seeds (` +
      `${fresh.length} fresh-yours + ${cf.length} cf + ${allFresh.length} fresh-all, ` +
      `${fresh.length + cf.length + allFresh.length - seeds.length} cross-dedupe)`,
    );
    return seeds;
  },
};
