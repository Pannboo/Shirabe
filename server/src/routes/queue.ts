import { Router } from "express";
import { requireAdmin, requireAuth } from "../auth/middleware.js";
import { listDownloads } from "../db/queries/downloads.js";
import { listSlskdDownloads } from "../integrations/slskd.js";

export const queueRouter = Router();
queueRouter.use(requireAuth, requireAdmin);

queueRouter.get("/", async (_req, res) => {
  const downloads = listDownloads();
  const slskd = await listSlskdDownloads();
  res.json({
    downloads,
    slskd: slskd.map((d) => ({
      username: d.username,
      filename: d.filename.split(/[\\/]/).pop() ?? d.filename,
      state: d.state ?? "unknown",
      progress:
        d.size && d.size > 0 && d.bytesTransferred !== undefined
          ? Math.min(1, d.bytesTransferred / d.size)
          : null,
    })),
  });
});
