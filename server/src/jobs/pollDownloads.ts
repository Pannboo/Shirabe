import { join } from "node:path";
import { config } from "../config.js";
import {
  completeDownload,
  listActiveDownloads,
  setDownloadStatus,
} from "../db/queries/downloads.js";
import { getSlskdSearch, enqueueBestResult, listSlskdDownloads } from "../integrations/slskd.js";
import { organiseDownload } from "./organiseDownloads.js";

export async function pollDownloads(): Promise<void> {
  const active = listActiveDownloads();
  if (active.length === 0) return;

  const slskdDownloads = await listSlskdDownloads();

  for (const dl of active) {
    if (!dl.slskd_search_id) continue;

    if (dl.status === "queued" || dl.status === "searching") {
      const search = await getSlskdSearch(dl.slskd_search_id);
      if (!search) continue;
      if ((search.responses?.length ?? 0) > 0) {
        const queued = await enqueueBestResult(dl.slskd_search_id, dl.mode);
        if (queued) {
          setDownloadStatus(dl.id, "downloading");
        } else {
          setDownloadStatus(dl.id, "searching");
        }
      } else {
        setDownloadStatus(dl.id, "searching");
      }
      continue;
    }

    if (dl.status === "downloading") {
      // Best-effort: if slskd reports it complete, mark done.
      const matching = slskdDownloads.find((d) => d.state?.toLowerCase().includes("completed"));
      if (matching) {
        const filePath = join(config.DOWNLOADS_DIR, matching.filename.split(/[\\/]/).pop() ?? matching.filename);
        completeDownload(dl.id, filePath);
        await organiseDownload(dl.id, filePath);
      }
    }
  }
}
