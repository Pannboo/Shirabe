// Navidrome auth via the Subsonic API. Uses /rest/ping.view to validate, /rest/getUser.view to read role.

import { createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";
import { getAllSettings } from "../db/queries/settings.js";

// Wrap any Subsonic fetch with a hard timeout so a slow / unresponsive
// Navidrome can't wedge request handlers or the library-sync job. Browser
// page refreshes also abort the request — without this, the upstream fetch
// would keep running and the next refresh would race with the old one.
const SUBSONIC_TIMEOUT_MS = 8_000;

async function subsonicFetch(url: string, timeoutMs = SUBSONIC_TIMEOUT_MS): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface SubsonicResponse<T> {
  "subsonic-response": T & { status: "ok" | "failed"; error?: { code: number; message: string } };
}

interface SubsonicUser {
  user: {
    username: string;
    adminRole?: boolean;
    id?: string;
  };
}

function tokenAuth(password: string): { t: string; s: string } {
  const salt = randomBytes(8).toString("hex");
  const t = createHash("md5").update(password + salt).digest("hex");
  return { t, s: salt };
}

function buildUrl(method: string, username: string, password: string): string {
  const { t, s } = tokenAuth(password);
  const params = new URLSearchParams({
    u: username,
    t,
    s,
    v: "1.16.1",
    c: "Shirabe",
    f: "json",
  });
  return `${config.NAVIDROME_URL.replace(/\/$/, "")}/rest/${method}.view?${params}`;
}

export interface NavidromeUser {
  navidrome_user_id: string;
  username: string;
  is_admin: boolean;
}

export async function authenticateNavidrome(
  username: string,
  password: string,
): Promise<NavidromeUser | null> {
  const pingRes = await subsonicFetch(buildUrl("ping", username, password));
  if (!pingRes || !pingRes.ok) return null;
  try {
    const ping = (await pingRes.json()) as SubsonicResponse<Record<string, never>>;
    if (ping["subsonic-response"].status !== "ok") return null;
  } catch {
    return null;
  }

  const userRes = await subsonicFetch(
    `${buildUrl("getUser", username, password)}&username=${encodeURIComponent(username)}`,
  );
  if (!userRes || !userRes.ok) return null;
  try {
    const userData = (await userRes.json()) as SubsonicResponse<SubsonicUser>;
    if (userData["subsonic-response"].status !== "ok") return null;
    const user = userData["subsonic-response"].user;
    return {
      navidrome_user_id: user.id ?? user.username,
      username: user.username,
      is_admin: !!user.adminRole,
    };
  } catch {
    return null;
  }
}

export async function pingNavidrome(): Promise<boolean> {
  const res = await subsonicFetch(`${config.NAVIDROME_URL.replace(/\/$/, "")}/ping`, 3_000);
  return !!res && res.ok;
}

function adminCreds(): { username: string; password: string } | null {
  const s = getAllSettings();
  if (!s.navidrome_admin_username || !s.navidrome_admin_password) return null;
  return { username: s.navidrome_admin_username, password: s.navidrome_admin_password };
}

export interface SubsonicNowPlayingEntry {
  username: string;
  minutesAgo?: number;
  playerName?: string;
  artist?: string;
  title?: string;
  album?: string;
  albumId?: string;
  duration?: number;
  // Navidrome includes the current playback position (seconds elapsed) in `playerName`-adjacent fields
  // depending on version; we also try `time` and `position`.
  time?: number;
  position?: number;
}

interface SubsonicNowPlayingPayload {
  nowPlaying?: { entry?: SubsonicNowPlayingEntry[] };
}

export async function getSubsonicNowPlaying(): Promise<SubsonicNowPlayingEntry[]> {
  const creds = adminCreds();
  if (!creds) return [];
  const res = await subsonicFetch(buildUrl("getNowPlaying", creds.username, creds.password), 4_000);
  if (!res || !res.ok) return [];
  try {
    const data = (await res.json()) as SubsonicResponse<SubsonicNowPlayingPayload>;
    if (data["subsonic-response"].status !== "ok") return [];
    return data["subsonic-response"].nowPlaying?.entry ?? [];
  } catch {
    return [];
  }
}

// Returns a fully-signed Subsonic URL for the cover art of an album/song id.
// Caller must NOT expose this URL to clients (contains credentials); use the
// /api/public/cover-art proxy route instead.
export function buildSubsonicCoverArtUrl(id: string, size = 300): string | null {
  const creds = adminCreds();
  if (!creds) return null;
  const base = buildUrl("getCoverArt", creds.username, creds.password);
  return `${base}&id=${encodeURIComponent(id)}&size=${size}`;
}

export interface SubsonicAlbumSummary {
  id: string;
  name: string;
  artist: string;
  artistId?: string;
  musicBrainzId?: string;
}

interface SubsonicAlbumList2Payload {
  albumList2?: { album?: SubsonicAlbumSummary[] };
}

// Paginates Subsonic getAlbumList2 (`type=alphabeticalByName`) to enumerate the
// entire library. Used by the syncNavidromeLibrary job so Shirabe knows what
// the user already owns and can skip those in Discover suggestions.
export async function listAllNavidromeAlbums(): Promise<SubsonicAlbumSummary[]> {
  const creds = adminCreds();
  if (!creds) return [];
  const collected: SubsonicAlbumSummary[] = [];
  const PAGE = 500;
  // 20s per page is generous — getAlbumList2 with 500 rows is usually under
  // a second, but a cold-start Navidrome on slow disks can take a beat.
  for (let offset = 0; ; offset += PAGE) {
    const base = buildUrl("getAlbumList2", creds.username, creds.password);
    const url = `${base}&type=alphabeticalByName&size=${PAGE}&offset=${offset}`;
    const res = await subsonicFetch(url, 20_000);
    if (!res || !res.ok) break;
    let page: SubsonicAlbumSummary[] = [];
    try {
      const data = (await res.json()) as SubsonicResponse<SubsonicAlbumList2Payload>;
      if (data["subsonic-response"].status !== "ok") break;
      page = data["subsonic-response"].albumList2?.album ?? [];
    } catch {
      break;
    }
    if (page.length === 0) break;
    collected.push(...page);
    if (page.length < PAGE) break;
    // Hard cap so we don't loop forever on a misbehaving server.
    if (offset > 50_000) break;
  }
  return collected;
}
