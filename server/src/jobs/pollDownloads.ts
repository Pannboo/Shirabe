import { basename, join } from "node:path";
import { config } from "../config.js";
import {
  completeDownload,
  listActiveDownloads,
  setDownloadSlskdTarget,
  setDownloadStatus,
} from "../db/queries/downloads.js";
import { getSlskdSearch, enqueueBestResult, listSlskdDownloads } from "../integrations/slskd.js";
import type { SlskdDownloadGroup } from "../integrations/slskd.js";
import { organiseDownload } from "./organiseDownloads.js";

// === slskd transfer state classification ===================================
//
// slskd reports a comma-separated state like "Completed, Succeeded" or
// "Completed, Errored". Substring matching on "completed" alone (the
// previous behaviour) would happily fire beets on cancelled or errored
// transfers. Bucket explicitly so a half-finished folder doesn't get
// handed off to the importer.

type FileState = "succeeded" | "errored" | "in_progress";

function classifyState(raw: string | undefined): FileState {
  const s = (raw ?? "").toLowerCase();
  if (s.includes("completed")) {
    if (s.includes("succeeded")) return "succeeded";
    return "errored"; // "Completed, Cancelled" / "Completed, Errored" / "Completed, TimedOut"
  }
  return "in_progress";
}

// === Group correlation =====================================================
//
// We persisted the (username, folder) we queued onto each download row.
// Match that against the slskd-side group. slskd's `directory` is the
// remote folder path on the peer — same string we picked off the
// Candidate, so an exact match works without normalisation.

function findGroupFor(
  dl: { slskd_username: string | null; slskd_folder: string | null },
  groups: SlskdDownloadGroup[],
): SlskdDownloadGroup | null {
  if (!dl.slskd_username || !dl.slskd_folder) return null;
  return (
    groups.find(
      (g) => g.username === dl.slskd_username && g.directory === dl.slskd_folder,
    ) ?? null
  );
}

// On-disk landing path slskd writes the album to. slskd's default layout
// puts each completed transfer at `<downloads_dir>/<folder-tail>/` (the
// last path segment of the remote folder). Shirabe's DOWNLOADS_DIR must
// be the same bind-mounted directory as slskd's `downloads` dir for this
// to find anything — that's documented in the deployment README.
function landingPathFor(folder: string): string {
  return join(config.DOWNLOADS_DIR, basename(folder.replace(/[\\/]+$/, "")));
}

export async function pollDownloads(): Promise<void> {
  const active = listActiveDownloads();
  if (active.length === 0) return;

  const groups = await listSlskdDownloads();

  for (const dl of active) {
    if (!dl.slskd_search_id) continue;

    if (dl.status === "queued" || dl.status === "searching") {
      const search = await getSlskdSearch(dl.slskd_search_id);
      if (!search) continue;
      if ((search.responses?.length ?? 0) > 0) {
        const queued = await enqueueBestResult(dl.slskd_search_id, dl.mode);
        if (queued) {
          // Persist target FIRST so a poll that races the next tick can
          // already correlate. Status flip is the second write.
          setDownloadSlskdTarget(dl.id, queued.username, queued.folder);
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
      const group = findGroupFor(dl, groups);
      if (!group) {
        // slskd has dropped the transfer from its list — either it
        // completed and was cleared, or the peer disappeared. If we
        // never saw a "succeeded" tick we treat it as inconclusive
        // and leave the row alone for the next pass.
        continue;
      }

      const buckets = group.files.map((f) => classifyState(f.state));
      const anyInProgress = buckets.includes("in_progress");
      if (anyInProgress) continue; // wait for the whole folder

      const allSucceeded = buckets.every((b) => b === "succeeded");
      const anyErrored = buckets.includes("errored");

      if (allSucceeded) {
        const filePath = landingPathFor(group.directory);
        completeDownload(dl.id, filePath);
        console.log(
          `[download] dl#${dl.id} ${dl.artist ?? "?"} — ${dl.title ?? "?"} ` +
          `complete (${group.files.length} files at ${filePath})`,
        );
        await organiseDownload(dl.id, filePath);
      } else if (anyErrored) {
        // Partial / cancelled — flag failed so it leaves the active set
        // instead of being re-polled forever.
        const failedCount = buckets.filter((b) => b === "errored").length;
        console.warn(
          `[download] dl#${dl.id} ${dl.artist ?? "?"} — ${dl.title ?? "?"} ` +
          `marked failed (${failedCount}/${buckets.length} files errored)`,
        );
        setDownloadStatus(dl.id, "failed");
      }
    }
  }
}
