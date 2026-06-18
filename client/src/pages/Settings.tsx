import { useEffect, useState } from "react";
import { Library } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SectionTitle from "@/components/SectionTitle";
import { api } from "@/lib/api";
import type {
  AppSettingsDto,
  ArtistImageStatsResponse,
  ArtistLinksStatsResponse,
  ImportStatusResponse,
  LibraryStatusResponse,
} from "@/lib/dto";
import { useTheme } from "@/hooks/useTheme";
import { formatNumber, formatRelative } from "@/lib/format";

export default function Settings() {
  const [settings, setSettings] = useState<AppSettingsDto | null>(null);
  const [library, setLibrary] = useState<LibraryStatusResponse | null>(null);
  const [artistImages, setArtistImages] = useState<ArtistImageStatsResponse | null>(null);
  const [artistLinks, setArtistLinks] = useState<ArtistLinksStatsResponse | null>(null);
  const [importStatus, setImportStatus] = useState<ImportStatusResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [requeuing, setRequeuing] = useState(false);
  const [requeuingLinks, setRequeuingLinks] = useState(false);
  const { setTheme } = useTheme();

  useEffect(() => {
    api<AppSettingsDto>("/api/settings").then(setSettings);
    api<LibraryStatusResponse>("/api/settings/library").then(setLibrary).catch(() => {});
    api<ArtistImageStatsResponse>("/api/settings/artist-images").then(setArtistImages).catch(() => {});
    api<ArtistLinksStatsResponse>("/api/settings/artist-links").then(setArtistLinks).catch(() => {});
    api<ImportStatusResponse>("/api/settings/import/status").then(setImportStatus).catch(() => {});
  }, []);

  // Poll the import status fast (2s) while either job is running, slow
  // (30s) otherwise. Keeps the UI live without burning requests when
  // nothing's happening.
  useEffect(() => {
    const running =
      importStatus?.lastfm.phase === "running" ||
      importStatus?.listenbrainz.phase === "running";
    const interval = running ? 2_000 : 30_000;
    const id = setInterval(() => {
      api<ImportStatusResponse>("/api/settings/import/status")
        .then(setImportStatus)
        .catch(() => {});
    }, interval);
    return () => clearInterval(id);
  }, [importStatus?.lastfm.phase, importStatus?.listenbrainz.phase]);

  async function startImport(source: "lastfm" | "listenbrainz") {
    try {
      await api(`/api/settings/import/${source}`, { method: "POST" });
      // Immediate refresh so the button flips to "Running…" without
      // waiting for the next poll tick.
      const fresh = await api<ImportStatusResponse>("/api/settings/import/status");
      setImportStatus(fresh);
    } catch (err) {
      alert(`Failed to start ${source} import: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  async function requeueArtistLinks(mode: "missing" | "all") {
    setRequeuingLinks(true);
    try {
      const path = mode === "all"
        ? "/api/settings/artist-links/requeue?all=true"
        : "/api/settings/artist-links/requeue";
      const result = await api<
        | { mode: "missing_only"; requeued: number }
        | { mode: "reseed"; wiped: number; queued: number }
      >(path, { method: "POST" });
      const fresh = await api<ArtistLinksStatsResponse>("/api/settings/artist-links");
      setArtistLinks(fresh);
      if (result.mode === "missing_only") {
        alert(`Requeued ${result.requeued} missing artist link${result.requeued === 1 ? "" : "s"}.`);
      } else {
        alert(`Wiped ${result.wiped} row${result.wiped === 1 ? "" : "s"} and re-queued ${result.queued} artists for link resolution.`);
      }
    } finally {
      setRequeuingLinks(false);
    }
  }

  async function requeueArtistImages(mode: "missing" | "all") {
    setRequeuing(true);
    try {
      const path = mode === "all"
        ? "/api/settings/artist-images/requeue?all=true"
        : "/api/settings/artist-images/requeue";
      const result = await api<
        | { mode: "missing_only"; requeued: number }
        | { mode: "reseed"; wiped: number; queued: number }
      >(path, { method: "POST" });
      const fresh = await api<ArtistImageStatsResponse>("/api/settings/artist-images");
      setArtistImages(fresh);
      if (result.mode === "missing_only") {
        alert(`Requeued ${result.requeued} missing artist${result.requeued === 1 ? "" : "s"}.`);
      } else {
        alert(`Wiped ${result.wiped} row${result.wiped === 1 ? "" : "s"} and re-queued ${result.queued} artists from your scrobbles.`);
      }
    } finally {
      setRequeuing(false);
    }
  }

  if (!settings) return <p className="text-sm text-muted-foreground">Loading…</p>;

  function update<K extends keyof AppSettingsDto>(key: K, value: AppSettingsDto[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    if (key === "theme") setTheme(value as string);
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await api<AppSettingsDto>("/api/settings", { method: "POST", body: settings });
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function syncLibrary() {
    setSyncing(true);
    try {
      const result = await api<LibraryStatusResponse>("/api/settings/library/sync", { method: "POST" });
      setLibrary(result);
    } catch (err) {
      alert(`Library sync failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setSyncing(false);
    }
  }

  async function connectLastFm() {
    const w = window.open("about:blank", "_blank", "width=520,height=720");
    try {
      const { url } = await api<{ url: string }>("/api/auth/lastfm/connect");
      if (w) w.location.href = url;
    } catch (err) {
      try { w?.close(); } catch { /* ignore */ }
      alert(`Failed to start Last.fm connect: ${err instanceof Error ? err.message : "error"}`);
      return;
    }
    const poll = setInterval(async () => {
      try {
        const result = await api<{ status: string; error?: string; error_code?: number }>(
          "/api/auth/lastfm/try-exchange",
          { method: "POST" },
        );
        if (result.status === "error") {
          clearInterval(poll);
          try { w?.close(); } catch { /* ignore */ }
          alert(`Last.fm rejected the exchange: ${result.error} (code ${result.error_code ?? "?"})`);
          return;
        }
      } catch {/* ignore transient errors */}
      const fresh = await api<AppSettingsDto>("/api/settings");
      if (fresh.lastfm_session_key) {
        setSettings(fresh);
        clearInterval(poll);
        try { w?.close(); } catch { /* ignore */ }
      }
    }, 2000);
    setTimeout(() => clearInterval(poll), 5 * 60_000);
  }

  async function disconnectLastFm() {
    await api("/api/auth/lastfm/disconnect", { method: "POST" });
    const fresh = await api<AppSettingsDto>("/api/settings");
    setSettings(fresh);
  }

  return (
    <div className="max-w-3xl space-y-6 pb-24">
      <h2 className="font-serif text-4xl md:text-5xl tracking-tight">Settings</h2>

      <Section title="Last.fm">
        <Field label="API key">
          <Input value={settings.lastfm_api_key} onChange={(e) => update("lastfm_api_key", e.target.value)} />
        </Field>
        <Field label="Shared secret">
          <Input type="password" value={settings.lastfm_shared_secret} onChange={(e) => update("lastfm_shared_secret", e.target.value)} />
        </Field>
        <Field label="Username (for suggestions)">
          <Input value={settings.lastfm_username} onChange={(e) => update("lastfm_username", e.target.value)} />
        </Field>
        <div className="rounded-xl border border-border bg-background/40 p-3 space-y-2">
          <div className="text-sm">
            Account for relay:{" "}
            {settings.lastfm_session_username ? (
              <span className="font-medium">{settings.lastfm_session_username}</span>
            ) : (
              <span className="text-muted-foreground">not connected</span>
            )}
          </div>
          {settings.lastfm_session_key ? (
            <Button size="sm" variant="outline" onClick={disconnectLastFm}>Disconnect</Button>
          ) : (
            <Button size="sm" onClick={connectLastFm} disabled={!settings.lastfm_api_key || !settings.lastfm_shared_secret}>
              Connect Last.fm
            </Button>
          )}
          {!settings.lastfm_api_key || !settings.lastfm_shared_secret ? (
            <p className="text-xs text-muted-foreground">Save the API key + shared secret first, then connect.</p>
          ) : null}
        </div>
        <Toggle label="Relay scrobbles to Last.fm" value={settings.relay_lastfm} onChange={(v) => update("relay_lastfm", v)} />
      </Section>

      <Section title="ListenBrainz">
        <Field label="Username">
          <Input value={settings.listenbrainz_username} onChange={(e) => update("listenbrainz_username", e.target.value)} />
        </Field>
        <Field label="Token">
          <Input value={settings.listenbrainz_token} onChange={(e) => update("listenbrainz_token", e.target.value)} />
        </Field>
        <Toggle label="Relay scrobbles to ListenBrainz" value={settings.relay_listenbrainz} onChange={(v) => update("relay_listenbrainz", v)} />
      </Section>

      <Section title="Import scrobble history">
        <p className="text-xs text-muted-foreground">
          One-click bulk import from Last.fm or ListenBrainz. Reads the username already
          configured above. Re-runs are safe — a unique-index dedupe means existing scrobbles
          are skipped, only new rows land. Imported scrobbles are flagged as already-relayed
          so the relay job doesn't bounce them back to the source.
        </p>
        {importStatus && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ImportPanel
              label="Last.fm"
              status={importStatus.lastfm}
              configured={!!settings.lastfm_username && !!settings.lastfm_api_key}
              onStart={() => startImport("lastfm")}
            />
            <ImportPanel
              label="ListenBrainz"
              status={importStatus.listenbrainz}
              configured={!!settings.listenbrainz_username}
              onStart={() => startImport("listenbrainz")}
            />
          </div>
        )}
      </Section>

      <Section title="slskd">
        <Field label="URL"><Input value={settings.slskd_url} onChange={(e) => update("slskd_url", e.target.value)} /></Field>
        <Field label="API key"><Input value={settings.slskd_api_key} onChange={(e) => update("slskd_api_key", e.target.value)} /></Field>
      </Section>

      <Section title="Navidrome">
        <Field label="URL"><Input value={settings.navidrome_url} onChange={(e) => update("navidrome_url", e.target.value)} /></Field>
        <Field label="Admin username (for now-playing + cover art)">
          <Input value={settings.navidrome_admin_username} onChange={(e) => update("navidrome_admin_username", e.target.value)} />
        </Field>
        <Field label="Admin password">
          <Input type="password" value={settings.navidrome_admin_password} onChange={(e) => update("navidrome_admin_password", e.target.value)} />
        </Field>
        <p className="text-xs text-muted-foreground">
          Used server-side for Subsonic <code>getNowPlaying</code>, cover-art proxy, and library mirror (so Discover can skip owned albums).
          Never exposed to the public dashboard.
        </p>
        <div className="rounded-xl border border-border bg-background/40 p-3 flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <Library className="h-3.5 w-3.5" />
            Library mirror:{" "}
            <span className="font-medium text-foreground tabular-nums">
              {library ? formatNumber(library.albums) : "—"}
            </span> albums
            {library?.last_synced_at ? <> · synced {formatRelative(library.last_synced_at)}</> : null}
          </div>
          <Button size="sm" variant="outline" onClick={syncLibrary} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
        </div>
      </Section>

      <Section title="Download quality">
        <p className="text-xs text-muted-foreground">
          Used when grabbing albums or tracks from slskd. Without these filters, the auto-picker
          will happily grab the largest file — including video rips.
        </p>
        <Toggle
          label="Lossless only (FLAC / WAV / ALAC / AIFF)"
          value={settings.download_lossless_only}
          onChange={(v) => update("download_lossless_only", v)}
        />
        <Field label="Allowed file extensions (comma-separated)">
          <Input
            value={settings.download_allowed_extensions}
            onChange={(e) => update("download_allowed_extensions", e.target.value)}
            placeholder="flac,mp3,m4a,ogg,opus"
          />
        </Field>
        <Field label="Minimum bitrate for lossy formats (kbps)">
          <Input
            type="number"
            value={settings.download_min_kbps}
            onChange={(e) => update("download_min_kbps", Number(e.target.value))}
          />
        </Field>
        <Field label="Minimum files per album (skips singles/EP-style folders)">
          <Input
            type="number"
            value={settings.download_min_files_per_album}
            onChange={(e) => update("download_min_files_per_album", Number(e.target.value))}
          />
        </Field>
      </Section>

      <Section title="Artist image cache">
        <p className="text-xs text-muted-foreground">
          Top-artist tiles try MusicBrainz → ListenBrainz → Last.fm <code>artist.search</code> in order.
          Anything that comes back without a usable photo (or hits the deprecated Last.fm star placeholder)
          is cached as <strong>missing</strong> and falls back to the artist's most-played album cover.
        </p>
        {artistImages && (
          <div className="rounded-xl border border-border bg-background/40 p-3 space-y-2">
            <div className="flex items-center gap-4 text-xs flex-wrap">
              <span>
                <span className="font-medium text-foreground tabular-nums">{artistImages.status.resolved ?? 0}</span>
                <span className="ml-1 text-muted-foreground">resolved</span>
              </span>
              <span>
                <span className="font-medium text-foreground tabular-nums">{artistImages.status.missing ?? 0}</span>
                <span className="ml-1 text-muted-foreground">missing</span>
              </span>
              <span>
                <span className="font-medium text-foreground tabular-nums">{artistImages.status.pending ?? 0}</span>
                <span className="ml-1 text-muted-foreground">pending</span>
              </span>
              <Button size="sm" variant="outline" onClick={() => requeueArtistImages("missing")} disabled={requeuing}>
                {requeuing ? "Requeuing…" : "Retry missing"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => requeueArtistImages("all")} disabled={requeuing}>
                {requeuing ? "…" : "Wipe + re-seed all"}
              </Button>
            </div>
            {artistImages.recent_missing.length > 0 && (
              <details>
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                  Show {artistImages.recent_missing.length} most recent missing artists
                </summary>
                <ul className="mt-2 max-h-48 overflow-auto text-[11px] text-muted-foreground font-mono space-y-0.5">
                  {artistImages.recent_missing.map((m) => (
                    <li key={m.artist}>{m.artist}</li>
                  ))}
                </ul>
              </details>
            )}
            <p className="text-[11px] text-muted-foreground">
              Tip: server logs (<code>[artist-image] &lt;name&gt; → mb=… lb=… lfm=…</code>) show which lookup
              contributed for each resolve.
            </p>
          </div>
        )}
      </Section>

      <Section title="Artist links cache">
        <p className="text-xs text-muted-foreground">
          External links on the artist page (Spotify, YouTube, Discogs, Wikipedia, socials...) come from
          MusicBrainz <code>url-rels</code>. Resolver runs at 1 artist / 30s, only for artists whose MBID
          is already cached by the artist-image resolver.
        </p>
        {artistLinks && (
          <div className="rounded-xl border border-border bg-background/40 p-3 space-y-2">
            <div className="flex items-center gap-4 text-xs flex-wrap">
              <span>
                <span className="font-medium text-foreground tabular-nums">{artistLinks.status.resolved ?? 0}</span>
                <span className="ml-1 text-muted-foreground">resolved</span>
              </span>
              <span>
                <span className="font-medium text-foreground tabular-nums">{artistLinks.status.missing ?? 0}</span>
                <span className="ml-1 text-muted-foreground">missing</span>
              </span>
              <span>
                <span className="font-medium text-foreground tabular-nums">{artistLinks.status.pending ?? 0}</span>
                <span className="ml-1 text-muted-foreground">pending</span>
              </span>
              <Button size="sm" variant="outline" onClick={() => requeueArtistLinks("missing")} disabled={requeuingLinks}>
                {requeuingLinks ? "Requeuing…" : "Retry missing"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => requeueArtistLinks("all")} disabled={requeuingLinks}>
                {requeuingLinks ? "…" : "Wipe + re-seed all"}
              </Button>
            </div>
            {artistLinks.recent_missing.length > 0 && (
              <details>
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                  Show {artistLinks.recent_missing.length} most recent missing artists
                </summary>
                <ul className="mt-2 max-h-48 overflow-auto text-[11px] text-muted-foreground font-mono space-y-0.5">
                  {artistLinks.recent_missing.map((m) => (
                    <li key={m.mb_artist_id}>
                      {m.artist_name ?? m.mb_artist_id}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p className="text-[11px] text-muted-foreground">
              Tip: server logs (<code>[artist-links] &lt;mbid&gt; → N relations → M kept</code>)
              show what MB returned per resolve. "Wipe + re-seed all" pulls every MBID already in
              artist_images, so the resolver works through them at 1/30s without you having to visit each page.
            </p>
          </div>
        )}
      </Section>

      <Section title="Cloudflare bypass (FlareSolverr)">
        <p className="text-xs text-muted-foreground">
          Some Discover sources (RateYourMusic, AlbumOfTheYear) sit behind Cloudflare and
          reject server-side fetches. Run{" "}
          <a
            href="https://github.com/FlareSolverr/FlareSolverr"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            FlareSolverr
          </a>{" "}
          as a sidecar container and paste its endpoint here — those sources will route
          through it. Leave empty to use direct fetches.
        </p>
        <Field label="FlareSolverr endpoint URL">
          <Input
            value={settings.flaresolverr_url}
            onChange={(e) => update("flaresolverr_url", e.target.value)}
            placeholder="http://flaresolverr:8191/v1"
          />
        </Field>
      </Section>

      <Section title="Appearance">
        <Field label="Theme">
          <select
            className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm"
            value={settings.theme}
            onChange={(e) => update("theme", e.target.value)}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </Field>
      </Section>

      <Section title="Curator">
        <Field label="Suggestion schedule (cron)">
          <Input value={settings.suggestion_schedule} onChange={(e) => update("suggestion_schedule", e.target.value)} />
        </Field>
        <Field label="Dismissed suggestion cooldown (days)">
          <Input type="number" value={settings.dismiss_cooldown_days} onChange={(e) => update("dismiss_cooldown_days", Number(e.target.value))} />
        </Field>
        <Field label="Beets config path">
          <Input value={settings.beets_config_path} onChange={(e) => update("beets_config_path", e.target.value)} />
        </Field>
        <Field label="Now-playing live window (seconds)">
          <Input type="number" value={settings.now_playing_window_seconds} onChange={(e) => update("now_playing_window_seconds", Number(e.target.value))} />
        </Field>
      </Section>

      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20">
        <div className="rounded-full border border-border bg-card/95 backdrop-blur shadow-lg flex items-center gap-3 px-4 py-2">
          {saved && <span className="text-xs text-muted-foreground">Saved.</span>}
          <Button onClick={save} disabled={saving} size="sm">
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  // Settings benefits from a soft container so form inputs feel grouped.
  // Keep the wrapper but soften it vs the rest of the app — barely-there
  // border + low-opacity card tint.
  return (
    <section className="rounded-2xl border border-border/40 bg-card/30 p-5 space-y-3">
      <SectionTitle>{title}</SectionTitle>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm select-none">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="accent-accent" />
      <span>{label}</span>
    </label>
  );
}

function ImportPanel({
  label,
  status,
  configured,
  onStart,
}: {
  label: string;
  status: import("@/lib/dto").ImportStatus;
  configured: boolean;
  onStart: () => void;
}) {
  const running = status.phase === "running";
  const done = status.phase === "done";
  const errored = status.phase === "error";
  const finishedRecently =
    status.finished_at !== null && Date.now() - status.finished_at < 5 * 60_000;
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <Button
          size="sm"
          variant="outline"
          onClick={onStart}
          disabled={!configured || running}
          title={!configured ? "Configure username + key first" : undefined}
        >
          {running ? "Importing…" : done || errored ? "Re-run" : "Import"}
        </Button>
      </div>
      {!configured && (
        <p className="text-[11px] text-muted-foreground">
          Configure the username (and API key for Last.fm) above first.
        </p>
      )}
      {running && (
        <div className="text-[11px] text-muted-foreground space-y-0.5">
          <div>
            Page <span className="tabular-nums text-foreground">{status.pages_fetched}</span> ·
            fetched <span className="tabular-nums text-foreground">{status.fetched.toLocaleString()}</span> ·
            new <span className="tabular-nums text-foreground">{status.inserted.toLocaleString()}</span>
          </div>
          <div>Background job — safe to navigate away.</div>
        </div>
      )}
      {done && finishedRecently && (
        <div className="text-[11px] text-muted-foreground">
          Imported <span className="text-foreground tabular-nums">{status.inserted.toLocaleString()}</span> new scrobbles
          {status.fetched > status.inserted && (
            <> · {(status.fetched - status.inserted).toLocaleString()} already in DB</>
          )}.
        </div>
      )}
      {errored && (
        <div className="text-[11px] text-destructive">{status.error ?? "Import failed."}</div>
      )}
    </div>
  );
}
