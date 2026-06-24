import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { extname, basename, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { REST, Routes } from "discord.js";

const token = process.env.DISCORD_BOT_TOKEN;
const appId = process.env.DISCORD_APP_ID;
if (!token || !appId) {
  console.error("DISCORD_BOT_TOKEN and DISCORD_APP_ID must be set");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const emojiDir = resolve(here, "..", "emojis");

const mimeFor: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const sanitize = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);

const files = readdirSync(emojiDir).filter((f) => mimeFor[extname(f).toLowerCase()]);
if (files.length === 0) {
  console.error(`No image files found in ${emojiDir}`);
  console.error("Drop spotify.png / youtube_music.png / lastfm.png / shirabe.png in there and re-run.");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

// Fetch existing app emojis so we can update instead of fail-on-duplicate.
const existing = (await rest.get(
  Routes.applicationEmojis(appId),
)) as { items: Array<{ id: string; name: string }> };
const byName = new Map(existing.items.map((e) => [e.name, e.id]));

console.log(`\nUploading ${files.length} emoji(s) to app ${appId}...\n`);
const envLines: string[] = [];

for (const file of files) {
  const ext = extname(file).toLowerCase();
  const mime = mimeFor[ext];
  if (!mime) continue;
  const name = sanitize(basename(file, ext));
  const buf = readFileSync(resolve(emojiDir, file));
  const dataUri = `data:${mime};base64,${buf.toString("base64")}`;

  let result: { id: string; name: string };
  const existingId = byName.get(name);
  if (existingId) {
    // Discord doesn't let you change the image of an emoji, so we delete + re-create.
    await rest.delete(Routes.applicationEmoji(appId, existingId));
    result = (await rest.post(Routes.applicationEmojis(appId), {
      body: { name, image: dataUri },
    })) as { id: string; name: string };
    console.log(`  ↻ replaced ${name}  → ${result.id}`);
  } else {
    result = (await rest.post(Routes.applicationEmojis(appId), {
      body: { name, image: dataUri },
    })) as { id: string; name: string };
    console.log(`  + uploaded ${name}  → ${result.id}`);
  }

  envLines.push(`EMOJI_${name.toUpperCase()}=${result.id}:${result.name}`);
}

console.log("\nAdd these to your root .env:\n");
for (const line of envLines) console.log("  " + line);
console.log("\nThen `docker compose up -d --force-recreate discord-bot` to pick them up.\n");
