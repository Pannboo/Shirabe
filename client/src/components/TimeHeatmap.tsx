import { useMemo } from "react";

export interface TimeOfDayCell {
  day_of_week: number;
  hour: number;
  count: number;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function TimeHeatmap({ cells }: { cells: TimeOfDayCell[] }) {
  const { matrix, max, total } = useMemo(() => {
    const m: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    let mx = 0;
    let tot = 0;
    for (const c of cells) {
      if (c.day_of_week < 0 || c.day_of_week > 6) continue;
      if (c.hour < 0 || c.hour > 23) continue;
      m[c.day_of_week]![c.hour] = c.count;
      tot += c.count;
      if (c.count > mx) mx = c.count;
    }
    return { matrix: m, max: mx, total: tot };
  }, [cells]);

  if (total === 0) {
    return <p className="text-sm text-muted-foreground">Not enough scrobbles yet to plot.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        {/* Hour labels — show every 3rd to avoid clutter */}
        <div className="flex pl-10 mb-1">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="flex-1 text-center text-[10px] text-muted-foreground tabular-nums">
              {h % 3 === 0 ? `${h.toString().padStart(2, "0")}` : ""}
            </div>
          ))}
        </div>
        {matrix.map((row, dow) => (
          <div key={dow} className="flex items-center gap-1">
            <div className="w-10 text-[10px] uppercase tracking-wider text-muted-foreground text-right pr-1">
              {DAY_LABELS[dow]}
            </div>
            {row.map((count, hour) => {
              const intensity = count === 0 ? 0 : 0.35 + (count / max) * 0.65;
              return (
                <div
                  key={hour}
                  className="flex-1 aspect-square rounded-[3px] min-w-[10px]"
                  style={{
                    backgroundColor:
                      count === 0 ? "hsl(var(--muted) / 0.5)" : `hsl(var(--accent) / ${intensity})`,
                  }}
                  title={`${DAY_LABELS[dow]} ${hour.toString().padStart(2, "0")}:00 — ${count} plays`}
                />
              );
            })}
          </div>
        ))}
        <div className="mt-3 flex items-center justify-end gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          Less
          <span className="h-2.5 w-2.5 rounded-sm bg-muted/50" />
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "hsl(var(--accent) / 0.35)" }} />
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "hsl(var(--accent) / 0.6)" }} />
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "hsl(var(--accent) / 0.85)" }} />
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "hsl(var(--accent))" }} />
          More
        </div>
      </div>
    </div>
  );
}
