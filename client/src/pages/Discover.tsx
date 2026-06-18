import { useMemo, useState } from "react";
import { Library, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import SuggestionCard, { type SuggestionDto } from "@/components/SuggestionCard";
import SectionTitle from "@/components/SectionTitle";
import DiscoverSearch from "@/components/DiscoverSearch";
import { useApi } from "@/hooks/useApi";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatNumber, formatRelative } from "@/lib/format";
import type { LibraryStatusResponse } from "@/lib/dto";

interface SuggestionsResponse {
  suggestions: SuggestionDto[];
}

type SourceFilter = "all" | SuggestionDto["source"];

const SOURCE_LABEL: Record<SuggestionDto["source"], string> = {
  lastfm: "Last.fm",
  listenbrainz: "ListenBrainz",
  musicbrainz: "MusicBrainz",
  pitchfork: "Pitchfork",
  albumoftheyear: "AOTY",
  anydecentmusic: "ADM",
  stereogum: "Stereogum",
  npr: "NPR Music",
  rym: "RateYourMusic",
};

interface RefreshBreakdown {
  source: SuggestionDto["source"];
  label: string;
  fetched: number;
  added: number;
  skipped_duplicate: number;
  skipped_owned: number;
}

interface RefreshResponse {
  added: number;
  skipped: number;
  per_source: RefreshBreakdown[];
}

export default function Discover() {
  const [includeOwned, setIncludeOwned] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const path = `/api/suggestions${includeOwned ? "?include_owned=true" : ""}`;
  const { data, reload, loading } = useApi<SuggestionsResponse>(path, [includeOwned]);
  const library = useApi<LibraryStatusResponse>(`/api/settings/library`, [], { pollMs: 60_000 });
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<RefreshResponse | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  async function forceRefresh() {
    setRefreshing(true);
    try {
      const result = await api<RefreshResponse>(`/api/suggestions/refresh`, { method: "POST" });
      setLastRefresh(result);
      reload();
    } finally {
      setRefreshing(false);
    }
  }

  async function syncLibrary() {
    setSyncing(true);
    try {
      await api(`/api/suggestions/library/sync`, { method: "POST" });
      library.reload();
      reload();
    } finally {
      setSyncing(false);
    }
  }

  async function approve(id: number) {
    await api(`/api/suggestions/${id}/approve`, { method: "POST" });
    reload();
  }

  async function dismiss(id: number) {
    await api(`/api/suggestions/${id}/dismiss`, { method: "POST" });
    reload();
  }

  async function setMode(id: number, mode: "album" | "track") {
    await api(`/api/suggestions/${id}/mode`, { method: "PATCH", body: { mode } });
    reload();
  }

  const allSuggestions = data?.suggestions ?? [];
  // Per-source filter chips. Counts come from the unfiltered list so each
  // chip shows the candidate pool size.
  const sourceCounts = useMemo(() => {
    const m = new Map<SuggestionDto["source"], number>();
    for (const s of allSuggestions) m.set(s.source, (m.get(s.source) ?? 0) + 1);
    return m;
  }, [allSuggestions]);
  const suggestions = sourceFilter === "all"
    ? allSuggestions
    : allSuggestions.filter((s) => s.source === sourceFilter);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-4xl md:text-5xl tracking-tight">Discover</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Curated by MusicBrainz, ListenBrainz, Pitchfork BNM and Last.fm · already-owned releases filtered out.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setSearchOpen(true)}>
            <Search className="h-4 w-4" />
            Search
          </Button>
          <Button variant="outline" size="sm" onClick={syncLibrary} disabled={syncing}>
            <Library className="h-4 w-4" />
            {syncing ? "Syncing library…" : "Sync library"}
          </Button>
          <Button size="sm" onClick={forceRefresh} disabled={refreshing}>
            <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            {refreshing ? "Refreshing…" : "Force refresh"}
          </Button>
        </div>
      </div>

      <DiscoverSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card/60 px-4 py-3">
        <div className="text-xs text-muted-foreground">
          Library: <span className="font-medium text-foreground tabular-nums">
            {library.data ? formatNumber(library.data.albums) : "—"}
          </span> albums
          {library.data?.last_synced_at ? (
            <> · synced {formatRelative(library.data.last_synced_at)}</>
          ) : null}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground select-none">
          <input
            type="checkbox"
            checked={includeOwned}
            onChange={(e) => setIncludeOwned(e.target.checked)}
            className="accent-accent"
          />
          Show albums already in library
        </label>
      </div>

      {lastRefresh && (
        <div className="rounded-2xl border border-border bg-card/60 px-4 py-3 text-xs space-y-1.5">
          <div className="font-medium">
            Refresh added {lastRefresh.added} new · {lastRefresh.skipped} skipped
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            {lastRefresh.per_source.map((b) => (
              <span key={b.source}>
                <span className="font-medium text-foreground tabular-nums">{b.label}</span>:
                {" "}{b.added} added of {b.fetched} fetched
                {b.skipped_duplicate > 0 ? <> · {b.skipped_duplicate} dup</> : null}
                {b.skipped_owned > 0 ? <> · {b.skipped_owned} owned</> : null}
              </span>
            ))}
          </div>
        </div>
      )}

      {allSuggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip
            active={sourceFilter === "all"}
            onClick={() => setSourceFilter("all")}
            count={allSuggestions.length}
          >
            All
          </FilterChip>
          {Array.from(sourceCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([src, count]) => (
              <FilterChip
                key={src}
                active={sourceFilter === src}
                onClick={() => setSourceFilter(src)}
                count={count}
              >
                {SOURCE_LABEL[src]}
              </FilterChip>
            ))}
        </div>
      )}

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!loading && allSuggestions.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 px-6 py-12 text-center text-sm text-muted-foreground">
          No pending suggestions.
          <div className="mt-1 text-xs">
            Set up Last.fm and ListenBrainz in Settings, then click Force refresh.
          </div>
        </div>
      )}

      {suggestions.length > 0 && (
        <section>
          <SectionTitle trailing={`${suggestions.length} pending`}>Suggestions</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {suggestions.map((s) => (
              <SuggestionCard
                key={s.id}
                s={s}
                onApprove={() => approve(s.id)}
                onDismiss={() => dismiss(s.id)}
                onModeChange={(m) => setMode(s.id, m)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function FilterChip({
  children,
  count,
  active,
  onClick,
}: {
  children: React.ReactNode;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition-colors border",
        active
          ? "border-accent/40 bg-accent/10 text-foreground"
          : "border-border bg-card/40 text-muted-foreground hover:text-foreground hover:bg-muted/40",
      )}
    >
      {children}
      <span className="tabular-nums text-[10px] text-muted-foreground">{count}</span>
    </button>
  );
}
