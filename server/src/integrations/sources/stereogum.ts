import { fetchRss, parseRssItems } from "./rssHelpers.js";
import type { RawSeed, Source } from "./index.js";

// Stereogum's "Album Of The Week" is a clean weekly editorial pick — one
// album per week, taste-maker curation, parseable title format. Premature
// Evaluation is similar but more frequent (early reviews ahead of release).
const FEEDS = [
  { url: "https://www.stereogum.com/category/album-of-the-week/feed/", label: "AOTW", score: 0.78 },
  { url: "https://www.stereogum.com/category/premature-evaluation/feed/", label: "Premature", score: 0.7 },
];

// Stereogum titles look like:
//   "Album Of The Week: Artist Name Album Title"
//   "Premature Evaluation: Artist Name — Album Title"
//   "Album Of The Week: Artist Name 'Album Title'"
// We strip the prefix and try to split on em dash / quoted album / colon.
const PREFIX_RE = /^(?:Album Of The Week|Premature Evaluation|AOTW)\s*[:\-]\s*/i;

interface Parsed { artist: string; title: string }

function parseStereogumTitle(raw: string): Parsed | null {
  const stripped = raw.replace(PREFIX_RE, "").trim();
  if (!stripped) return null;

  // Most reliable: artist — album (em dash or en dash)
  const dashMatch = stripped.match(/^(.+?)\s*[–—]\s*(.+)$/);
  if (dashMatch && dashMatch[1] && dashMatch[2]) {
    return { artist: dashMatch[1].trim(), title: dashMatch[2].trim() };
  }

  // Next: artist 'album' or artist "album"
  const quoteMatch = stripped.match(/^(.+?)\s+["'‘“](.+?)["'’”]\s*$/);
  if (quoteMatch && quoteMatch[1] && quoteMatch[2]) {
    return { artist: quoteMatch[1].trim(), title: quoteMatch[2].trim() };
  }

  // Last resort: ASCII hyphen with surrounding spaces
  const hypMatch = stripped.match(/^(.+?)\s+-\s+(.+)$/);
  if (hypMatch && hypMatch[1] && hypMatch[2]) {
    return { artist: hypMatch[1].trim(), title: hypMatch[2].trim() };
  }

  return null;
}

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
        const p = parseStereogumTitle(it.title);
        if (!p) continue;
        parsedCount += 1;
        seeds.push({
          source: "stereogum",
          artist: p.artist,
          title: p.title,
          release_mbid: null,
          artist_mbid: null,
          mode: "album",
          score: feed.score,
          reason: feed.label === "AOTW" ? "Stereogum Album of the Week" : "Stereogum Premature Evaluation",
        });
      }
      console.log(`[stereogum/${feed.label}] parsed ${parsedCount}/${items.length} items`);
      // When the title regex matches 0 items, dump a sample so we can see
      // what the actual title format looks like and update the parser.
      if (parsedCount === 0 && items.length > 0) {
        const sample = items.slice(0, 3).map((it) => `  - ${it.title}`).join("\n");
        console.warn(
          `[stereogum/${feed.label}] no titles matched parser. Sample titles:\n${sample}`,
        );
      }
    }
    return seeds;
  },
};
