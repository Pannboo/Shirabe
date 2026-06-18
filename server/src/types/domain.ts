export type Role = "admin" | "listener";

export interface User {
  id: number;
  navidrome_user_id: string;
  username: string;
  role: Role;
  created_at: number;
}

export interface Scrobble {
  id: number;
  user_id: number;
  track: string;
  artist: string;
  album: string | null;
  timestamp: number;
  source_client: string | null;
  relayed_lastfm: number;
  relayed_listenbrainz: number;
  created_at: number;
}

export type SuggestionSource =
  | "lastfm"
  | "listenbrainz"
  | "musicbrainz"
  | "pitchfork"
  | "albumoftheyear"
  | "anydecentmusic"
  | "stereogum"
  | "npr"
  | "rym";
export type MatchStatus = "matched" | "unmatched" | "ambiguous" | "unresolved";
export type SuggestionMode = "album" | "track";
export type SuggestionStatus =
  | "pending"
  | "approved"
  | "dismissed"
  | "downloading"
  | "complete";

export interface Suggestion {
  id: number;
  source: SuggestionSource;
  artist: string;
  title: string | null;
  mb_release_id: string | null;
  mb_artist_id: string | null;
  cover_art_url: string | null;
  match_status: MatchStatus;
  mode: SuggestionMode;
  status: SuggestionStatus;
  dismissed_at: number | null;
  created_at: number;
  score: number | null;
  reason: string | null;
}

export type DownloadStatus =
  | "queued"
  | "searching"
  | "downloading"
  | "complete"
  | "failed";

export interface Download {
  id: number;
  suggestion_id: number | null;
  slskd_search_id: string | null;
  mode: SuggestionMode;
  status: DownloadStatus;
  download_path: string | null;
  created_at: number;
  completed_at: number | null;
  artist: string | null;
  title: string | null;
}

export interface ReviewItem {
  id: number;
  download_id: number | null;
  file_path: string;
  beets_attempt: string | null;
  confidence: number | null;
  status: "pending" | "done";
  created_at: number;
}

export interface AppSettings {
  lastfm_api_key: string;
  lastfm_shared_secret: string;
  lastfm_username: string;
  // Short-lived request token returned by Last.fm auth.getToken, persisted
  // while the user authorises in the popup so a server restart mid-OAuth
  // doesn't lose the in-flight exchange. Cleared when consumed or aborted.
  lastfm_pending_token: string;
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
  // Download quality filtering (applied to slskd search candidates so we
  // don't auto-grab video rips or low-bitrate junk).
  download_allowed_extensions: string;     // comma-separated, e.g. "flac,mp3,m4a"
  download_lossless_only: boolean;
  download_min_kbps: number;                // for lossy formats only
  download_min_files_per_album: number;     // skip releases with too few audio files
  // Optional FlareSolverr proxy URL (e.g. http://flaresolverr:8191/v1).
  // When set, Cloudflare-protected scraper sources (RYM, AOTY) route
  // their fetches through it. Empty = direct fetch.
  flaresolverr_url: string;
}

export type Period = "week" | "month" | "year" | "all";
