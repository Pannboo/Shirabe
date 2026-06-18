import { insertReviewItem } from "../db/queries/review.js";
import { tryBeetsImport } from "../integrations/beets.js";

export async function organiseDownload(downloadId: number, filePath: string): Promise<void> {
  const result = await tryBeetsImport(filePath);
  if (result.ok) return;

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
}
