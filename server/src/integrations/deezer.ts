// Deezer public search API — used as the primary artist-image source after
// Last.fm fully removed real artist images from their API in 2022. Deezer
// has wide coverage (including J-Pop / cast recordings / niche artists) and
// requires no auth or rate-limit token.

const BASE = "https://api.deezer.com";

interface DeezerArtist {
  id: number;
  name: string;
  picture: string;
  picture_small: string;
  picture_medium: string;
  picture_big: string;
  picture_xl: string;
}

interface DeezerArtistSearch {
  data?: DeezerArtist[];
}

// Deezer serves a generic placeholder when an artist has no real picture.
// The placeholder URLs contain "images/artist//" (note the double slash
// where the artist-image id would normally sit) — that's the identifier we
// reject so we don't cache a useless silhouette.
const PLACEHOLDER_RE = /images\/artist\/\//;

export async function getDeezerArtistImage(artist: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const url = `${BASE}/search/artist?q=${encodeURIComponent(artist)}&limit=1`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as DeezerArtistSearch;
    const top = data.data?.[0];
    if (!top) return null;
    const picked = top.picture_xl || top.picture_big || top.picture_medium || top.picture;
    if (!picked) return null;
    if (PLACEHOLDER_RE.test(picked)) return null;
    return picked;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
