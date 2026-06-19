CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  navidrome_user_id TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'listener',
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS scrobbles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) NOT NULL,
  track TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  timestamp INTEGER NOT NULL,
  source_client TEXT,
  relayed_lastfm INTEGER DEFAULT 0,
  relayed_listenbrainz INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_scrobbles_user_ts ON scrobbles(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_scrobbles_artist ON scrobbles(artist);
CREATE INDEX IF NOT EXISTS idx_scrobbles_album ON scrobbles(album);

CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  artist TEXT NOT NULL,
  title TEXT,
  mb_release_id TEXT,
  mb_artist_id TEXT,
  cover_art_url TEXT,
  match_status TEXT DEFAULT 'unresolved',
  mode TEXT DEFAULT 'album',
  status TEXT DEFAULT 'pending',
  dismissed_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  -- Set by individual sources. Higher = more confident this is a good
  -- suggestion for this user; Discover sorts by this descending.
  score REAL,
  -- Human-readable "why this" string, e.g. "Pitchfork 8.4" or
  -- "New release from <artist> (you played them 47 times)".
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions(status);
CREATE INDEX IF NOT EXISTS idx_suggestions_artist_title ON suggestions(artist, title);

CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suggestion_id INTEGER REFERENCES suggestions(id),
  slskd_search_id TEXT,
  mode TEXT NOT NULL,
  status TEXT DEFAULT 'queued',
  download_path TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  completed_at INTEGER,
  -- Free-text artist/title for search-initiated downloads. Auto-approve
  -- copies these from the suggestion at insert time; manual /slskd-queue
  -- passes them in directly. Lets Queue render "Artist — Title" instead of
  -- the meaningless "suggestion #?".
  artist TEXT,
  title TEXT
);

CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);

CREATE TABLE IF NOT EXISTS review_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  download_id INTEGER REFERENCES downloads(id),
  file_path TEXT NOT NULL,
  beets_attempt TEXT,
  confidence REAL,
  status TEXT DEFAULT 'pending',
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS coverart (
  artist TEXT NOT NULL,
  album TEXT NOT NULL,
  mb_release_id TEXT,
  url TEXT,
  status TEXT DEFAULT 'pending',
  -- Release year, captured by the resolver from MusicBrainz when available.
  -- Drives the decade chart. Null when unknown.
  release_year INTEGER,
  -- Local cache filename (relative to /data/image-cache/album/) populated
  -- by services/imageCache.ts on first request or warm-cron tick.
  local_path TEXT,
  content_type TEXT,
  updated_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (artist, album)
);

CREATE INDEX IF NOT EXISTS idx_coverart_status ON coverart(status);

-- Mirror of the Navidrome library so suggestion pipelines can skip already-owned releases.
CREATE TABLE IF NOT EXISTS library_albums (
  artist_key TEXT NOT NULL,
  album_key TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT NOT NULL,
  navidrome_album_id TEXT,
  mb_release_id TEXT,
  last_seen_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (artist_key, album_key)
);

CREATE INDEX IF NOT EXISTS idx_library_mb ON library_albums(mb_release_id);

-- Per-artist image cache, resolved by the artist-image background job from
-- ListenBrainz / Cover Art Archive / Last.fm. Mirrors the coverart table.
CREATE TABLE IF NOT EXISTS artist_images (
  artist TEXT PRIMARY KEY,
  mb_artist_id TEXT,
  url TEXT,
  status TEXT DEFAULT 'pending',
  -- Local cache filename (relative to /data/image-cache/artist/) populated
  -- by services/imageCache.ts on first request or warm-cron tick.
  local_path TEXT,
  content_type TEXT,
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_artist_images_status ON artist_images(status);

-- MusicBrainz URL relationships for an artist (official homepage, socials,
-- streaming services, Discogs, Wikipedia, etc). Surfaced on the artist
-- detail page as an "External" right-rail panel. Keyed by MB artist id —
-- we read that from artist_images.mb_artist_id (populated by the artist
-- image resolver chain). Same pending/resolved/missing lifecycle as the
-- coverart / artist_images caches.
CREATE TABLE IF NOT EXISTS artist_links (
  mb_artist_id TEXT PRIMARY KEY,
  links_json TEXT,
  status TEXT DEFAULT 'pending',
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_artist_links_status ON artist_links(status);

-- Persisted now-playing state. Lives in SQLite (not memory) so it survives
-- server restarts — otherwise the now-playing endpoint falls back to the
-- previous scrobble during the gap between heartbeats and shows the wrong
-- song. One row per user.
CREATE TABLE IF NOT EXISTS now_playing (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  artist TEXT NOT NULL,
  track TEXT NOT NULL,
  album TEXT,
  timestamp INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  album_id TEXT,
  enriched_at INTEGER
);
