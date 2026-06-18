import { Download, ExternalLink, X } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

export interface SuggestionDto {
  id: number;
  source: "lastfm" | "listenbrainz" | "musicbrainz" | "pitchfork" | "albumoftheyear" | "anydecentmusic" | "stereogum" | "npr" | "rym";
  artist: string;
  title: string | null;
  cover_art_url: string | null;
  match_status: "matched" | "unmatched" | "ambiguous" | "unresolved";
  mode: "album" | "track";
  score: number | null;
  reason: string | null;
}

const sourceLabel: Record<SuggestionDto["source"], string> = {
  lastfm: "Last.fm",
  listenbrainz: "ListenBrainz",
  musicbrainz: "MusicBrainz",
  pitchfork: "Pitchfork",
  albumoftheyear: "AOTY",
  anydecentmusic: "ADM",
  stereogum: "Stereogum",
  npr: "NPR Music",
  rym: "RateYourMusic",
};

// Badge variant per source. Brand colors already in tailwind.config.ts for
// the three with established brand pills; the new sources reuse neutral so
// we don't end up with a clown-car of colours on the page.
const sourceVariant: Record<SuggestionDto["source"], "lastfm" | "listenbrainz" | "musicbrainz" | "default"> = {
  lastfm: "lastfm",
  listenbrainz: "listenbrainz",
  musicbrainz: "musicbrainz",
  pitchfork: "default",
  albumoftheyear: "default",
  anydecentmusic: "default",
  stereogum: "default",
  npr: "default",
  rym: "default",
};

// Preview-search URL so the user can verify what they're about to download
// before approving. Goes to MusicBrainz when we have a release id, falls
// back to a Last.fm site search by artist+title.
function previewUrl(s: SuggestionDto): string {
  const q = encodeURIComponent(`${s.artist} ${s.title ?? ""}`.trim());
  return `https://www.last.fm/search?q=${q}`;
}

export default function SuggestionCard({
  s,
  onApprove,
  onDismiss,
  onModeChange,
}: {
  s: SuggestionDto;
  onApprove: () => void;
  onDismiss: () => void;
  onModeChange: (mode: "album" | "track") => void;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-accent/40 hover:shadow-lg">
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {s.cover_art_url ? (
          <img
            src={s.cover_art_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-4xl text-muted-foreground">♪</div>
        )}
        {s.match_status !== "matched" && (
          <div className="absolute top-2 right-2">
            <Badge variant={s.match_status === "ambiguous" ? "warning" : "default"}>
              {s.match_status}
            </Badge>
          </div>
        )}
      </div>
      <div className="p-3 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={sourceVariant[s.source]}>{sourceLabel[s.source]}</Badge>
          <ModeToggle value={s.mode} onChange={onModeChange} />
        </div>
        <div>
          <div className="text-sm font-semibold truncate">{s.title ?? "(no title)"}</div>
          <div className="text-xs text-muted-foreground truncate">{s.artist}</div>
        </div>
        {s.reason ? (
          <div className="text-[11px] text-muted-foreground italic leading-snug line-clamp-2">
            {s.reason}
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onApprove} className="flex-1">
            <Download className="h-3.5 w-3.5" />
            Grab {s.mode}
          </Button>
          <a
            href={previewUrl(s)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center h-8 px-2 rounded-md border border-border hover:bg-muted text-muted-foreground"
            aria-label="Preview"
            title="Look this up on Last.fm before grabbing"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          <Button size="sm" variant="outline" onClick={onDismiss} className="px-2.5" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function ModeToggle({
  value,
  onChange,
}: {
  value: "album" | "track";
  onChange: (m: "album" | "track") => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-border bg-card/80 p-0.5 text-[10px] uppercase tracking-wider">
      {(["album", "track"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={cn(
            "px-2 py-0.5 rounded-full transition-colors",
            value === m ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {m}
        </button>
      ))}
    </div>
  );
}
