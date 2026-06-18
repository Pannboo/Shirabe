import { Link } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StatItem } from "@/components/StatList";

export default function HeroCard({
  item,
  kind,
  emptyLabel,
}: {
  item: StatItem | undefined;
  kind: "artist" | "album";
  emptyLabel: string;
}) {
  const { isAuthed } = useAuth();
  if (!item) {
    return (
      <div className="aspect-[4/3] rounded-2xl border border-border bg-card/60 flex items-center justify-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }
  const artistName = kind === "artist" ? item.name : item.artist;
  const base = isAuthed ? "/me/artist" : "/artist";
  const to = artistName ? `${base}/${encodeURIComponent(artistName)}` : undefined;
  const body = (
    <div className={cn("relative aspect-[4/3] overflow-hidden rounded-2xl border border-border bg-card group")}>
      {item.cover_art_url ? (
        <img
          src={item.cover_art_url}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-5xl text-muted-foreground bg-muted">
          ♪
        </div>
      )}
      <div className="absolute inset-0 hero-mask" />
      <div className="absolute inset-x-0 bottom-0 p-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-accent mb-1">
          #1 {kind}
        </div>
        <div className="text-2xl font-semibold leading-tight line-clamp-2">{item.name}</div>
        {kind === "album" && item.artist ? (
          <div className="text-sm text-muted-foreground truncate">{item.artist}</div>
        ) : null}
        <div className="mt-2 text-xs text-muted-foreground">
          <span className="tabular-nums font-medium text-foreground">{formatNumber(item.play_count)}</span> plays
        </div>
      </div>
    </div>
  );
  return to ? (
    <Link to={to} className="block focus:outline-none focus:ring-2 focus:ring-ring rounded-2xl">
      {body}
    </Link>
  ) : (
    body
  );
}
