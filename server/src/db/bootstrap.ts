// Seed the settings table from BOOT_* env vars on first run (when table is empty).
// After that, settings live in the DB and are changed via the UI.

import { db } from "./client.js";
import { setSetting } from "./queries/settings.js";
import type { AppSettings } from "../types/domain.js";

const ENV_TO_KEY: Partial<Record<keyof AppSettings, string>> = {
  lastfm_api_key: "BOOT_LASTFM_API_KEY",
  lastfm_shared_secret: "BOOT_LASTFM_SHARED_SECRET",
  lastfm_username: "BOOT_LASTFM_USERNAME",
  listenbrainz_username: "BOOT_LISTENBRAINZ_USERNAME",
  listenbrainz_token: "BOOT_LISTENBRAINZ_TOKEN",
  slskd_url: "BOOT_SLSKD_URL",
  slskd_api_key: "BOOT_SLSKD_API_KEY",
  navidrome_url: "BOOT_NAVIDROME_URL",
  navidrome_admin_username: "BOOT_NAVIDROME_USERNAME",
  navidrome_admin_password: "BOOT_NAVIDROME_PASSWORD",
  relay_lastfm: "BOOT_RELAY_LASTFM",
  relay_listenbrainz: "BOOT_RELAY_LISTENBRAINZ",
  suggestion_schedule: "BOOT_SUGGESTION_SCHEDULE",
  dismiss_cooldown_days: "BOOT_DISMISS_COOLDOWN_DAYS",
};

export function bootstrapSettings(): void {
  const row = db.prepare("SELECT COUNT(*) as c FROM settings").get() as { c: number };
  if (row.c > 0) return;

  let seeded = 0;
  for (const [key, envName] of Object.entries(ENV_TO_KEY) as [keyof AppSettings, string][]) {
    const raw = process.env[envName];
    if (raw === undefined || raw === "") continue;
    setSetting(key, raw as never);
    seeded += 1;
  }
  if (seeded > 0) console.log(`[bootstrap] seeded ${seeded} setting(s) from BOOT_* env`);
}
