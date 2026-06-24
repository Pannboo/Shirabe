export type NowPlaying = {
  is_live: boolean;
  track: string;
  artist: string;
  album: string;
  timestamp: number;
  cover_art_url: string;
};

const baseUrl = process.env.SHIRABE_URL ?? "http://server:3000";

export async function getNowPlaying(): Promise<NowPlaying | null> {
  const res = await fetch(`${baseUrl}/api/v1/public/now-playing`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`shirabe ${res.status}`);
  return (await res.json()) as NowPlaying | null;
}
