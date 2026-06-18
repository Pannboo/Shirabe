import { Badge } from "./ui/badge";
import { formatRelative } from "@/lib/format";

interface QueueRow {
  id: number;
  suggestion_id: number | null;
  slskd_search_id: string | null;
  mode: "album" | "track";
  status: "queued" | "searching" | "downloading" | "complete" | "failed";
  download_path: string | null;
  created_at: number;
  artist: string | null;
  title: string | null;
}

const statusVariant: Record<QueueRow["status"], "default" | "success" | "warning" | "info" | "danger"> = {
  queued: "default",
  searching: "info",
  downloading: "info",
  complete: "success",
  failed: "danger",
};

export default function QueueRowItem({ row }: { row: QueueRow }) {
  // Prefer the artist/title we captured at queue time. Fall back to a sensible
  // identifier so older rows still render (download path, slskd search id, or
  // just the row id).
  const headline = row.artist && row.title
    ? `${row.artist} — ${row.title}`
    : row.download_path ?? row.slskd_search_id ?? `Download #${row.id}`;
  const source = row.suggestion_id ? `suggestion #${row.suggestion_id}` : "manual search";
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-border/70 last:border-0">
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{headline}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          <span className="uppercase tracking-wider text-[10px]">{row.mode}</span>
          {" · "}{source}
          {" · "}{formatRelative(row.created_at)}
        </div>
      </div>
      <Badge variant={statusVariant[row.status]}>{row.status}</Badge>
    </div>
  );
}
