import ReviewRowItem from "@/components/ReviewRow";
import SectionTitle from "@/components/SectionTitle";
import { useApi } from "@/hooks/useApi";
import { api } from "@/lib/api";

interface ReviewResponse {
  items: Array<{
    id: number;
    download_id: number | null;
    file_path: string;
    beets_attempt: string | null;
    confidence: number | null;
    status: "pending" | "done";
  }>;
}

export default function Review() {
  const { data, loading, reload } = useApi<ReviewResponse>(`/api/review`);

  async function markDone(id: number) {
    await api(`/api/review/${id}/done`, { method: "PATCH" });
    reload();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-4xl md:text-5xl tracking-tight">Review queue</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Releases that didn't import cleanly with beets. Process each manually with
          MusicBrainz Picard, then mark done.
        </p>
      </div>
      <section>
        <SectionTitle trailing={`${data?.items.length ?? 0} pending`}>Flagged releases</SectionTitle>
        <div>
          {loading && <p className="text-sm text-muted-foreground py-3">Loading…</p>}
          {!loading && (data?.items.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground py-3">Nothing to review.</p>
          )}
          {data?.items.map((r) => (
            <ReviewRowItem key={r.id} row={r} onMarkDone={() => markDone(r.id)} />
          ))}
        </div>
      </section>
    </div>
  );
}
