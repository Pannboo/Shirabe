import { insertReviewItem } from "../db/queries/review.js";
import { tryBeetsImport } from "../integrations/beets.js";

// Returns true iff beets imported the album cleanly (high confidence,
// not ambiguous). pollDownloads uses the return to decide whether the
// download row can be auto-deleted; a false return means the album was
// filed in review_queue and the row should stick around so the user
// has context for the review entry.
export async function organiseDownload(downloadId: number, filePath: string): Promise<boolean> {
  const result = await tryBeetsImport(filePath);
  if (result.ok) {
    console.log(`[beets] dl#${downloadId} imported ${filePath} (confidence ${result.confidence.toFixed(2)})`);
    return true;
  }

  console.warn(
    `[beets] dl#${downloadId} ${filePath} → review queue ` +
    `(confidence ${result.confidence.toFixed(2)}, ambiguous=${result.ambiguous})`,
  );
  insertReviewItem(
    downloadId,
    filePath,
    JSON.stringify({
      stdout_excerpt: result.stdout.slice(0, 2000),
      stderr_excerpt: result.stderr.slice(0, 2000),
      ambiguous: result.ambiguous,
    }),
    result.confidence,
  );
  return false;
}
