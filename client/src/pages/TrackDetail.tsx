import { Link, useParams } from "react-router-dom";
import SectionTitle from "@/components/SectionTitle";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/lib/auth";
import { formatNumber, formatRelative } from "@/lib/format";
import type { TrackDetailDto } from "@/lib/dto";

function fmtDate(epoch: number | null): string | null {
  if (!epoch) return null;
  const d = new Date(epoch * 1000);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export default function TrackDetail({ scope }: { scope: "public" | "me" }) {
  const { artist, track } = useParams<{ artist: string; track: string }>();
  const { isAuthed } = useAuth();
  const path = scope === "public"
    ? `/api/public/tracks/${encodeURIComponent(artist ?? "")}/${encodeURIComponent(track ?? "")}`
    : `/api/me/tracks/${encodeURIComponent(artist ?? "")}/${encodeURIComponent(track ?? "")}`;
  const { data, loading } = useApi<TrackDetailDto>(path, [artist, track], { pollMs: 30_000 });

  if (loading && !data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data) return <p className="text-sm text-muted-foreground">No data.</p>;

  const max = Math.max(1, ...data.monthly.map((m) => m.count));
  const firstPlayed = fmtDate(data.first_listen_at);
  const artistBase = isAuthed ? "/me/artist" : "/artist";
  const albumBase = isAuthed ? "/me/album" : "/album";

  return (
    <div className="space-y-12">
      {/* === Hero ============================================================ */}
      <section className="grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] gap-6 md:gap-10 items-start">
        <div className="aspect-square w-full md:w-60 rounded-xl bg-muted overflow-hidden flex items-center justify-center">
          {data.cover_art_url ? (
            <img src={data.cover_art_url} alt={data.track} className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <span className="text-4xl text-muted-foreground">♪</span>
          )}
        </div>

        <div className="min-w-0 flex flex-col gap-4">
          <div className="eyebrow">Track</div>
          <h1 className="font-serif text-5xl md:text-6xl lg:text-7xl tracking-tight leading-[1.05] break-words">
            {data.track}
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
            {data.primary_album ? (
              <>
                {" "}on{" "}
                <Link
                  to={`${albumBase}/${encodeURIComponent(data.artist)}/${encodeURIComponent(data.primary_album)}`}
                  className="text-foreground hover:underline"
                >
                  {data.primary_album}
                </Link>
              </>
            ) : null}
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <div>
              <span className="tabular-nums text-foreground">{formatNumber(data.total_plays)}</span> plays
            </div>
            {firstPlayed && <div>First played {firstPlayed}</div>}
            {data.last_listen_at && <div>Last played {formatRelative(data.last_listen_at)}</div>}
          </div>
        </div>
      </section>

      {/* === Listens over time ============================================ */}
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

      {/* === Play timeline + Also on ====================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-10 lg:gap-12">
        <section>
          <SectionTitle trailing={`${data.recent_plays.length} plays shown`}>Play history</SectionTitle>
          {data.recent_plays.length === 0 ? (
            <p className="text-sm text-muted-foreground">No plays recorded.</p>
          ) : (
            <ul className="divide-y divide-border/70 text-sm">
              {data.recent_plays.map((p, i) => (
                <li key={i} className="flex items-center justify-between py-2 gap-3">
                  <span className="text-muted-foreground">
                    {new Date(p.timestamp * 1000).toLocaleString()}
                  </span>
                  {p.album && (
                    <span className="text-xs text-muted-foreground truncate">
                      on {p.album}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <SectionTitle>Also on</SectionTitle>
          {data.albums_appeared_on.length === 0 ? (
            <p className="text-sm text-muted-foreground">No album info.</p>
          ) : (
            <ul className="divide-y divide-border/70">
              {data.albums_appeared_on.map((a) => (
                <li key={a.name}>
                  <Link
                    to={`${albumBase}/${encodeURIComponent(data.artist)}/${encodeURIComponent(a.name)}`}
                    className="flex items-center gap-3 py-2 px-2 -mx-2 hover:bg-muted/30 rounded-md transition-colors"
                  >
                    <div className="h-10 w-10 rounded-md bg-muted overflow-hidden flex items-center justify-center flex-shrink-0">
                      {a.cover_art_url ? (
                        <img src={a.cover_art_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-xs text-muted-foreground">♪</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 text-sm truncate">{a.name}</div>
                    <span className="text-sm tabular-nums font-medium">
                      {formatNumber(a.play_count)}
                      <span className="ml-1 text-[10px] uppercase tracking-wider text-muted-foreground font-normal">
                        plays
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
