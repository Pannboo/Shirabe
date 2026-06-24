import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, ExternalLink, Loader2, Music, Search } from "lucide-react";
import Modal from "./Modal";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface SearchResult {
  artist: string;
  title: string;
  cover_art_url: string | null;
  mb_release_id: string | null;
  year: number | null;
  source: "lastfm" | "musicbrainz";
  is_owned: boolean;
}

function mbLink(r: SearchResult): string {
  if (r.mb_release_id) return `https://musicbrainz.org/release/${r.mb_release_id}`;
  return `https://musicbrainz.org/search?type=release&query=${encodeURIComponent(`${r.artist} ${r.title}`)}`;
}

function lfmLink(r: SearchResult): string {
  return `https://www.last.fm/music/${encodeURIComponent(r.artist)}/${encodeURIComponent(r.title)}`;
}

interface CandidateFile {
  filename: string;
  size: number;
  bitRate: number | null;
  bitDepth: number | null;
  sampleRate: number | null;
  length: number | null;
  extension: string;
  is_audio: boolean;
}

interface Candidate {
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
  audio_count: number;
  extra_count: number;
  folder_expanded: boolean;
}

interface Track {
  position: number;
  title: string;
  duration_seconds: number | null;
}

type View =
  | { kind: "search" }
  | {
      kind: "candidates";
      album: SearchResult;
      mode: "album" | "track";
      loading: boolean;
      polling: boolean;
      candidates: Candidate[];
      totalPeers: number;
      totalFiles: number;
      searchId: string | null;
      complete: boolean;
      strict: boolean;
    }
  | { kind: "tracks"; album: SearchResult; loading: boolean; tracks: Track[]; picked: Set<number> };

// How long we keep pulling new candidates after the initial preview.
// slskd peers can take 20–30s to respond; capping at 45s keeps the modal
// from hanging open forever if the search yields nothing.
const POLL_TOTAL_MS = 45_000;
const POLL_INTERVAL_MS = 2_500;

function fmtBytes(b: number): string {
  if (b > 1024 * 1024 * 1024) return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (b > 1024 * 1024) return `${Math.round(b / (1024 * 1024))} MB`;
  if (b > 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
}

function fmtSpeed(bps: number): string {
  if (bps > 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bps > 1024) return `${Math.round(bps / 1024)} KB/s`;
  return `${bps} B/s`;
}

function fmtDuration(secs: number | null): string {
  if (!secs) return "";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function DiscoverSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [hideOwned, setHideOwned] = useState(false);
  const [view, setView] = useState<View>({ kind: "search" });
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<{ id: ReturnType<typeof setInterval> | null; stopAt: number }>({ id: null, stopAt: 0 });

  function stopPolling() {
    if (pollRef.current.id !== null) {
      clearInterval(pollRef.current.id);
      pollRef.current.id = null;
    }
  }

  // Stop polling whenever the candidates view goes away (back, close, error).
  useEffect(() => {
    if (view.kind !== "candidates") stopPolling();
  }, [view.kind]);
  useEffect(() => stopPolling, []);

  async function runSearch() {
    if (!q.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const r = await api<{ results: SearchResult[] }>(`/api/suggestions/search?q=${encodeURIComponent(q.trim())}`);
      setResults(r.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "search_failed");
    } finally {
      setSearching(false);
    }
  }

  async function pickAlbum(album: SearchResult) {
    setView({
      kind: "candidates",
      album,
      mode: "album",
      loading: true,
      polling: false,
      candidates: [],
      totalPeers: 0,
      totalFiles: 0,
      searchId: null,
      complete: false,
      strict: true,
    });
    try {
      const r = await api<{
        search_id: string;
        candidates: Candidate[];
        total_peers: number;
        total_files: number;
        complete: boolean;
      }>(
        `/api/suggestions/slskd-preview`,
        { method: "POST", body: { artist: album.artist, title: album.title, mode: "album" } },
      );
      setView({
        kind: "candidates",
        album,
        mode: "album",
        loading: false,
        polling: !r.complete,
        candidates: r.candidates,
        totalPeers: r.total_peers,
        totalFiles: r.total_files,
        searchId: r.search_id,
        complete: r.complete,
        strict: true,
      });
      if (!r.complete) startPolling(r.search_id, "album", true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "slskd_failed");
      setView({ kind: "search" });
    }
  }

  // After the initial preview returns, keep polling slskd-search/:id every
  // few seconds for up to POLL_TOTAL_MS to pick up late-arriving peers.
  // Stops automatically when the search is complete, the cap is hit, or
  // the modal closes / view changes.
  function startPolling(searchId: string, mode: "album" | "track", strict: boolean) {
    stopPolling();
    pollRef.current.stopAt = Date.now() + POLL_TOTAL_MS;
    pollRef.current.id = setInterval(async () => {
      if (Date.now() >= pollRef.current.stopAt) {
        stopPolling();
        setView((v) => (v.kind === "candidates" ? { ...v, polling: false } : v));
        return;
      }
      try {
        const r = await api<{
          search_id: string;
          candidates: Candidate[];
          total_peers: number;
          total_files: number;
          complete: boolean;
        }>(
          `/api/suggestions/slskd-search/${encodeURIComponent(searchId)}?mode=${mode}&strict=${strict}`,
        );
        setView((v) => {
          if (v.kind !== "candidates" || v.searchId !== searchId) return v;
          return {
            ...v,
            candidates: r.candidates,
            totalPeers: r.total_peers,
            totalFiles: r.total_files,
            complete: r.complete,
            polling: !r.complete,
          };
        });
        if (r.complete) stopPolling();
      } catch {
        // network blip — keep polling
      }
    }, POLL_INTERVAL_MS);
  }

  // Refetch the current search id with the opposite strict setting and
  // restart polling so late peers continue to flow in under the new filter.
  async function toggleStrict() {
    if (view.kind !== "candidates" || !view.searchId) return;
    const nextStrict = !view.strict;
    setView({ ...view, strict: nextStrict, loading: true });
    try {
      const r = await api<{
        search_id: string;
        candidates: Candidate[];
        total_peers: number;
        total_files: number;
        complete: boolean;
      }>(
        `/api/suggestions/slskd-search/${encodeURIComponent(view.searchId)}?mode=${view.mode}&strict=${nextStrict}`,
      );
      setView({
        ...view,
        strict: nextStrict,
        loading: false,
        candidates: r.candidates,
        totalPeers: r.total_peers,
        totalFiles: r.total_files,
        complete: r.complete,
        polling: !r.complete,
      });
      if (!r.complete) startPolling(view.searchId, view.mode, nextStrict);
      else stopPolling();
    } catch (e) {
      setError(e instanceof Error ? e.message : "slskd_failed");
    }
  }

  async function pickTracks(album: SearchResult) {
    setView({ kind: "tracks", album, loading: true, tracks: [], picked: new Set() });
    try {
      const r = await api<{ tracks: Track[] }>(
        `/api/suggestions/album-tracks?${album.mb_release_id
          ? `mb_release_id=${encodeURIComponent(album.mb_release_id)}`
          : `artist=${encodeURIComponent(album.artist)}&title=${encodeURIComponent(album.title)}`}`,
      );
      setView({ kind: "tracks", album, loading: false, tracks: r.tracks, picked: new Set() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "tracks_failed");
      setView({ kind: "search" });
    }
  }

  async function queueCandidate(c: Candidate) {
    if (view.kind !== "candidates") return;
    try {
      await api(`/api/suggestions/slskd-queue`, {
        method: "POST",
        body: {
          username: c.username,
          files: c.files.map((f) => ({ filename: f.filename, size: f.size })),
          mode: view.mode,
          artist: view.album.artist,
          title: view.album.title,
        },
      });
      setView({ kind: "search" });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "queue_failed");
    }
  }

  async function queuePickedTracks() {
    if (view.kind !== "tracks") return;
    if (view.picked.size === 0) return;
    const trackTitles = Array.from(view.picked).map((i) => view.tracks[i]?.title).filter(Boolean) as string[];
    // For each picked track, run a slskd preview and queue the top candidate.
    for (const trackTitle of trackTitles) {
      try {
        const r = await api<{ candidates: Candidate[] }>(
          `/api/suggestions/slskd-preview`,
          { method: "POST", body: { artist: view.album.artist, title: trackTitle, mode: "track" } },
        );
        const top = r.candidates[0];
        if (top) {
          await api(`/api/suggestions/slskd-queue`, {
            method: "POST",
            body: {
              username: top.username,
              files: top.files.map((f) => ({ filename: f.filename, size: f.size })),
              mode: "track",
              artist: view.album.artist,
              title: trackTitle,
            },
          });
        }
      } catch {
        // continue with the rest
      }
    }
    setView({ kind: "search" });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        setView({ kind: "search" });
        onClose();
      }}
      title={
        view.kind === "search"
          ? "Search & download"
          : view.kind === "candidates"
            ? `Pick a source · ${view.album.artist} — ${view.album.title}`
            : `Pick tracks · ${view.album.artist} — ${view.album.title}`
      }
      size="xl"
    >
      {error && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {view.kind === "search" && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runSearch();
            }}
            className="flex items-center gap-2"
          >
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Album, artist, or both"
              className="flex-1"
            />
            <Button type="submit" disabled={searching || !q.trim()}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search
            </Button>
          </form>

          <SearchResults
            results={results}
            searching={searching}
            query={q}
            hideOwned={hideOwned}
            onToggleHideOwned={() => setHideOwned((v) => !v)}
            onPickAlbum={pickAlbum}
            onPickTracks={pickTracks}
          />
        </>
      )}

      {view.kind === "candidates" && (
        <div>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setView({ kind: "search" })}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              ← Back to results
            </button>
            <div className="text-xs text-muted-foreground flex items-center gap-3">
              <span>
                {view.totalPeers} peer{view.totalPeers === 1 ? "" : "s"}
                {view.strict && view.totalPeers > view.candidates.length ? (
                  <> · <span className="text-foreground">{view.candidates.length} match filter</span></>
                ) : null}
                {!view.strict && <> · <span className="text-accent">unfiltered</span></>}
              </span>
              {view.polling && <Loader2 className="h-3 w-3 animate-spin" />}
              {view.complete && <span>· complete</span>}
              <button
                type="button"
                onClick={toggleStrict}
                className="rounded-full border border-border bg-card/40 hover:bg-muted/40 px-2 py-0.5"
                disabled={view.loading}
              >
                {view.strict ? "Show all peers" : "Apply quality filter"}
              </button>
            </div>
          </div>
          {view.loading && (
            <p className="text-sm text-muted-foreground flex items-center gap-2 py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Starting slskd search…
            </p>
          )}
          {!view.loading && view.candidates.length === 0 && !view.polling && view.totalPeers === 0 && (
            <p className="text-sm text-muted-foreground py-4">
              No slskd peers responded. Either no one is sharing this album, or slskd isn't reachable.
            </p>
          )}
          {!view.loading && view.candidates.length === 0 && !view.polling && view.totalPeers > 0 && view.strict && (
            <div className="py-4 space-y-2">
              <p className="text-sm text-muted-foreground">
                {view.totalPeers} peers responded with {view.totalFiles} audio file{view.totalFiles === 1 ? "" : "s"},
                but none matched your quality filter.
              </p>
              <Button size="sm" variant="outline" onClick={toggleStrict}>
                Show all peers anyway
              </Button>
            </div>
          )}
          {!view.loading && view.candidates.length === 0 && view.polling && (
            <p className="text-sm text-muted-foreground py-4 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Asking peers — can take 20–45 seconds. Candidates appear as they respond.
            </p>
          )}
          <div className="space-y-2">
            {view.candidates.map((c, i) => (
              <CandidateCard key={`${c.username}-${i}`} candidate={c} onGrab={() => queueCandidate(c)} />
            ))}
          </div>
        </div>
      )}

      {view.kind === "tracks" && (
        <div>
          <button
            type="button"
            onClick={() => setView({ kind: "search" })}
            className="text-xs text-muted-foreground hover:text-foreground mb-3"
          >
            ← Back to results
          </button>
          {view.loading && (
            <p className="text-sm text-muted-foreground flex items-center gap-2 py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading tracks…
            </p>
          )}
          {!view.loading && view.tracks.length === 0 && (
            <p className="text-sm text-muted-foreground py-4">No tracks found for this album.</p>
          )}
          {view.tracks.length > 0 && (
            <>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {view.picked.size} of {view.tracks.length} selected
                </span>
                <Button
                  size="sm"
                  disabled={view.picked.size === 0}
                  onClick={queuePickedTracks}
                >
                  <Download className="h-3.5 w-3.5" />
                  Grab {view.picked.size} tracks
                </Button>
              </div>
              <ul className="divide-y divide-border/70">
                {view.tracks.map((t, i) => (
                  <li key={i} className="py-2 flex items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={view.picked.has(i)}
                      onChange={(e) => {
                        const picked = new Set(view.picked);
                        if (e.target.checked) picked.add(i);
                        else picked.delete(i);
                        setView({ ...view, picked });
                      }}
                      className="accent-accent"
                    />
                    <span className="w-7 text-right text-xs tabular-nums text-muted-foreground">
                      {t.position}
                    </span>
                    <span className="flex-1 truncate">{t.title}</span>
                    {t.duration_seconds && (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {fmtDuration(t.duration_seconds)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function fmtRate(r: number): string {
  // sampleRate comes in Hz; show as kHz so the column doesn't sprawl.
  return `${(r / 1000).toFixed(r % 1000 === 0 ? 0 : 1)}kHz`;
}

const LOSSLESS_EXTS = new Set(["flac", "wav", "alac", "aiff", "ape", "wv"]);

function fileQualityLabel(f: CandidateFile): string {
  // Lossless: prefer bit-depth/sample-rate (16/44.1 vs 24/96 is what matters
  // for FLAC). Lossy: show kbps.
  if (LOSSLESS_EXTS.has(f.extension) && f.bitDepth && f.sampleRate) {
    return `${f.bitDepth}/${fmtRate(f.sampleRate)}`;
  }
  if (f.bitRate) {
    return `${f.bitRate} kbps`;
  }
  return "—";
}

// Most common (artist|title)-level quality across a candidate's files, so the
// collapsed card can show "24/96 FLAC" or "320 kbps MP3" without expanding
// the file list. Picks the modal value; ties broken by the first file.
function dominantQuality(c: Candidate): string | null {
  if (c.files.length === 0) return null;
  const isLossless = c.isLossless;
  if (isLossless) {
    const labels = c.files
      .map((f) => (f.bitDepth && f.sampleRate ? `${f.bitDepth}/${fmtRate(f.sampleRate)}` : null))
      .filter((x): x is string => x !== null);
    if (labels.length === 0) return null;
    const counts = new Map<string, number>();
    for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }
  if (c.avgBitrate) return `${c.avgBitrate} kbps`;
  return null;
}

function baseName(path: string): string {
  const lastSep = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return lastSep < 0 ? path : path.slice(lastSep + 1);
}

function CandidateCard({ candidate, onGrab }: { candidate: Candidate; onGrab: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const showFiles = expanded || candidate.files.length <= 6;
  const visibleFiles = showFiles ? candidate.files : candidate.files.slice(0, 0);
  const quality = dominantQuality(candidate);

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-background/40 px-3 py-3",
        candidate.isLossless && "border-accent/40",
      )}
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{candidate.folder || "(root)"}</div>
          <div className="text-xs text-muted-foreground truncate">{candidate.username}</div>
        </div>
        <Button size="sm" onClick={onGrab}>
          <Download className="h-3.5 w-3.5" />
          Grab
        </Button>
      </div>
      <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground mb-2">
        {candidate.isLossless ? <Badge variant="success">lossless</Badge> : <Badge variant="default">lossy</Badge>}
        {quality && (
          <span className="font-medium text-foreground tabular-nums">{quality}</span>
        )}
        <span>{candidate.formats.join(", ")}</span>
        <span>·</span>
        <span>
          {candidate.audio_count} audio
          {candidate.extra_count > 0 && ` + ${candidate.extra_count} extras`}
        </span>
        <span>·</span>
        <span>{fmtBytes(candidate.totalSize)}</span>
        <span>·</span>
        <span>{fmtSpeed(candidate.uploadSpeed)}</span>
        {candidate.hasFreeUploadSlot && <Badge variant="success">free slot</Badge>}
        {candidate.queueLength > 0 && <span>queue: {candidate.queueLength}</span>}
      </div>
      {visibleFiles.length > 0 && (
        <ul className="text-[11px] divide-y divide-border/60 border-t border-border/60 pt-1">
          {visibleFiles.map((f, i) => (
            <li key={i} className={cn("py-1 flex items-center gap-2", !f.is_audio && "opacity-60")}>
              <span className="flex-1 truncate font-mono text-muted-foreground">{baseName(f.filename)}</span>
              <span className="uppercase tracking-wider text-[10px] text-muted-foreground w-10 text-right">
                {f.extension}
              </span>
              <span className="tabular-nums text-foreground w-20 text-right">{f.is_audio ? fileQualityLabel(f) : "extra"}</span>
              <span className="tabular-nums text-muted-foreground w-14 text-right">{fmtBytes(f.size)}</span>
            </li>
          ))}
        </ul>
      )}
      {!showFiles && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          Show all {candidate.files.length} files
        </button>
      )}
    </div>
  );
}

function SearchResults({
  results,
  searching,
  query,
  hideOwned,
  onToggleHideOwned,
  onPickAlbum,
  onPickTracks,
}: {
  results: SearchResult[];
  searching: boolean;
  query: string;
  hideOwned: boolean;
  onToggleHideOwned: () => void;
  onPickAlbum: (r: SearchResult) => void;
  onPickTracks: (r: SearchResult) => void;
}) {
  const ownedCount = useMemo(() => results.filter((r) => r.is_owned).length, [results]);
  const visible = useMemo(
    () => (hideOwned ? results.filter((r) => !r.is_owned) : results),
    [results, hideOwned],
  );

  if (results.length === 0 && !searching && query) {
    return <p className="text-sm text-muted-foreground py-4">No results.</p>;
  }

  return (
    <div className="mt-4 space-y-3">
      {ownedCount > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-card/40 px-3 py-2 text-xs text-muted-foreground">
          <span>
            <span className="font-medium text-foreground tabular-nums">{ownedCount}</span> of {results.length} already in your library
          </span>
          <button
            type="button"
            onClick={onToggleHideOwned}
            className="rounded-full border border-border bg-card/40 hover:bg-muted/40 px-2 py-0.5"
          >
            {hideOwned ? "Show owned" : "Hide owned"}
          </button>
        </div>
      )}
      <div className="divide-y divide-border/70">
        {visible.map((r, i) => (
          <div
            key={`${r.artist}-${r.title}-${i}`}
            className={cn(
              "flex items-center gap-3 py-3",
              r.is_owned && "opacity-70",
            )}
          >
            <div className="h-12 w-12 rounded-md bg-muted overflow-hidden flex-shrink-0 flex items-center justify-center">
              {r.cover_art_url ? (
                <img src={r.cover_art_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-xs text-muted-foreground">♪</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{r.title}</span>
                {r.is_owned && (
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-accent">
                    <Check className="h-3 w-3" />
                    In library
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {r.artist}
                {r.year ? ` · ${r.year}` : ""}
              </div>
            </div>
            <Badge variant="default">{r.source === "musicbrainz" ? "MB" : "Last.fm"}</Badge>
            <a
              href={mbLink(r)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center h-8 px-2 rounded-md border border-border hover:bg-muted text-muted-foreground"
              aria-label="Look up on MusicBrainz"
              title="MusicBrainz"
            >
              <span className="text-[10px] font-semibold tracking-wider">MB</span>
            </a>
            <a
              href={lfmLink(r)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center h-8 px-2 rounded-md border border-border hover:bg-muted text-muted-foreground"
              aria-label="Look up on Last.fm"
              title="Last.fm"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <Button size="sm" onClick={() => onPickAlbum(r)} variant="default">
              <Download className="h-3.5 w-3.5" />
              Album
            </Button>
            <Button size="sm" onClick={() => onPickTracks(r)} variant="outline">
              <Music className="h-3.5 w-3.5" />
              Tracks
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
