import { Router } from "express";
import { z } from "zod";
import {
  createUser,
  getUserByNavidromeId,
  hasAdmin,
} from "../db/queries/users.js";
import { authenticateNavidrome } from "../integrations/navidrome.js";
import {
  exchangeLastFmToken,
  getLastFmRequestToken,
} from "../integrations/lastfm.js";
import { getAllSettings, setSetting } from "../db/queries/settings.js";
import { signJwt } from "../auth/jwt.js";
import { requireAdmin, requireAuth } from "../auth/middleware.js";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const navidromeUser = await authenticateNavidrome(parsed.data.username, parsed.data.password);
  if (!navidromeUser) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }

  let user = getUserByNavidromeId(navidromeUser.navidrome_user_id);
  if (!user) {
    const role = navidromeUser.is_admin && !hasAdmin() ? "admin" : "listener";
    user = createUser(navidromeUser.navidrome_user_id, navidromeUser.username, role);
  }

  const token = signJwt({
    user_id: user.id,
    navidrome_user_id: user.navidrome_user_id,
    navidrome_username: user.username,
    role: user.role,
  });

  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role },
  });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// === Last.fm Connect-Account ===
// Step 1: admin clicks "Connect Last.fm" → backend asks for a request token,
// stores it as "pending", returns the auth URL.
authRouter.get("/lastfm/connect", requireAuth, requireAdmin, async (_req, res) => {
  const { lastfm_api_key } = getAllSettings();
  if (!lastfm_api_key) {
    res.status(400).json({ error: "lastfm_api_key_not_set" });
    return;
  }
  const token = await getLastFmRequestToken();
  if (!token) {
    res.status(502).json({ error: "lastfm_token_failed" });
    return;
  }
  setSetting("lastfm_pending_token", token);
  setSetting("lastfm_session_key", "");
  // No cb= param: Last.fm shows "close your browser" and the user authorizes.
  // We poll auth.getSession on the backend below to detect the authorization.
  const authUrl = `https://www.last.fm/api/auth/?api_key=${lastfm_api_key}&token=${token}`;
  res.json({ url: authUrl, token });
});

// Step 2 (poll): frontend hits this every couple of seconds while the popup is open.
// We try to exchange the pending token; it succeeds as soon as the user has authorized.
authRouter.post("/lastfm/try-exchange", requireAuth, requireAdmin, async (_req, res) => {
  const { lastfm_pending_token, lastfm_session_key } = getAllSettings();
  if (lastfm_session_key) {
    res.json({ status: "already_connected" });
    return;
  }
  if (!lastfm_pending_token) {
    res.json({ status: "no_pending" });
    return;
  }
  const result = await exchangeLastFmToken(lastfm_pending_token);
  if (result.session) {
    setSetting("lastfm_pending_token", "");
    res.json({ status: "ok", user_name: result.session.name });
    return;
  }
  // Error 14 = "unauthorized token" = user hasn't clicked Allow yet → keep polling.
  // Anything else (signature mismatch, missing secret, etc.) → surface it.
  if (result.error_code === 14) {
    res.json({ status: "pending" });
    return;
  }
  res.json({
    status: "error",
    error: result.error,
    error_code: result.error_code,
    http_status: result.http_status,
  });
});

// Optional callback (works if user registered a Callback URL with their Last.fm app).
// Kept for parity — exchanges immediately and renders a small "done" page.
authRouter.get("/lastfm/callback", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : null;
  if (!token) {
    res.status(400).send("Missing token");
    return;
  }
  const result = await exchangeLastFmToken(token);
  if (!result.session) {
    res.status(502).send(`Last.fm exchange failed: ${result.error ?? "unknown"} (code ${result.error_code ?? "?"})`);
    return;
  }
  setSetting("lastfm_pending_token", "");
  res.send(`<html><body style="font-family:sans-serif;background:#0f0f10;color:#eee;padding:2rem">
    <h2>Last.fm connected as ${result.session.name}</h2>
    <p>You can close this tab and return to Shirabe.</p>
    <script>setTimeout(()=>window.close(),1500);</script>
  </body></html>`);
});

authRouter.post("/lastfm/disconnect", requireAuth, requireAdmin, (_req, res) => {
  setSetting("lastfm_session_key", "");
  setSetting("lastfm_session_username", "");
  setSetting("lastfm_pending_token", "");
  res.json({ ok: true });
});
