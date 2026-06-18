import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { migrate } from "./db/migrate.js";
import { bootstrapSettings } from "./db/bootstrap.js";
import { getAllSettings } from "./db/queries/settings.js";
import { authRouter } from "./routes/auth.js";
import { publicStatsRouter } from "./routes/publicStats.js";
import { meStatsRouter } from "./routes/meStats.js";
import { suggestionsRouter } from "./routes/suggestions.js";
import { queueRouter } from "./routes/queue.js";
import { reviewRouter } from "./routes/review.js";
import { settingsRouter } from "./routes/settings.js";
import { scrobbleIntakeRouter } from "./routes/scrobbleIntake.js";
import { widgetRouter } from "./routes/widget.js";
import { healthRouter } from "./routes/health.js";
import { registerCron } from "./jobs/scheduler.js";
import { pullSuggestions } from "./jobs/pullSuggestions.js";
import { pollDownloads } from "./jobs/pollDownloads.js";
import { retryRelays } from "./jobs/retryRelays.js";
import { resolveCoverArtBatch } from "./jobs/resolveCoverArt.js";
import { resolveArtistImageBatch } from "./jobs/resolveArtistImage.js";
import { resolveArtistLinksBatch } from "./jobs/resolveArtistLinks.js";
import { backfillReleaseYears } from "./jobs/backfillReleaseYears.js";
import { syncNavidromeLibrary } from "./jobs/syncNavidromeLibrary.js";

migrate();
bootstrapSettings();

const app = express();
app.use(express.json({ limit: "1mb" }));

// Internal frontend CORS (dev: 5173).
app.use(
  cors({
    origin: [config.PUBLIC_FRONTEND_ORIGIN],
    credentials: false,
  }),
);

app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/public", publicStatsRouter);
app.use("/api/me", meStatsRouter);
app.use("/api/suggestions", suggestionsRouter);
app.use("/api/queue", queueRouter);
app.use("/api/review", reviewRouter);
app.use("/api/settings", settingsRouter);

// ListenBrainz-compatible scrobble intake (real LB protocol paths).
// Navidrome and other LB clients append `1/submit-listens` and `1/validate-token`
// to the configured BaseURL, so we mount at `/1` and the router defines those
// endpoints directly. Set Navidrome's ND_LISTENBRAINZ_BASEURL to `http://<host>:<port>/`.
app.use("/1", (req, _res, next) => {
  console.log(`[lb-intake] ${req.method} /1${req.url} from ${req.ip} ua="${req.headers["user-agent"] ?? ""}"`);
  next();
});
app.use("/1", scrobbleIntakeRouter);

// Versioned widget API.
app.use("/api/v1/public", widgetRouter);

// Static SPA in production. In dev, vite serves the client directly.
const here = dirname(fileURLToPath(import.meta.url));
const staticDir = resolve(here, "static");
if (existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/1/")) {
      next();
      return;
    }
    res.sendFile(join(staticDir, "index.html"));
  });
}

// Cron jobs.
const settings = getAllSettings();
registerCron("pullSuggestions", settings.suggestion_schedule, pullSuggestions);
registerCron("pollDownloads", "*/10 * * * * *", pollDownloads);
registerCron("resolveCoverArt", "*/30 * * * * *", resolveCoverArtBatch);
registerCron("resolveArtistImage", "*/20 * * * * *", resolveArtistImageBatch);
registerCron("resolveArtistLinks", "*/30 * * * * *", resolveArtistLinksBatch);
registerCron("backfillReleaseYears", "*/5 * * * *", backfillReleaseYears);
registerCron("syncNavidromeLibrary", "0 3 * * *", async () => {
  await syncNavidromeLibrary();
});

retryRelays().catch((err) => console.error("[retryRelays] failed", err));
// Warm the library mirror on boot so Discover filters work immediately if
// Navidrome admin creds are already configured.
syncNavidromeLibrary().catch((err) => console.error("[syncNavidromeLibrary] startup failed", err));

const server = app.listen(config.PORT, () => {
  console.log(`[shirabe] listening on http://0.0.0.0:${config.PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[shirabe] received ${signal}, shutting down`);
    server.close(() => process.exit(0));
  });
}
