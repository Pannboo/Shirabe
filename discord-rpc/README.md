# @shirabe/discord-rpc

Tiny desktop daemon that mirrors your current Shirabe scrobble to Discord
Rich Presence. Shows up under your Discord profile as
**"Listening to Shirabe — \<track\> by \<artist\>"**.

> ⚠️ This runs on **your desktop machine**, not on the homelab. It talks
> to Discord via the local IPC socket exposed by the Discord client, so
> Discord itself must be running on the same box.

## Setup

1. Create a Discord Application at <https://discord.com/developers/applications>
   and copy the **Application ID**.
2. From this directory:

   ```bash
   cp .env.example .env  # or create .env by hand
   ```

   Set:

   ```
   DISCORD_APP_ID=<your application id>
   SHIRABE_PUBLIC_URL=https://shirabe.yourdomain.com
   POLL_SECONDS=10
   ```

3. Install + run:

   ```bash
   npm install
   npm run dev      # local with auto-reload
   # or
   npm run build && npm start
   ```

## Run on login (Linux, systemd user unit)

```ini
# ~/.config/systemd/user/shirabe-rpc.service
[Unit]
Description=Shirabe Discord Rich Presence
After=graphical-session.target

[Service]
WorkingDirectory=%h/Development/Shirabe/discord-rpc
ExecStart=/usr/bin/npm start
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now shirabe-rpc
```

## Notes

- Third-party RPC shows as **"Listening to Shirabe"** — only Spotify's
  official integration gets the green "Listening to Spotify" badge.
- Cover art URLs are passed straight through to Discord; their media
  proxy will fetch them. If your Shirabe instance isn't publicly
  reachable, the art slot will be empty (the text still works).
