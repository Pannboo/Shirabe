import {
  BookOpen,
  Database,
  Disc,
  ExternalLink,
  Facebook,
  Globe,
  Instagram,
  Music,
  Twitter,
  Youtube,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface ArtistLink {
  brand: string;
  label: string;
  url: string;
}

// Map brand → icon component. Brands not in the map fall through to a
// generic ExternalLink so the panel still renders something useful.
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  spotify: Music,
  "apple-music": Music,
  deezer: Music,
  tidal: Music,
  bandcamp: Music,
  youtube: Youtube,
  "youtube-music": Youtube,
  soundcloud: Music,
  discogs: Disc,
  wikipedia: BookOpen,
  wikidata: Database,
  lastfm: Music,
  genius: BookOpen,
  allmusic: BookOpen,
  twitter: Twitter,
  instagram: Instagram,
  facebook: Facebook,
  tiktok: Music,
  homepage: Globe,
};

// Brand-coloured accent on the icon. The grid tile itself stays neutral so
// the panel doesn't look like a chocolate-box of logos — just a hint of
// colour that helps each service pop without overwhelming.
const TINTS: Record<string, string> = {
  spotify: "text-emerald-400",
  youtube: "text-red-500",
  "youtube-music": "text-red-500",
  discogs: "text-amber-300",
  lastfm: "text-lastfm",
  bandcamp: "text-sky-400",
  twitter: "text-sky-300",
  instagram: "text-pink-400",
  facebook: "text-blue-400",
  homepage: "text-accent",
  "apple-music": "text-rose-400",
  deezer: "text-fuchsia-400",
  tidal: "text-slate-300",
  soundcloud: "text-orange-400",
  wikipedia: "text-foreground/80",
};

interface Props {
  links: ArtistLink[];
  // "rail" → 4-column icon grid (default for the artist-page right rail);
  //   icon-only tiles with title-attr tooltips, much more compact than a
  //   labelled list.
  // "flow" → horizontal wrap of icon + label pills (mobile / md fallback
  //   under the stat lockup).
  layout?: "rail" | "flow";
  className?: string;
}

export default function ArtistLinks({ links, layout = "rail", className }: Props) {
  if (links.length === 0) return null;

  if (layout === "flow") {
    return (
      <div className={cn("flex flex-wrap items-center gap-2", className)}>
        {links.map((l) => {
          const Icon = ICONS[l.brand] ?? ExternalLink;
          const tint = TINTS[l.brand] ?? "text-muted-foreground";
          return (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/40 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors"
              title={l.label}
            >
              <Icon className={cn("h-3.5 w-3.5", tint)} />
              {l.label}
            </a>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="eyebrow">External</div>
      <div className="grid grid-cols-4 gap-1.5">
        {links.map((l) => {
          const Icon = ICONS[l.brand] ?? ExternalLink;
          const tint = TINTS[l.brand] ?? "text-muted-foreground";
          return (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              title={l.label}
              aria-label={l.label}
              className="group flex items-center justify-center aspect-square rounded-md border border-border/40 bg-card/30 hover:bg-muted/40 hover:border-border transition-colors"
            >
              <Icon className={cn("h-4 w-4 transition-transform group-hover:scale-110", tint)} />
            </a>
          );
        })}
      </div>
    </div>
  );
}
