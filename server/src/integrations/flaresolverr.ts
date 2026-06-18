import { getAllSettings } from "../db/queries/settings.js";

// FlareSolverr (https://github.com/FlareSolverr/FlareSolverr) is a proxy
// service that runs a real headless browser to defeat Cloudflare challenge
// pages. Set flaresolverr_url in Settings to enable; sources/rym.ts and
// sources/aoty.ts will route their fetches through it instead of doing a
// raw fetch.
//
// Endpoint contract: POST flaresolverr_url with
//   { cmd: "request.get", url, maxTimeout: 60000 }
// → { status: "ok", solution: { response: "<html>...", status: 200, ... } }
//
// We treat any non-ok response or missing solution as a hard failure —
// callers fall back to direct fetch when this returns null.

interface FlareSolverrSolution {
  url?: string;
  response?: string;
  status?: number;
  userAgent?: string;
}

interface FlareSolverrResponse {
  status?: string;        // "ok" | "error"
  message?: string;
  solution?: FlareSolverrSolution;
}

export function flaresolverrConfigured(): boolean {
  const { flaresolverr_url } = getAllSettings();
  return typeof flaresolverr_url === "string" && flaresolverr_url.trim().length > 0;
}

// Wraps the FlareSolverr call. 70s timeout because the browser-resolver
// itself can take 30-60s on a cold Cloudflare challenge.
export async function fetchViaFlareSolverr(url: string, label = "flaresolverr"): Promise<string | null> {
  const { flaresolverr_url } = getAllSettings();
  const endpoint = flaresolverr_url?.trim();
  if (!endpoint) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 70_000);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: "request.get", url, maxTimeout: 60_000 }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`[${label}] flaresolverr returned HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as FlareSolverrResponse;
    if (data.status !== "ok" || !data.solution?.response) {
      console.warn(`[${label}] flaresolverr error: ${data.message ?? "no solution"}`);
      return null;
    }
    return data.solution.response;
  } catch (err) {
    console.warn(`[${label}] flaresolverr fetch failed`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
