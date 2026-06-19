import { Router } from "express";
import {
  ensureLocalAlbum,
  ensureLocalArtist,
  findAlbumByHash,
  findArtistByHash,
} from "../services/imageCache.js";

export const imageRouter = Router();

// 1x1 transparent PNG returned when there's no row at all for the hash
// or the upstream fetch failed. Browsers render it cleanly with no
// broken-image icon — better than a 404 in an <img>.
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

// One-year immutable cache headers — the hash is content-derived, so the
// URL is stable forever for the same (artist, album|artist) pair. If a
// row is re-resolved with a different URL, the local file is overwritten
// in place; clients picking up the change is acceptable laziness here
// (browser will eventually refetch).
const CACHE_CONTROL = "public, max-age=31536000, immutable";

imageRouter.get("/album/:hash", async (req, res) => {
  const row = findAlbumByHash(req.params.hash);
  if (!row) {
    sendPlaceholder(res);
    return;
  }
  const local = await ensureLocalAlbum(row);
  if (!local) {
    sendPlaceholder(res);
    return;
  }
  res.setHeader("Cache-Control", CACHE_CONTROL);
  res.setHeader("Content-Type", local.contentType);
  res.sendFile(local.absolutePath);
});

imageRouter.get("/artist/:hash", async (req, res) => {
  const row = findArtistByHash(req.params.hash);
  if (!row) {
    sendPlaceholder(res);
    return;
  }
  const local = await ensureLocalArtist(row);
  if (!local) {
    sendPlaceholder(res);
    return;
  }
  res.setHeader("Cache-Control", CACHE_CONTROL);
  res.setHeader("Content-Type", local.contentType);
  res.sendFile(local.absolutePath);
});

function sendPlaceholder(res: import("express").Response): void {
  // Short cache so re-tries pick up newly resolved rows quickly.
  res.setHeader("Cache-Control", "public, max-age=60");
  res.setHeader("Content-Type", "image/png");
  res.status(200).end(TRANSPARENT_PNG);
}
