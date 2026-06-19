import { listResolvedArtistImagesWithoutLocal } from "../db/queries/artistImages.js";
import { listResolvedCoverartWithoutLocal } from "../db/queries/coverart.js";
import { ensureLocalAlbum, ensureLocalArtist } from "../services/imageCache.js";

// Eagerly downloads resolved cover-art + artist-image bytes that don't yet
// have a local file. Runs in small batches at a slow cadence so we stay
// polite to upstream CDNs (CAA, Deezer, Last.fm); lazy fetches in
// routes/image.ts handle the on-demand case if a request beats the warm
// pass.
const BATCH_PER_TICK = 5;

export async function warmImageCacheBatch(): Promise<void> {
  const albums = listResolvedCoverartWithoutLocal(BATCH_PER_TICK);
  const artists = listResolvedArtistImagesWithoutLocal(BATCH_PER_TICK);
  if (albums.length === 0 && artists.length === 0) return;

  let albumOk = 0;
  for (const row of albums) {
    const got = await ensureLocalAlbum(row);
    if (got) albumOk += 1;
  }
  let artistOk = 0;
  for (const row of artists) {
    const got = await ensureLocalArtist(row);
    if (got) artistOk += 1;
  }
  console.log(
    `[warm-image] album ${albumOk}/${albums.length}, artist ${artistOk}/${artists.length}`,
  );
}
