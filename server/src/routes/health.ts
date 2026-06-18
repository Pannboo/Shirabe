import { Router } from "express";
import { requireAdmin, requireAuth } from "../auth/middleware.js";
import { pingNavidrome } from "../integrations/navidrome.js";
import { pingSlskd } from "../integrations/slskd.js";
import { getAllSettings } from "../db/queries/settings.js";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({ ok: true });
});

healthRouter.get("/integrations", requireAuth, requireAdmin, async (_req, res) => {
  const settings = getAllSettings();
  const [navidrome, slskd] = await Promise.all([pingNavidrome(), pingSlskd()]);
  res.json({
    navidrome,
    slskd,
    lastfm_configured: !!settings.lastfm_api_key && !!settings.lastfm_username,
    listenbrainz_configured: !!settings.listenbrainz_token && !!settings.listenbrainz_username,
  });
});
