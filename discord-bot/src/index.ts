import "dotenv/config";
import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
} from "discord.js";
import { getNowPlaying } from "./shirabeClient.js";

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("DISCORD_BOT_TOKEN must be set");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "nowplaying") return;

  const ephemeral = interaction.options.getBoolean("private") ?? false;
  await interaction.deferReply(
    ephemeral ? { flags: MessageFlags.Ephemeral } : {},
  );

  try {
    const np = await getNowPlaying();
    if (!np) {
      await interaction.editReply("No scrobbles yet.");
      return;
    }

    const title = np.is_live ? "Now playing" : "Last played";
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(`**${np.track}**\n${np.artist} — *${np.album}*`)
      .setTimestamp(np.timestamp * 1000);

    // Cover URLs from Shirabe are relative; resolve against the public
    // base so Discord's image proxy can actually fetch them. Internal
    // docker URLs won't render — set SHIRABE_PUBLIC_URL to a URL Discord
    // can reach.
    const publicBase = process.env.SHIRABE_PUBLIC_URL;
    if (np.cover_art_url && publicBase) {
      embed.setThumbnail(new URL(np.cover_art_url, publicBase).toString());
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("nowplaying failed", err);
    await interaction.editReply("Couldn't reach Shirabe right now.");
  }
});

await client.login(token);
