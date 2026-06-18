import type { RawSeed, Source } from "./index.js";
import { fetchViaFlareSolverr, flaresolverrConfigured } from "../flaresolverr.js";
import { htmlPreview } from "./rssHelpers.js";

// ============================================================================
// AlbumOfTheYear scraper
// ============================================================================
//
// Selectors and decoding patterns adapted from edideaur/AOTY-api
// (https://github.com/edideaur/AOTY-api) which maintains a working
// Cloudflare-Worker-based AOTY scraper. Their HTMLRewriter selectors are
// the source-of-truth for what the live HTML actually looks like —
// translated here to regex form since we don't have a streaming HTML
// parser server-side. Credit in the README.
//
// AOTY uses two distinct chart layouts:
//   - List pages (/ratings/critic-highest-rated/, /list/...)
//       → .albumListRow containing .albumListTitle a[itemprop='url']
//   - Discover/release pages (/releases/, /discover/...)
//       → .albumBlock with .artistTitle and .albumTitle children
//
// We default to the list page but parse both shapes — saves us a refetch
// if AOTY's HTML structure shifts under us.
// ============================================================================

const CHART_URL = (() => {
  const year = new Date().getUTCFullYear();
  return `https://www.albumoftheyear.org/ratings/critic-highest-rated/${year}/1/`;
})();

const SCORE = 0.72;

let cache: { fetchedAt: number; seeds: RawSeed[] } | null = null;
const CACHE_TTL_MS = 24 * 60 * 60_000;

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "gzip, deflate",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
};

interface ChartEntry {
  artist: string;
  title: string;
}

// HTML entity decoder — mirrors AOTY-api's decodeEntities helper. Covers
// the entities AOTY's pages actually use (numeric, named common, smart
// punctuation passed through from CMS).
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

// Strip any nested tags out of a cell's inner HTML, decode entities,
// collapse whitespace. Mirrors what HTMLRewriter would emit as text().
function textOf(cellHtml: string): string {
  return decodeEntities(cellHtml.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// === List-page parser ======================================================
//
// Matches AOTY-api's lists.ts shape:
//   <div class="albumListRow ...">
//     <div class="albumListImage">...</div>
//     <div class="albumListTitle">
//       <a itemprop="url" href="/album/...">Artist Name - Album Title</a>
//     </div>
//     <div class="albumListGenre">...</div>
//   </div>
//
// The anchor text is "Artist Name - Album Title" on these list pages.
// (The discover-block format splits artist + title into separate
// elements; the list format concatenates them.)
function parseListRows(html: string): ChartEntry[] {
  const entries: ChartEntry[] = [];
  const rowRe = /<div[^>]*class="[^"]*albumListRow[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const row = m[1] ?? "";
    // Find the .albumListTitle block's first anchor.
    const titleMatch = row.match(
      /<div[^>]*class="[^"]*albumListTitle[^"]*"[^>]*>[\s\S]*?<a[^>]*itemprop=["']url["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!titleMatch?.[1]) continue;
    const text = textOf(titleMatch[1]);
    // Split on the first " - " (AOTY list-page convention).
    const dashIdx = text.indexOf(" - ");
    if (dashIdx <= 0) continue;
    const artist = text.slice(0, dashIdx).trim();
    const title = text.slice(dashIdx + 3).trim();
    if (artist && title) entries.push({ artist, title });
  }
  return entries;
}

// === Discover/release-block parser =========================================
//
// Matches AOTY-api's albumBlock.ts shape. Used when the page is a
// "discover" layout rather than a chart list:
//
//   <div class="albumBlock" data-type="LP">
//     <div class="image"><a href="/album/...">...</a></div>
//     <div class="artistTitle">Artist Name</div>
//     <div class="albumTitle">Album Title</div>
//     ...
//   </div>
function parseAlbumBlocks(html: string): ChartEntry[] {
  const entries: ChartEntry[] = [];
  const blockRe = /<div[^>]*class="[^"]*albumBlock[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
  const artistRe = /<div[^>]*class="[^"]*artistTitle[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
  const titleRe = /<div[^>]*class="[^"]*albumTitle[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null) {
    const block = m[1] ?? "";
    const a = block.match(artistRe);
    const t = block.match(titleRe);
    if (!a?.[1] || !t?.[1]) continue;
    const artist = textOf(a[1]);
    const title = textOf(t[1]);
    if (artist && title) entries.push({ artist, title });
  }
  return entries;
}

function parseChart(html: string): ChartEntry[] {
  // Try the list-row layout first (matches the chart URL we hit), fall
  // back to the discover-block layout if AOTY has changed the page type.
  const list = parseListRows(html);
  if (list.length > 0) return list;
  return parseAlbumBlocks(html);
}

function looksLikeChallenge(html: string): boolean {
  const sniff = html.slice(0, 4000).toLowerCase();
  return (
    sniff.includes("cf-challenge") ||
    sniff.includes("just a moment") ||
    sniff.includes("checking your browser") ||
    sniff.includes("attention required! | cloudflare")
  );
}

async function fetchChart(): Promise<RawSeed[]> {
  let html: string | null = null;

  // Prefer FlareSolverr when configured.
  if (flaresolverrConfigured()) {
    html = await fetchViaFlareSolverr(CHART_URL, "aoty/flaresolverr");
  }

  if (!html) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(CHART_URL, { headers: BROWSER_HEADERS, signal: ctrl.signal });
      if (!res.ok) {
        console.warn(`[aoty] ${CHART_URL} returned HTTP ${res.status}`);
        return [];
      }
      html = await res.text();
    } catch (err) {
      console.warn(`[aoty] fetch failed`, err instanceof Error ? err.message : err);
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  if (looksLikeChallenge(html)) {
    console.warn(
      "[aoty] cloudflare-challenge — AOTY blocked the request. " +
      (flaresolverrConfigured()
        ? "FlareSolverr is configured but couldn't resolve the page."
        : "Set flaresolverr_url in Settings to route fetches through a browser-resolver."),
    );
    return [];
  }

  const entries = parseChart(html);
  if (entries.length === 0) {
    console.warn(
      `[aoty] no-matches — fetched ${html.length} bytes but parsed 0 rows. ` +
      `HTML layout may have changed (selectors based on edideaur/AOTY-api). ` +
      `First 2000 chars of <body> (scripts/styles stripped) for diagnosis:\n` +
      htmlPreview(html),
    );
    return [];
  }

  return entries.slice(0, 25).map<RawSeed>((e) => ({
    source: "albumoftheyear",
    artist: e.artist,
    title: e.title,
    release_mbid: null,
    artist_mbid: null,
    mode: "album",
    score: SCORE,
    reason: "Highest-rated by critics this year on AOTY",
  }));
}

export const aotySource: Source = {
  id: "albumoftheyear",
  label: "AlbumOfTheYear",
  async fetchSeeds(): Promise<RawSeed[]> {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      return cache.seeds;
    }
    const seeds = await fetchChart();
    cache = { fetchedAt: Date.now(), seeds };
    console.log(`[aoty] cached ${seeds.length} seeds for 24h`);
    return seeds;
  },
};
