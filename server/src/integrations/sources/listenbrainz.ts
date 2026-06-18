import { fetchListenBrainzSuggestions } from "../listenbrainz.js";
import type { RawSeed, Source } from "./index.js";

export const listenbrainzSource: Source = {
  id: "listenbrainz",
  label: "ListenBrainz",
  async fetchSeeds(): Promise<RawSeed[]> {
    const seeds = await fetchListenBrainzSuggestions();
    // LB collaborative-filtering scores aren't exposed on this endpoint, but
    // a CF match is consistently higher-signal than Last.fm's similar-artist
    // graph — give it the top fixed tier.
    return seeds.map<RawSeed>((s) => ({
      source: "listenbrainz",
      artist: s.artist,
      title: s.title,
      release_mbid: s.release_mbid,
      artist_mbid: s.artist_mbid,
      mode: s.mode,
      score: 0.7,
      reason: "Listeners with similar taste also play this",
    }));
  },
};
