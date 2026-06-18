import { getAllSettings } from "../db/queries/settings.js";
import { insertSuggestion, suggestionExists } from "../db/queries/suggestions.js";
import { isAlbumOwned } from "../db/queries/library.js";
import { sources } from "../integrations/sources/index.js";
import { findRelease } from "../integrations/musicbrainz.js";
import { getCoverArtUrl } from "../integrations/coverart.js";
import { lookupLbRelease } from "../integrations/listenbrainz.js";
import { getLastFmAlbumImage } from "../integrations/lastfm.js";
import type { MatchStatus, SuggestionSource } from "../types/domain.js";

export interface PullResultBreakdown {
  source: SuggestionSource;
  label: string;
  fetched: number;
  added: number;
  skipped_duplicate: number;
  skipped_owned: number;
}

export interface PullResult {
  added: number;
  skipped: number;
  per_source: PullResultBreakdown[];
}

// Iterates the registered Source[] (Last.fm, ListenBrainz, MusicBrainz fresh
// releases, Pitchfork BNM). Each yields RawSeed[] which we dedupe against
// (a) existing suggestions including dismissed-cooldown, and (b) the
// Navidrome library mirror — both server-side, so Discover never shows
// owned albums or recently-dismissed picks.
//
// Returns a per-source breakdown so the Discover UI can show "added 3 new
// from MusicBrainz, 0 from Pitchfork (12 already in feed)" rather than just
// a useless total.
export async function pullSuggestions(): Promise<PullResult> {
  const settings = getAllSettings();
  const cooldown = settings.dismiss_cooldown_days;

  // Gather seeds in parallel across all sources. A failing/unconfigured
  // source returns [] without throwing, so one outage doesn't block the
  // others. We capture each source's fetched count up front so the
  // breakdown distinguishes "source returned nothing" from "all skipped".
  const seedGroups = await Promise.all(
    sources.map(async (s) => {
      const seeds = await s.fetchSeeds();
      return { source: s, seeds };
    }),
  );

  const breakdown = new Map<SuggestionSource, PullResultBreakdown>();
  for (const { source, seeds } of seedGroups) {
    breakdown.set(source.id, {
      source: source.id,
      label: source.label,
      fetched: seeds.length,
      added: 0,
      skipped_duplicate: 0,
      skipped_owned: 0,
    });
  }

  let totalAdded = 0;
  let totalSkipped = 0;

  for (const { source, seeds } of seedGroups) {
    const stats = breakdown.get(source.id)!;
    for (const seed of seeds) {
      if (suggestionExists(seed.artist, seed.title, cooldown)) {
        stats.skipped_duplicate += 1;
        totalSkipped += 1;
        continue;
      }

      let releaseId = seed.release_mbid;
      let artistId = seed.artist_mbid;
      let matchStatus: MatchStatus = "unresolved";

      if (seed.title && !releaseId) {
        const found = await findRelease(seed.artist, seed.title);
        if (found) {
          releaseId = found.releaseId;
          artistId = found.artistId;
          matchStatus = found.ambiguous ? "ambiguous" : "matched";
        } else {
          matchStatus = "unmatched";
        }
      } else if (releaseId) {
        matchStatus = "matched";
      }

      if (isAlbumOwned(seed.artist, seed.title, releaseId)) {
        stats.skipped_owned += 1;
        totalSkipped += 1;
        continue;
      }

      // Same fallback chain as the cover-art resolver — MB/CAA first, then
      // LB metadata (route MBID through CAA's JSON API), then Last.fm
      // album.getInfo. Means new sources that don't bring their own art
      // (RSS review feeds) still get thumbnails.
      let coverArt: string | null = null;
      if (releaseId) coverArt = await getCoverArtUrl(releaseId);
      if (!coverArt && seed.title) {
        const lb = await lookupLbRelease(seed.artist, seed.title);
        const lbMbid = lb?.caa_release_mbid ?? lb?.release_mbid ?? null;
        if (lbMbid) {
          if (!releaseId) releaseId = lbMbid;
          coverArt = await getCoverArtUrl(lbMbid);
        }
      }
      if (!coverArt && seed.title) coverArt = await getLastFmAlbumImage(seed.artist, seed.title);

      insertSuggestion({
        source: seed.source,
        artist: seed.artist,
        title: seed.title,
        mb_release_id: releaseId,
        mb_artist_id: artistId,
        cover_art_url: coverArt,
        match_status: matchStatus,
        mode: seed.mode,
        score: seed.score,
        reason: seed.reason,
      });
      stats.added += 1;
      totalAdded += 1;
    }
  }

  const per_source = Array.from(breakdown.values()).sort((a, b) => b.added - a.added);

  // Logged so a server-side glance reveals "Pitchfork returned 0" before
  // the user has to ask.
  console.log(
    "[pullSuggestions]",
    per_source
      .map((b) => `${b.label}=${b.added}/${b.fetched} (dup ${b.skipped_duplicate}, owned ${b.skipped_owned})`)
      .join(" · "),
  );

  return { added: totalAdded, skipped: totalSkipped, per_source };
}
