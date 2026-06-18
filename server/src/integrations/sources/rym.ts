import type { RawSeed, Source } from "./index.js";
import { fetchViaFlareSolverr, flaresolverrConfigured } from "../flaresolverr.js";
import { htmlPreview } from "./rssHelpers.js";

// ============================================================================
// RateYourMusic scraper
// ============================================================================
//
// RYM (Sonemic) has no public API and their ToS prohibits automated access.
// The user explicitly chose to scrape anyway, accepting the tradeoffs:
//
//   - RYM sits behind Cloudflare. Most server-side fetches hit a JS challenge
//     page and get 0 results. There's nothing to do about this short of a
//     headless-browser setup (puppeteer/playwright), which is too heavy for
//     this project.
//   - Even when the fetch succeeds, RYM's HTML structure changes
//     occasionally. The parser uses defensive regex with multiple fall-back
//     patterns; when none match we log and return [] instead of throwing.
//   - We cache the response for 24 hours in-memory so multiple
//     pullSuggestions runs in a day don't hammer the site.
//   - User-Agent + Accept headers mimic a real browser. Doesn't bypass
//     Cloudflare's JS challenge but reduces friction with simpler rate
//     limits.
//
// Implementation notes:
//   - Pulls one chart page per refresh (top albums of the current year).
//   - Parses album/artist pairs from chart-entry blocks.
//   - Flagged as "rym" source; UI shows "RateYourMusic" label.
//
// If you see [rym] cloudflare-challenge or [rym] no-matches in the logs and
// want this working reliably, the realistic options are:
//   (a) front it with a residential proxy that solves the JS challenge
//   (b) replace the fetch with a headless browser library
//   (c) accept that this source contributes intermittently and move on
//
// ============================================================================

const CHART_URL = (() => {
  const year = new Date().getUTCFullYear();
  return `https://rateyourmusic.com/charts/top/album/year/${year}/`;
})();

const SCORE = 0.6;

// 24-hour in-memory cache. RYM chart rankings barely shift inside a day and
// avoiding repeated requests is the most polite thing we can do.
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
  // No Referer — RYM gates some pages on Referer-from-RYM; we don't want to
  // fake an internal navigation pattern, just look like a direct visit.
};

interface ChartEntry {
  artist: string;
  title: string;
}

// RYM chart entries usually render like:
//   <a class="artist" ...>Artist Name</a>
//   <a class="album" ...>Album Title</a>
// inside <div class="chart_item"> or similar. Their HTML changes more often
// than most sites, so we try several anchor-class patterns and fall back to
// generic /artist/... and /release/... link extraction.
function parseChart(html: string): ChartEntry[] {
  const entries: ChartEntry[] = [];

  // Primary pattern — artist+album anchors paired in chart-item blocks.
  const blockRe = /<div[^>]*class="[^"]*chart_item[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  const artistRe = /<a[^>]*class="[^"]*artist[^"]*"[^>]*>([^<]+)<\/a>/;
  const albumRe = /<a[^>]*class="[^"]*album[^"]*"[^>]*>([^<]+)<\/a>/;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null) {
    const block = m[1];
    if (!block) continue;
    const a = block.match(artistRe);
    const al = block.match(albumRe);
    if (a?.[1] && al?.[1]) {
      entries.push({ artist: decode(a[1]), title: decode(al[1]) });
    }
  }
  if (entries.length > 0) return entries;

  // Fallback pattern — paired /artist/ and /release/ anchors near each other.
  // Scrapes anchors in order, pairs an artist anchor with the next album
  // anchor that follows it (within a reasonable window).
  const anchors = [...html.matchAll(/<a[^>]*href="(\/(?:artist|release)\/[^"]+)"[^>]*>([^<]+)<\/a>/g)];
  let pendingArtist: string | null = null;
  for (const a of anchors) {
    const href = a[1] ?? "";
    const text = decode(a[2] ?? "");
    if (href.startsWith("/artist/")) {
      pendingArtist = text;
    } else if (href.startsWith("/release/") && pendingArtist) {
      entries.push({ artist: pendingArtist, title: text });
      pendingArtist = null;
    }
  }
  return entries;
}

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
    .trim();
}

function looksLikeChallenge(html: string): boolean {
  // Cloudflare challenge pages contain a few telltale strings. If we see any,
  // bail with a clear log rather than wasting cycles parsing.
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

  // Prefer FlareSolverr when configured — RYM is the textbook case for it.
  if (flaresolverrConfigured()) {
    html = await fetchViaFlareSolverr(CHART_URL, "rym/flaresolverr");
  }

  // Direct fetch as fallback (or primary when no FlareSolverr).
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
      "[rym] cloudflare-challenge — RYM is blocking the request. " +
      (flaresolverrConfigured()
        ? "FlareSolverr is configured but the response still looks like a challenge page."
        : "Set flaresolverr_url in Settings to route fetches through a browser-resolver."),
    );
    return [];
  }

  const entries = parseChart(html);
  if (entries.length === 0) {
    console.warn(
      `[rym] no-matches — fetched ${html.length} bytes from RYM but parsed 0 album entries. ` +
      `HTML structure may have changed. First 500 chars after <body> for diagnosis:\n` +
      htmlPreview(html),
    );
    return [];
  }

  return entries.slice(0, 25).map<RawSeed>((e) => ({
    source: "rym",
    artist: e.artist,
    title: e.title,
    release_mbid: null,
    artist_mbid: null,
    mode: "album",
    score: SCORE,
    reason: "Top of the year on RateYourMusic",
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
    // Cache even an empty result so a Cloudflare block doesn't trigger a
    // retry every time pullSuggestions runs. 24 hours is plenty for chart
    // data.
    cache = { fetchedAt: Date.now(), seeds };
    console.log(`[rym] cached ${seeds.length} seeds for 24h`);
    return seeds;
  },
};
