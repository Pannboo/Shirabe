import { Router } from "express";
import { requireAdmin, requireAuth } from "../auth/middleware.js";
import { clearAllDownloads, listDownloads } from "../db/queries/downloads.js";
import { listSlskdDownloads } from "../integrations/slskd.js";

export const queueRouter = Router();
queueRouter.use(requireAuth, requireAdmin);

queueRouter.get("/", async (_req, res) => {
  const downloads = listDownloads();
  const groups = await listSlskdDownloads();
  // Flatten group → per-file rows for the UI (one line per transfer).
  // listSlskdDownloads now returns a grouped shape so pollDownloads can
  // correlate by folder; this view just unrolls it again.
  const slskd = groups.flatMap((g) =>
    g.files.map((d) => ({
      username: g.username,
      filename: d.filename.split(/[\\/]/).pop() ?? d.filename,
      state: d.state ?? "unknown",
      progress:
        d.size && d.size > 0 && d.bytesTransferred !== undefined
          ? Math.min(1, d.bytesTransferred / d.size)
          : null,
    })),
  );
  res.json({ downloads, slskd });
});

queueRouter.post("/clear-all", (_req, res) => {
  const cleared = clearAllDownloads();
  res.json({ cleared });
});
