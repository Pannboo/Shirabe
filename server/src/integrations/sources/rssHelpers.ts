// Shared RSS plumbing used by the review-feed sources (Stereogum, NPR, etc).
// The parser is regex-only because all the feeds we target are vanilla
// RSS 2.0 with <item>/<title>/<dc:creator>; a full XML parser would just
// add weight. Each source supplies its own title→(artist, album) parser
// since editorial sites don't all format the same way.

export interface RssItem {
  title: string;
  link: string | null;
  description: string | null;
  creator: string | null;
}

function extract(item: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = item.match(re);
  if (!m || !m[1]) return null;
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const body = m[1];
    if (!body) continue;
    const title = extract(body, "title");
    if (!title) continue;
    items.push({
      title,
      link: extract(body, "link"),
      description: extract(body, "description"),
      creator: extract(body, "dc:creator"),
    });
  }
  return items;
}

// Trims an HTML/RSS document into a short preview suitable for log lines.
// Skips down past <head> to give a more useful snippet of the actual
// content, and collapses whitespace so the log entry doesn't sprawl.
export function htmlPreview(doc: string, len = 500): string {
  const bodyIdx = doc.toLowerCase().indexOf("<body");
  const trimmed = bodyIdx > 0 ? doc.slice(bodyIdx) : doc;
  return trimmed
    .slice(0, len * 4)            // pull enough raw chars to survive whitespace collapse
    .replace(/\s+/g, " ")
    .slice(0, len);
}

// Fetches an RSS URL with a 10-second timeout. Returns null on any error
// (network, non-2xx, abort) so callers can fall through to alternates.
export async function fetchRss(url: string, label = "rss"): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Shirabe/0.1 (https://github.com/pannboo/shirabe)" },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`[${label}] ${url} returned HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.warn(`[${label}] ${url} fetch failed`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
