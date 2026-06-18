import { Link } from "react-router-dom";
import SectionTitle from "./SectionTitle";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import type { OnThisDayResponse } from "@/lib/dto";

// "On this day" — small horizontal scroll of tracks the user played on
// today's calendar date in previous years. Hidden when there's nothing to
// show, so new users don't see an empty section.
//
// Polls slowly (5 min) — the data only ticks over once per day at most.
export default function OnThisDay() {
  const { isAuthed } = useAuth();
  const { data } = useApi<OnThisDayResponse>(
    "/api/me/trivia/on-this-day",
    [],
    { pollMs: 5 * 60_000 },
  );

  if (!isAuthed) return null;
  if (!data || data.items.length === 0) return null;

  const trackBase = "/me/track";
  const yearNow = new Date().getFullYear();

  return (
    <section>
      <SectionTitle>On this day</SectionTitle>
      <div className="-mx-1 flex overflow-x-auto pb-2 snap-x snap-mandatory">
        {data.items.map((item, i) => {
          const yearsAgo = yearNow - item.year;
          return (
            <Link
              key={`${item.year}-${item.artist}-${item.track}-${i}`}
              to={`${trackBase}/${encodeURIComponent(item.artist)}/${encodeURIComponent(item.track)}`}
              className="snap-start group mx-1 flex w-64 flex-shrink-0 items-center gap-3 rounded-lg border border-border/40 bg-card/30 hover:bg-muted/30 hover:border-border transition-colors px-3 py-2.5"
            >
              <div className="h-12 w-12 rounded-md bg-muted overflow-hidden flex items-center justify-center flex-shrink-0">
                {item.cover_art_url ? (
                  <img src={item.cover_art_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-xs text-muted-foreground">♪</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="eyebrow text-[9px] mb-0.5">
                  {yearsAgo === 1 ? "1 year ago" : `${yearsAgo} years ago`}
                </div>
                <div className="truncate text-sm font-medium group-hover:text-foreground">{item.track}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {item.artist}
                  {" · "}
                  <span className="tabular-nums">{formatNumber(item.plays)}</span>×
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
