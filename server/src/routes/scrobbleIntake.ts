// ListenBrainz-compatible scrobble intake.
// Auth token IS the user's navidrome_user_id (v1 simplification, documented in README).

import { Router } from "express";
import { z } from "zod";
import { getUserByNavidromeId } from "../db/queries/users.js";
import { ingestScrobble } from "../services/scrobble.js";
import { setNowPlaying } from "../services/nowPlaying.js";

export const scrobbleIntakeRouter = Router();

function parseToken(req: import("express").Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  if (header.startsWith("Token ")) return header.slice("Token ".length).trim();
  if (header.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
  return null;
}

const trackMetaSchema = z.object({
  artist_name: z.string(),
  track_name: z.string(),
  release_name: z.string().optional(),
});

const payloadItemSchema = z.object({
  listened_at: z.number().int().positive().optional(),
  track_metadata: trackMetaSchema,
});

const submitSchema = z.object({
  listen_type: z.enum(["single", "import", "playing_now"]),
  payload: z.array(payloadItemSchema).min(1),
});

scrobbleIntakeRouter.post("/submit-listens", async (req, res) => {
  const token = parseToken(req);
  if (!token) {
    console.warn("[lb-intake] reject: missing_token");
    res.status(401).json({ status: "error", error: "missing_token" });
    return;
  }
  const user = getUserByNavidromeId(token);
  if (!user) {
    console.warn(`[lb-intake] reject: invalid_token (token=${token.slice(0, 12)}…)`);
    res.status(401).json({ status: "error", error: "invalid_token" });
    return;
  }

  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    console.warn("[lb-intake] reject: invalid_payload", JSON.stringify(parsed.error.issues));
    console.warn("[lb-intake] body was:", JSON.stringify(req.body).slice(0, 800));
    res.status(400).json({ status: "error", error: "invalid_payload" });
    return;
  }

  if (parsed.data.listen_type === "playing_now") {
    const head = parsed.data.payload[0];
    if (head) {
      setNowPlaying(user.id, {
        artist: head.track_metadata.artist_name,
        track: head.track_metadata.track_name,
        album: head.track_metadata.release_name ?? null,
      });
    }
    res.json({ status: "ok" });
    return;
  }

  const sourceClient = (req.headers["user-agent"] as string | undefined) ?? null;
  for (const item of parsed.data.payload) {
    await ingestScrobble({
      user_id: user.id,
      track: item.track_metadata.track_name,
      artist: item.track_metadata.artist_name,
      album: item.track_metadata.release_name ?? null,
      timestamp: item.listened_at ?? Math.floor(Date.now() / 1000),
      source_client: sourceClient,
    });
  }

  res.json({ status: "ok" });
});

scrobbleIntakeRouter.get("/validate-token", (req, res) => {
  const token = parseToken(req);
  if (!token) {
    res.json({ code: 200, message: "Token invalid.", valid: false });
    return;
  }
  const user = getUserByNavidromeId(token);
  if (!user) {
    res.json({ code: 200, message: "Token invalid.", valid: false });
    return;
  }
  res.json({ code: 200, message: "Token valid.", valid: true, user_name: user.username });
});
