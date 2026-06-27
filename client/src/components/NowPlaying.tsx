import { useEffect, useState } from "react";
import { useNowPlaying } from "@/hooks/useNowPlaying";
import { formatRelative } from "@/lib/format";

function mmss(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

export default function NowPlaying() {
  const data = useNowPlaying();
  // Tick once a second so the progress bar advances smoothly between the
  // 5-second now-playing polls.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!data?.is_live || !data.duration) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [data?.is_live, data?.duration]);

  if (!data) return null;

  const showBar = data.is_live && data.duration && data.duration > 0;
  const elapsed = showBar
    ? Math.min(
        data.duration!,
        Math.max(0, Math.floor(Date.now() / 1000) - data.started_at),
      )
    : 0;
  const pct = showBar ? (elapsed / data.duration!) * 100 : 0;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card">
      {data.cover_art_url ? (
        <div
          aria-hidden
          className="absolute inset-0 opacity-25 blur-2xl scale-110"
          style={{
            backgroundImage: `url(${data.cover_art_url})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      ) : null}
      <div className="relative flex items-center gap-4 p-4">
        <div className="h-20 w-20 rounded-xl bg-muted overflow-hidden flex items-center justify-center flex-shrink-0 shadow-lg">
          {data.cover_art_url ? (
            <img src={data.cover_art_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-2xl text-muted-foreground">♪</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 mb-1">
            {data.is_live ? (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
                <span className="relative inline-flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-60 live-pulse" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                </span>
                Now playing
              </span>
            ) : (
              <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Last played · {formatRelative(data.timestamp)}
              </span>
            )}
          </div>
          <div className="truncate text-lg font-semibold">{data.track}</div>
          <div className="truncate text-sm text-muted-foreground">
            {data.artist}
            {data.album ? ` — ${data.album}` : ""}
          </div>
          {showBar ? (
            <div className="mt-2 flex items-center gap-2 text-[10px] tabular-nums text-muted-foreground">
              <span>{mmss(elapsed)}</span>
              <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-1000 ease-linear"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span>{mmss(data.duration!)}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
