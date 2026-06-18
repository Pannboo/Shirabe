import { AnimatePresence, motion } from "framer-motion";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { NowPlayingDto } from "@/hooks/useNowPlaying";

interface Scrobble {
  track: string;
  artist: string;
  album: string | null;
  timestamp: number;
  cover_art_url?: string | null;
}

// Content-based key for ghost↔real reconciliation. When a ghost scrobble is
// replaced by the matching server scrobble the React element stays mounted —
// only the timestamp prop changes — so framer-motion's `layout` animates the
// row in place instead of exit+enter (which used to flash).
function rowKey(s: { artist: string; track: string }): string {
  return `${s.artist.toLowerCase()}|${s.track.toLowerCase()}`;
}

// Drop duplicates that share the same (artist, track), keeping the first one
// (most-recent). Ghosts are already deduped against real; this also catches
// rare cases where the user plays the same song twice within the feed window.
function dedupe(scrobbles: Scrobble[]): Scrobble[] {
  const seen = new Set<string>();
  const out: Scrobble[] = [];
  for (const s of scrobbles) {
    const k = rowKey(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

export default function ScrobbleFeed({
  scrobbles,
  animateEnter = true,
  nowPlaying,
}: {
  scrobbles: Scrobble[];
  animateEnter?: boolean;
  nowPlaying?: NowPlayingDto | null;
}) {
  const showLive = !!nowPlaying?.is_live;

  // De-dupe the visible list against the live row so the currently-playing
  // track isn't shown twice while it's still live.
  const visible = (() => {
    const filtered = showLive && nowPlaying
      ? scrobbles.filter(
          (s) => rowKey(s) !== rowKey({ artist: nowPlaying.artist, track: nowPlaying.track }),
        )
      : scrobbles;
    return dedupe(filtered);
  })();

  if (visible.length === 0 && !showLive) {
    return <p className="text-sm text-muted-foreground">No scrobbles yet.</p>;
  }

  return (
    <ul className="space-y-px">
      <AnimatePresence initial={false}>
        {showLive && nowPlaying ? (
          <motion.li
            key="live"
            layout
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          >
            <Row
              cover={nowPlaying.cover_art_url}
              artist={nowPlaying.artist}
              track={nowPlaying.track}
              right={<LivePulse />}
              live
            />
          </motion.li>
        ) : null}
        {visible.map((s) => (
          <motion.li
            key={rowKey(s)}
            layout
            initial={animateEnter ? { opacity: 0, y: -10 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <Row
              cover={s.cover_art_url}
              artist={s.artist}
              track={s.track}
              right={
                <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                  {formatRelative(s.timestamp)}
                </span>
              }
            />
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function Row({
  cover,
  artist,
  track,
  right,
  live = false,
}: {
  cover: string | null | undefined;
  artist: string;
  track: string;
  right: React.ReactNode;
  live?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-lg px-2 py-2 transition-colors",
        live ? "bg-accent/5" : "hover:bg-muted/30",
      )}
    >
      <div
        className={cn(
          "h-11 w-11 rounded-md bg-muted overflow-hidden flex items-center justify-center flex-shrink-0",
          live && "ring-2 ring-accent ring-offset-2 ring-offset-background",
        )}
      >
        {cover ? (
          <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="text-xs text-muted-foreground">♪</span>
        )}
      </div>
      <div className="min-w-0 flex-1 truncate text-sm">
        <span className="font-semibold">{artist}</span>
        <span className="text-muted-foreground"> — </span>
        <span className="text-muted-foreground">{track}</span>
      </div>
      {right}
    </div>
  );
}

function LivePulse() {
  return (
    <span className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent whitespace-nowrap">
      <span className="relative inline-flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-60 live-pulse" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
      </span>
      Now playing
    </span>
  );
}
