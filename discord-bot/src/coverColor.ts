import Vibrant from "node-vibrant";

const FALLBACK = 0x8a6e5c; // warm muted Shirabe tone

export async function getDominantColor(imageUrl: string): Promise<number> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return FALLBACK;
    const buf = Buffer.from(await res.arrayBuffer());
    const palette = await Vibrant.from(buf).getPalette();
    const pick =
      palette.Vibrant ??
      palette.LightVibrant ??
      palette.Muted ??
      palette.DarkVibrant ??
      palette.LightMuted ??
      palette.DarkMuted;
    if (!pick) return FALLBACK;
    const [r, g, b] = pick.rgb;
    return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
  } catch {
    return FALLBACK;
  }
}
