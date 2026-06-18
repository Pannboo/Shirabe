import { useState } from "react";
import { Link } from "react-router-dom";
import StatList from "@/components/StatList";
import HeroCard from "@/components/HeroCard";
import SectionTitle from "@/components/SectionTitle";
import { useApi } from "@/hooks/useApi";
import type { RewindHighlight, RewindResponse } from "@/lib/dto";
import { formatNumber } from "@/lib/format";

function fmtLongDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

function fmtMonthName(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  if (!y || !m) return yearMonth;
  const date = new Date(`${y}-${m}-01T00:00:00Z`);
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function fmtTimestamp(epoch: number): string {
  const d = new Date(epoch * 1000);
  return d.toLocaleString(undefined, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

export default function PublicRewind() {
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const { data, loading } = useApi<RewindResponse>(`/api/public/stats/rewind/${year}`, [year]);

  return (
    <div className="space-y-14">
      <div className="flex items-center justify-between gap-3">
        <button
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setYear(year - 1)}
        >
          ← {year - 1}
        </button>
        <h2 className="font-serif text-5xl md:text-6xl tracking-tight leading-none">
          {year} <span className="text-muted-foreground/70">Rewind</span>
        </h2>
        <button
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setYear(year + 1)}
        >
          {year + 1} →
        </button>
      </div>

      {loading && <p className="text-sm text-muted-foreground text-center">Loading…</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Scrobbles" value={data.total_scrobbles} />
            <Stat label="Artists" value={data.unique_artists} />
            <Stat label="Albums" value={data.unique_albums} />
            <Stat label="Tracks" value={data.unique_tracks} />
          </div>

          <section>
            <SectionTitle>The year, by the numbers</SectionTitle>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
              {data.longest_streak_days > 0 && (
                <Storyline
                  label="Longest streak"
                  value={`${formatNumber(data.longest_streak_days)} days`}
                  detail="consecutive days with at least one scrobble"
                />
              )}
              {data.biggest_day && (
                <Storyline
                  label="Biggest day"
                  value={`${formatNumber(data.biggest_day.count)} plays`}
                  detail={fmtLongDate(data.biggest_day.date)}
                />
              )}
              {data.biggest_week && (
                <Storyline
                  label="Biggest week"
                  value={`${formatNumber(data.biggest_week.count)} plays`}
                  detail={`week of ${fmtLongDate(data.biggest_week.start_date)}`}
                />
              )}
              {data.biggest_month && (
                <Storyline
                  label="Biggest month"
                  value={`${formatNumber(data.biggest_month.count)} plays`}
                  detail={fmtMonthName(data.biggest_month.month)}
                />
              )}
            </div>
          </section>

          {(data.new_artists_discovered > 0 || data.new_albums_discovered > 0) && (
            <section>
              <SectionTitle>What was discovered</SectionTitle>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
                <Storyline
                  label="New artists"
                  value={formatNumber(data.new_artists_discovered)}
                  detail="first-ever scrobbled this year"
                />
                <Storyline
                  label="New albums"
                  value={formatNumber(data.new_albums_discovered)}
                  detail="first-ever scrobbled this year"
                />
              </div>
            </section>
          )}

          {(data.first_scrobble_of_year || data.last_scrobble_of_year) && (
            <section>
              <SectionTitle>Bookends</SectionTitle>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {data.first_scrobble_of_year && (
                  <BookendCard label="First track of the year" item={data.first_scrobble_of_year} />
                )}
                {data.last_scrobble_of_year && (
                  <BookendCard label="Latest track of the year" item={data.last_scrobble_of_year} />
                )}
              </div>
            </section>
          )}

          <section>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div>
                <SectionTitle>Top artists</SectionTitle>
                <HeroCard item={data.top_artists[0]} kind="artist" emptyLabel="No data" />
                <div className="mt-3">
                  <StatList items={data.top_artists.slice(1, 6)} startRank={2} size="sm" kind="artist" />
                </div>
              </div>
              <div>
                <SectionTitle>Top albums</SectionTitle>
                <HeroCard item={data.top_albums[0]} kind="album" emptyLabel="No data" />
                <div className="mt-3">
                  <StatList items={data.top_albums.slice(1, 6)} startRank={2} size="sm" kind="album" />
                </div>
              </div>
              <div>
                <SectionTitle>Top tracks</SectionTitle>
                <StatList items={data.top_tracks.slice(0, 10)} startRank={1} kind="track" />
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center py-3">
      <div className="font-serif text-4xl md:text-5xl tabular-nums leading-none">{formatNumber(value)}</div>
      <div className="eyebrow mt-2">{label}</div>
    </div>
  );
}

function Storyline({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div>
      <div className="eyebrow mb-2">{label}</div>
      <div className="font-serif text-3xl md:text-4xl tabular-nums leading-tight">{value}</div>
      <div className="text-sm text-muted-foreground mt-1">{detail}</div>
    </div>
  );
}

function BookendCard({ label, item }: { label: string; item: RewindHighlight }) {
  const albumHref = item.album
    ? `/album/${encodeURIComponent(item.artist)}/${encodeURIComponent(item.album)}`
    : null;
  const trackHref = `/track/${encodeURIComponent(item.artist)}/${encodeURIComponent(item.track)}`;
  return (
    <div className="flex items-center gap-4">
      <div className="h-16 w-16 rounded-md bg-muted overflow-hidden flex items-center justify-center flex-shrink-0">
        {item.cover_art_url ? (
          <img src={item.cover_art_url} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="text-lg text-muted-foreground">♪</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="eyebrow mb-1">{label}</div>
        <div className="text-base font-medium truncate">
          <Link to={trackHref} className="hover:underline">{item.track}</Link>
        </div>
        <div className="text-sm text-muted-foreground truncate">
          {item.artist}
          {item.album ? (
            <>
              {" — "}
              {albumHref ? <Link to={albumHref} className="hover:underline">{item.album}</Link> : item.album}
            </>
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground mt-1">{fmtTimestamp(item.timestamp)}</div>
      </div>
    </div>
  );
}
