import { Link, useParams } from "react-router-dom";
import ScrobbleFeed from "@/components/ScrobbleFeed";
import SectionTitle from "@/components/SectionTitle";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/lib/auth";
import { formatNumber, formatRelative } from "@/lib/format";
import type { AlbumDetailDto } from "@/lib/dto";

function fmtDate(epoch: number | null): string | null {
  if (!epoch) return null;
  const d = new Date(epoch * 1000);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function fmtDuration(secs: number | null): string {
  if (!secs) return "";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AlbumDetail({ scope }: { scope: "public" | "me" }) {
  const { artist, album } = useParams<{ artist: string; album: string }>();
  const { isAuthed } = useAuth();
  const path = scope === "public"
    ? `/api/public/albums/${encodeURIComponent(artist ?? "")}/${encodeURIComponent(album ?? "")}`
    : `/api/me/albums/${encodeURIComponent(artist ?? "")}/${encodeURIComponent(album ?? "")}`;
  const { data, loading } = useApi<AlbumDetailDto>(path, [artist, album], { pollMs: 30_000 });

  if (loading && !data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data) return <p className="text-sm text-muted-foreground">No data.</p>;

  const max = Math.max(1, ...data.monthly.map((m) => m.count));
  const firstPlayed = fmtDate(data.first_listen_at);
  const artistBase = isAuthed ? "/me/artist" : "/artist";

  return (
    <div className="space-y-12">
      {/* === Hero ============================================================ */}
      <section className="grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] gap-6 md:gap-10 items-start">
        <div className="aspect-square w-full md:w-60 rounded-xl bg-muted overflow-hidden flex items-center justify-center">
          {data.cover_art_url ? (
            <img src={data.cover_art_url} alt={data.album} className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <span className="text-4xl text-muted-foreground">♪</span>
          )}
        </div>

        <div className="min-w-0 flex flex-col gap-4">
          <div className="eyebrow">Album</div>
          <h1 className="font-serif text-5xl md:text-6xl lg:text-7xl tracking-tight leading-[1.05] break-words">
            {data.album}
            {data.rank ? (
              <span className="ml-3 align-middle text-muted-foreground/70 text-xl md:text-2xl font-sans tabular-nums">
                #{data.rank}
              </span>
            ) : null}
          </h1>
          <div className="text-base text-muted-foreground">
            By{" "}
            <Link to={`${artistBase}/${encodeURIComponent(data.artist)}`} className="text-foreground hover:underline">
              {data.artist}
            </Link>
            {data.release_year ? <> · {data.release_year}</> : null}
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <div>
              <span className="tabular-nums text-foreground">{formatNumber(data.total_plays)}</span> plays
              <span className="mx-1.5 text-muted-foreground/40">·</span>
              <span className="tabular-nums text-foreground">{formatNumber(data.unique_tracks)}</span> tracks played
            </div>
            {firstPlayed && <div>First played {firstPlayed}</div>}
            {data.last_listen_at && <div>Last played {formatRelative(data.last_listen_at)}</div>}
          </div>
        </div>
      </section>

      {/* === Listens over time (hidden if <2 months) ====================== */}
      {data.monthly.length >= 2 && (
        <section>
          <SectionTitle>Listens over time</SectionTitle>
          <div className="flex items-end gap-1 h-24">
            {data.monthly.map((m) => (
              <div
                key={m.month}
                className="flex-1 rounded-t bg-accent/70 hover:bg-accent transition-colors"
                style={{ height: `${(m.count / max) * 100}%`, minHeight: 2 }}
                title={`${m.month}: ${m.count}`}
              />
            ))}
          </div>
        </section>
      )}

      {/* === Tracklist + recent =========================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-10 lg:gap-12">
        <section>
          <SectionTitle trailing={`${data.tracks.length} tracks`}>Tracklist</SectionTitle>
          {data.tracks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tracks resolved yet.</p>
          ) : (
            <ol className="divide-y divide-border/70">
              {data.tracks.map((t) => {
                const href = `${isAuthed ? "/me" : ""}/track/${encodeURIComponent(data.artist)}/${encodeURIComponent(t.title)}`;
                return (
                  <li key={`${t.position}-${t.title}`}>
                    <Link
                      to={href}
                      className="flex items-center gap-3 py-2 px-2 -mx-2 hover:bg-muted/30 rounded-md transition-colors"
                    >
                      <span className="w-7 text-right text-xs tabular-nums font-mono text-muted-foreground">
                        {String(t.position).padStart(2, "0")}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-sm font-medium">{t.title}</div>
                      </div>
                      {t.duration_seconds ? (
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {fmtDuration(t.duration_seconds)}
                        </span>
                      ) : null}
                      <span className="text-sm tabular-nums font-medium w-20 text-right">
                        {t.play_count > 0 ? formatNumber(t.play_count) : "—"}
                        {t.play_count > 0 && (
                          <span className="ml-1 text-[10px] uppercase tracking-wider text-muted-foreground font-normal">
                            plays
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section>
          <SectionTitle>Last played</SectionTitle>
          <ScrobbleFeed scrobbles={data.recent} animateEnter={false} />
        </section>
      </div>
    </div>
  );
}
