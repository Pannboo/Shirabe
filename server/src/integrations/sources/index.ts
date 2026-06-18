// A "source" is a curation feed that produces album/track seeds for the
// Discover pipeline. Each implementation owns its own credentials check
// (returning [] when not configured) and is free to call out to any third
// party. The orchestration logic in jobs/pullSuggestions iterates every
// registered source on each tick, de-dupes against suggestions+library, and
// inserts new seeds.

export type SourceId =
  | "lastfm"
  | "listenbrainz"
  | "musicbrainz"
  | "pitchfork"        // legacy; kept so old rows render correctly
  | "albumoftheyear"
  | "anydecentmusic"
  | "stereogum"
  | "npr"
  | "rym";

export interface RawSeed {
  source: SourceId;
  artist: string;
  title: string | null;
  release_mbid: string | null;
  artist_mbid: string | null;
  mode: "album" | "track";
  // Best-effort 0..1 score. Sources that have a real signal (review rating,
  // CF confidence) populate this; sources that don't return null.
  score: number | null;
  // Short, human-readable reason — shown verbatim on the Discover card.
  // "Pitchfork 8.4", "New release · you played them 47 times", etc.
  reason: string | null;
}

export interface Source {
  id: SourceId;
  label: string;
  // Returns [] when this source isn't configured (missing API key, token,
  // etc) — never throws. Each call is one full refresh cycle.
  fetchSeeds(): Promise<RawSeed[]>;
}

import { lastfmSource } from "./lastfm.js";
import { listenbrainzSource } from "./listenbrainz.js";
import { musicbrainzSource } from "./musicbrainz.js";
import { stereogumSource } from "./stereogum.js";
import { nprSource } from "./npr.js";
import { aotySource } from "./aoty.js";
import { rymSource } from "./rym.js";

// Order is significant — Discover's de-dupe keeps the first occurrence of
// any (artist, title) pair, so put the higher-signal sources first.
export const sources: Source[] = [
  musicbrainzSource,   // confirmed new releases from artists the user plays
  listenbrainzSource,  // CF recommendations
  stereogumSource,     // weekly taste-maker pick (well-parseable)
  nprSource,           // First Listen / album reviews when format matches
  aotySource,          // scraped — critic-highest-rated of the year
  rymSource,           // scraped — works only when Cloudflare allows
  lastfmSource,        // similar-artist filler
];
