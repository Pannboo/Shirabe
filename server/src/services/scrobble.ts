import { getAllSettings } from "../db/queries/settings.js";
import { insertScrobble, markRelayed } from "../db/queries/scrobbles.js";
import { relayToLastFm } from "../integrations/lastfm.js";
import { relayToListenBrainz } from "../integrations/listenbrainz.js";
import type { Scrobble } from "../types/domain.js";

export interface IncomingScrobble {
  user_id: number;
  track: string;
  artist: string;
  album: string | null;
  timestamp: number;
  source_client: string | null;
}

export async function ingestScrobble(input: IncomingScrobble): Promise<Scrobble> {
  const scrobble = insertScrobble(
    input.user_id,
    input.track,
    input.artist,
    input.album,
    input.timestamp,
    input.source_client,
  );
  await dispatchRelays(scrobble);
  return scrobble;
}

export async function dispatchRelays(scrobble: Scrobble): Promise<void> {
  const settings = getAllSettings();
  const tasks: Promise<void>[] = [];

  if (
    settings.relay_lastfm &&
    scrobble.relayed_lastfm === 0 &&
    settings.lastfm_api_key &&
    settings.lastfm_shared_secret &&
    settings.lastfm_session_key
  ) {
    tasks.push(
      (async () => {
        const ok = await relayToLastFm(scrobble);
        if (ok) markRelayed(scrobble.id, "lastfm");
      })(),
    );
  }

  if (
    settings.relay_listenbrainz &&
    scrobble.relayed_listenbrainz === 0 &&
    settings.listenbrainz_token
  ) {
    tasks.push(
      (async () => {
        const ok = await relayToListenBrainz(scrobble, settings.listenbrainz_token);
        if (ok) markRelayed(scrobble.id, "listenbrainz");
      })(),
    );
  }

  await Promise.allSettled(tasks);
}
