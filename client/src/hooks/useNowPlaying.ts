import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export interface NowPlayingDto {
  is_live: boolean;
  track: string;
  artist: string;
  album: string | null;
  timestamp: number;
  cover_art_url: string | null;
  duration: number | null;
  started_at: number;
}

const POLL_MS = 5_000;

// Single shared poller so the hero NowPlaying card and the live scrobble row
// at the top of the feed share one network subscription. Pauses while the
// tab is hidden.
export function useNowPlaying(): NowPlayingDto | null {
  const [data, setData] = useState<NowPlayingDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    let id: ReturnType<typeof setInterval> | null = null;

    async function tick() {
      try {
        const next = await api<NowPlayingDto | null>("/api/public/now-playing");
        if (!cancelled) setData(next);
      } catch {
        /* ignore — keep previous value */
      }
    }
    function start() {
      if (id !== null) return;
      tick();
      id = setInterval(tick, POLL_MS);
    }
    function stop() {
      if (id !== null) {
        clearInterval(id);
        id = null;
      }
    }
    function onVis() {
      if (document.visibilityState === "visible") start();
      else stop();
    }
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return data;
}
