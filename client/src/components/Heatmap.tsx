import { useMemo } from "react";

interface Point {
  date: string;
  count: number;
}

export default function Heatmap({ data, year }: { data: Point[]; year: number }) {
  const map = useMemo(() => new Map(data.map((d) => [d.date, d.count])), [data]);
  const max = useMemo(() => Math.max(1, ...data.map((d) => d.count)), [data]);

  const cells: Array<{ date: string; count: number }> = [];
  const start = new Date(`${year}-01-01T00:00:00Z`);
  const end = new Date(`${year + 1}-01-01T00:00:00Z`);
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    cells.push({ date: iso, count: map.get(iso) ?? 0 });
  }

  const leading = start.getUTCDay();
  const padded = Array.from({ length: leading }, () => null).concat(cells as never[]);

  return (
    <div className="overflow-x-auto">
      <div
        className="grid grid-flow-col gap-[3px]"
        style={{ gridTemplateRows: "repeat(7, minmax(0, 1fr))" }}
      >
        {padded.map((cell, i) => {
          if (!cell) return <div key={i} className="h-3 w-3" />;
          const c = cell as { date: string; count: number };
          if (c.count === 0) {
            return (
              <div
                key={i}
                className="h-3 w-3 rounded-[3px] bg-muted/60"
                title={`${c.date}: 0`}
              />
            );
          }
          const intensity = 0.35 + (c.count / max) * 0.65;
          return (
            <div
              key={i}
              className="h-3 w-3 rounded-[3px]"
              style={{ backgroundColor: `hsl(var(--accent) / ${intensity})` }}
              title={`${c.date}: ${c.count}`}
            />
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        Less
        <span className="h-2.5 w-2.5 rounded-sm bg-muted/60" />
        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "hsl(var(--accent) / 0.35)" }} />
        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "hsl(var(--accent) / 0.6)" }} />
        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "hsl(var(--accent) / 0.85)" }} />
        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "hsl(var(--accent))" }} />
        More
      </div>
    </div>
  );
}
