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
// Selectors below are the live RYM markup as of 2026 (captured via the
// /api/settings/scraper-debug endpoint with via=flaresolverr):
//
//   <div class="page_charts_section_charts_item_info">
//     <div class="page_charts_section_charts_top_line">
//       <div class="page_charts_section_charts_top_line_title_artist">
//         <div class="page_charts_section_charts_item_title">
//           <a class="page_charts_section_charts_item_link release" href="/release/...">
//             <span class="ui_name_locale_original">Inferno</span>
//           </a>
//           <span class="page_charts_section_charts_item_release_type">Album</span>
//         </div>
//         <div class="page_charts_section_charts_item_credited_text">
//           <a class="artist" href="/artist/...">
//             <span class="ui_name_locale_original">Boards of Canada</span>
//           </a>
//         </div>
//       </div>
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

// Parses RYM chart-item markup. Each chart entry sits inside a
// .page_charts_section_charts_item_info container. We split on those
// containers, then extract the album link, artist link, and release type
// from each.
//
// The container is itself nested inside other elements with overlapping
// classes; rather than trying to bracket-match nested divs (regex pain),
// we use a lookahead split: each block ends where the next container
// begins, or at </main> / </body>.
function parseChartItems(html: string): ChartEntry[] {
  const entries: ChartEntry[] = [];
  const itemRe =
    /<div[^>]*class="[^"]*\bpage_charts_section_charts_item_info\b[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*\bpage_charts_section_charts_item_info\b|<\/main>|<\/body>)/g;

  // Album title: the link with both "page_charts_section_charts_item_link"
  // and "release" classes contains the ui_name_locale_original span with
  // the title text.
  const albumRe =
    /<a[^>]*class="[^"]*\bpage_charts_section_charts_item_link\s+release\b[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*\bui_name_locale_original\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i;

  // Artist: the link with class "artist" pointing at /artist/...
  const artistRe =
    /<a[^>]*class="[^"]*\bartist\b[^"]*"[^>]*href="\/artist\/[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*\bui_name_locale_original\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i;

  // Release type — used to filter out singles/EPs/comps so Discover
  // suggestions stay album-focused.
  const typeRe =
    /<span[^>]*class="[^"]*\bpage_charts_section_charts_item_release_type\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i;

  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(html)) !== null) {
    const block = m[1] ?? "";

    const releaseType = (() => {
      const t = block.match(typeRe);
      return t?.[1] ? textOf(t[1]) : "Album";
    })();
    // RYM exposes Album, EP, Single, Mixtape, Compilation, etc. We keep
    // Album + EP (both album-shaped for Shirabe's purposes), skip the rest.
    const ok = ["album", "ep"].includes(releaseType.toLowerCase());
    if (!ok) continue;

    const albumMatch = block.match(albumRe);
    const artistMatch = block.match(artistRe);
    if (!albumMatch?.[1] || !artistMatch?.[1]) continue;

    const title = textOf(albumMatch[1]);
    const artist = textOf(artistMatch[1]);
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
