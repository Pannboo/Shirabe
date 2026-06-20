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
// Match that against the slskd-side group. slskd is sloppy about
// separators (search responses use whatever the peer's OS uses —
// usually `\` — but the transfer-list endpoint sometimes normalises
// or appends a trailing slash). Compare both sides after normalising
// to forward slashes + stripping trailing slashes, and fall back to a
// basename match so a slkd re-rooting the path can't break correlation.

function normaliseFolder(p: string): string {
  return p.replace(/\\+/g, "/").replace(/\/+$/, "").toLowerCase();
}

function basenameOf(p: string): string {
  const n = normaliseFolder(p);
  const i = n.lastIndexOf("/");
  return i < 0 ? n : n.slice(i + 1);
}

function findGroupFor(
  dl: { slskd_username: string | null; slskd_folder: string | null },
  groups: SlskdDownloadGroup[],
): SlskdDownloadGroup | null {
  if (!dl.slskd_username || !dl.slskd_folder) return null;
  const wantFolder = normaliseFolder(dl.slskd_folder);
  const wantBase = basenameOf(dl.slskd_folder);

  const sameUser = groups.filter((g) => g.username === dl.slskd_username);
  if (sameUser.length === 0) return null;

  // Strict: full path match (normalised).
  const exact = sameUser.find((g) => normaliseFolder(g.directory) === wantFolder);
  if (exact) return exact;

  // Lenient: basename match (slskd re-rooted the path).
  const byBase = sameUser.find((g) => basenameOf(g.directory) === wantBase);
  if (byBase) return byBase;

  // If the peer only has one transfer group in flight, attribute by user.
  // Safe because a single peer rarely overlaps two of our active dl rows.
  if (sameUser.length === 1) return sameUser[0] ?? null;

  return null;
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
    // Manual-search rows insert directly into 'downloading' with a
    // pre-populated (slskd_username, slskd_folder) but no search_id —
    // the search/auto-pick state machine never runs for them. Only the
    // queued/searching branch actually needs the search_id; the
    // downloading branch correlates by username+folder, so it works for
    // both flows. Silently skipping on !slskd_search_id used to swallow
    // every manual-search download (bug fixed 2026-06).
    if ((dl.status === "queued" || dl.status === "searching") && !dl.slskd_search_id) continue;

    if (dl.status === "queued" || dl.status === "searching") {
      // search_id presence already guaranteed by the early-skip above,
      // but TS doesn't narrow across the conditional — assert with !.
      const searchId = dl.slskd_search_id!;
      const search = await getSlskdSearch(searchId);
      if (!search) continue;
      if ((search.responses?.length ?? 0) > 0) {
        const queued = await enqueueBestResult(searchId, dl.mode);
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
        // Diagnostics so a future stuck row points the operator at the
        // actual mismatch. The two most common causes are:
        //   1. Pre-fix legacy row with slskd_username / slskd_folder NULL
        //      (queued before correlation columns existed) — nothing the
        //      poller can do; user must "Clear all" from the Queue page.
        //   2. slskd dropped the transfer from its list because it
        //      finished and the user's slskd is configured to auto-clear
        //      completed transfers. Same remediation.
        if (!dl.slskd_username || !dl.slskd_folder) {
          console.warn(
            `[download] dl#${dl.id} ${dl.artist ?? "?"} — ${dl.title ?? "?"} ` +
            `stuck: no slskd_username/slskd_folder persisted (pre-fix row). ` +
            `Use "Clear all" on the Queue page.`,
          );
        } else {
          const userGroups = groups.filter((g) => g.username === dl.slskd_username);
          console.warn(
            `[download] dl#${dl.id} ${dl.artist ?? "?"} — ${dl.title ?? "?"} ` +
            `no matching group for user=${dl.slskd_username} folder=${dl.slskd_folder}. ` +
            `slskd reports ${userGroups.length} group(s) for that user: ` +
            userGroups.map((g) => g.directory).join(" | "),
          );
        }
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
