import { getAllSettings } from "../db/queries/settings.js";

const BASE = "https://api.listenbrainz.org/1";

interface LbRecommendation {
  recording_mbid?: string;
  artist_mbids?: string[];
  caa_release_mbid?: string;
}

interface LbRecommendations {
  payload?: {
    recommendations?: { recordings?: LbRecommendation[] };
  };
}

interface LbLookup {
  artist_credit_name?: string;
  recording_name?: string;
  release_name?: string;
  release_mbid?: string;
  artist_mbids?: string[];
}

async function lbGet<T>(path: string, token?: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Token ${token}` } : {}),
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface ListenBrainzSeed {
  artist: string;
  title: string;
  release_mbid: string | null;
  artist_mbid: string | null;
  mode: "album" | "track";
}

export async function fetchListenBrainzSuggestions(): Promise<ListenBrainzSeed[]> {
  const settings = getAllSettings();
  if (!settings.listenbrainz_username || !settings.listenbrainz_token) return [];

  const recs = await lbGet<LbRecommendations>(
    `/cf/recommendation/user/${encodeURIComponent(settings.listenbrainz_username)}/recording?count=20`,
    settings.listenbrainz_token,
  );

  const recordings = recs?.payload?.recommendations?.recordings ?? [];
  const seeds: ListenBrainzSeed[] = [];

  for (const r of recordings.slice(0, 10)) {
    if (!r.recording_mbid) continue;
    const lookup = await lbGet<LbLookup>(
      `/metadata/recording/?recording_mbids=${r.recording_mbid}`,
    );
    if (!lookup?.artist_credit_name || !lookup.recording_name) continue;
    seeds.push({
      artist: lookup.artist_credit_name,
      title: lookup.release_name ?? lookup.recording_name,
      release_mbid: lookup.release_mbid ?? null,
      artist_mbid: lookup.artist_mbids?.[0] ?? null,
      mode: lookup.release_name ? "album" : "track",
    });
  }

  return seeds;
}

// LB metadata endpoints — used as a fallback when MusicBrainz / Cover Art
// Archive can't resolve cover art or artist images for a given pair.

interface LbReleaseMetadata {
  artist?: { name?: string };
  release?: { caa_release_mbid?: string; mbid?: string; name?: string; year?: number };
}

// Resolve an album cover via ListenBrainz's release-group lookup. Returns a
// CAA URL when available.
export async function getLbAlbumCover(artist: string, album: string): Promise<string | null> {
  const params = new URLSearchParams({
    artist_name: artist,
    release_name: album,
  });
  const data = await lbGet<LbReleaseMetadata>(`/metadata/lookup/?${params.toString()}`);
  const caaId = data?.release?.caa_release_mbid ?? data?.release?.mbid;
  if (!caaId) return null;
  return `https://archive.org/download/mbid-${caaId}/mbid-${caaId}-front-500.jpg`;
}

interface LbArtistMetadata {
  // The /metadata/artist response is keyed by artist mbid.
  [mbid: string]: {
    artist?: { name?: string; type?: string; country?: string };
    tag?: unknown;
    wikipedia?: { extract?: string };
  };
}

// Resolve an artist image via ListenBrainz's artist metadata (keyed by MBID).
// LB doesn't host artist images directly, but Wikidata/Wikimedia images are
// linked via the artist's tags — this is a best-effort.
export async function getLbArtistImageByMbid(artistMbid: string): Promise<string | null> {
  const data = await lbGet<LbArtistMetadata>(
    `/metadata/artist/?artist_mbids=${artistMbid}&inc=image`,
  );
  const entry = data?.[artistMbid];
  if (!entry) return null;
  // Some LB deployments include `image` on the artist object.
  const img = (entry.artist as { image?: string } | undefined)?.image;
  return typeof img === "string" && img.length > 0 ? img : null;
}

// === History import =======================================================
//
// Paginates /user/{username}/listens by max_ts cursor. LB returns up to
// 1000 listens per page and uses descending timestamp order, so we walk
// backwards via max_ts until the API returns an empty page or a row
// older than `min_ts` (when supplied).

interface LbListen {
  listened_at: number;
  track_metadata: {
    artist_name: string;
    track_name: string;
    release_name?: string;
  };
}

interface LbListensResponse {
  payload?: {
    count?: number;
    listens?: LbListen[];
  };
}

export interface LbHistoryPage {
  rows: { artist: string; track: string; album: string | null; timestamp: number }[];
  oldest_ts: number | null;
}

export async function fetchListenBrainzHistoryPage(
  username: string,
  maxTs: number | null,
  count = 1000,
): Promise<LbHistoryPage | null> {
  const params = new URLSearchParams({ count: String(count) });
  if (maxTs !== null) params.set("max_ts", String(maxTs));
  const data = await lbGet<LbListensResponse>(
    `/user/${encodeURIComponent(username)}/listens?${params.toString()}`,
  );
  if (!data?.payload) return null;
  const listens = data.payload.listens ?? [];
  const rows = listens.map((l) => ({
    artist: l.track_metadata.artist_name,
    track: l.track_metadata.track_name,
    album: l.track_metadata.release_name ?? null,
    timestamp: l.listened_at,
  }));
  const oldest = rows.length > 0 ? Math.min(...rows.map((r) => r.timestamp)) : null;
  return { rows, oldest_ts: oldest };
}

export async function validateListenBrainzToken(token: string): Promise<{ valid: boolean; user_name?: string }> {
  if (!token) return { valid: false };
  try {
    const res = await fetch(`${BASE}/validate-token`, {
      headers: { Authorization: `Token ${token}` },
    });
    if (!res.ok) return { valid: false };
    const data = (await res.json()) as { valid?: boolean; user_name?: string };
    return { valid: !!data.valid, user_name: data.user_name };
  } catch {
    return { valid: false };
  }
}

export async function relayToListenBrainz(
  scrobble: { artist: string; track: string; album: string | null; timestamp: number },
  token: string,
): Promise<boolean> {
  if (!token) return false;
  const body = {
    listen_type: "single",
    payload: [
      {
        listened_at: scrobble.timestamp,
        track_metadata: {
          artist_name: scrobble.artist,
          track_name: scrobble.track,
          release_name: scrobble.album ?? undefined,
        },
      },
    ],
  };
  try {
    const res = await fetch(`${BASE}/submit-listens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${token}`,
      },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}
