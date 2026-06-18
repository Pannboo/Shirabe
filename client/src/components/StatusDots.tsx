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

  return (
    <div className="flex items-center gap-2 ml-2" title="Integration status">
      <Dot label="Navidrome" ok={health.navidrome} />
      <Dot label="slskd" ok={health.slskd} />
      <Dot label="Last.fm" ok={health.lastfm_configured} />
      <Dot label="ListenBrainz" ok={health.listenbrainz_configured} />
    </div>
  );
}

function Dot({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      title={`${label}: ${ok ? "ok" : "down/unconfigured"}`}
      className={cn(
        "h-2 w-2 rounded-full inline-block",
        ok ? "bg-green-500" : "bg-red-500/70",
      )}
    />
  );
}
