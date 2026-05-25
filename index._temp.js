require("dotenv").config();
const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ─── Paths ────────────────────────────────────────────────────────────────
const JMS_ICON       = path.join(__dirname, "jms-icon.png");
const MARKET_ICON    = path.join(__dirname, "market-icon.png");
const STATE_FILE     = path.join(__dirname, "state.json");
const AUTO_MM_BOT_ID = "1504422804647313488";

// ─── State ────────────────────────────────────────────────────────────────
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { mode: "market" }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s)); }
let currentMode = loadState().mode;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── MARKET channel/category IDs (existing) ───────────────────────────────
const MARKET_CHANNELS = {
  introduction: "1503875033649381536",
  myShop:       "1503095633920393286",
  buying:       "1503099672628301935",
  market:       "1503103814683852920",
  tickets:      "1503104618417094687",
};
const MARKET_CATEGORIES = {
  tradingHub: "1502611113924362291",
  market:     "1503103734996275220",
  ticket:     "1503104506337034351",
};
const STAFF_CHANNELS = {
  staffChat:     "1503750763543924786",
  ticketLogging: "1503750491996164196",
};
const STAFF_CATEGORY  = "1503750430629433414";
const BOOSTER_ROLE_ID = "1503879796369789060";
const GUILD_ID        = process.env.GUILD_ID;

// ─── JACE channel/category IDs ────────────────────────────────────────────
// Create these manually in Discord, then paste the IDs here.
const JACE_CATEGORIES = [
  "1505208805217275946",
  "1505208858832933085",
  "1505208910196248637",
  "1506410208962936953",
];
const JACE_CHANNELS = [
  // Important
  "1505208810770268210",
  "1505208824729174047",
  "1505208837148377321",
  "1505208842391261234",
  "1505208854118662214",
  // Middleman Request
  "1505208862494425160",
  "1505208874016182424",
  "1505208885122961498",
  // Social
  "1505208913761538109",
  "1505208918924857477",
  "1505208927242031125",
  // Auto Crypto
  "1505208943251816530",
  "1505208948045778994",
  "1505208962683764918",
];

// ─── Fake leaderboard data ────────────────────────────────────────────────
const FAKE_ALLTIME = [
  { username: "kadderr",          points: 365 },
  { username: "pending193",       points: 234 },
  { username: "safi.xk",          points: 231 },
  { username: "superfunk_",       points: 202 },
  { username: "twiss9219",        points: 201 },
  { username: "ilovemydogbella",  points: 151 },
  { username: ".darknight.1",     points: 145 },
  { username: "osamahegazy1238",  points: 117 },
  { username: "brawlstars901",    points: 116 },
  { username: "ps4850",           points: 115 },
];
const FAKE_MONTHLY = [
  { username: "oqute",               points: 8 },
  { username: "pa99trader0701",      points: 8 },
  { username: "h20virus",            points: 8 },
  { username: "qvxryy",              points: 7 },
  { username: "kazuu2424",           points: 7 },
  { username: "caughton4k097681242", points: 6 },
  { username: "laoroush7",           points: 5 },
  { username: "fjahyy1230",          points: 5 },
  { username: "andya9x",             points: 5 },
  { username: "1kv0",                points: 5 },
];

// ─── ToS ──────────────────────────────────────────────────────────────────
const TOS_FULL = `**JMS Manual Middleman | TOS**

While using our Middleman Services, you must agree to a few things.

**1.** We are not responsible for anything that happens after the deal is over. (i.e. PSX duped pets getting wiped, Revoked/Poisoned Limiteds, etc)
**2.** We are not responsible if anything happens in the middle of a deal if the Middleman is not at fault.
**3.** If anything happens mid-deal, we're not responsible & not committed to compensating the loss.
**4.** If one of our MMs goes AFK in the middle of the trade, it means they're busy with IRL things. Don't worry, they'll be back soon.
**5.** We aren't responsible if either side of the trade goes AFK.
**6.** We save a transcript of the ticket after every deal.
**7.** We do not MM very time-consuming/risky trades for free. Make sure to tip the MM at the start of the trade.
**8.** Make sure to vouch after every trade you've done with a MM. Not vouching within 24 hours is a Middleman Ban.
**9.** Do not request MM if your trade includes nitro, giftcards and/or accounts.
**10.** You may not choose to use another middleman other than the first MM who replied your ticket.
**11.** If a trader or MM loses items due to being duped, no one is obligated to compensate unless it was agreed beforehand.
**12.** For currency-based trades, if no agreement was made about fees/taxes, the receiver must get the full amount.
**13.** For SAB trades, the MM is not responsible for any losses.`;

// ─── Switch to JACE ───────────────────────────────────────────────────────
async function switchToJace(guild, notifyChannel) {
  const everyoneRole = guild.roles.everyone;

  // Change server name + icon
  try { await guild.setIcon(JMS_ICON); await guild.setName("Jace's MM Service"); }
  catch (err) { console.error("Icon/name error:", err.message); }

  // Hide all market channels
  for (const id of [...Object.values(MARKET_CHANNELS), ...Object.values(MARKET_CATEGORIES)]) {
    const ch = guild.channels.cache.get(id);
    if (ch) await ch.permissionOverwrites.edit(everyoneRole, { ViewChannel: false }).catch(() => {});
    await sleep(150);
  }

  // Show all Jace channels
  for (const id of [...JACE_CHANNELS, ...JACE_CATEGORIES]) {
    const ch = guild.channels.cache.get(id);
    if (ch) await ch.permissionOverwrites.edit(everyoneRole, { ViewChannel: true }).catch(() => {});
    await sleep(150);
  }

  // Show Auto Middleman bot
  const autoMember = guild.members.cache.get(AUTO_MM_BOT_ID);
  if (autoMember) {
    await autoMember.roles.add("paste_auto_bots_role_id_here").catch(() => {});
  } 

  console.log("✅ switchToJace complete");
  notifyChannel?.send("✅ Switched to **Jace's MM Service**! 🎉").catch(() => {});
}

// ─── Switch to MARKET ─────────────────────────────────────────────────────
async function switchToMarket(guild, notifyChannel) {
  const everyoneRole = guild.roles.everyone;

  // Change server name + icon
  try { await guild.setIcon(MARKET_ICON); await guild.setName("Joo's Market"); }
  catch (err) { console.error("Icon/name error:", err.message); }

  // Hide all Jace channels
  for (const id of [...JACE_CHANNELS, ...JACE_CATEGORIES]) {
    const ch = guild.channels.cache.get(id);
    if (ch) await ch.permissionOverwrites.edit(everyoneRole, { ViewChannel: false }).catch(() => {});
    await sleep(150);
  }

  // Show all market channels
  for (const id of [...Object.values(MARKET_CHANNELS), ...Object.values(MARKET_CATEGORIES)]) {
    const ch = guild.channels.cache.get(id);
    if (ch) await ch.permissionOverwrites.edit(everyoneRole, { ViewChannel: true }).catch(() => {});
    await sleep(150);
  }

  // Hide Auto Middleman bot by removing its visible role
  const autoMember = guild.members.cache.get(AUTO_MM_BOT_ID);
  if (autoMember) {
    await autoMember.roles.remove("paste_auto_bots_role_id_here").catch(() => {});
  }

  console.log("✅ switchToMarket complete");
  notifyChannel?.send("✅ Switched back to **Joo's Market**! 📈").catch(() => {});
}

// ─── Ready ────────────────────────────────────────────────────────────────
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const command = new SlashCommandBuilder()
    .setName("switch")
    .setDescription("Switch the server theme")
    .addStringOption((opt) =>
      opt.setName("theme").setDescription("Which theme?").setRequired(true)
        .addChoices(
          { name: "Jace's MM Service", value: "jace"   },
          { name: "Market",            value: "market" }
        )
    );

  try {
    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), {
      body: [command.toJSON()],
    });
    console.log("✅ /switch registered");
  } catch (err) {
    console.error("Slash command registration failed:", err.message);
  }
});

// ─── Interactions ─────────────────────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {

  if (interaction.isButton() && interaction.customId === "request_middleman") {
    return interaction.reply({
      content: "📨 Please open a ticket and a staff member will assign you a middleman shortly!",
      flags: 64,
    });
  }

  if (interaction.isButton() && interaction.customId === "request_ltc") {
    return interaction.reply({ content: "⚡ LTC request coming soon!", flags: 64 });
  }

  if (interaction.isButton() && interaction.customId === "request_usdt") {
    return interaction.reply({ content: "⚡ USDT request coming soon!", flags: 64 });
  }

  if (interaction.isButton() && interaction.customId === "view_tos") {
    const chunks = TOS_FULL.match(/[\s\S]{1,4000}/g) || [TOS_FULL];
    const embeds = chunks.map((chunk, i) =>
      new EmbedBuilder()
        .setDescription(chunk)
        .setColor(0x5865F2)
        .setTitle(i === 0 ? "JMS Manual Middleman | TOS" : null)
    );
    return interaction.reply({ embeds, flags: 64 });
  }

  if (interaction.isButton() && interaction.customId === "view_your_stats") {
    const username  = interaction.user.username;
    const monthName = new Date().toLocaleString("en-US", { month: "long" });

    const atLines = FAKE_ALLTIME.map((e, i) => `#${i + 1} ${e.username} — ${e.points}`);
    atLines.push(`**#734 ${username} — 6 (YOU)**`);

    const moLines = FAKE_MONTHLY.map((e, i) => `#${i + 1} ${e.username} — ${e.points}`);
    moLines.push(`**#734 ${username} — 6 (YOU)**`);

    const atEmbed = new EmbedBuilder()
      .setTitle("Top Clients [All-Time]")
      .setDescription(atLines.join("\n"))
      .setColor(0x5865F2);

    const moEmbed = new EmbedBuilder()
      .setTitle(`Top Clients [${monthName}]`)
      .setDescription(moLines.join("\n"))
      .setColor(0x5865F2);

    return interaction.reply({ embeds: [atEmbed, moEmbed], flags: 64 });
  }

  if (interaction.isButton() && interaction.customId === "shopping_cart_join") {
    return interaction.reply({
      content: "https://jaces.xyz/\nhttps://discord.gg/fQbPUNvCFx",
      flags: 64,
    });
  }

  if (!interaction.isChatInputCommand() || interaction.commandName !== "switch") return;

  const hasBooster = interaction.member.roles.cache.has(BOOSTER_ROLE_ID);
  const isAdmin    = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
  if (!hasBooster && !isAdmin) {
    return interaction.reply({ content: "❌ You need the **Booster** role to use this!", flags: 64 });
  }

  const theme = interaction.options.getString("theme");

  if (theme === "jace"   && currentMode === "jace")
    return interaction.reply({ content: "⚠️ Already in **Jace's MM Service** mode!", flags: 64 });
  if (theme === "market" && currentMode === "market")
    return interaction.reply({ content: "⚠️ Already in **Market** mode!", flags: 64 });

  await interaction.reply({
    content: `⏳ Switching to **${theme === "jace" ? "Jace's MM Service" : "Joo's Market"}**... give me a moment!`,
    flags: 64,
  });

  currentMode = theme;
  saveState({ mode: currentMode });

  const notifyChannel = interaction.guild.channels.cache.get(STAFF_CHANNELS.staffChat) ?? null;
  const switchFn = theme === "jace" ? switchToJace : switchToMarket;
  switchFn(interaction.guild, notifyChannel).catch((err) => {
    console.error(`${theme} switch error:`, err);
    notifyChannel?.send(`❌ Error during switch to **${theme}** — check bot logs.`).catch(() => {});
  });
});

// ─── Prevent crashes ──────────────────────────────────────────────────────
process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));

client.login(process.env.DISCORD_TOKEN);