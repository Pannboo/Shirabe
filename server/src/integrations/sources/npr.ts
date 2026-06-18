import { fetchRss, parseRssItems } from "./rssHelpers.js";
import type { RawSeed, Source } from "./index.js";

// NPR Music's main RSS feed. Articles vary in format — only some are
// album-debut/review pieces with parseable titles. We extract only items
// that match the "First Listen" / "New Music From" patterns; the rest
// (longer-form features, interviews) are skipped because we can't reliably
// turn a sentence into (artist, album) without NLP.
const FEED_URL = "https://feeds.npr.org/1039/rss.xml";

// Patterns observed on NPR Music:
//   "First Listen: Artist Name, 'Album Title'"
//   "First Listen: Artist Name — Album Title"
//   "New Music From Artist Name: 'Album Title'"
//   "Album Review: Artist, 'Album Title'"
const PARSERS: Array<{ re: RegExp; artistIdx: number; titleIdx: number }> = [
  { re: /^(?:First Listen|Album Review|Review)\s*:\s*(.+?)\s*[,—–-]\s*['"‘“](.+?)['"’”]\s*$/i, artistIdx: 1, titleIdx: 2 },
  { re: /^(?:First Listen|Album Review|Review)\s*:\s*(.+?)\s*[—–-]\s*(.+)$/i, artistIdx: 1, titleIdx: 2 },
  { re: /^New Music From\s+(.+?)\s*:\s*['"‘“](.+?)['"’”]\s*$/i, artistIdx: 1, titleIdx: 2 },
];

interface Parsed { artist: string; title: string }

function parseNprTitle(raw: string): Parsed | null {
  for (const p of PARSERS) {
    const m = raw.match(p.re);
    if (!m) continue;
    const artist = m[p.artistIdx];
    const title = m[p.titleIdx];
    if (artist && title) return { artist: artist.trim(), title: title.trim() };
  }
  return null;
}

export const nprSource: Source = {
  id: "npr",
  label: "NPR Music",
  async fetchSeeds(): Promise<RawSeed[]> {
    const xml = await fetchRss(FEED_URL, "npr");
    if (!xml) return [];
    const items = parseRssItems(xml);
    const seeds: RawSeed[] = [];
    for (const it of items) {
      const p = parseNprTitle(it.title);
      if (!p) continue;
      seeds.push({
        source: "npr",
        artist: p.artist,
        title: p.title,
        release_mbid: null,
        artist_mbid: null,
        mode: "album",
        score: 0.7,
        reason: "NPR Music",
      });
    }
    console.log(`[npr] parsed ${seeds.length}/${items.length} items`);
    return seeds;
  },
};
