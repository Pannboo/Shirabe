import { db } from "../client.js";
import type { AppSettings } from "../../types/domain.js";

const get = db.prepare(`SELECT value FROM settings WHERE key = ?`);
const upsert = db.prepare(`
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);
const all = db.prepare(`SELECT key, value FROM settings`);

const DEFAULTS: AppSettings = {
  lastfm_api_key: "",
  lastfm_shared_secret: "",
  lastfm_username: "",
  lastfm_pending_token: "",
  lastfm_session_key: "",
  lastfm_session_username: "",
  listenbrainz_username: "",
  listenbrainz_token: "",
  slskd_url: "",
  slskd_api_key: "",
  navidrome_url: "",
  navidrome_admin_username: "",
  navidrome_admin_password: "",
  relay_lastfm: false,
  relay_listenbrainz: false,
  suggestion_schedule: "0 */6 * * *",
  dismiss_cooldown_days: 30,
  beets_config_path: "/etc/beets/config.yaml",
  now_playing_window_seconds: 240,
  theme: "dark",
  download_allowed_extensions: "flac,mp3,m4a,ogg,opus,wav,alac,aiff",
  download_lossless_only: false,
  download_min_kbps: 192,
  download_min_files_per_album: 2,
  flaresolverr_url: "",
};

function parseValue(key: keyof AppSettings, raw: string | null): unknown {
  if (raw === null) return DEFAULTS[key];
  const def = DEFAULTS[key];
  if (typeof def === "boolean") return raw === "true";
  if (typeof def === "number") return Number(raw);
  return raw;
}

export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  const row = get.get(key) as { value: string } | undefined;
  return parseValue(key, row?.value ?? null) as AppSettings[K];
}

export function getAllSettings(): AppSettings {
  const rows = all.all() as { key: string; value: string }[];
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof AppSettings)[]) {
    if (map.has(key)) {
      (out as Record<string, unknown>)[key] = parseValue(key, map.get(key) ?? null);
    }
  }
  return out;
}

export function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
  upsert.run(key, String(value));
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    upsert.run(key, String(value));
  }
  return getAllSettings();
}
