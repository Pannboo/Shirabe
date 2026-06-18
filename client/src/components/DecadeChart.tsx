import { useMemo } from "react";
import { formatNumber } from "@/lib/format";

export interface DecadeRow {
  decade: number;
  count: number;
}

export default function DecadeChart({
  decades,
  albumsResolved,
  albumsTotal,
}: {
  decades: DecadeRow[];
  albumsResolved: number;
  albumsTotal: number;
}) {
  const { padded, max } = useMemo(() => {
    if (decades.length === 0) return { padded: [] as DecadeRow[], max: 0 };
    const min = decades[0]!.decade;
    const top = decades[decades.length - 1]!.decade;
    const all: DecadeRow[] = [];
    for (let d = min; d <= top; d += 10) {
      const found = decades.find((r) => r.decade === d);
      all.push({ decade: d, count: found?.count ?? 0 });
    }
    const mx = Math.max(...all.map((r) => r.count));
    return { padded: all, max: mx };
  }, [decades]);

  if (albumsTotal === 0) {
    return <p className="text-sm text-muted-foreground">No album scrobbles yet.</p>;
  }

  const resolutionPct = albumsTotal > 0 ? Math.round((albumsResolved / albumsTotal) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2 h-40 min-h-[10rem]">
        {padded.map((d) => {
          const pct = max > 0 ? (d.count / max) * 100 : 0;
          return (
            <div key={d.decade} className="flex-1 flex flex-col items-center gap-2 min-w-0">
              <div className="text-[10px] tabular-nums text-muted-foreground">
                {d.count > 0 ? formatNumber(d.count) : ""}
              </div>
              <div className="w-full flex-1 flex items-end">
                <div
                  className="w-full rounded-t bg-accent/70 hover:bg-accent transition-colors"
                  style={{ height: `${pct}%`, minHeight: d.count > 0 ? 4 : 0 }}
                  title={`${d.decade}s: ${d.count} plays`}
                />
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {String(d.decade).slice(-2)}s
              </div>
            </div>
          );
        })}
      </div>
      {resolutionPct < 95 && (
        <p className="text-[11px] text-muted-foreground">
          Showing {formatNumber(albumsResolved)} of {formatNumber(albumsTotal)} albums ({resolutionPct}%) —
          release years are still being resolved from MusicBrainz. Refresh later to see more.
        </p>
      )}
    </div>
  );
}
