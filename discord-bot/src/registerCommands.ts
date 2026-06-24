import "dotenv/config";
import { REST, Routes } from "discord.js";

const token = process.env.DISCORD_BOT_TOKEN;
const appId = process.env.DISCORD_APP_ID;
if (!token || !appId) {
  console.error("DISCORD_BOT_TOKEN and DISCORD_APP_ID must be set");
  process.exit(1);
}

// integration_types: 0 = guild install, 1 = user install
// contexts:          0 = guild,         1 = bot DM,      2 = private channel / group DM
const commands = [
  {
    name: "nowplaying",
    description: "Show what's currently scrobbling on Shirabe",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      {
        type: 5, // BOOLEAN
        name: "private",
        description: "Only show the reply to you",
        required: false,
      },
    ],
  },
];

const rest = new REST({ version: "10" }).setToken(token);
await rest.put(Routes.applicationCommands(appId), { body: commands });
console.log(`Registered ${commands.length} command(s) globally.`);
