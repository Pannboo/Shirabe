import { createHash } from "node:crypto";
import { getAllSettings, setSetting } from "../db/queries/settings.js";

const BASE = "https://ws.audioscrobbler.com/2.0/";

interface LfmSimilarArtists {
  similarartists?: { artist?: Array<{ name: string; mbid?: string }> };
}

interface LfmTopAlbums {
  topalbums?: { album?: Array<{ name: string; artist: { name: string } | string; mbid?: string }> };
}

interface LfmUserTopArtists {
  topartists?: { artist?: Array<{ name: string; mbid?: string }> };
}

async function lfmGet<T>(params: Record<string, string>): Promise<T | null> {
  const settings = getAllSettings();
  if (!settings.lastfm_api_key) return null;
  const url = new URL(BASE);
  for (const [k, v] of Object.entries({ ...params, api_key: settings.lastfm_api_key, format: "json" })) {
    url.searchParams.set(k, v);
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface SuggestionSeed {
  artist: string;
  title: string | null;
  mode: "album" | "track";
}

// Last.fm `image` arrays look like [{ "#text": "https://...", size: "small" }, ...].
// Their "mega"/"extralarge" entries are the highest resolution.
interface LfmImage { "#text"?: string; size?: string }
function pickLargestImage(images: LfmImage[] | undefined): string | null {
  if (!images || images.length === 0) return null;
  const order = ["mega", "extralarge", "large", "medium", "small"];
  for (const size of order) {
    const m = images.find((i) => i.size === size && i["#text"]);
    if (m && m["#text"]) return m["#text"]!;
  }
  return null;
}

interface LfmAlbumInfo { album?: { image?: LfmImage[] } }
interface LfmArtistSearch {
  results?: {
    artistmatches?: {
      artist?: Array<{ name: string; image?: LfmImage[] }>;
    };
  };
}

// Cover-art fallback when MusicBrainz / Cover Art Archive can't find a release.
// Particularly helpful for cast recordings, soundtracks, and compilations
// whose MB metadata is patchy.
export async function getLastFmAlbumImage(artist: string, album: string): Promise<string | null> {
  const data = await lfmGet<LfmAlbumInfo>({
    method: "album.getinfo",
    artist,
    album,
    autocorrect: "1",
  });
  return pickLargestImage(data?.album?.image);
}

interface LfmAlbumSearch {
  results?: {
    albummatches?: {
      album?: Array<{ name: string; artist: string; image?: LfmImage[]; mbid?: string }>;
    };
  };
}

export interface LfmAlbumMatch {
  name: string;
  artist: string;
  cover_art_url: string | null;
  mbid: string | null;
}

// Free-text album search via Last.fm. Powers the Discover search box.
export async function searchLastFmAlbums(query: string, limit = 12): Promise<LfmAlbumMatch[]> {
  const data = await lfmGet<LfmAlbumSearch>({
    method: "album.search",
    album: query,
    limit: String(limit),
  });
  const albums = data?.results?.albummatches?.album ?? [];
  return albums.map((a) => ({
    name: a.name,
    artist: a.artist,
    cover_art_url: pickLargestImage(a.image),
    mbid: a.mbid ?? null,
  }));
}

interface LfmAlbumGetInfo {
  album?: {
    name: string;
    artist: string;
    image?: LfmImage[];
    tracks?: { track?: Array<{ name: string; duration?: string }> };
  };
}

export interface LfmAlbumTrack {
  name: string;
  duration_seconds: number | null;
}

// Tracks fallback when the album isn't matched on MusicBrainz.
export async function getLastFmAlbumTracks(artist: string, album: string): Promise<LfmAlbumTrack[]> {
  const data = await lfmGet<LfmAlbumGetInfo>({
    method: "album.getinfo",
    artist,
    album,
    autocorrect: "1",
  });
  const tracks = data?.album?.tracks?.track ?? [];
  return tracks.map((t) => ({
    name: t.name,
    duration_seconds: t.duration ? Number(t.duration) || null : null,
  }));
}

// === History import =======================================================
//
// Paginates user.getRecentTracks across the user's full Last.fm history.
// Filters out the "now playing" track (which has no listened_at).

interface LfmRecentTrack {
  name: string;
  artist: { "#text"?: string; name?: string } | string;
  album?: { "#text"?: string };
  date?: { uts?: string };
  "@attr"?: { nowplaying?: string };
}

interface LfmRecentTracksResponse {
  recenttracks?: {
    "@attr"?: { totalPages?: string; total?: string; page?: string };
    track?: LfmRecentTrack[];
  };
}

export interface LfmHistoryPage {
  rows: { artist: string; track: string; album: string | null; timestamp: number }[];
  page: number;
  total_pages: number;
  total: number;
}

function artistName(a: LfmRecentTrack["artist"]): string {
  if (typeof a === "string") return a;
  return a["#text"] ?? a.name ?? "";
}

export async function fetchLastFmHistoryPage(
  username: string,
  page: number,
  perPage = 200,
): Promise<LfmHistoryPage | null> {
  const data = await lfmGet<LfmRecentTracksResponse>({
    method: "user.getrecenttracks",
    user: username,
    limit: String(perPage),
    page: String(page),
  });
  if (!data?.recenttracks) return null;
  const tracks = data.recenttracks.track ?? [];
  const rows: LfmHistoryPage["rows"] = [];
  for (const t of tracks) {
    if (t["@attr"]?.nowplaying === "true") continue;
    const ts = t.date?.uts ? Number(t.date.uts) : null;
    if (!ts || !Number.isFinite(ts)) continue;
    const artist = artistName(t.artist);
    if (!artist || !t.name) continue;
    rows.push({
      artist,
      track: t.name,
      album: t.album?.["#text"] || null,
      timestamp: ts,
    });
  }
  const attr = data.recenttracks["@attr"];
  return {
    rows,
    page,
    total_pages: Number(attr?.totalPages ?? page),
    total: Number(attr?.total ?? rows.length),
  };
}

// Artist image fallback. Last.fm deprecated the image arrays on
// `artist.getInfo` in 2019 — they now point at a generic star placeholder.
// But `artist.search` still returns the real artist photos in its result
// list, which is a well-known community workaround. We take the first
// (highest-relevance) match and pull the largest image off it.
export async function getLastFmArtistImage(artist: string): Promise<string | null> {
  const data = await lfmGet<LfmArtistSearch>({
    method: "artist.search",
    artist,
    limit: "1",
  });
  const top = data?.results?.artistmatches?.artist?.[0];
  const url = pickLargestImage(top?.image);
  // Filter out the well-known deprecated-placeholder URL.
  if (url && url.includes("2a96cbd8b46e442fc41c2b86b821562f")) return null;
  return url;
}

export async function fetchLastFmSuggestions(): Promise<SuggestionSeed[]> {
  const settings = getAllSettings();
  if (!settings.lastfm_api_key || !settings.lastfm_username) return [];

  const seeds: SuggestionSeed[] = [];

  const top = await lfmGet<LfmUserTopArtists>({
    method: "user.gettopartists",
    user: settings.lastfm_username,
    period: "3month",
    limit: "10",
  });

  for (const a of top?.topartists?.artist ?? []) {
    const similar = await lfmGet<LfmSimilarArtists>({
      method: "artist.getsimilar",
      artist: a.name,
      limit: "3",
    });
    for (const s of similar?.similarartists?.artist ?? []) {
      const topAlbums = await lfmGet<LfmTopAlbums>({
        method: "artist.gettopalbums",
        artist: s.name,
        limit: "1",
      });
      const alb = topAlbums?.topalbums?.album?.[0];
      if (alb) {
        seeds.push({ artist: s.name, title: alb.name, mode: "album" });
      } else {
        seeds.push({ artist: s.name, title: null, mode: "album" });
      }
    }
  }

  return seeds;
}

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

function signedParams(params: Record<string, string>, apiSecret: string): Record<string, string> {
  const sigSrc =
    Object.keys(params)
      .sort()
      .map((k) => `${k}${params[k]}`)
      .join("") + apiSecret;
  return { ...params, api_sig: md5(sigSrc), format: "json" };
}

// === OAuth: fetch a token to send the user to last.fm/api/auth ===
export async function getLastFmRequestToken(): Promise<string | null> {
  const { lastfm_api_key } = getAllSettings();
  if (!lastfm_api_key) return null;
  const url = new URL(BASE);
  url.searchParams.set("method", "auth.getToken");
  url.searchParams.set("api_key", lastfm_api_key);
  url.searchParams.set("format", "json");
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: string };
    return data.token ?? null;
  } catch {
    return null;
  }
}

export interface LastFmExchangeResult {
  session: { name: string; key: string } | null;
  error: string | null;
  error_code: number | null;
  http_status: number | null;
}

// === OAuth: exchange a returned token for a long-lived session key ===
export async function exchangeLastFmToken(token: string): Promise<LastFmExchangeResult> {
  const { lastfm_api_key, lastfm_shared_secret } = getAllSettings();
  if (!lastfm_api_key) return { session: null, error: "lastfm_api_key_not_set", error_code: null, http_status: null };
  if (!lastfm_shared_secret) return { session: null, error: "lastfm_shared_secret_not_set", error_code: null, http_status: null };

  const params = signedParams(
    { method: "auth.getSession", api_key: lastfm_api_key, token },
    lastfm_shared_secret,
  );

  try {
    const body = new URLSearchParams(params).toString();
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const text = await res.text();
    let data: { session?: { name: string; key: string }; error?: number; message?: string } = {};
    try {
      data = JSON.parse(text);
    } catch {
      console.error("[lastfm.exchange] non-JSON response", res.status, text.slice(0, 500));
      return { session: null, error: text.slice(0, 200), error_code: null, http_status: res.status };
    }

    if (data.session) {
      setSetting("lastfm_session_key", data.session.key);
      setSetting("lastfm_session_username", data.session.name);
      return { session: data.session, error: null, error_code: null, http_status: res.status };
    }

    console.error("[lastfm.exchange] error", res.status, data);
    return {
      session: null,
      error: data.message ?? "unknown_lastfm_error",
      error_code: data.error ?? null,
      http_status: res.status,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "fetch_failed";
    console.error("[lastfm.exchange] network error", msg);
    return { session: null, error: msg, error_code: null, http_status: null };
  }
}

export async function relayToLastFm(scrobble: {
  artist: string;
  track: string;
  album: string | null;
  timestamp: number;
}): Promise<boolean> {
  const { lastfm_api_key, lastfm_shared_secret, lastfm_session_key } = getAllSettings();
  if (!lastfm_api_key || !lastfm_session_key || !lastfm_shared_secret) return false;

  const params: Record<string, string> = {
    method: "track.scrobble",
    artist: scrobble.artist,
    track: scrobble.track,
    timestamp: String(scrobble.timestamp),
    api_key: lastfm_api_key,
    sk: lastfm_session_key,
  };
  if (scrobble.album) params.album = scrobble.album;

  try {
    const body = new URLSearchParams(signedParams(params, lastfm_shared_secret)).toString();
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    return res.ok;
  } catch {
    return false;
  }
}
