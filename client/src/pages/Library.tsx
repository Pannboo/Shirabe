import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Grid, List as ListIcon, Search } from "lucide-react";
import SectionTitle from "@/components/SectionTitle";
import { Input } from "@/components/ui/input";
import { useApi } from "@/hooks/useApi";
import { cn } from "@/lib/utils";
import { formatNumber, formatRelative } from "@/lib/format";
import type { LibraryResponse } from "@/lib/dto";

type Filter = "all" | "never_played" | "played_recently" | "played_this_year" | "lost_gems";
type Sort = "last_played" | "most_played" | "alphabetical" | "artist" | "recently_added";
type View = "grid" | "list";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "played_this_year", label: "Played this year" },
  { key: "played_recently", label: "Played recently" },
  { key: "never_played", label: "Never played" },
  { key: "lost_gems", label: "Lost gems (6m+)" },
];

const SORTS: { key: Sort; label: string }[] = [
  { key: "last_played", label: "Last played" },
  { key: "most_played", label: "Most played" },
  { key: "alphabetical", label: "Album A→Z" },
  { key: "artist", label: "Artist A→Z" },
  { key: "recently_added", label: "Recently added" },
];

// Debounce the search input so we don't spam the server while typing.
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export default function Library() {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("last_played");
  const [view, setView] = useState<View>("grid");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 250);
  const [page, setPage] = useState(0);

  // Reset to first page whenever the query knobs change.
  useEffect(() => { setPage(0); }, [filter, sort, debouncedSearch]);

  const qs = useMemo(() => {
    const params = new URLSearchParams();
    if (sort !== "last_played") params.set("sort", sort);
    if (filter !== "all") params.set("filter", filter);
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    if (page > 0) params.set("page", String(page));
    return params.toString();
  }, [sort, filter, debouncedSearch, page]);

  const path = `/api/me/library${qs ? `?${qs}` : ""}`;
  const { data, loading } = useApi<LibraryResponse>(path, [qs]);

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-serif text-4xl md:text-5xl tracking-tight">Library</h2>
          {data && (
            <p className="text-sm text-muted-foreground mt-1">
              <span className="tabular-nums text-foreground">{formatNumber(data.total)}</span> albums ·{" "}
              <span className="tabular-nums">{formatNumber(data.played)}</span> played ·{" "}
              <span className="tabular-nums">{formatNumber(data.unplayed)}</span> untouched
            </p>
          )}
        </div>
        <div className="inline-flex items-center rounded-full border border-border bg-card/40 p-0.5">
          <button
            type="button"
            onClick={() => setView("grid")}
            className={cn("p-1.5 rounded-full transition-colors", view === "grid" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
            aria-label="Grid view"
            title="Grid"
          >
            <Grid className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            className={cn("p-1.5 rounded-full transition-colors", view === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
            aria-label="List view"
            title="List"
          >
            <ListIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filter === f.key
                ? "border-accent/40 bg-accent/10 text-foreground"
                : "border-border bg-card/40 text-muted-foreground hover:text-foreground hover:bg-muted/40",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search artist or album…"
            className="pl-9"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="h-9 rounded-md border border-border bg-input px-3 text-sm"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>Sort: {s.label}</option>
          ))}
        </select>
      </div>

      {loading && !data && <p className="text-sm text-muted-foreground">Loading…</p>}
      {data && data.rows.length === 0 && (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No albums match this view.
        </p>
      )}

      {data && data.rows.length > 0 && view === "grid" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
          {data.rows.map((r) => (
            <Link
              key={`${r.artist}/${r.album}`}
              to={`/me/album/${encodeURIComponent(r.artist)}/${encodeURIComponent(r.album)}`}
              className="group block"
            >
              <div className="aspect-square rounded-lg bg-muted overflow-hidden flex items-center justify-center mb-2">
                {r.cover_art_url ? (
                  <img
                    src={r.cover_art_url}
                    alt={r.album}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                ) : (
                  <span className="text-2xl text-muted-foreground">♪</span>
                )}
              </div>
              <div className="text-sm font-medium truncate group-hover:text-foreground">{r.album}</div>
              <div className="text-xs text-muted-foreground truncate">{r.artist}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                {r.play_count > 0
                  ? <>{formatNumber(r.play_count)} plays · {formatRelative(r.last_played_at ?? 0)}</>
                  : <span className="text-muted-foreground/70">never played</span>}
              </div>
            </Link>
          ))}
        </div>
      )}

      {data && data.rows.length > 0 && view === "list" && (
        <ol className="divide-y divide-border/70">
          {data.rows.map((r) => (
            <li key={`${r.artist}/${r.album}`}>
              <Link
                to={`/me/album/${encodeURIComponent(r.artist)}/${encodeURIComponent(r.album)}`}
                className="flex items-center gap-3 py-2.5 px-2 -mx-2 hover:bg-muted/30 rounded-md transition-colors"
              >
                <div className="h-12 w-12 rounded-md bg-muted overflow-hidden flex items-center justify-center flex-shrink-0">
                  {r.cover_art_url ? (
                    <img src={r.cover_art_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xs text-muted-foreground">♪</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium">{r.album}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.artist}
                    {r.release_year ? ` · ${r.release_year}` : ""}
                  </div>
                </div>
                <div className="text-xs tabular-nums text-muted-foreground whitespace-nowrap text-right">
                  {r.play_count > 0 ? (
                    <>
                      <div className="text-foreground">{formatNumber(r.play_count)} plays</div>
                      <div>{formatRelative(r.last_played_at ?? 0)}</div>
                    </>
                  ) : (
                    <div className="text-muted-foreground/70">never played</div>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}

      {data && data.rows.length >= 60 && (
        <div className="flex items-center justify-between pt-4">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            ← Prev
          </button>
          <span className="text-xs text-muted-foreground">page {page + 1}</span>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
