import { Link } from "react-router-dom";
import { formatNumber } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export interface StatItem {
  name: string;
  play_count: number;
  cover_art_url: string | null;
  artist?: string;
}

export type StatListKind = "artist" | "album" | "track";

// Resolves the destination URL for a clickable row given the row's kind and
// the current scope (public vs me). Top-list rows always link to their
// respective detail page; tracks need an artist for a meaningful URL.
function rowHref(kind: StatListKind, item: StatItem, isAuthed: boolean): string | null {
  const base = isAuthed ? "/me" : "";
  if (kind === "artist") {
    // For artist rows the artist NAME lives in item.name (no item.artist).
    const name = item.artist ?? item.name;
    if (!name) return null;
    return `${base}/artist/${encodeURIComponent(name)}`;
  }
  if (!item.artist) return null;
  if (kind === "album") {
    return `${base}/album/${encodeURIComponent(item.artist)}/${encodeURIComponent(item.name)}`;
  }
  return `${base}/track/${encodeURIComponent(item.artist)}/${encodeURIComponent(item.name)}`;
}

export default function StatList({
  items,
  emptyMessage,
  startRank = 1,
  size = "md",
  kind,
}: {
  items: StatItem[];
  emptyMessage?: string;
  startRank?: number;
  size?: "sm" | "md";
  // Kind drives the destination route for each clickable row. Defaults to
  // "artist" if not provided, which preserves the prior behaviour for
  // unmigrated callers.
  kind?: StatListKind;
}) {
  const { isAuthed } = useAuth();
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage ?? "No data yet."}</p>;
  }
  const effectiveKind: StatListKind = kind ?? (items[0] && !items[0].artist ? "artist" : "album");
  const thumb = size === "sm" ? "h-9 w-9" : "h-11 w-11";
  return (
    <ol className="divide-y divide-border/70">
      {items.map((item, i) => {
        const rank = startRank + i;
        const href = rowHref(effectiveKind, item, isAuthed);
        const content = (
          <>
            <span className="w-7 text-right text-xs tabular-nums font-mono text-muted-foreground">
              {String(rank).padStart(2, "0")}
            </span>
            <div className={cn(thumb, "rounded-md bg-muted overflow-hidden flex-shrink-0 flex items-center justify-center")}>
              {item.cover_art_url ? (
                <img src={item.cover_art_url} alt="" loading="lazy" className="h-full w-full object-cover" />
              ) : (
                <span className="text-xs text-muted-foreground">♪</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="truncate text-sm font-medium">{item.name}</div>
              {item.artist && (
                <div className="truncate text-xs text-muted-foreground">{item.artist}</div>
              )}
            </div>
            <span className="text-sm tabular-nums font-medium">
              {formatNumber(item.play_count)}
              <span className="ml-1 text-[10px] uppercase tracking-wider text-muted-foreground font-normal">
                plays
              </span>
            </span>
          </>
        );
        return (
          <li key={`${item.name}-${item.artist ?? i}`}>
            {href ? (
              <Link
                to={href}
                className="flex items-center gap-3 py-2 hover:bg-muted/30 rounded-md px-2 -mx-2 transition-colors"
              >
                {content}
              </Link>
            ) : (
              <div className="flex items-center gap-3 py-2 px-2 -mx-2">{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
