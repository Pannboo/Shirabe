import { fetchRss, parseRssItems } from "./rssHelpers.js";
import { searchReleases } from "../musicbrainz.js";
import type { RawSeed, Source } from "./index.js";

// Stereogum's "Album Of The Week" is a clean weekly editorial pick — one
// album per week, taste-maker curation. Premature Evaluation is similar
// but more frequent (early reviews ahead of release).
const FEEDS = [
  { url: "https://www.stereogum.com/category/album-of-the-week/feed/", label: "AOTW", score: 0.78 },
  { url: "https://www.stereogum.com/category/premature-evaluation/feed/", label: "Premature", score: 0.7 },
];

// Stereogum titles look like (as of 2026):
//   "Album Of The Week: Styrofoam Winos Any River"
//   "Premature Evaluation: Olivia Rodrigo you seem pretty sad..."
// There's NO machine-readable separator between artist and album — both
// halves run together. We can't split mechanically, so instead we strip
// the prefix and pass the remainder to MusicBrainz release search.
// MB knows how to find "Any River by Styrofoam Winos" even when given
// the concatenated string, and returns a structured (artist, title)
// pair we can use.
const PREFIX_RE = /^(?:Album Of The Week|Premature Evaluation|AOTW)\s*[:\-]\s*/i;

// Reject MB matches under this score — keeps us from attributing a
// Stereogum pick to some random unrelated release.
const MB_SCORE_FLOOR = 80;

export const stereogumSource: Source = {
  id: "stereogum",
  label: "Stereogum",
  async fetchSeeds(): Promise<RawSeed[]> {
    const seeds: RawSeed[] = [];
    for (const feed of FEEDS) {
      const xml = await fetchRss(feed.url, `stereogum/${feed.label}`);
      if (!xml) continue;
      const items = parseRssItems(xml);
      let parsedCount = 0;
      for (const it of items.slice(0, 15)) {
        const stripped = it.title.replace(PREFIX_RE, "").trim();
        if (!stripped) continue;
        const results = await searchReleases(stripped, 3);
        const best = results[0];
        if (!best || best.score < MB_SCORE_FLOOR) continue;
        parsedCount += 1;
        seeds.push({
          source: "stereogum",
          artist: best.artistName,
          title: best.title,
          release_mbid: best.releaseId,
          artist_mbid: best.artistId,
          mode: "album",
          score: feed.score,
          reason: feed.label === "AOTW" ? "Stereogum Album of the Week" : "Stereogum Premature Evaluation",
        });
      }
      console.log(`[stereogum/${feed.label}] parsed ${parsedCount}/${items.length} items (via MB search)`);
      if (parsedCount === 0 && items.length > 0) {
        const sample = items.slice(0, 3).map((it) => `  - ${it.title}`).join("\n");
        console.warn(
          `[stereogum/${feed.label}] MB search found nothing matching any title. Sample titles:\n${sample}`,
        );
      }
    }
    return seeds;
  },
};
