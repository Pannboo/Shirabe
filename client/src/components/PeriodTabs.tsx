import { PERIODS, periodLabel, type Period } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function PeriodTabs({
  value,
  onChange,
  align = "center",
}: {
  value: Period;
  onChange: (p: Period) => void;
  align?: "center" | "start";
}) {
  return (
    <div className={cn("flex", align === "center" ? "justify-center" : "justify-start")}>
      <div className="inline-flex rounded-full border border-border bg-card/60 p-1">
        {PERIODS.map((p) => {
          const active = p === value;
          return (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              className={cn(
                "px-4 py-1.5 rounded-full text-xs font-medium uppercase tracking-[0.16em] transition-colors",
                active
                  ? "bg-primary text-primary-foreground shadow"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {periodLabel(p)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
