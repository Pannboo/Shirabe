import {
  enqueueArtistLinks,
  getCachedArtistLinks,
  listPendingArtistLinks,
  setArtistLinks,
  type ArtistLink,
} from "../db/queries/artistLinks.js";
import { getArtistRelations, type MbArtistRelation } from "../integrations/musicbrainz.js";

// Same lazy pattern as getOrEnqueueCoverArt — return cached if resolved,
// otherwise enqueue and return null so the UI can render its empty state.
export function getOrEnqueueArtistLinks(mbArtistId: string | null | undefined): ArtistLink[] | null {
  if (!mbArtistId) return null;
  const cached = getCachedArtistLinks(mbArtistId);
  if (cached) return cached;
  enqueueArtistLinks(mbArtistId);
  return null;
}

// === Branding / categorisation =============================================
//
// MB's `type` field gives us a coarse category ("official homepage", "social
// network", "streaming music", "lyrics", etc) but most of the interesting
// breakdown — Spotify vs Apple Music vs Deezer — lives in the URL host.
// We sniff the URL to pick a brand + label + sort category.

type Brand =
  | "spotify" | "apple-music" | "deezer" | "tidal" | "bandcamp"
  | "youtube" | "youtube-music" | "soundcloud"
  | "discogs" | "wikipedia" | "wikidata" | "lastfm" | "genius" | "allmusic"
  | "twitter" | "instagram" | "facebook" | "tiktok"
  | "homepage" | "other";

interface BrandSpec {
  brand: Brand;
  label: string;
  // Lower category number sorts higher on the panel.
  category: number;
}

// Order: homepage → streaming → social → reference → other.
const CATEGORY = { HOMEPAGE: 0, STREAMING: 1, SOCIAL: 2, REFERENCE: 3, OTHER: 4 };

function brandFor(rel: MbArtistRelation): BrandSpec | null {
  const url = rel.url.toLowerCase();
  const host = (() => { try { return new URL(rel.url).hostname.toLowerCase(); } catch { return ""; } })();
  if (!host) return null;

  // Streaming
  if (host.includes("open.spotify.com")) return { brand: "spotify", label: "Spotify", category: CATEGORY.STREAMING };
  if (host.includes("music.apple.com")) return { brand: "apple-music", label: "Apple Music", category: CATEGORY.STREAMING };
  if (host.includes("deezer.com")) return { brand: "deezer", label: "Deezer", category: CATEGORY.STREAMING };
  if (host.includes("tidal.com")) return { brand: "tidal", label: "Tidal", category: CATEGORY.STREAMING };
  if (host.includes("bandcamp.com")) return { brand: "bandcamp", label: "Bandcamp", category: CATEGORY.STREAMING };
  if (host === "music.youtube.com") return { brand: "youtube-music", label: "YouTube Music", category: CATEGORY.STREAMING };
  if (host === "soundcloud.com" || host.endsWith(".soundcloud.com")) return { brand: "soundcloud", label: "SoundCloud", category: CATEGORY.STREAMING };

  // Social
  if (host === "youtube.com" || host === "www.youtube.com" || host === "youtu.be") return { brand: "youtube", label: "YouTube", category: CATEGORY.SOCIAL };
  if (host === "twitter.com" || host === "www.twitter.com" || host === "x.com" || host === "www.x.com") return { brand: "twitter", label: "Twitter / X", category: CATEGORY.SOCIAL };
  if (host === "instagram.com" || host === "www.instagram.com") return { brand: "instagram", label: "Instagram", category: CATEGORY.SOCIAL };
  if (host === "facebook.com" || host === "www.facebook.com") return { brand: "facebook", label: "Facebook", category: CATEGORY.SOCIAL };
  if (host === "tiktok.com" || host === "www.tiktok.com") return { brand: "tiktok", label: "TikTok", category: CATEGORY.SOCIAL };

  // Reference / databases
  if (host.includes("discogs.com")) return { brand: "discogs", label: "Discogs", category: CATEGORY.REFERENCE };
  if (host.endsWith("wikipedia.org")) return { brand: "wikipedia", label: "Wikipedia", category: CATEGORY.REFERENCE };
  if (host.endsWith("wikidata.org")) return { brand: "wikidata", label: "Wikidata", category: CATEGORY.REFERENCE };
  if (host === "last.fm" || host === "www.last.fm") return { brand: "lastfm", label: "Last.fm", category: CATEGORY.REFERENCE };
  if (host.includes("genius.com")) return { brand: "genius", label: "Genius", category: CATEGORY.REFERENCE };
  if (host.includes("allmusic.com")) return { brand: "allmusic", label: "AllMusic", category: CATEGORY.REFERENCE };

  // Official homepage by MB relationship type (URL itself can be any domain).
  if (rel.type === "official homepage") return { brand: "homepage", label: "Official homepage", category: CATEGORY.HOMEPAGE };

  // Skip catch-all: VIAF, ISNI, IMDb credit-only, blog hubs, fan sites etc
  // are typically MB types like "VIAF", "ISNI", "blog", "fanpage". Returning
  // null filters them out.
  return null;
}

// Dedupe by brand, then by URL. MB stores region-specific entries
// separately (US/JP/global Apple Music, multiple Tidal stores, etc.) so a
// raw URL-dedupe leaves three Apple Music rows in the panel. Brand-dedupe
// collapses those to one — we keep the first occurrence which, because the
// caller has already sorted by category + label, is the canonical entry for
// that brand.
function dedupe(links: ArtistLink[]): ArtistLink[] {
  const seenBrand = new Set<string>();
  const seenUrl = new Set<string>();
  const out: ArtistLink[] = [];
  for (const l of links) {
    if (seenBrand.has(l.brand)) continue;
    if (seenUrl.has(l.url)) continue;
    seenBrand.add(l.brand);
    seenUrl.add(l.url);
    out.push(l);
  }
  return out;
}

// Batch worker. One artist per tick — every MB call goes through the global
// 1 req/sec queue, and this resolver shares that budget with cover-art,
// artist-image, year-backfill, and fresh-releases. Keeping the batch tight
// avoids starving those.
export async function resolveArtistLinksBatch(): Promise<void> {
  const pending = listPendingArtistLinks(1);
  for (const { mb_artist_id } of pending) {
    const relations = await getArtistRelations(mb_artist_id);
    const branded: ArtistLink[] = [];
    let dropped = 0;
    for (const rel of relations) {
      if (rel.ended) continue; // skip defunct
      const spec = brandFor(rel);
      if (!spec) { dropped += 1; continue; }
      branded.push({ brand: spec.brand, label: spec.label, url: rel.url });
    }
    // Sort by category, then by brand label for stable ordering.
    branded.sort((a, b) => {
      const sa = brandFor({ type: "", url: a.url, ended: false })?.category ?? 99;
      const sb = brandFor({ type: "", url: b.url, ended: false })?.category ?? 99;
      if (sa !== sb) return sa - sb;
      return a.label.localeCompare(b.label);
    });
    const links = dedupe(branded);
    console.log(
      `[artist-links] ${mb_artist_id} → ${relations.length} relations → ${links.length} kept (${dropped} dropped)`,
    );
    setArtistLinks(mb_artist_id, links, links.length > 0 ? "resolved" : "missing");
  }
}
