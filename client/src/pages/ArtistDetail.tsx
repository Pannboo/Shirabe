import { useParams } from "react-router-dom";
import StatList from "@/components/StatList";
import ScrobbleFeed from "@/components/ScrobbleFeed";
import SectionTitle from "@/components/SectionTitle";
import ArtistLinks, { type ArtistLink } from "@/components/ArtistLinks";
import { useApi } from "@/hooks/useApi";
import { formatNumber } from "@/lib/format";

interface ArtistDetailDto {
  artist: string;
  total_scrobbles: number;
  unique_albums: number;
  unique_tracks: number;
  monthly: { month: string; count: number }[];
  top_albums: { name: string; play_count: number; cover_art_url: string | null }[];
  top_tracks: { name: string; play_count: number }[];
  recent: { track: string; artist: string; album: string | null; timestamp: number; cover_art_url: string | null }[];
  rank: number | null;
  minutes_listened: number;
  first_listen_at: number | null;
  cover_art_url: string | null;
  mb_artist_id: string | null;
  links: ArtistLink[];
}

function formatStartDate(epoch: number | null): string | null {
  if (!epoch) return null;
  const d = new Date(epoch * 1000);
  const dd = d.getDate().toString().padStart(2, "0");
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export default function ArtistDetail({ scope }: { scope: "public" | "me" }) {
  const { name } = useParams<{ name: string }>();
  const path = scope === "public"
    ? `/api/public/artists/${encodeURIComponent(name ?? "")}`
    : `/api/me/artists/${encodeURIComponent(name ?? "")}`;
  // Poll on a slow tick so the artist photo and external-links panel fill
  // in without a manual refresh once the background resolvers finish.
  const { data, loading } = useApi<ArtistDetailDto>(path, [name], { pollMs: 30_000 });

  if (loading && !data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data) return <p className="text-sm text-muted-foreground">No data.</p>;

  const max = Math.max(1, ...data.monthly.map((m) => m.count));
  const since = formatStartDate(data.first_listen_at);

  return (
    <div className="space-y-12">
      {/* === Hero ======================================================
          All three columns top-align to the artist photo so the eyebrow +
          name appear anchored to the top of the row rather than floating
          mid-page when the External rail happens to be taller. */}
      <section className="grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)_180px] gap-6 md:gap-10 items-start">
        {/* Square artist photo (or album-cover fallback) */}
        <div className="aspect-square w-full md:w-60 rounded-xl bg-muted overflow-hidden flex items-center justify-center">
          {data.cover_art_url ? (
            <img
              src={data.cover_art_url}
              alt={data.artist}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <span className="text-4xl text-muted-foreground">♪</span>
          )}
        </div>

        {/* Name + stat lockup */}
        <div className="min-w-0 flex flex-col gap-4">
          <div className="eyebrow">Artist</div>
          <h1 className="font-serif text-5xl md:text-6xl lg:text-7xl tracking-tight leading-[1.05] break-words">
            {data.artist}
            {data.rank ? (
              <span className="ml-3 align-middle text-muted-foreground/70 text-xl md:text-2xl font-sans tabular-nums">
                #{data.rank}
              </span>
            ) : null}
          </h1>
          <div className="text-sm text-muted-foreground space-y-1">
            <div>
              <span className="tabular-nums text-foreground">{formatNumber(data.total_scrobbles)}</span> plays
              <span className="mx-1.5 text-muted-foreground/40">·</span>
              <span className="tabular-nums text-foreground">{formatNumber(data.unique_albums)}</span> albums
              <span className="mx-1.5 text-muted-foreground/40">·</span>
              <span className="tabular-nums text-foreground">{formatNumber(data.unique_tracks)}</span> tracks
            </div>
            <div>
              <span className="tabular-nums text-foreground">{formatNumber(data.minutes_listened)}</span> minutes listened
            </div>
            {since && <div>Listening since {since}</div>}
          </div>

          {/* On md (no right rail) the links wrap as a flow row under the
              stat lockup. The lg right-rail panel renders separately. */}
          {data.links.length > 0 && (
            <div className="lg:hidden pt-2">
              <ArtistLinks links={data.links} layout="flow" />
            </div>
          )}
        </div>

        {/* Right rail — only at lg+ */}
        <div className="hidden lg:block">
          <ArtistLinks links={data.links} layout="rail" />
        </div>
      </section>

      {/* === Listens over time (flattened, no card) ====================
          Hidden when there's fewer than 2 months of data — a single bar at
          100% height looks like a render bug, not a chart. */}
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

      {/* === Top tracks / Top albums / Last played ===================== */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10 lg:gap-12">
        <section>
          <SectionTitle>Top tracks</SectionTitle>
          <StatList
            items={data.top_tracks.map((t) => ({ ...t, cover_art_url: null, artist: data.artist }))}
            emptyMessage="No tracks yet."
            kind="track"
          />
        </section>
        <section>
          <SectionTitle>Top albums</SectionTitle>
          <StatList
            items={data.top_albums.map((a) => ({ ...a, artist: data.artist }))}
            emptyMessage="No albums yet."
            kind="album"
          />
        </section>
        <section>
          <SectionTitle>Last played</SectionTitle>
          <ScrobbleFeed scrobbles={data.recent} animateEnter={false} />
        </section>
      </div>
    </div>
  );
}
