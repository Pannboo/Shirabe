import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { cn } from "@/lib/utils";

interface ReviewRow {
  id: number;
  download_id: number | null;
  file_path: string;
  beets_attempt: string | null;
  confidence: number | null;
  status: "pending" | "done";
}

function confidenceColor(c: number): string {
  if (c >= 0.8) return "bg-green-500";
  if (c >= 0.5) return "bg-yellow-500";
  return "bg-destructive";
}

export default function ReviewRowItem({
  row,
  onMarkDone,
}: {
  row: ReviewRow;
  onMarkDone: () => void;
}) {
  const conf = row.confidence ?? 0;
  return (
    <div className="py-4 border-b border-border/70 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-mono truncate">{row.file_path}</div>
          {row.confidence !== null ? (
            <div className="mt-2 flex items-center gap-2 max-w-sm">
              <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full", confidenceColor(conf))}
                  style={{ width: `${conf * 100}%` }}
                />
              </div>
              <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">
                {Math.round(conf * 100)}%
              </span>
            </div>
          ) : (
            <div className="mt-1 text-xs text-muted-foreground">No confidence score</div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge variant="warning">needs Picard</Badge>
          <Button size="sm" variant="outline" onClick={onMarkDone}>
            Mark done
          </Button>
        </div>
      </div>
      {row.beets_attempt && (
        <pre className="mt-3 max-h-32 overflow-auto text-[11px] text-muted-foreground bg-muted/60 p-3 rounded-md">
          {row.beets_attempt}
        </pre>
      )}
    </div>
  );
}
