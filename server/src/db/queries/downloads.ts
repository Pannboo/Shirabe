import { db } from "../client.js";
import type { Download, DownloadStatus, SuggestionMode } from "../../types/domain.js";

const insert = db.prepare(`
  INSERT INTO downloads (suggestion_id, slskd_search_id, mode, status, artist, title)
  VALUES (?, ?, ?, 'queued', ?, ?)
`);
const byId = db.prepare(`SELECT * FROM downloads WHERE id = ?`);
const listAll = db.prepare(`
  SELECT * FROM downloads ORDER BY created_at DESC LIMIT 200
`);
const listActive = db.prepare(`
  SELECT * FROM downloads WHERE status NOT IN ('complete', 'failed') ORDER BY created_at DESC
`);
const updateStatus = db.prepare(`UPDATE downloads SET status = ? WHERE id = ?`);
const updateSearchId = db.prepare(`UPDATE downloads SET slskd_search_id = ? WHERE id = ?`);
const updateSlskdTarget = db.prepare(`
  UPDATE downloads SET slskd_username = ?, slskd_folder = ? WHERE id = ?
`);
const markComplete = db.prepare(`
  UPDATE downloads SET status = 'complete', download_path = ?, completed_at = unixepoch() WHERE id = ?
`);

export function insertDownload(
  suggestionId: number | null,
  slskdSearchId: string | null,
  mode: SuggestionMode,
  meta: { artist?: string | null; title?: string | null } = {},
): Download {
  const result = insert.run(
    suggestionId,
    slskdSearchId,
    mode,
    meta.artist ?? null,
    meta.title ?? null,
  );
  return byId.get(result.lastInsertRowid) as Download;
}

export function getDownload(id: number): Download | undefined {
  return byId.get(id) as Download | undefined;
}

export function listDownloads(): Download[] {
  return listAll.all() as Download[];
}

export function listActiveDownloads(): Download[] {
  return listActive.all() as Download[];
}

export function setDownloadStatus(id: number, status: DownloadStatus): void {
  updateStatus.run(status, id);
}

export function setDownloadSearchId(id: number, slskdSearchId: string): void {
  updateSearchId.run(slskdSearchId, id);
}

export function setDownloadSlskdTarget(
  id: number,
  slskdUsername: string,
  slskdFolder: string,
): void {
  updateSlskdTarget.run(slskdUsername, slskdFolder, id);
}

export function completeDownload(id: number, downloadPath: string): void {
  markComplete.run(downloadPath, id);
}

// Wipes the downloads table. Used by the "Clear all" button on the
// Queue page — clears both stalled (queued/searching/downloading) and
// finished (complete/failed) rows in one go. slskd's own transfer list
// is independent; clear those from slskd's UI if you want a full reset.
//
// review_queue.download_id has a FK back into downloads with no cascade,
// so we have to wipe the review queue in the same transaction or
// foreign_keys=ON aborts the DELETE. Orphaned review rows have no
// usable context anyway (the file path is the only thing that survives
// and we've usually moved on by then).
const deleteAllReviews = db.prepare(`DELETE FROM review_queue`);
const deleteAllDownloads = db.prepare(`DELETE FROM downloads`);

export function clearAllDownloads(): number {
  let cleared = 0;
  db.transaction(() => {
    deleteAllReviews.run();
    cleared = deleteAllDownloads.run().changes;
  })();
  return cleared;
}
