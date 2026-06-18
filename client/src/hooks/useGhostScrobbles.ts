import { useEffect, useRef, useState } from "react";
import type { NowPlayingDto } from "@/hooks/useNowPlaying";

export interface Scrobble {
  track: string;
  artist: string;
  album: string | null;
  timestamp: number;
  cover_art_url?: string | null;
}

const GHOST_TTL_MS = 10 * 60_000; // 10 min — beyond this, assume the track was skipped and won't be scrobbled.

function key(s: { track: string; artist: string }): string {
  return `${s.artist.toLowerCase()}|${s.track.toLowerCase()}`;
}

// Bridges the gap between "track just finished playing" and "the real scrobble
// lands on the server" — without this, the previous song briefly vanishes from
// the feed entirely (it's no longer the live row, not yet a scrobble) and the
// list flashes/reflows. We synthesise a client-side scrobble at the moment of
// transition and drop it as soon as the authoritative scrobble appears in
// `real`, or after GHOST_TTL_MS if it never does (skipped track).
//
// Ghosts are intentionally not persisted — a page refresh shows only real
// server state, which is the source of truth.
export function useGhostScrobbles(
  nowPlaying: NowPlayingDto | null,
  real: Scrobble[],
): Scrobble[] {
  const [ghosts, setGhosts] = useState<Scrobble[]>([]);
  const prev = useRef<NowPlayingDto | null>(null);

  // On every now-playing change, if the previous live track is a different
  // track, materialise it as a ghost scrobble at "just now".
  useEffect(() => {
    const previous = prev.current;
    const current = nowPlaying;
    if (
      previous &&
      previous.is_live &&
      previous.track &&
      previous.artist &&
      (!current ||
        previous.track.toLowerCase() !== current.track.toLowerCase() ||
        previous.artist.toLowerCase() !== current.artist.toLowerCase())
    ) {
      const ghost: Scrobble = {
        track: previous.track,
        artist: previous.artist,
        album: previous.album,
        timestamp: Math.floor(Date.now() / 1000),
        cover_art_url: previous.cover_art_url,
      };
      setGhosts((g) => {
        const k = key(ghost);
        if (g.some((x) => key(x) === k)) return g;
        return [ghost, ...g];
      });
    }
    prev.current = current;
  }, [nowPlaying]);

  // Evict ghosts the server has now scrobbled (real took over), and drop
  // anything older than the TTL.
  useEffect(() => {
    if (ghosts.length === 0) return;
    const realKeys = new Set(real.map(key));
    const cutoff = Math.floor(Date.now() / 1000) - GHOST_TTL_MS / 1000;
    setGhosts((g) => {
      const next = g.filter((x) => !realKeys.has(key(x)) && x.timestamp >= cutoff);
      return next.length === g.length ? g : next;
    });
  }, [real, ghosts]);

  // Re-evaluate TTL on a slow tick so stale ghosts disappear even when
  // `real` isn't changing (e.g. user paused).
  useEffect(() => {
    const id = setInterval(() => {
      const cutoff = Math.floor(Date.now() / 1000) - GHOST_TTL_MS / 1000;
      setGhosts((g) => {
        const next = g.filter((x) => x.timestamp >= cutoff);
        return next.length === g.length ? g : next;
      });
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  return ghosts;
}
