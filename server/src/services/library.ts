import { db } from "../db/client.js";
import { getOrEnqueueCoverArt } from "../jobs/resolveCoverArt.js";

// Library browse — joins library_albums (the Navidrome mirror) with scrobble
// aggregates so each row in the browse view carries the user's play stats
// for that album. Supports search / sort / filter and paginates at 60 rows.

export type LibrarySort =
  | "last_played"      // most-recent play first, never-played last
  | "most_played"      // by play count desc
  | "alphabetical"     // by album title
  | "artist"           // by artist name then album
  | "recently_added";  // by library_albums.last_seen_at

export type LibraryFilter =
  | "all"
  | "never_played"
  | "played_recently"        // last 30 days
  | "played_this_year"
  | "lost_gems";             // not played in 6+ months

export interface LibraryAlbumRow {
  artist: string;
  album: string;
  navidrome_album_id: string | null;
  mb_release_id: string | null;
  cover_art_url: string | null;
  release_year: number | null;
  play_count: number;
  first_played_at: number | null;
  last_played_at: number | null;
}

export interface LibraryPage {
  rows: LibraryAlbumRow[];
  total: number;
  played: number;
  unplayed: number;
}

export interface LibraryOpts {
  sort?: LibrarySort;
  filter?: LibraryFilter;
  search?: string;
  page?: number;
  page_size?: number;
}

// Headline counts for the library page header. Cheap aggregate query —
// played = library albums with at least one scrobble; the rest are unplayed.
const libraryCountsStmt = db.prepare(`
  WITH counts AS (
    SELECT
      la.artist_key, la.album_key,
      EXISTS (
        SELECT 1 FROM scrobbles s
        WHERE s.user_id = ?
          AND s.artist = la.artist
          AND s.album = la.album
        LIMIT 1
      ) AS has_scrobble
    FROM library_albums la
  )
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN has_scrobble = 1 THEN 1 ELSE 0 END) AS played
  FROM counts
`);

function buildListSql(opts: LibraryOpts): { sql: string; params: unknown[] } {
  const params: unknown[] = [];

  // Aggregate join: scrobble counts + first/last per (artist, album) for
  // this user. LEFT JOIN so never-played albums stay in the result set.
  let sql = `
    SELECT
      la.artist AS artist,
      la.album AS album,
      la.navidrome_album_id AS navidrome_album_id,
      la.mb_release_id AS mb_release_id,
      la.last_seen_at AS last_seen_at,
      ca.release_year AS release_year,
      COALESCE(agg.play_count, 0) AS play_count,
      agg.first_played_at AS first_played_at,
      agg.last_played_at AS last_played_at
    FROM library_albums la
    LEFT JOIN (
      SELECT
        artist, album,
        COUNT(*) AS play_count,
        MIN(timestamp) AS first_played_at,
        MAX(timestamp) AS last_played_at
      FROM scrobbles
      WHERE user_id = ?
      GROUP BY artist, album
    ) agg ON agg.artist = la.artist AND agg.album = la.album
    LEFT JOIN coverart ca ON ca.artist = la.artist AND ca.album = la.album
  `;
  params.push(opts.search === undefined ? null : null); // placeholder, replaced below — first param is the user_id
  params.length = 0;
  params.push(/* user_id will be unshifted by caller */);

  // ↑ Reset and rely on caller to inject user_id as first param; we just
  // collect WHERE / ORDER / LIMIT clauses below.
  const where: string[] = [];

  if (opts.filter === "never_played") {
    where.push("agg.play_count IS NULL");
  } else if (opts.filter === "played_recently") {
    where.push("agg.last_played_at >= unixepoch() - 30 * 86400");
  } else if (opts.filter === "played_this_year") {
    where.push(`agg.last_played_at >= strftime('%s', strftime('%Y', 'now') || '-01-01')`);
  } else if (opts.filter === "lost_gems") {
    where.push("agg.last_played_at IS NOT NULL AND agg.last_played_at < unixepoch() - 180 * 86400");
  }

  if (opts.search && opts.search.trim()) {
    where.push("(la.artist LIKE ? OR la.album LIKE ?)");
    const q = `%${opts.search.trim()}%`;
    params.push(q, q);
  }

  if (where.length > 0) sql += " WHERE " + where.join(" AND ");

  const order = (() => {
    switch (opts.sort) {
      case "most_played": return "play_count DESC, la.artist ASC, la.album ASC";
      case "alphabetical": return "la.album COLLATE NOCASE ASC";
      case "artist": return "la.artist COLLATE NOCASE ASC, la.album COLLATE NOCASE ASC";
      case "recently_added": return "la.last_seen_at DESC";
      case "last_played":
      default: return "last_played_at DESC NULLS LAST, la.artist ASC";
    }
  })();
  sql += ` ORDER BY ${order}`;

  const pageSize = Math.min(Math.max(opts.page_size ?? 60, 12), 120);
  const offset = Math.max(opts.page ?? 0, 0) * pageSize;
  sql += ` LIMIT ${pageSize} OFFSET ${offset}`;

  return { sql, params };
}

export function listLibrary(userId: number, opts: LibraryOpts = {}): LibraryPage {
  const counts = libraryCountsStmt.get(userId) as { total: number; played: number | null };
  const total = counts.total ?? 0;
  const played = counts.played ?? 0;

  const { sql, params } = buildListSql(opts);
  // user_id is the first bind for the subquery — prepend.
  const rows = db.prepare(sql).all(userId, ...params) as Array<{
    artist: string;
    album: string;
    navidrome_album_id: string | null;
    mb_release_id: string | null;
    last_seen_at: number;
    release_year: number | null;
    play_count: number;
    first_played_at: number | null;
    last_played_at: number | null;
  }>;

  return {
    rows: rows.map((r) => ({
      artist: r.artist,
      album: r.album,
      navidrome_album_id: r.navidrome_album_id,
      mb_release_id: r.mb_release_id,
      cover_art_url: getOrEnqueueCoverArt(r.artist, r.album),
      release_year: r.release_year && r.release_year > 1900 ? r.release_year : null,
      play_count: r.play_count,
      first_played_at: r.first_played_at,
      last_played_at: r.last_played_at,
    })),
    total,
    played,
    unplayed: total - played,
  };
}
