import type { RawSeed, Source } from "./index.js";
import { fetchViaFlareSolverr, flaresolverrConfigured } from "../flaresolverr.js";
import { htmlPreview } from "./rssHelpers.js";

// ============================================================================
// AlbumOfTheYear scraper
// ============================================================================
//
// Faithful port of edideaur/AOTY-api (https://github.com/edideaur/AOTY-api),
// which maintains a working AOTY scraper as a Cloudflare Worker. Credited
// in the README.
//
// Endpoint: /must-hear/{year}/ — AOTY's curated "essential albums" list
// for the year. High-signal: the editorial team picks ~25-50 per year,
// with active curation. Matches the same scraper AOTY-api uses for
// /must-hear, /discover, /releases — all album-block layout.
//
// URL choice rationale:
//   - /ratings/critic-highest-rated/... is NOT a real AOTY path (AOTY
//     uses /ratings/6-highest-rated/... internally), which is why the
//     original implementation got back the homepage shell with no rows.
//   - /must-hear/{year}/ is a documented AOTY-api endpoint and uses the
//     clean .albumBlock structure with .artistTitle + .albumTitle.
//   - /discover/ would also work but is broader/less curated.
//
// Selectors copied verbatim from AOTY-api's scrapers/albumBlock.ts:
//   .albumBlock > .artistTitle    → artist name
//   .albumBlock > .albumTitle     → album title
//   .albumBlock > .image a        → album page URL
//   .albumBlock > .image img      → cover URL
//
// HTMLRewriter (their parser) is streaming; we use regex since we're not
// on a Cloudflare Worker. Equivalent output.
// ============================================================================

const CHART_URL = (() => {
  const year = new Date().getUTCFullYear();
  return `https://www.albumoftheyear.org/must-hear/${year}/`;
})();

const SCORE = 0.78;

let cache: { fetchedAt: number; seeds: RawSeed[] } | null = null;
const CACHE_TTL_MS = 24 * 60 * 60_000;

// User-Agent matches AOTY-api's FETCH_OPTS (Chrome on Windows). Real
// browser strings reduce friction with AOTY's bot detection — though
// the page is generally fetchable without Cloudflare bypass.
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9," +
    "image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
};

interface ChartEntry {
  artist: string;
  title: string;
}

// Direct port of AOTY-api's decodeEntities helper (constants.ts).
function decodeEntities(str: string): string {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// Strip nested tags from inner HTML, decode entities, collapse whitespace.
// Equivalent to what HTMLRewriter's text() emits, concatenated.
function textOf(cellHtml: string): string {
  return decodeEntities(cellHtml.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// Port of AOTY-api's scrapeAlbumBlocks (scrapers/albumBlock.ts).
// On their side it's a streaming HTMLRewriter; here it's regex over the
// full HTML. Either way the selectors are .albumBlock > .artistTitle and
// .albumBlock > .albumTitle.
function parseAlbumBlocks(html: string): ChartEntry[] {
  const entries: ChartEntry[] = [];
  // Match each .albumBlock container. AOTY uses a non-greedy capture
  // bounded by the next .albumBlock or end-of-document — but the
  // simpler "block until two closing divs" pattern handles typical
  // AOTY markup (the block ends with </div></div> for its content +
  // wrapper).
  const blockRe = /<div[^>]*class="[^"]*\balbumBlock\b[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*\balbumBlock\b|<\/body>)/g;
  const artistRe = /<div[^>]*class="[^"]*\bartistTitle\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
  const titleRe = /<div[^>]*class="[^"]*\balbumTitle\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i;

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

  const entries = parseAlbumBlocks(html);
  if (entries.length === 0) {
    console.warn(
      `[aoty] no-matches — fetched ${html.length} bytes from ${CHART_URL} ` +
      `but parsed 0 .albumBlock rows. AOTY may have changed their markup ` +
      `(selectors are a direct port of edideaur/AOTY-api). First 2000 chars ` +
      `of <body> (scripts/styles stripped) for diagnosis:\n` +
      htmlPreview(html),
    );
    return [];
  }

  const year = new Date().getUTCFullYear();
  return entries.slice(0, 30).map<RawSeed>((e) => ({
    source: "albumoftheyear",
    artist: e.artist,
    title: e.title,
    release_mbid: null,
    artist_mbid: null,
    mode: "album",
    score: SCORE,
    reason: `Must-hear album of ${year} on AlbumOfTheYear`,
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
