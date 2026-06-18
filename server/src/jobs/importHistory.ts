import { fetchLastFmHistoryPage } from "../integrations/lastfm.js";
import { fetchListenBrainzHistoryPage } from "../integrations/listenbrainz.js";
import { insertHistoricalBatch, type HistoricalRow } from "../db/queries/scrobbles.js";
import { getAllSettings } from "../db/queries/settings.js";

// One-click history import from Last.fm + ListenBrainz. Idempotent: re-runs
// land on the uniq_scrobble index and INSERT OR IGNORE skips dupes.
//
// State lives in-memory because the import takes anywhere from 10s
// (small history) to a few minutes (10 years of scrobbles) — too short
// for a DB-backed job queue, too long for a synchronous HTTP request.
// The Settings UI polls /api/settings/import/status every 2s while a
// job is active.

export type ImportSource = "lastfm" | "listenbrainz";
export type ImportPhase = "idle" | "running" | "done" | "error";

export interface ImportStatus {
  source: ImportSource;
  phase: ImportPhase;
  started_at: number | null;
  finished_at: number | null;
  pages_fetched: number;
  fetched: number;        // total listens pulled from the upstream API
  inserted: number;       // new rows actually written (rest are dupes)
  error: string | null;
}

// One entry per source. Keeps running jobs visible to the polling client
// independently and lets the user kick off Last.fm + LB back-to-back.
const STATUS: Record<ImportSource, ImportStatus> = {
  lastfm: emptyStatus("lastfm"),
  listenbrainz: emptyStatus("listenbrainz"),
};

function emptyStatus(source: ImportSource): ImportStatus {
  return {
    source,
    phase: "idle",
    started_at: null,
    finished_at: null,
    pages_fetched: 0,
    fetched: 0,
    inserted: 0,
    error: null,
  };
}

export function getImportStatus(): { lastfm: ImportStatus; listenbrainz: ImportStatus } {
  return { lastfm: { ...STATUS.lastfm }, listenbrainz: { ...STATUS.listenbrainz } };
}

function markStarted(source: ImportSource): void {
  STATUS[source] = { ...emptyStatus(source), phase: "running", started_at: Date.now() };
}

function markDone(source: ImportSource, err?: string): void {
  STATUS[source] = {
    ...STATUS[source],
    phase: err ? "error" : "done",
    finished_at: Date.now(),
    error: err ?? null,
  };
}

// === Last.fm =============================================================
//
// Walks user.getRecentTracks forward (oldest pages first not supported,
// so just iterate 1..total_pages until the API returns an empty page).
// 200/page, ~5 req/s budget — the lfmGet helper does no internal
// throttling so we add a small sleep between pages.

export async function importLastFmHistory(userId: number): Promise<void> {
  if (STATUS.lastfm.phase === "running") return;
  const settings = getAllSettings();
  if (!settings.lastfm_username || !settings.lastfm_api_key) {
    STATUS.lastfm = {
      ...emptyStatus("lastfm"),
      phase: "error",
      error: "Last.fm username + API key required (Settings → Last.fm)",
      started_at: Date.now(),
      finished_at: Date.now(),
    };
    return;
  }

  markStarted("lastfm");
  console.log(`[import/lastfm] started for ${settings.lastfm_username}`);
  try {
    let page = 1;
    let totalPages = 1;
    do {
      const result = await fetchLastFmHistoryPage(settings.lastfm_username, page, 200);
      if (!result) {
        throw new Error(`Last.fm page ${page} returned no data`);
      }
      totalPages = result.total_pages || page;
      if (result.rows.length === 0) break;

      const batch: HistoricalRow[] = result.rows.map((r) => ({
        ...r,
        source_client: "lastfm-import",
        relayed_lastfm: true,           // already on Last.fm — don't round-trip
        relayed_listenbrainz: false,
      }));
      const inserted = insertHistoricalBatch(userId, batch);

      STATUS.lastfm.pages_fetched = page;
      STATUS.lastfm.fetched += batch.length;
      STATUS.lastfm.inserted += inserted;
      console.log(
        `[import/lastfm] page ${page}/${totalPages} · +${inserted}/${batch.length} new`,
      );

      page += 1;
      // Polite spacing — keeps us well under Last.fm's 5 req/s ceiling.
      await new Promise((r) => setTimeout(r, 300));
    } while (page <= totalPages);

    markDone("lastfm");
    console.log(`[import/lastfm] done · ${STATUS.lastfm.inserted} new of ${STATUS.lastfm.fetched} fetched`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(`[import/lastfm] failed:`, msg);
    markDone("lastfm", msg);
  }
}

// === ListenBrainz ========================================================
//
// Walks /user/.../listens with the max_ts cursor (descending). Stops when
// a page returns zero rows or repeats the same oldest_ts (which means
// we've hit the floor of history).

export async function importListenBrainzHistory(userId: number): Promise<void> {
  if (STATUS.listenbrainz.phase === "running") return;
  const settings = getAllSettings();
  if (!settings.listenbrainz_username) {
    STATUS.listenbrainz = {
      ...emptyStatus("listenbrainz"),
      phase: "error",
      error: "ListenBrainz username required (Settings → ListenBrainz)",
      started_at: Date.now(),
      finished_at: Date.now(),
    };
    return;
  }

  markStarted("listenbrainz");
  console.log(`[import/listenbrainz] started for ${settings.listenbrainz_username}`);
  try {
    let cursor: number | null = null;
    let lastOldest: number | null = null;
    while (true) {
      const result = await fetchListenBrainzHistoryPage(settings.listenbrainz_username, cursor, 1000);
      if (!result) {
        throw new Error("ListenBrainz returned no data");
      }
      if (result.rows.length === 0) break;
      if (result.oldest_ts !== null && result.oldest_ts === lastOldest) break;

      const batch: HistoricalRow[] = result.rows.map((r) => ({
        ...r,
        source_client: "listenbrainz-import",
        relayed_lastfm: false,
        relayed_listenbrainz: true,     // already on LB — don't round-trip
      }));
      const inserted = insertHistoricalBatch(userId, batch);

      STATUS.listenbrainz.pages_fetched += 1;
      STATUS.listenbrainz.fetched += batch.length;
      STATUS.listenbrainz.inserted += inserted;
      console.log(
        `[import/listenbrainz] page ${STATUS.listenbrainz.pages_fetched} · +${inserted}/${batch.length} new`,
      );

      // Advance cursor to one second before the oldest in this page.
      cursor = result.oldest_ts !== null ? result.oldest_ts - 1 : null;
      lastOldest = result.oldest_ts;
      if (cursor === null) break;

      await new Promise((r) => setTimeout(r, 200));
    }

    markDone("listenbrainz");
    console.log(`[import/listenbrainz] done · ${STATUS.listenbrainz.inserted} new of ${STATUS.listenbrainz.fetched} fetched`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(`[import/listenbrainz] failed:`, msg);
    markDone("listenbrainz", msg);
  }
}
