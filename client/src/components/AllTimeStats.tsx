import { formatNumber } from "@/lib/format";

export interface SummaryDto {
  plays: number;
  tracks: number;
  albums: number;
  artists: number;
  days_active: number;
  longest_streak_days: number;
  avg_daily_plays: number;
  first_scrobble_at: number | null;
}

interface Cell {
  label: string;
  value: string;
}

function cellsFor(s: SummaryDto): Cell[] {
  return [
    { label: "Plays", value: formatNumber(s.plays) },
    { label: "Tracks", value: formatNumber(s.tracks) },
    { label: "Albums", value: formatNumber(s.albums) },
    { label: "Artists", value: formatNumber(s.artists) },
    { label: "Days active", value: formatNumber(s.days_active) },
    { label: "Longest streak", value: `${formatNumber(s.longest_streak_days)}d` },
    { label: "Avg / day", value: formatNumber(s.avg_daily_plays) },
  ];
}

export default function AllTimeStats({ summary }: { summary: SummaryDto | null | undefined }) {
  if (!summary) {
    return <div className="py-4 text-sm text-muted-foreground">Loading stats…</div>;
  }
  const cells = cellsFor(summary);
  return (
    <div className="py-2">
      <div className="mb-4 flex items-baseline justify-between">
        <span className="eyebrow">All-time</span>
        {summary.first_scrobble_at ? (
          <span className="text-xs text-muted-foreground">
            since {new Date(summary.first_scrobble_at * 1000).toLocaleDateString()}
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4 lg:grid-cols-7">
        {cells.map((c) => (
          <div key={c.label} className="flex flex-col">
            <span className="font-serif text-2xl md:text-3xl tabular-nums leading-none">
              {c.value}
            </span>
            <span className="eyebrow mt-2">{c.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
