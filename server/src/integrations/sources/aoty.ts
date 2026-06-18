import type { RawSeed, Source } from "./index.js";
import { fetchViaFlareSolverr, flaresolverrConfigured } from "../flaresolverr.js";
import { htmlPreview } from "./rssHelpers.js";

// ============================================================================
// AlbumOfTheYear scraper
// ============================================================================
//
// AOTY has no public API. The popular Python library
// (https://pypi.org/project/album-of-the-year-api/) is a scraper; we follow
// the same pattern in TypeScript so we don't drag a Python runtime into the
// container just for this.
//
// AOTY is behind Cloudflare but historically less aggressive than RYM —
// straight server-side fetches with real browser headers tend to succeed.
// Same defensive shape as sources/rym.ts:
//   - 24h in-memory cache so multiple pullSuggestions don't re-hit
//   - Browser-style headers (UA + Accept)
//   - AbortController + 15s timeout
//   - Cloudflare challenge detection → bail with a clear log
//   - Multiple parser patterns with fallback; log when none match
//
// Source URL: critic-highest-rated for the current year. The user-rated
// equivalent skews toward consensus picks; critic-rated is more aligned
// with the editorial taste of Pitchfork BNM / Stereogum AOTW that we
// already surface, so it complements rather than duplicates.
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

interface ChartEntry { artist: string; title: string }

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<[^>]+>/g, "") // strip any nested anchors / spans inside the title cells
    .trim();
}

// AOTY rows look roughly like:
//   <div class="albumListRow">
//     ...
//     <div class="albumListTitle">
//       <a href="/album/...">Artist Name - Album Title</a>
//     </div>
//     OR
//     <div class="albumTitle"><a ...>Title</a></div>
//     <div class="artistTitle"><a ...>Artist</a></div>
//
// We try the combined "Artist - Title" link first (current layout as of
// the last time anyone inspected), then fall back to the split fields.
function parseChart(html: string): ChartEntry[] {
  const entries: ChartEntry[] = [];

  // Pattern A — combined cell.
  const combinedRe = /<div[^>]*class="[^"]*albumListTitle[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = combinedRe.exec(html)) !== null) {
    const cell = m[1];
    if (!cell) continue;
    const text = decode(cell);
    // Most AOTY titles are "Artist - Album". Some have hyphens in either
    // half, so split on the FIRST " - " only.
    const dashIdx = text.indexOf(" - ");
    if (dashIdx > 0) {
      const artist = text.slice(0, dashIdx).trim();
      const title = text.slice(dashIdx + 3).trim();
      if (artist && title) entries.push({ artist, title });
    }
  }
  if (entries.length > 0) return entries;

  // Pattern B — split cells. Walk the document in order, pair each
  // artistTitle with the following albumTitle in the same row block.
  const blockRe = /<div[^>]*class="[^"]*albumListRow[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
  const artistRe = /<div[^>]*class="[^"]*artistTitle[^"]*"[^>]*>([\s\S]*?)<\/div>/;
  const albumRe = /<div[^>]*class="[^"]*albumTitle[^"]*"[^>]*>([\s\S]*?)<\/div>/;
  while ((m = blockRe.exec(html)) !== null) {
    const block = m[1] ?? "";
    const a = block.match(artistRe);
    const al = block.match(albumRe);
    if (a?.[1] && al?.[1]) {
      const artist = decode(a[1]);
      const title = decode(al[1]);
      if (artist && title) entries.push({ artist, title });
    }
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

  // Same FlareSolverr-then-direct fallback chain as RYM. AOTY tends to
  // succeed direct more often, but having the proxy as a first option
  // smooths over the occasional block.
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
      `HTML layout may have changed. First 500 chars after <body> for diagnosis:\n` +
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
    // Cache empty results too so a transient block doesn't trigger a retry
    // every pullSuggestions tick. 24h is plenty for chart data.
    cache = { fetchedAt: Date.now(), seeds };
    console.log(`[aoty] cached ${seeds.length} seeds for 24h`);
    return seeds;
  },
};
