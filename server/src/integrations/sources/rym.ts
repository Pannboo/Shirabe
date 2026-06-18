import type { RawSeed, Source } from "./index.js";
import { fetchViaFlareSolverr, flaresolverrConfigured } from "../flaresolverr.js";
import { htmlPreview } from "./rssHelpers.js";

// ============================================================================
// RateYourMusic scraper
// ============================================================================
//
// RYM has no public API and their ToS prohibits scraping. Implemented per
// the user's explicit decision to scrape anyway; tradeoffs documented in
// the README.
//
// The /new-music/ page is RYM's curated "recent releases" view — high
// signal for Discover (current popular albums sorted by rating) and uses
// the same .page_charts_section_charts_item_info markup as the rest of
// RYM's charts framework.
//
// Cloudflare blocks raw fetches from most server IPs. FlareSolverr is
// essentially required — without it this source returns 0. The fallback
// chain still attempts direct fetch in case CF happens to let through.
//
// /new-music/ uses a different markup family than RYM's /charts/ pages.
// Confirmed against the actual response via the scraper-debug endpoint:
//
//   <div class="newreleases_itembox excl_item release_<ID> artist_<ID> ...">
//     <div class="newreleases_item_artbox">
//       <a href="/release/album/<artist>/<title>/" title="<Title>">
//         <img class="newreleases_item_art" src="...">
//       </a>
//     </div>
//     <div class="newreleases_item_..."> (varies)
//       <a href="/release/album/..." class="album newreleases_item_title"
//          title="[Album<ID>]">Inferno</a>
//       <span class="newreleases_item_artist">
//         <a href="/artist/..." class="artist">Boards of Canada</a>
//       </span>
//       <div class="newreleases_item_releasedate">29 May 2026</div>
//     </div>
//     ...
//   </div>
//
// ============================================================================

const CHART_URL = "https://rateyourmusic.com/new-music/";
const SCORE = 0.7;

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

// Strip nested tags, decode entities, collapse whitespace. Used on the
// inner contents of each ui_name_locale_original span which sometimes
// wrap the text in extra inline elements for locale variants.
function textOf(cellHtml: string): string {
  return decodeEntities(cellHtml.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// Parses RYM's /new-music/ markup. Each release sits inside a
// .newreleases_itembox container. We split on those containers via
// lookahead (regex doesn't bracket-match nested divs), then pull the
// title from the .album.newreleases_item_title anchor and the artist
// from the .artist anchor inside the .newreleases_item_artist span.
function parseChartItems(html: string): ChartEntry[] {
  const entries: ChartEntry[] = [];
  const seen = new Set<string>();

  // Each itembox runs until the next itembox or end-of-body. Lookahead
  // avoids the bracket-matching problem entirely.
  const itemRe =
    /<div[^>]*class="[^"]*\bnewreleases_itembox\b[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*\bnewreleases_itembox\b|<\/main>|<\/body>)/g;

  // Album title — anchor carrying both "album" and "newreleases_item_title"
  // classes (order can vary).
  const albumRe =
    /<a[^>]*class="[^"]*\b(?:album\s+newreleases_item_title|newreleases_item_title\s+album)\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i;

  // Artist — the .artist anchor is wrapped in a .newreleases_item_artist
  // span. We match the wrapping span so we don't pick up incidental .artist
  // links elsewhere on the page (sidebar, recommendations, etc).
  const artistWrapRe =
    /<span[^>]*class="[^"]*\bnewreleases_item_artist\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i;
  const artistAnchorRe =
    /<a[^>]*class="[^"]*\bartist\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i;

  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(html)) !== null) {
    const block = m[1] ?? "";

    const albumMatch = block.match(albumRe);
    if (!albumMatch?.[1]) continue;

    const artistWrapMatch = block.match(artistWrapRe);
    if (!artistWrapMatch?.[1]) continue;
    const artistAnchorMatch = artistWrapMatch[1].match(artistAnchorRe);
    if (!artistAnchorMatch?.[1]) continue;

    const title = textOf(albumMatch[1]);
    const artist = textOf(artistAnchorMatch[1]);
    if (!artist || !title) continue;

    // Dedupe — the /new-music/ page sometimes shows the same release in
    // multiple sections (today/this week/featured).
    const k = `${artist.toLowerCase()}|${title.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);

    entries.push({ artist, title });
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
    html = await fetchViaFlareSolverr(CHART_URL, "rym/flaresolverr");
  }

  if (!html) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(CHART_URL, { headers: BROWSER_HEADERS, signal: ctrl.signal });
      if (!res.ok) {
        console.warn(`[rym] ${CHART_URL} returned HTTP ${res.status}`);
        return [];
      }
      html = await res.text();
    } catch (err) {
      console.warn(`[rym] fetch failed`, err instanceof Error ? err.message : err);
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  if (looksLikeChallenge(html)) {
    console.warn(
      "[rym] cloudflare-challenge — RYM blocked the request. " +
      (flaresolverrConfigured()
        ? "FlareSolverr is configured but couldn't solve the challenge."
        : "Set flaresolverr_url in Settings — RYM almost always needs the proxy."),
    );
    return [];
  }

  const entries = parseChartItems(html);
  if (entries.length === 0) {
    console.warn(
      `[rym] no-matches — fetched ${html.length} bytes from ${CHART_URL} ` +
      `but parsed 0 chart items. RYM may have changed their markup. ` +
      `First 2000 chars of <body> (scripts/styles stripped) for diagnosis:\n` +
      htmlPreview(html),
    );
    return [];
  }

  return entries.slice(0, 30).map<RawSeed>((e) => ({
    source: "rym",
    artist: e.artist,
    title: e.title,
    release_mbid: null,
    artist_mbid: null,
    mode: "album",
    score: SCORE,
    reason: "New music on RateYourMusic",
  }));
}

export const rymSource: Source = {
  id: "rym",
  label: "RateYourMusic",
  async fetchSeeds(): Promise<RawSeed[]> {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      return cache.seeds;
    }
    const seeds = await fetchChart();
    cache = { fetchedAt: Date.now(), seeds };
    console.log(`[rym] cached ${seeds.length} seeds for 24h`);
    return seeds;
  },
};
