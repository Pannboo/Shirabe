import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const dbPath = isAbsolute(config.DATABASE_URL)
  ? config.DATABASE_URL
  : resolve(process.cwd(), config.DATABASE_URL);

mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");

// Apply schema synchronously at import time so query modules can prepare
// statements during their own evaluation. (ESM hoists imports, so running
// migrate() from index.ts is too late — queries are already prepared by then.)
const here = dirname(fileURLToPath(import.meta.url));
db.exec(readFileSync(join(here, "schema.sql"), "utf8"));

// Idempotent ALTER TABLE migrations for columns added after the initial
// schema. CREATE TABLE IF NOT EXISTS skips existing tables entirely, so we
// have to add new columns separately. Checking PRAGMA table_info is cheaper
// than try/catching every boot.
function ensureColumn(table: string, column: string, ddl: string): void {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (info.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

ensureColumn("coverart", "release_year", "release_year INTEGER");
ensureColumn("suggestions", "score", "score REAL");
ensureColumn("suggestions", "reason", "reason TEXT");
ensureColumn("downloads", "artist", "artist TEXT");
ensureColumn("downloads", "title", "title TEXT");
// Correlation columns for pollDownloads — without them we'd have to guess
// which slskd transfer belongs to which download row, and beets gets
// triggered on the wrong file (or on an unrelated peer's leftover).
ensureColumn("downloads", "slskd_username", "slskd_username TEXT");
ensureColumn("downloads", "slskd_folder", "slskd_folder TEXT");
// Local image cache (services/imageCache.ts) — stores a disk path + the
// upstream Content-Type so /api/image/... can sendFile with the right
// MIME header. NULL until the warm job / first lazy fetch populates it.
ensureColumn("coverart", "local_path", "local_path TEXT");
ensureColumn("coverart", "content_type", "content_type TEXT");
ensureColumn("artist_images", "local_path", "local_path TEXT");
ensureColumn("artist_images", "content_type", "content_type TEXT");
// Captured from Navidrome's getNowPlaying when available — drives the
// progress bar on the web NowPlaying card and the Discord /nowplaying card.
ensureColumn("now_playing", "duration", "duration INTEGER");

// One-shot data migrations. Tracked in the settings table so each only runs
// once across reboots.
function runMigrationOnce(name: string, fn: () => void): void {
  const key = `migration_${name}_done`;
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
  if (row) return;
  fn();
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, 'true')`).run(key);
}

// 2026-06: switched artist image resolver from artist.getInfo (which now
// returns Last.fm's deprecated 3-star placeholder) to artist.search. Wipe
// the cache so existing rows re-resolve via the new path.
runMigrationOnce("invalidate_artist_images_v1", () => {
  db.exec(`DELETE FROM artist_images`);
});

// 2026-06: Last.fm artist.search also turned out to be dead for images
// (returns placeholders for every artist post-2022). Switched primary
// source to Deezer. Wipe cache again so previously-missing artists are
// retried through the new chain.
runMigrationOnce("invalidate_artist_images_v2_deezer", () => {
  db.exec(`DELETE FROM artist_images`);
});

// 2026-06: enforce scrobble uniqueness on (user_id, artist, track, timestamp).
// Required so the Last.fm / ListenBrainz history-import flow can use
// INSERT OR IGNORE for idempotent re-runs. Existing duplicates are
// collapsed first (keeping the lowest id) — without that the CREATE
// UNIQUE INDEX would fail on any DB that already has dupes.
// 2026-06: suggestionExists used to be case-sensitive, so the same album
// could land under different casings ("Cacola" vs "cacola") and show up
// twice on the Discover page. Collapse the existing duplicates here so
// the post-fix dedupe has a clean slate; the lowest id wins.
runMigrationOnce("dedupe_suggestions_v1", () => {
  db.exec(`
    DELETE FROM suggestions WHERE id NOT IN (
      SELECT MIN(id) FROM suggestions
      GROUP BY LOWER(TRIM(artist)), LOWER(TRIM(IFNULL(title, '')))
    )
  `);
});

runMigrationOnce("uniq_scrobbles_v1", () => {
  db.exec(`
    DELETE FROM scrobbles WHERE id NOT IN (
      SELECT MIN(id) FROM scrobbles GROUP BY user_id, artist, track, timestamp
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_scrobble
      ON scrobbles(user_id, artist, track, timestamp);
  `);
});
