import { getUnrelayedScrobbles } from "../db/queries/scrobbles.js";
import { dispatchRelays } from "../services/scrobble.js";

export async function retryRelays(): Promise<void> {
  const pending = getUnrelayedScrobbles();
  if (pending.length === 0) return;
  console.log(`[retryRelays] replaying ${pending.length} unrelayed scrobble(s)`);
  for (const s of pending) {
    await dispatchRelays(s);
  }
}
