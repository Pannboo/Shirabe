import "dotenv/config";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ContainerBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
  time,
  TimestampStyles,
} from "discord.js";
import { getNowPlaying } from "./shirabeClient.js";
import { getDominantColor } from "./coverColor.js";

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("DISCORD_BOT_TOKEN must be set");
  process.exit(1);
}

const internalBase = process.env.SHIRABE_URL ?? "http://server:3000";
const publicBase = process.env.SHIRABE_PUBLIC_URL; // optional, for Discord-visible URLs

// Optional app emoji on each button. Env value format: `<id>:<name>`,
// produced by `npm run upload-emojis`. Missing values fall back to label-only.
function parseEmoji(value: string | undefined): { id: string; name: string } | null {
  if (!value) return null;
  const [id, name] = value.split(":");
  if (!id || !name) return null;
  return { id, name };
}
const emoji = {
  spotify: parseEmoji(process.env.EMOJI_SPOTIFY),
  youtubeMusic: parseEmoji(process.env.EMOJI_YTM),
  lastfm: parseEmoji(process.env.EMOJI_LASTFM),
  shirabe: parseEmoji(process.env.EMOJI_SHIRABE),
};

function linkButton(
  label: string,
  url: string,
  icon: { id: string; name: string } | null,
): ButtonBuilder {
  const b = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url);
  if (icon) b.setEmoji(icon);
  return b;
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

    // Color sampling uses the internal URL so it works on LAN-only setups.
    const internalCover = np.cover_art_url
      ? new URL(np.cover_art_url, internalBase).toString()
      : null;
    const accent = internalCover
      ? await getDominantColor(internalCover)
      : 0x8a6e5c;

    // Discord-visible URLs need to be publicly resolvable; without a public
    // base, we skip the thumbnail and the in-Shirabe link.
    const publicCover =
      publicBase && np.cover_art_url
        ? new URL(np.cover_art_url, publicBase).toString()
        : null;
    const shirabeTrackUrl = publicBase
      ? `${publicBase.replace(/\/$/, "")}/track/${encodeURIComponent(np.artist)}/${encodeURIComponent(np.track)}`
      : null;
    const lastfmUrl = `https://www.last.fm/music/${encodeURIComponent(np.artist)}/_/${encodeURIComponent(np.track)}`;
    const searchQuery = encodeURIComponent(`${np.artist} ${np.track}`);
    const spotifyUrl = `https://open.spotify.com/search/${searchQuery}`;
    const ytMusicUrl = `https://music.youtube.com/search?q=${searchQuery}`;

    const liveLine = np.is_live
      ? `▶ Live · started ${time(np.timestamp, TimestampStyles.RelativeTime)}`
      : `⏸ Last played ${time(np.timestamp, TimestampStyles.RelativeTime)}`;

    const section = new SectionBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${np.track}\nby **${np.artist}**\non *${np.album}*`,
      ),
    );

    if (publicCover) {
      section.setThumbnailAccessory(
        new ThumbnailBuilder()
          .setURL(publicCover)
          .setDescription(`${np.album} cover art`),
      );
    }

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      linkButton("Spotify", spotifyUrl, emoji.spotify),
      linkButton("YouTube Music", ytMusicUrl, emoji.youtubeMusic),
      linkButton("Last.fm", lastfmUrl, emoji.lastfm),
    );
    if (shirabeTrackUrl) {
      buttons.addComponents(
        linkButton("Open in Shirabe", shirabeTrackUrl, emoji.shirabe),
      );
    }

    const container = new ContainerBuilder()
      .setAccentColor(accent)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `-# ♪ Shirabe · ${np.is_live ? "Now Playing" : "Recently Played"}`,
        ),
      )
      .addSectionComponents(section)
      .addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# ${liveLine}`),
      )
      .addActionRowComponents(buttons);

    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: [container],
    });
  } catch (err) {
    console.error("nowplaying failed", err);
    await interaction.editReply("Couldn't reach Shirabe right now.");
  }
});

await client.login(token);
