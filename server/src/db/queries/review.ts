import { db } from "../client.js";
import type { ReviewItem } from "../../types/domain.js";

const insert = db.prepare(`
  INSERT INTO review_queue (download_id, file_path, beets_attempt, confidence)
  VALUES (?, ?, ?, ?)
`);
const byId = db.prepare(`SELECT * FROM review_queue WHERE id = ?`);
const listPending = db.prepare(`
  SELECT * FROM review_queue WHERE status = 'pending' ORDER BY created_at DESC
`);
const markDone = db.prepare(`UPDATE review_queue SET status = 'done' WHERE id = ?`);

export function insertReviewItem(
  downloadId: number | null,
  filePath: string,
  beetsAttempt: string | null,
  confidence: number | null,
): ReviewItem {
  const result = insert.run(downloadId, filePath, beetsAttempt, confidence);
  return byId.get(result.lastInsertRowid) as ReviewItem;
}

export function listPendingReview(): ReviewItem[] {
  return listPending.all() as ReviewItem[];
}

export function markReviewDone(id: number): void {
  markDone.run(id);
}
