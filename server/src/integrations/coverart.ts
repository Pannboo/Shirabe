// Cover Art Archive — returns null if no art available; never returns broken URL.

const CAA_BASE = "https://coverartarchive.org";

const cache = new Map<string, string | null>();

export async function getCoverArtUrl(releaseId: string | null): Promise<string | null> {
  if (!releaseId) return null;
  if (cache.has(releaseId)) return cache.get(releaseId) ?? null;
  try {
    const res = await fetch(`${CAA_BASE}/release/${releaseId}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      cache.set(releaseId, null);
      return null;
    }
    const data = (await res.json()) as { images?: Array<{ front?: boolean; thumbnails?: { large?: string; small?: string }; image?: string }> };
    const front = data.images?.find((i) => i.front) ?? data.images?.[0];
    const url = front?.thumbnails?.large ?? front?.image ?? null;
    cache.set(releaseId, url);
    return url;
  } catch {
    cache.set(releaseId, null);
    return null;
  }
}
