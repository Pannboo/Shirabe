import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Health {
  navidrome: boolean;
  slskd: boolean;
  lastfm_configured: boolean;
  listenbrainz_configured: boolean;
}

const POLL_MS = 30_000;

// Each row knows whether it's a reachability ping (Navidrome / slskd) or a
// configuration check (Last.fm / ListenBrainz), so the popover can label
// failures meaningfully — "unreachable" vs "not configured" point at very
// different fixes.
const ROWS: Array<{
  key: keyof Health;
  label: string;
  kind: "ping" | "config";
}> = [
  { key: "navidrome", label: "Navidrome", kind: "ping" },
  { key: "slskd", label: "slskd", kind: "ping" },
  { key: "lastfm_configured", label: "Last.fm", kind: "config" },
  { key: "listenbrainz_configured", label: "ListenBrainz", kind: "config" },
];

function statusText(ok: boolean, kind: "ping" | "config"): string {
  if (ok) return kind === "ping" ? "Reachable" : "Configured";
  return kind === "ping" ? "Unreachable" : "Not configured";
}

export default function StatusDots() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      api<Health>("/api/health/integrations")
        .then((h) => {
          if (!cancelled) setHealth(h);
        })
        .catch(() => {/* ignore */});
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!health) return null;

  const down = ROWS.filter((r) => !health[r.key]).length;

  return (
    <div className="relative group ml-2">
      {/* Trigger — same compact dot row, but wrapped in a button with
          padding so the hover hit area is comfortable and the popover
          stays open while you aim for it. */}
      <button
        type="button"
        className="flex items-center gap-1.5 py-1.5 px-1 rounded-md hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
        aria-label={`Integration status: ${down} of ${ROWS.length} down`}
      >
        {ROWS.map((r) => (
          <span
            key={r.key}
            className={cn(
              "h-2 w-2 rounded-full inline-block",
              health[r.key] ? "bg-green-500" : "bg-red-500/80",
            )}
          />
        ))}
      </button>

      {/* Popover — appears on hover/focus via group utilities, no JS
          state needed. Right-aligned so it doesn't fall off the nav. */}
      <div
        className={cn(
          "absolute right-0 top-full mt-2 w-56 z-40",
          "rounded-lg border border-border bg-card shadow-xl",
          "opacity-0 invisible translate-y-1",
          "group-hover:opacity-100 group-hover:visible group-hover:translate-y-0",
          "group-focus-within:opacity-100 group-focus-within:visible group-focus-within:translate-y-0",
          "transition-all duration-150",
        )}
        role="status"
      >
        <div className="px-3 py-2 border-b border-border/60">
          <div className="eyebrow">Integrations</div>
        </div>
        <ul className="py-1">
          {ROWS.map((r) => {
            const ok = health[r.key];
            return (
              <li key={r.key} className="flex items-center justify-between gap-3 px-3 py-1.5">
                <span className="flex items-center gap-2 text-sm">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full inline-block flex-shrink-0",
                      ok ? "bg-green-500" : "bg-red-500/80",
                    )}
                  />
                  {r.label}
                </span>
                <span
                  className={cn(
                    "text-[11px] tabular-nums",
                    ok ? "text-muted-foreground" : "text-destructive",
                  )}
                >
                  {statusText(ok, r.kind)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
