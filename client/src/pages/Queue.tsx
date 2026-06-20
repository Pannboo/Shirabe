import { useState } from "react";
import QueueRowItem from "@/components/QueueRow";
import SectionTitle from "@/components/SectionTitle";
import { useApi } from "@/hooks/useApi";
import { api } from "@/lib/api";

interface QueueResponse {
  downloads: Array<{
    id: number;
    suggestion_id: number | null;
    slskd_search_id: string | null;
    mode: "album" | "track";
    status: "queued" | "searching" | "downloading" | "complete" | "failed";
    download_path: string | null;
    created_at: number;
    artist: string | null;
    title: string | null;
  }>;
  slskd: Array<{
    username: string;
    filename: string;
    state: string;
    progress: number | null;
  }>;
}

export default function Queue() {
  const { data, loading, reload } = useApi<QueueResponse>(`/api/queue`, [], { pollMs: 5_000 });
  const [clearing, setClearing] = useState(false);

  const totalCount = data?.downloads.length ?? 0;

  async function clearAll(): Promise<void> {
    if (totalCount === 0) return;
    if (!confirm(`Delete all ${totalCount} download row${totalCount === 1 ? "" : "s"}? This wipes both active and finished history.`)) return;
    setClearing(true);
    try {
      await api<{ cleared: number }>("/api/queue/clear-all", { method: "POST" });
      reload();
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <h2 className="font-serif text-4xl md:text-5xl tracking-tight">Download queue</h2>
        <button
          type="button"
          onClick={clearAll}
          disabled={clearing || totalCount === 0}
          className="text-xs px-3 py-1.5 rounded-md border border-border bg-card hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {clearing ? "Clearing…" : `Clear all${totalCount > 0 ? ` (${totalCount})` : ""}`}
        </button>
      </div>

      <section>
        <SectionTitle trailing={`${data?.downloads.length ?? 0} tracked`}>
          Shirabe downloads
        </SectionTitle>
        <div>
          {loading && <p className="text-sm text-muted-foreground py-3">Loading…</p>}
          {!loading && (data?.downloads.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground py-3">Nothing in the queue.</p>
          )}
          {data?.downloads.map((d) => (
            <QueueRowItem key={d.id} row={d} />
          ))}
        </div>
      </section>

      <section>
        <SectionTitle trailing={`${data?.slskd.length ?? 0} active`}>Live slskd transfers</SectionTitle>
        <div>
          {(data?.slskd.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground py-3">slskd reports no active transfers.</p>
          )}
          {data?.slskd.map((t, i) => (
            <div key={i} className="py-3 border-b border-border/70 last:border-0">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm truncate font-medium">{t.filename}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">from {t.username} · {t.state}</div>
                </div>
                {t.progress !== null && (
                  <div className="text-xs tabular-nums w-12 text-right">{Math.round(t.progress * 100)}%</div>
                )}
              </div>
              {t.progress !== null && (
                <div className="mt-2 h-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-500"
                    style={{ width: `${t.progress * 100}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
