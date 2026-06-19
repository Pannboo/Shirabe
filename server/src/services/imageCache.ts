import { createHash } from "node:crypto";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { config } from "../config.js";
import {
  listAllArtistImagesWithUrl,
  setArtistImageLocal,
  type ArtistImageRow,
} from "../db/queries/artistImages.js";
import {
  listAllCoverartWithUrl,
  setCoverartLocal,
  type CoverartRow,
} from "../db/queries/coverart.js";

// ============================================================================
// Local image cache
// ============================================================================
//
// Album-cover and artist-image bytes live on disk under /data/image-cache,
// served by /api/image/{kind}/{hash}. External URLs (Cover Art Archive,
// Deezer, Last.fm) get fetched once per resolved row — either lazily on
// first browser request, or eagerly by the warmImageCache cron — and
// never again until the row is wiped.
//
// Hashing strategy: sha1("{kind}|{lowercased-content-key}") truncated to
// 16 hex chars (64 bits). Deterministic so the server can hand out URLs
// without a DB roundtrip (getOrEnqueueCoverArt just computes the hash),
// and the lookup direction (hash → row) is a single in-memory scan of
// resolved rows, which is fine at hundreds-of-rows scale.
// ============================================================================

export type ImageKind = "album" | "artist";

// Mirror of db/client.ts dbPath logic — keep the image cache on the same
// volume as shirabe.db so it survives container rebuilds via the same
// bind mount.
const dbAbs = isAbsolute(config.DATABASE_URL)
  ? config.DATABASE_URL
  : resolve(process.cwd(), config.DATABASE_URL);
const CACHE_ROOT = join(dirname(dbAbs), "image-cache");

mkdirSync(join(CACHE_ROOT, "album"), { recursive: true });
mkdirSync(join(CACHE_ROOT, "artist"), { recursive: true });

// === Hashing ================================================================

function contentKey(kind: ImageKind, parts: string[]): string {
  return `${kind}|` + parts.map((p) => p.toLowerCase().trim()).join("|");
}

export function hashForAlbum(artist: string, album: string): string {
  return createHash("sha1").update(contentKey("album", [artist, album])).digest("hex").slice(0, 16);
}

export function hashForArtist(artist: string): string {
  return createHash("sha1").update(contentKey("artist", [artist])).digest("hex").slice(0, 16);
}

// === Public URL builders ====================================================
//
// What getOrEnqueueCoverArt / getOrEnqueueArtistImage hand back to clients.
// Same shape regardless of whether the row exists yet — the /api/image
// route returns 404 (or transparent placeholder) until the resolver
// + warm path catches up.

export function publicUrlForAlbum(artist: string, album: string): string {
  return `/api/image/album/${hashForAlbum(artist, album)}`;
}

export function publicUrlForArtist(artist: string): string {
  return `/api/image/artist/${hashForArtist(artist)}`;
}

// === Hash → row reverse lookup =============================================
//
// SQLite has no native sha1 and we're at hundreds-of-rows scale, so a
// per-request scan of resolved rows is cheaper than maintaining a
// generated hash column. We cache the scan result for 5 seconds to
// amortise across the burst of image requests a page-load triggers.

interface CachedScan<T> { rows: T[]; at: number }
const SCAN_TTL_MS = 5_000;
let albumScanCache: CachedScan<CoverartRow> | null = null;
let artistScanCache: CachedScan<ArtistImageRow> | null = null;

function freshAlbumScan(): CoverartRow[] {
  if (albumScanCache && Date.now() - albumScanCache.at < SCAN_TTL_MS) {
    return albumScanCache.rows;
  }
  const rows = listAllCoverartWithUrl();
  albumScanCache = { rows, at: Date.now() };
  return rows;
}

function freshArtistScan(): ArtistImageRow[] {
  if (artistScanCache && Date.now() - artistScanCache.at < SCAN_TTL_MS) {
    return artistScanCache.rows;
  }
  const rows = listAllArtistImagesWithUrl();
  artistScanCache = { rows, at: Date.now() };
  return rows;
}

export function findAlbumByHash(hash: string): CoverartRow | null {
  for (const r of freshAlbumScan()) {
    if (hashForAlbum(r.artist, r.album) === hash) return r;
  }
  return null;
}

export function findArtistByHash(hash: string): ArtistImageRow | null {
  for (const r of freshArtistScan()) {
    if (hashForArtist(r.artist) === hash) return r;
  }
  return null;
}

// === Disk paths + content-type plumbing ====================================

const EXT_BY_CT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
};

function extFromContentType(ct: string | null | undefined): string | null {
  if (!ct) return null;
  const base = ct.split(";")[0]?.trim().toLowerCase() ?? "";
  return EXT_BY_CT[base] ?? null;
}

function extFromUrl(url: string): string | null {
  const clean = url.split("?")[0]?.split("#")[0] ?? "";
  const m = clean.match(/\.(jpg|jpeg|png|webp|gif|avif)$/i);
  if (!m || !m[1]) return null;
  const e = m[1].toLowerCase();
  return e === "jpeg" ? ".jpg" : `.${e}`;
}

function absolutePathFor(kind: ImageKind, filename: string): string {
  return join(CACHE_ROOT, kind, filename);
}

function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// === Fetch + persist =======================================================
//
// ensureLocal is the workhorse — given a kind + identifier (album row or
// artist row), it returns the absolute filesystem path of the cached
// image, fetching from the external URL on miss.

const FETCH_TIMEOUT_MS = 10_000;
const FETCH_HEADERS = {
  "User-Agent": "Shirabe/0.1 (https://github.com/pannboo/shirabe)",
  Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.9,*/*;q=0.5",
};

async function downloadToCache(
  kind: ImageKind,
  filenameBase: string,
  url: string,
): Promise<{ path: string; contentType: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS, signal: ctrl.signal });
    if (!res.ok) {
      console.warn(`[image] ${url} returned HTTP ${res.status}`);
      return null;
    }
    const ct = res.headers.get("content-type") ?? "image/jpeg";
    const ext = extFromContentType(ct) ?? extFromUrl(url) ?? ".jpg";
    const filename = `${filenameBase}${ext}`;
    const abs = absolutePathFor(kind, filename);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(abs, buf);
    return { path: filename, contentType: ct };
  } catch (err) {
    console.warn(`[image] ${url} fetch failed`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface LocalImage {
  absolutePath: string;
  contentType: string;
}

// Given an album row already loaded from the DB, return the on-disk
// absolute path + content-type for serving. Fetches from row.url on miss.
export async function ensureLocalAlbum(row: CoverartRow): Promise<LocalImage | null> {
  if (!row.url) return null;
  if (row.local_path) {
    const abs = absolutePathFor("album", row.local_path);
    if (fileExists(abs)) {
      return { absolutePath: abs, contentType: row.content_type ?? "image/jpeg" };
    }
    // local_path stale (file deleted under us) — re-fetch
  }
  const hash = hashForAlbum(row.artist, row.album);
  const dl = await downloadToCache("album", hash, row.url);
  if (!dl) return null;
  setCoverartLocal(row.artist, row.album, dl.path, dl.contentType);
  // Invalidate the scan cache so the next lookup sees the new local_path.
  albumScanCache = null;
  return { absolutePath: absolutePathFor("album", dl.path), contentType: dl.contentType };
}

export async function ensureLocalArtist(row: ArtistImageRow): Promise<LocalImage | null> {
  if (!row.url) return null;
  if (row.local_path) {
    const abs = absolutePathFor("artist", row.local_path);
    if (fileExists(abs)) {
      return { absolutePath: abs, contentType: row.content_type ?? "image/jpeg" };
    }
  }
  const hash = hashForArtist(row.artist);
  const dl = await downloadToCache("artist", hash, row.url);
  if (!dl) return null;
  setArtistImageLocal(row.artist, dl.path, dl.contentType);
  artistScanCache = null;
  return { absolutePath: absolutePathFor("artist", dl.path), contentType: dl.contentType };
}
