import type { RawSeed, Source } from "./index.js";
import { fetchViaFlareSolverr, flaresolverrConfigured } from "../flaresolverr.js";
import { htmlPreview } from "./rssHelpers.js";

// ============================================================================
// RateYourMusic scraper
// ============================================================================
//
// RYM has no public API and their ToS prohibits scraping. Implemented per
// the user's explicit decision to scrape anyway; tradeoffs documented in
// the README. Cloudflare blocks raw fetches from most server IPs — without
// FlareSolverr this source returns 0.
//
// Pulls three endpoints in one cycle, each contributing distinct seeds:
//
//   /new-music/                       → recent releases (highest novelty)
//   /charts/top/album/{year}/         → this year's top-rated
//   /charts/top/album/all-time/       → canonical all-time top
//
// Two markup families involved (RYM uses different templates for
// /new-music/ vs /charts/):
//
//   /new-music/ items:
//     <div class="newreleases_itembox ...">
//       <a class="album newreleases_item_title">TITLE</a>
//       <span class="newreleases_item_artist">
//         <a class="artist">ARTIST</a>
//       </span>
//
//   /charts/ items:
//     <div class="page_charts_section_charts_item_info">
//       <a class="page_charts_section_charts_item_link release">
//         <span class="ui_name_locale_original">TITLE</span>
//       </a>
//       <a class="artist">
//         <span class="ui_name_locale_original">ARTIST</span>
//       </a>
//       <span class="page_charts_section_charts_item_release_type">Album</span>
//
// Dedupe is content-keyed (artist|title, lowercased) within RYM. Cross-
// source dedupe across RYM ↔ Stereogum ↔ AOTY ↔ etc happens server-side
// in pullSuggestions via suggestionExists().
// ============================================================================

const YEAR = new Date().getUTCFullYear();

interface Endpoint {
  url: string;
  parser: (html: string) => ChartEntry[];
  reason: string;
  score: number;
}

const ENDPOINTS: Endpoint[] = [
  {
    url: "https://rateyourmusic.com/new-music/",
    parser: () => [],   // assigned below once the parsers are declared
    reason: "New music on RateYourMusic",
    score: 0.72,
  },
  {
    url: `https://rateyourmusic.com/charts/top/album/${YEAR}/`,
    parser: () => [],
    reason: `Top album of ${YEAR} on RateYourMusic`,
    score: 0.7,
  },
  {
    url: "https://rateyourmusic.com/charts/top/album/all-time/",
    parser: () => [],
    // All-time picks are mostly canon (OK Computer, Nevermind, etc) so
    // they offer less *new* discovery — score them below the fresher
    // sources but keep them in the mix for novelty filtering.
    reason: "All-time top album on RateYourMusic",
    score: 0.55,
  },
];

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

interface ChartEntry { artist: string; title: string }

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function textOf(cellHtml: string): string {
  return decodeEntities(cellHtml.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// === /new-music/ parser =====================================================
function parseNewReleases(html: string): ChartEntry[] {
  const entries: ChartEntry[] = [];
  const seen = new Set<string>();

  const itemRe =
    /<div[^>]*class="[^"]*\bnewreleases_itembox\b[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*\bnewreleases_itembox\b|<\/main>|<\/body>)/g;
  // Title anchor — "album newreleases_item_title" in either class-order.
  const albumRe =
    /<a[^>]*class="[^"]*\b(?:album\s+newreleases_item_title|newreleases_item_title\s+album)\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i;
  // Artist anchor wrapped in .newreleases_item_artist so we don't grab
  // incidental .artist links elsewhere in the block.
  const artistWrapRe =
    /<span[^>]*class="[^"]*\bnewreleases_item_artist\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i;
  const artistAnchorRe =
    /<a[^>]*class="[^"]*\bartist\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i;

  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(html)) !== null) {
    const block = m[1] ?? "";
    const al = block.match(albumRe);
    if (!al?.[1]) continue;
    const wrap = block.match(artistWrapRe);
    if (!wrap?.[1]) continue;
    const ar = wrap[1].match(artistAnchorRe);
    if (!ar?.[1]) continue;

    const title = textOf(al[1]);
    const artist = textOf(ar[1]);
    if (!artist || !title) continue;
    const k = `${artist.toLowerCase()}|${title.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    entries.push({ artist, title });
  }
  return entries;
}

// === /charts/top/album/... parser ===========================================
function parseChartItems(html: string): ChartEntry[] {
  const entries: ChartEntry[] = [];
  const seen = new Set<string>();

  const itemRe =
    /<div[^>]*class="[^"]*\bpage_charts_section_charts_item_info\b[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*\bpage_charts_section_charts_item_info\b|<\/main>|<\/body>)/g;
  const albumRe =
    /<a[^>]*class="[^"]*\bpage_charts_section_charts_item_link\s+release\b[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*\bui_name_locale_original\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i;
  const artistRe =
    /<a[^>]*class="[^"]*\bartist\b[^"]*"[^>]*href="\/artist\/[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*\bui_name_locale_original\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i;
  const typeRe =
    /<span[^>]*class="[^"]*\bpage_charts_section_charts_item_release_type\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i;

  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(html)) !== null) {
    const block = m[1] ?? "";

    // Skip non-album release types (Single, Mixtape, Compilation) so
    // Discover suggestions stay album-focused. Default to Album when
    // the type element is absent (some chart variants omit it).
    const t = block.match(typeRe);
    const releaseType = t?.[1] ? textOf(t[1]).toLowerCase() : "album";
    if (releaseType && !["album", "ep"].includes(releaseType)) continue;

    const al = block.match(albumRe);
    const ar = block.match(artistRe);
    if (!al?.[1] || !ar?.[1]) continue;

    const title = textOf(al[1]);
    const artist = textOf(ar[1]);
    if (!artist || !title) continue;
    const k = `${artist.toLowerCase()}|${title.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    entries.push({ artist, title });
  }
  return entries;
}

// Wire the parsers into the endpoint table (declared above the parsers
// so the constant is hoistable, but the functions need to exist before
// reference).
ENDPOINTS[0]!.parser = parseNewReleases;
ENDPOINTS[1]!.parser = parseChartItems;
ENDPOINTS[2]!.parser = parseChartItems;

function looksLikeChallenge(html: string): boolean {
  const sniff = html.slice(0, 4000).toLowerCase();
  return (
    sniff.includes("cf-challenge") ||
    sniff.includes("just a moment") ||
    sniff.includes("checking your browser") ||
    sniff.includes("attention required! | cloudflare")
  );
}

async function fetchOne(url: string): Promise<string | null> {
  if (flaresolverrConfigured()) {
    const via = await fetchViaFlareSolverr(url, "rym/flaresolverr");
    if (via) return via;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS, signal: ctrl.signal });
    if (!res.ok) {
      console.warn(`[rym] ${url} returned HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.warn(`[rym] ${url} fetch failed`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAllEndpoints(): Promise<RawSeed[]> {
  const seeds: RawSeed[] = [];
  // Global dedupe across all three RYM endpoints — an album in /new-music/
  // that also charts in /this-year/ should only contribute one seed.
  const seen = new Set<string>();

  for (const ep of ENDPOINTS) {
    const html = await fetchOne(ep.url);
    if (!html) continue;
    if (looksLikeChallenge(html)) {
      console.warn(
        `[rym] ${ep.url} → cloudflare-challenge. ` +
        (flaresolverrConfigured()
          ? "FlareSolverr couldn't solve it."
          : "Configure flaresolverr_url in Settings."),
      );
      continue;
    }
    const entries = ep.parser(html);
    if (entries.length === 0) {
      console.warn(
        `[rym] ${ep.url} → no-matches (${html.length} bytes). ` +
        `Markup may have changed. First 2000 chars of body:\n` +
        htmlPreview(html),
      );
      continue;
    }
    let added = 0;
    for (const e of entries) {
      const k = `${e.artist.toLowerCase()}|${e.title.toLowerCase()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      seeds.push({
        source: "rym",
        artist: e.artist,
        title: e.title,
        release_mbid: null,
        artist_mbid: null,
        mode: "album",
        score: ep.score,
        reason: ep.reason,
      });
      added += 1;
    }
    console.log(`[rym] ${ep.url} → ${added} new (${entries.length - added} dupe within RYM)`);
  }

  return seeds;
}

export const rymSource: Source = {
  id: "rym",
  label: "RateYourMusic",
  async fetchSeeds(): Promise<RawSeed[]> {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      return cache.seeds;
    }
    const seeds = await fetchAllEndpoints();
    cache = { fetchedAt: Date.now(), seeds };
    console.log(`[rym] cached ${seeds.length} seeds for 24h (across ${ENDPOINTS.length} endpoints)`);
    return seeds;
  },
};
