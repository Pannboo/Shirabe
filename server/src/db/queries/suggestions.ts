import { db } from "../client.js";
import type {
  Suggestion,
  SuggestionMode,
  SuggestionSource,
  SuggestionStatus,
  MatchStatus,
} from "../../types/domain.js";

const insert = db.prepare(`
  INSERT INTO suggestions
    (source, artist, title, mb_release_id, mb_artist_id, cover_art_url, match_status, mode, status, score, reason)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
`);

const exists = db.prepare(`
  SELECT 1 FROM suggestions
  WHERE artist = ? AND IFNULL(title, '') = IFNULL(?, '')
    AND (status != 'dismissed' OR dismissed_at > unixepoch() - ? * 86400)
  LIMIT 1
`);

// Order by score desc (NULLS last via COALESCE), then recency. Sources with a
// real signal (CF confidence, review rating) float their picks above pure
// similar-artist fillers.
const listPending = db.prepare(`
  SELECT * FROM suggestions
  WHERE status = 'pending'
  ORDER BY COALESCE(score, 0) DESC, created_at DESC
  LIMIT 200
`);

const byId = db.prepare(`SELECT * FROM suggestions WHERE id = ?`);
const setStatus = db.prepare(`UPDATE suggestions SET status = ? WHERE id = ?`);
const setMode = db.prepare(`UPDATE suggestions SET mode = ? WHERE id = ?`);
const setDismissed = db.prepare(`
  UPDATE suggestions SET status = 'dismissed', dismissed_at = unixepoch() WHERE id = ?
`);

export function suggestionExists(
  artist: string,
  title: string | null,
  cooldownDays: number,
): boolean {
  return exists.get(artist, title, cooldownDays) !== undefined;
}

export function insertSuggestion(input: {
  source: SuggestionSource;
  artist: string;
  title: string | null;
  mb_release_id: string | null;
  mb_artist_id: string | null;
  cover_art_url: string | null;
  match_status: MatchStatus;
  mode: SuggestionMode;
  score?: number | null;
  reason?: string | null;
}): Suggestion {
  const result = insert.run(
    input.source,
    input.artist,
    input.title,
    input.mb_release_id,
    input.mb_artist_id,
    input.cover_art_url,
    input.match_status,
    input.mode,
    input.score ?? null,
    input.reason ?? null,
  );
  return byId.get(result.lastInsertRowid) as Suggestion;
}

export function listPendingSuggestions(): Suggestion[] {
  return listPending.all() as Suggestion[];
}

export function getSuggestion(id: number): Suggestion | undefined {
  return byId.get(id) as Suggestion | undefined;
}

export function setSuggestionStatus(id: number, status: SuggestionStatus): void {
  setStatus.run(status, id);
}

export function setSuggestionMode(id: number, mode: SuggestionMode): void {
  setMode.run(mode, id);
}

export function dismissSuggestion(id: number): void {
  setDismissed.run(id);
}
