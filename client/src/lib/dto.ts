import type { StatItem } from "@/components/StatList";

export interface RankedListResponse {
  period: "week" | "month" | "year" | "all";
  items: StatItem[];
}

export interface SummaryResponse {
  plays: number;
  tracks: number;
  albums: number;
  artists: number;
  days_active: number;
  longest_streak_days: number;
  avg_daily_plays: number;
  first_scrobble_at: number | null;
}

export interface LibraryStatusResponse {
  albums: number;
  last_synced_at: number | null;
}

export interface ArtistImageStatsResponse {
  status: Record<string, number>;
  recent_missing: { artist: string; updated_at: number }[];
}

export interface ArtistLinksStatsResponse {
  status: Record<string, number>;
  recent_missing: { mb_artist_id: string; artist_name: string | null; updated_at: number }[];
}

export interface MediaCacheStatsResponse {
  cover_art: { status: Record<string, number> };
  artist_images: { status: Record<string, number> };
  artist_links: { status: Record<string, number> };
}

export interface ImportStatus {
  source: "lastfm" | "listenbrainz";
  phase: "idle" | "running" | "done" | "error";
  started_at: number | null;
  finished_at: number | null;
  pages_fetched: number;
  fetched: number;
  inserted: number;
  error: string | null;
}

export interface ImportStatusResponse {
  lastfm: ImportStatus;
  listenbrainz: ImportStatus;
}

export interface AlbumDetailDto {
  artist: string;
  album: string;
  total_plays: number;
  unique_tracks: number;
  rank: number | null;
  first_listen_at: number | null;
  last_listen_at: number | null;
  cover_art_url: string | null;
  release_year: number | null;
  mb_release_id: string | null;
  monthly: { month: string; count: number }[];
  tracks: { position: number; title: string; play_count: number; duration_seconds: number | null }[];
  recent: { track: string; artist: string; album: string | null; timestamp: number; cover_art_url: string | null }[];
}

export interface TrackDetailDto {
  artist: string;
  track: string;
  primary_album: string | null;
  total_plays: number;
  rank: number | null;
  first_listen_at: number | null;
  last_listen_at: number | null;
  cover_art_url: string | null;
  monthly: { month: string; count: number }[];
  recent_plays: { timestamp: number; album: string | null }[];
  albums_appeared_on: { name: string; play_count: number; cover_art_url: string | null }[];
}

export interface LibraryRowDto {
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

export interface LibraryResponse {
  rows: LibraryRowDto[];
  total: number;
  played: number;
  unplayed: number;
}

export interface OnThisDayItem {
  year: number;
  artist: string;
  track: string;
  album: string | null;
  plays: number;
  cover_art_url: string | null;
}

export interface OnThisDayResponse {
  items: OnThisDayItem[];
}

export interface TimeOfDayResponse {
  cells: { day_of_week: number; hour: number; count: number }[];
}

export interface DecadesResponse {
  decades: { decade: number; count: number }[];
  albums_resolved: number;
  albums_total: number;
}

export interface HeatmapResponse {
  year: number;
  data: { date: string; count: number }[];
}

export interface ScrobblesResponse {
  scrobbles: {
    track: string;
    artist: string;
    album: string | null;
    timestamp: number;
  }[];
}

export interface RewindHighlight {
  artist: string;
  track: string;
  album: string | null;
  timestamp: number;
  cover_art_url: string | null;
}

export interface RewindResponse {
  year: number;
  total_scrobbles: number;
  unique_artists: number;
  unique_albums: number;
  unique_tracks: number;
  top_artists: StatItem[];
  top_albums: StatItem[];
  top_tracks: StatItem[];
  longest_streak_days: number;
  biggest_day: { date: string; count: number } | null;
  biggest_week: { start_date: string; count: number } | null;
  biggest_month: { month: string; count: number } | null;
  first_scrobble_of_year: RewindHighlight | null;
  last_scrobble_of_year: RewindHighlight | null;
  new_artists_discovered: number;
  new_albums_discovered: number;
}

export interface AppSettingsDto {
  lastfm_api_key: string;
  lastfm_shared_secret: string;
  lastfm_username: string;
  lastfm_session_key: string;
  lastfm_session_username: string;
  listenbrainz_username: string;
  listenbrainz_token: string;
  slskd_url: string;
  slskd_api_key: string;
  navidrome_url: string;
  navidrome_admin_username: string;
  navidrome_admin_password: string;
  relay_lastfm: boolean;
  relay_listenbrainz: boolean;
  suggestion_schedule: string;
  dismiss_cooldown_days: number;
  beets_config_path: string;
  now_playing_window_seconds: number;
  theme: string;
  download_allowed_extensions: string;
  download_lossless_only: boolean;
  download_min_kbps: number;
  download_min_files_per_album: number;
  flaresolverr_url: string;
}
