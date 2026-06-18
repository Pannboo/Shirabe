import { fetchLastFmSuggestions } from "../lastfm.js";
import type { RawSeed, Source } from "./index.js";

export const lastfmSource: Source = {
  id: "lastfm",
  label: "Last.fm",
  async fetchSeeds(): Promise<RawSeed[]> {
    const seeds = await fetchLastFmSuggestions();
    // Last.fm's similar-artists graph doesn't expose a confidence number, so
    // we fix a mid-tier score — pure dedup ranks below LB CF.
    return seeds.map<RawSeed>((s) => ({
      source: "lastfm",
      artist: s.artist,
      title: s.title,
      release_mbid: null,
      artist_mbid: null,
      mode: s.mode,
      score: 0.5,
      reason: "Similar to artists you play",
    }));
  },
};
