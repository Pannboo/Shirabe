import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

interface UseApiOptions {
  // Refetch on a fixed interval. Useful for "live" UI (recent scrobbles,
  // now-playing). Polling pauses while the tab is hidden so we don't burn
  // battery in a background tab.
  pollMs?: number;
}

export function useApi<T>(
  path: string,
  deps: unknown[] = [],
  options: UseApiOptions = {},
): {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  refetchedAt: number;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [refetchedAt, setRefetchedAt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const initial = data === null;
    if (initial) setLoading(true);
    api<T>(path)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
          setRefetchedAt(Date.now());
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          if (err instanceof ApiError) setError(err.message);
          else setError("network_error");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);

  useEffect(() => {
    if (!options.pollMs || options.pollMs <= 0) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id !== null) return;
      id = setInterval(() => setTick((t) => t + 1), options.pollMs);
    };
    const stop = () => {
      if (id !== null) {
        clearInterval(id);
        id = null;
      }
    };
    const onVis = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [options.pollMs]);

  return {
    data,
    loading,
    error,
    reload: () => setTick((t) => t + 1),
    refetchedAt,
  };
}
