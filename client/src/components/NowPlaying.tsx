import { useNowPlaying } from "@/hooks/useNowPlaying";
import { formatRelative } from "@/lib/format";

export default function NowPlaying() {
  const data = useNowPlaying();
  if (!data) return null;

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
        </div>
      </div>
    </div>
  );
}
