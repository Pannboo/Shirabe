// MusicBrainz API wrapper with a 1 req/sec global queue (per MB ToS).

interface QueueItem {
  run: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

const queue: QueueItem[] = [];
let busy = false;

async function enqueue<T>(run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({
      run: run as () => Promise<unknown>,
      resolve: resolve as (v: unknown) => void,
      reject,
    });
    pump();
  });
}

async function pump(): Promise<void> {
  if (busy) return;
  const item = queue.shift();
  if (!item) return;
  busy = true;
  try {
    const result = await item.run();
    item.resolve(result);
  } catch (err) {
    item.reject(err);
  } finally {
    setTimeout(() => {
      busy = false;
      pump();
    }, 1100);
  }
}

const UA = "Shirabe/0.1 ( https://github.com/pannboo/shirabe )";
const BASE = "https://musicbrainz.org/ws/2";

async function mbFetch<T>(path: string): Promise<T | null> {
  return enqueue(async () => {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  });
}

export interface MbArtistSearch {
  artists?: Array<{ id: string; name: string; score: number }>;
}

export interface MbReleaseSearch {
  releases?: Array<{
    id: string;
    title: string;
    score: number;
    date?: string;
    "artist-credit"?: Array<{ name: string; artist?: { id: string; name: string } }>;
  }>;
}

export async function findArtist(name: string): Promise<{ id: string; name: string } | null> {
  const q = encodeURIComponent(`artist:"${name.replace(/"/g, "")}"`);
  const data = await mbFetch<MbArtistSearch>(`/artist?query=${q}&fmt=json&limit=5`);
  const top = data?.artists?.[0];
  if (!top || top.score < 85) return null;
  return { id: top.id, name: top.name };
}

export interface ResolvedRelease {
  releaseId: string;
  artistId: string | null;
  artistName: string;
  title: string;
  // MusicBrainz `date` is "YYYY", "YYYY-MM", or "YYYY-MM-DD"; we keep just
  // the year for the decade-chart aggregation.
  year: number | null;
  ambiguous: boolean;
}

export async function findRelease(
  artist: string,
  title: string,
): Promise<ResolvedRelease | null> {
  const q = encodeURIComponent(`release:"${title.replace(/"/g, "")}" AND artist:"${artist.replace(/"/g, "")}"`);
  const data = await mbFetch<MbReleaseSearch>(`/release?query=${q}&fmt=json&limit=5`);
  const releases = data?.releases ?? [];
  const top = releases[0];
  // Threshold lowered from 80 → 70 so cast recordings / compilations with
  // verbose subtitles ("Original Broadway Cast Recording") still match.
  if (!top || top.score < 70) return null;
  const second = releases[1];
  const ambiguous = !!second && Math.abs((second.score ?? 0) - top.score) < 5;
  const credit = top["artist-credit"]?.[0];
  const yearMatch = top.date?.match(/^(\d{4})/);
  const year = yearMatch?.[1] ? Number(yearMatch[1]) : null;
  return {
    releaseId: top.id,
    artistId: credit?.artist?.id ?? null,
    artistName: credit?.artist?.name ?? credit?.name ?? artist,
    title: top.title,
    year: Number.isFinite(year) ? year : null,
    ambiguous,
  };
}

export interface MbArtistInfo {
  id: string;
  name: string;
  type?: string;
}

export interface MbReleaseGroup {
  id: string;
  title: string;
  primaryType: string | null;
  firstReleaseDate: string | null;
}

interface MbReleaseGroupBrowse {
  "release-groups"?: Array<{
    id: string;
    title: string;
    "primary-type"?: string | null;
    "first-release-date"?: string | null;
  }>;
}

// Browse the release-groups for a given artist MBID. Used by the
// MusicBrainz fresh-releases Discover source to surface new albums from
// artists the user already plays. release-groups are preferred over raw
// releases so we don't surface every reissue/format variant separately.
export async function browseReleaseGroupsForArtist(
  artistMbid: string,
  limit = 25,
): Promise<MbReleaseGroup[]> {
  const data = await mbFetch<MbReleaseGroupBrowse>(
    `/release-group?artist=${encodeURIComponent(artistMbid)}&type=album|ep&limit=${limit}&fmt=json`,
  );
  const rgs = data?.["release-groups"] ?? [];
  return rgs.map((r) => ({
    id: r.id,
    title: r.title,
    primaryType: r["primary-type"] ?? null,
    firstReleaseDate: r["first-release-date"] ?? null,
  }));
}

export interface MbReleaseSearchResult {
  releaseId: string;
  title: string;
  artistName: string;
  artistId: string | null;
  date: string | null;
  year: number | null;
  score: number;
}

// Free-text release search via MusicBrainz. Used by the Discover search box
// to complement Last.fm album.search with MB-verified results.
export async function searchReleases(query: string, limit = 12): Promise<MbReleaseSearchResult[]> {
  const q = encodeURIComponent(query.replace(/"/g, ""));
  const data = await mbFetch<MbReleaseSearch>(`/release?query=${q}&fmt=json&limit=${limit}`);
  const releases = data?.releases ?? [];
  return releases
    .filter((r) => r.score >= 60)
    .map((r) => {
      const credit = r["artist-credit"]?.[0];
      const yearMatch = r.date?.match(/^(\d{4})/);
      const year = yearMatch?.[1] ? Number(yearMatch[1]) : null;
      return {
        releaseId: r.id,
        title: r.title,
        artistName: credit?.artist?.name ?? credit?.name ?? "Unknown",
        artistId: credit?.artist?.id ?? null,
        date: r.date ?? null,
        year: Number.isFinite(year) ? year : null,
        score: r.score,
      };
    });
}

interface MbReleaseLookup {
  id: string;
  title: string;
  date?: string;
  media?: Array<{
    tracks?: Array<{
      title: string;
      length?: number; // milliseconds
      position?: number;
    }>;
  }>;
}

export interface MbTrack {
  position: number;
  title: string;
  duration_seconds: number | null;
}

// Look up a release's full track listing (across all media/discs).
export async function getReleaseTracks(releaseId: string): Promise<MbTrack[]> {
  const data = await mbFetch<MbReleaseLookup>(`/release/${encodeURIComponent(releaseId)}?fmt=json&inc=recordings`);
  if (!data?.media) return [];
  const tracks: MbTrack[] = [];
  let position = 1;
  for (const medium of data.media) {
    for (const t of medium.tracks ?? []) {
      tracks.push({
        position: t.position ?? position,
        title: t.title,
        duration_seconds: t.length ? Math.round(t.length / 1000) : null,
      });
      position += 1;
    }
  }
  return tracks;
}

interface MbArtistWithRelations {
  id: string;
  name: string;
  relations?: Array<{
    type: string;
    "target-type"?: string;
    url?: { resource: string };
    ended?: boolean;
  }>;
}

export interface MbArtistRelation {
  type: string;            // raw MB relationship type ("official homepage", "social network", "discogs", ...)
  url: string;
  ended: boolean;          // true for defunct accounts / archived pages
}

// Browse an artist's URL relationships (homepage, socials, streaming,
// Wikipedia, Discogs, etc). Powers the "External" panel on the artist page.
// Returns raw MB relations — caller decides which to surface and how to
// categorise them by URL pattern.
export async function getArtistRelations(artistMbid: string): Promise<MbArtistRelation[]> {
  const data = await mbFetch<MbArtistWithRelations>(
    `/artist/${encodeURIComponent(artistMbid)}?inc=url-rels&fmt=json`,
  );
  if (!data?.relations) return [];
  const out: MbArtistRelation[] = [];
  for (const r of data.relations) {
    if (r["target-type"] !== "url") continue;
    if (!r.url?.resource) continue;
    out.push({
      type: r.type,
      url: r.url.resource,
      ended: !!r.ended,
    });
  }
  return out;
}

// Looks up an artist by name. Used by the artist-image resolver as a
// stepping stone to ListenBrainz / Cover Art Archive artist metadata.
export async function findArtistInfo(name: string): Promise<MbArtistInfo | null> {
  const q = encodeURIComponent(`artist:"${name.replace(/"/g, "")}"`);
  const data = await mbFetch<MbArtistSearch & { artists?: Array<{ id: string; name: string; score: number; type?: string }> }>(
    `/artist?query=${q}&fmt=json&limit=3`,
  );
  const top = data?.artists?.[0];
  if (!top || top.score < 80) return null;
  return { id: top.id, name: top.name, type: (top as { type?: string }).type };
}
