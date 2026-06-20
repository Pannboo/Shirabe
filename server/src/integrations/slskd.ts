import { getAllSettings } from "../db/queries/settings.js";

interface SlskdSearchResponse {
  id: string;
  state?: string;
}

interface SlskdFile {
  filename: string;
  size: number;
  bitRate?: number;
  bitDepth?: number;
  sampleRate?: number;
  length?: number;
}

interface SlskdResponseEntry {
  username: string;
  uploadSpeed?: number;
  hasFreeUploadSlot?: boolean;
  queueLength?: number;
  files?: SlskdFile[];
}

interface SlskdSearchDetail {
  id: string;
  state?: string;
  isComplete?: boolean;
  responses?: SlskdResponseEntry[];
}

interface SlskdDownload {
  id?: string;
  username: string;
  filename: string;
  state?: string;
  bytesTransferred?: number;
  size?: number;
}

// Grouped view of /api/v0/transfers/downloads — per (username, directory)
// so pollDownloads can correlate by the username+folder it persisted when
// it kicked the queue. slskd's `directory` field carries the full remote
// folder path; that's what we matched our `slskd_folder` against.
export interface SlskdDownloadGroup {
  username: string;
  directory: string;
  files: SlskdDownload[];
}

// Audio formats we consider lossless. Used by the quality filter — when the
// user has download_lossless_only set, anything else is rejected.
const LOSSLESS_EXTS = new Set(["flac", "wav", "alac", "aiff", "ape", "wv"]);

function authHeaders(): Record<string, string> {
  const { slskd_api_key } = getAllSettings();
  return slskd_api_key ? { "X-API-Key": slskd_api_key } : {};
}

function slskdUrl(path: string): string | null {
  const { slskd_url } = getAllSettings();
  if (!slskd_url) return null;
  return `${slskd_url.replace(/\/$/, "")}${path}`;
}

export async function startSlskdSearch(searchText: string): Promise<string | null> {
  const url = slskdUrl(`/api/v0/searches`);
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ searchText }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as SlskdSearchResponse;
    return data.id;
  } catch {
    return null;
  }
}

export async function getSlskdSearch(id: string): Promise<SlskdSearchDetail | null> {
  const url = slskdUrl(`/api/v0/searches/${id}?includeResponses=true`);
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) return null;
    return (await res.json()) as SlskdSearchDetail;
  } catch {
    return null;
  }
}

export async function listSlskdDownloads(): Promise<SlskdDownloadGroup[]> {
  const url = slskdUrl(`/api/v0/transfers/downloads`);
  if (!url) return [];
  try {
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{
      username?: string;
      directories?: Array<{ directory?: string; files?: SlskdDownload[] }>;
    }>;
    const groups: SlskdDownloadGroup[] = [];
    for (const user of data) {
      const username = user.username ?? "";
      for (const dir of user.directories ?? []) {
        groups.push({
          username,
          directory: dir.directory ?? "",
          files: (dir.files ?? []).map((f) => ({ ...f, username })),
        });
      }
    }
    return groups;
  } catch {
    return [];
  }
}

// === Candidate aggregation + filtering =====================================
//
// slskd returns per-peer responses each containing a flat file list. For our
// purposes a "candidate" is a peer + the audio files from one folder on that
// peer (most rips are organised as one album per folder). We group files by
// their parent directory, drop anything that doesn't pass the quality filter,
// then rank by a simple score that prefers lossless and faster peers.

export interface CandidateFile {
  filename: string;
  size: number;
  bitRate: number | null;
  bitDepth: number | null;
  sampleRate: number | null;
  length: number | null;
  extension: string;
}

export interface Candidate {
  username: string;
  uploadSpeed: number;
  queueLength: number;
  hasFreeUploadSlot: boolean;
  folder: string;
  files: CandidateFile[];
  totalSize: number;
  formats: string[];
  isLossless: boolean;
  avgBitrate: number | null;
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

function folderOf(filename: string): string {
  const lastSep = Math.max(filename.lastIndexOf("\\"), filename.lastIndexOf("/"));
  return lastSep < 0 ? "" : filename.slice(0, lastSep);
}

interface QualityFilter {
  allowedExts: Set<string>;
  losslessOnly: boolean;
  minKbps: number;
  minFilesPerAlbum: number;
}

function activeFilter(): QualityFilter {
  const s = getAllSettings();
  const allowed = new Set(
    s.download_allowed_extensions
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  );
  return {
    allowedExts: allowed,
    losslessOnly: s.download_lossless_only,
    minKbps: s.download_min_kbps,
    minFilesPerAlbum: s.download_min_files_per_album,
  };
}

function passesFileFilter(file: SlskdFile, f: QualityFilter): boolean {
  const ext = extOf(file.filename);
  if (!ext) return false;
  if (!f.allowedExts.has(ext)) return false;
  if (f.losslessOnly && !LOSSLESS_EXTS.has(ext)) return false;
  // Bitrate check is lossy-only — lossless rips report variable bitrate
  // and shouldn't be gated.
  if (!LOSSLESS_EXTS.has(ext) && file.bitRate && file.bitRate > 0 && file.bitRate < f.minKbps) {
    return false;
  }
  return true;
}

export interface RankedResult {
  candidates: Candidate[];
  total_peers: number;          // distinct slskd peers that responded
  total_files: number;          // total audio files across all peers (pre-filter)
}

// Group + rank a slskd search detail into folder-level candidates.
//
// `strict` controls the file filter:
//   - true (default): apply user's quality settings (extensions, lossless-only,
//     bitrate floor) + min-files-per-album for album mode. Right for the
//     auto-approver and the default Discover preview view.
//   - false: skip ALL filtering except a basic "is this an audio file"
//     extension whitelist. Used by the "Show all peers" toggle in the
//     preview modal so users can see exactly what slskd is returning when
//     the strict filter is rejecting everything.
//
// The result object also includes total peer/file counts so the UI can show
// "12 peers responded, 4 passed filter" and offer a relax-filter affordance.
export function rankCandidates(
  detail: SlskdSearchDetail,
  opts: { mode?: "album" | "track"; strict?: boolean } = {},
): RankedResult {
  if (!detail.responses) return { candidates: [], total_peers: 0, total_files: 0 };
  const strict = opts.strict !== false;
  const filter = activeFilter();
  const candidates: Candidate[] = [];

  // Loose mode still drops obviously non-audio extensions (videos, images,
  // archives) — pointless to show .mkv when the user is downloading music.
  const audioExts = new Set(["flac", "mp3", "m4a", "ogg", "opus", "wav", "alac", "aiff", "ape", "wv", "mp2", "wma"]);

  let totalPeers = 0;
  let totalFiles = 0;

  for (const response of detail.responses) {
    if (!response.files || response.files.length === 0) continue;
    totalPeers += 1;

    const audioOnly = response.files.filter((f) => {
      const ext = extOf(f.filename);
      return ext && audioExts.has(ext);
    });
    totalFiles += audioOnly.length;
    if (audioOnly.length === 0) continue;

    const okFiles = strict ? audioOnly.filter((f) => passesFileFilter(f, filter)) : audioOnly;
    if (okFiles.length === 0) continue;

    // Group filtered files by their containing folder. For album mode we
    // surface each folder as a candidate; for track mode a folder with
    // even one matching file is acceptable.
    const byFolder = new Map<string, SlskdFile[]>();
    for (const f of okFiles) {
      const folder = folderOf(f.filename);
      const arr = byFolder.get(folder) ?? [];
      arr.push(f);
      byFolder.set(folder, arr);
    }

    for (const [folder, files] of byFolder) {
      if (strict && opts.mode === "album" && files.length < filter.minFilesPerAlbum) continue;
      const totalSize = files.reduce((s, f) => s + (f.size ?? 0), 0);
      const exts = Array.from(new Set(files.map((f) => extOf(f.filename))));
      const isLossless = exts.every((e) => LOSSLESS_EXTS.has(e));
      const bitrates = files.map((f) => f.bitRate ?? 0).filter((b) => b > 0);
      const avgBitrate = bitrates.length > 0
        ? Math.round(bitrates.reduce((s, b) => s + b, 0) / bitrates.length)
        : null;

      candidates.push({
        username: response.username,
        uploadSpeed: response.uploadSpeed ?? 0,
        queueLength: response.queueLength ?? 0,
        hasFreeUploadSlot: !!response.hasFreeUploadSlot,
        folder,
        files: files.map<CandidateFile>((f) => ({
          filename: f.filename,
          size: f.size,
          bitRate: f.bitRate ?? null,
          bitDepth: f.bitDepth ?? null,
          sampleRate: f.sampleRate ?? null,
          length: f.length ?? null,
          extension: extOf(f.filename),
        })),
        totalSize,
        formats: exts,
        isLossless,
        avgBitrate,
      });
    }
  }

  // Score: lossless (+100) > free upload slot (+25) > faster peer (kbps/1000)
  // > more files (caps at 25). Stable sort by score desc.
  candidates.sort((a, b) => score(b) - score(a));
  return { candidates, total_peers: totalPeers, total_files: totalFiles };
}

function score(c: Candidate): number {
  let s = 0;
  if (c.isLossless) s += 100;
  if (c.hasFreeUploadSlot) s += 25;
  s += Math.min(c.uploadSpeed / 1024, 50);
  s += Math.min(c.files.length, 25);
  return s;
}

// === Queue ====================================================================

export async function queueSlskdFiles(
  username: string,
  files: Array<{ filename: string; size: number }>,
): Promise<boolean> {
  const url = slskdUrl(`/api/v0/transfers/downloads/${encodeURIComponent(username)}`);
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(files),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Backwards-compatible auto-pick used by pollDownloads. Filters using the
// configured quality criteria — fixes the previous behaviour of "biggest
// file wins" which routinely grabbed video releases.
//
// Returns the (username, folder) that was queued so the caller can persist
// it onto the download row for later correlation.
export async function enqueueBestResult(
  searchId: string,
  mode: "album" | "track" = "album",
): Promise<{ username: string; folder: string; fileCount: number } | null> {
  const search = await getSlskdSearch(searchId);
  if (!search) return null;
  const { candidates } = rankCandidates(search, { mode, strict: true });
  const best = candidates[0];
  if (!best) return null;
  const ok = await queueSlskdFiles(best.username, best.files.map((f) => ({ filename: f.filename, size: f.size })));
  if (!ok) return null;
  return { username: best.username, folder: best.folder, fileCount: best.files.length };
}

// Tell slskd to remove a completed transfer from its list. The `remove`
// query param distinguishes "cancel an in-flight transfer" (false) from
// "drop a finished one from history" (true). We only call this for files
// already in a "Completed, Succeeded" state, so `remove=true` is safe.
//
// Best-effort: a 404 means slskd already cleared it (some users have
// auto-clear enabled); a 5xx will be logged but won't block the
// download row from being marked complete.
export async function removeSlskdDownload(username: string, transferId: string): Promise<boolean> {
  const url = slskdUrl(
    `/api/v0/transfers/downloads/${encodeURIComponent(username)}/${encodeURIComponent(transferId)}?remove=true`,
  );
  if (!url) return false;
  try {
    const res = await fetch(url, { method: "DELETE", headers: authHeaders() });
    if (res.ok || res.status === 404) return true;
    console.warn(`[slskd] remove transfer ${username}/${transferId} → HTTP ${res.status}`);
    return false;
  } catch (err) {
    console.warn(`[slskd] remove transfer failed`, err instanceof Error ? err.message : err);
    return false;
  }
}

export async function pingSlskd(): Promise<boolean> {
  const url = slskdUrl(`/api/v0/application`);
  if (!url) return false;
  try {
    const res = await fetch(url, { headers: authHeaders() });
    return res.ok;
  } catch {
    return false;
  }
}
