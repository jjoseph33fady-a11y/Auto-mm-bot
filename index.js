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
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  AttachmentBuilder,
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ─── Paths ─────────────────────────────────────────────────────────────────
// Save these files in the same folder as index.js:
//   jms-icon.png       → server icon for Jace mode
//   market-icon.png    → server icon for Market mode
//   jace-bot-pfp.png   → JMS logo (webhook avatar)
//   alltime-lb.png     → the All-Time leaderboard card image  (image 1 you sent)
//   monthly-lb.png     → the Monthly leaderboard card image   (image 2 you sent)
const JMS_ICON       = path.join(__dirname, "jms-icon.png");
const MARKET_ICON    = path.join(__dirname, "market-icon.png");
const JACE_BOT_PFP   = path.join(__dirname, "jace-bot-pfp.png");
const ALLTIME_LB_IMG = path.join(__dirname, "alltime-lb.png");
const MONTHLY_LB_IMG = path.join(__dirname, "monthly-lb.png");
const STATE_FILE     = path.join(__dirname, "state.json");
const AUTO_MM_PFP = path.join(__dirname, "auto-mm-pfp.png");


// ─── State ─────────────────────────────────────────────────────────────────
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { mode: "market" }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s)); }
let currentMode = loadState().mode;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Server IDs ─────────────────────────────────────────────────────────────
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

// ─── Fake leaderboard data for "View Your Stats" ─────────────────────────────
// These match exactly what's shown in the card images.
// The user who clicks the button is always appended at the very last spot with 0 points.
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

// ─── ToS ───────────────────────────────────────────────────────────────────
const TOS_FULL = `**JMS Manual Middleman | TOS**

While using our Middleman Services, you must agree to a few things.

**1.** We are not responsible for anything that happens after the deal is over. (i.e. PSX duped pets getting wiped, Revoked/Poisoned Limiteds, etc)

**2.** We are not responsible if anything happens in the middle of a deal if the Middleman is not at fault. (i.e. Wrong Crypto Address/PayPal email, wrong gamepass, wrong spelling for Roblox username in lima trades)

**3.** If anything happens mid-deal, we're not responsible & not committed to compensating the loss. (i.e. middleman account getting terminated, rollbacks, being compromised, etc)

**4.** If one of our MMs goes AFK in the middle of the trade, it means they're busy with IRL things. Don't worry, they'll be back soon, you just have to wait, you'll get pinged when they're there.

**5.** We aren't responsible if either side of the trade goes AFK, including returning the items to the seller if the buyer is AFK & hasn't given their part to the seller.

**6.** We save a transcript of the ticket after every deal to make sure if anything goes wrong, we can analyze the ticket.

**7.** We do not MM very time-consuming/risky trades for free. We will ask you to tip, and some MMs don't MM them at all. Make sure to tip the MM at the start of the trade.

**8.** Make sure to vouch after every trade you've done with a MM. Not vouching within 24 hours is a Middleman Ban.

**9.** Do not request MM if your trade includes nitro, giftcards and/or accounts.

**10.** You may not choose to use another middleman other than the first MM who replied your ticket. Only exceptions are if there are issues with the trade.

**11.** If a trader or MM loses items due to being duped, no one is obligated to compensate unless it was agreed beforehand. Refusing to compensate after agreeing will result in a server ban.

**12.** For currency-based trades, if no agreement was made about fees/taxes, the receiver must get the full amount.

**13.** For SAB trades, the MM is not responsible for any losses. Items are always at risk from third parties in SAB.`;

// ─── Jace channel content ───────────────────────────────────────────────────
const JACE_CONTENT = {
  rules: `**JACE'S MM SERVICE | RULES**

**AVOID ARGUMENTS, AND TOXICITY**
- Do not start, partake, or instigate drama.
- Do not troll, bully, or bother other members in the server.
- Profanity is fine upto some extent, although refrain from using it at all, if possible.
- Do not disrespect any staff or MMs in any way.

**DON'T SCAM**
- Scamming will result in you receiving the DWC role and a possible ban.
- It may also lead to a mass ban over roblox servers.

**NO DOXXING, ADVERTISING, IMPERSONATION, THREATS OR ANYTHING OF THE SORT**
- Posting private information such as selfies, addresses, phone numbers, or emails is strictly prohibited.
- Do not doxx anyone. Death threats may lead to a warn, mute or a ban.
- No advertising within the server.
- Do NOT impersonate MMs or staff members. Doing so will lead to a ban.

**DON'T BE IMMATURE**
- Be appropriate in the voice channels.
- Do not scream into your mic or force-play loud audio.
- Don't ping others and provoke them to start arguments.
- Do not annoy staff.
- No asking for donations, or begging for money.
- Stay on topic, use the appropriate text channels in the server.

**BE OBEDIENT**
- Staff have the authority, meaning they have the final say.
- Failure to abide by rules will result in a ban/kick from the server.

**FLOODING AND SPAM**
- Flooding or spamming unwanted comments will result in a warn/mute.
- Do not post any NSFW-related content within the server.

**DISCORD TERMS OF SERVICE**
- JMS abides by Discord's official TOS.
🔗 https://discord.com/guidelines
🔗 https://discord.com/terms`,

  updates: `If you had a manual ticket open, please create a new one with your trader and ping your MM.
For auto tickets, you can either:
• Create a support ticket in the market Jace's Market > report / support.
• Or make a new ticket and ping staff; we'll assist you.

If anything happens, you can always find the links at https://jaces.xyz/`,

  servers: `https://discord.gg/KdXDqvdayx
https://discord.gg/8ueB68BGqn
https://discord.gg/fQbPUNvCFx

**Jace's MM Service**
https://jaces.xyz/

**JMS 2**
https://jaces.xyz/

**Jace's Market**
https://jaces.xyz/

All links can be found at: https://jaces.xyz/`,

  mmReq: `__Middleman Service__
To request a middleman from this server, click the blue "Request Middleman" button on this message.

__How does middleman work?__
Example: Trade is NFR Crow for Robux.
1. Seller gives NFR Crow to middleman
2. Buyer pays seller robux (After middleman confirms receiving pet)
3. Middleman gives buyer NFR Crow (After seller confirmed receiving robux)

__NOTES:__
1. You must both agree on the deal before using a middleman. Troll tickets will have consequences.
2. Specify what you're trading (e.g. FR Frost Dragon in Adopt Me > $20 USD LTC). Don't just put "adopt me" in the embed.`,

  mmTosTeaser: `Get a Manual Middleman from the mm-req channel.

There has been an increase in scam attempts recently.
• Double-check your Middleman's roles, as traders can impersonate the MM.
• Beware of **fake SAB games**.
• Always record your trades (e.g. giving items in-game).`,

  autoCrypto: `**Jace's Auto Middleman**

• Paid Service
• Read our ToS before using the bot in tos-crypto

**Fees:**
• Deals $250+: $1.50
• Deals under $250: $0.50
• Deals under $50 are **FREE**

Request Litecoin (LTC)
Request USDT [BEP-20] — Network: BSC (BEP-20)`,

  tosCrypto: `The ToS in mm-tos also apply here.
You can start a trade with the Automatic MM bot in auto-crypto.

• Double-check your Middleman's roles, as traders can impersonate the MM.
• Beware of **fake SAB games**.
• Always record your trades (e.g. giving items in-game).
• Always read the bot's embeds — people can send a few cents to the bot and lie that they sent the full amount.`,

shoppingCart: null, // handled by sendShoppingCart()

};

// ─── Webhook: get or create "Jace's MM Bot" in a channel ────────────────────
async function getJaceWebhook(channel) {
  const webhooks = await channel.fetchWebhooks();
  let wh = webhooks.find((w) => w.name === "Jace's MM Bot");
  if (!wh) {
    const avatar = fs.existsSync(JACE_BOT_PFP) ? fs.readFileSync(JACE_BOT_PFP) : null;
    wh = await channel.createWebhook({ name: "Jace's MM Bot", avatar });
  }
  return wh;
}

async function getAutoMmWebhook(channel) {
  const webhooks = await channel.fetchWebhooks();
  let wh = webhooks.find((w) => w.name === "Auto Middleman");
  if (!wh) {
    const avatar = fs.existsSync(AUTO_MM_PFP) ? fs.readFileSync(AUTO_MM_PFP) : null;
    wh = await channel.createWebhook({ name: "Auto Middleman", avatar });
  }
  return wh;
}

async function sendAsAutoMm(channel, payload) {
  try {
    const wh = await getAutoMmWebhook(channel);
    await wh.send(payload);
  } catch (err) {
    console.error(`Auto MM webhook error in #${channel.name}:`, err.message);
    try { await channel.send(payload); } catch {}
  }
}

async function sendAsJace(channel, payload) {
  try {
    const wh = await getJaceWebhook(channel);
    await wh.send(payload);
  } catch (err) {
    console.error(`Webhook error in #${channel.name}:`, err.message);
    try { await channel.send(payload); } catch {}
  }
}

// ─── Channel send helpers ────────────────────────────────────────────────────
async function sendMmReq(channel) {
  const embed = new EmbedBuilder().setDescription(JACE_CONTENT.mmReq).setColor(0x5865F2);
  const row   = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("request_middleman")
      .setLabel("Request Middleman")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🔷")
  );
  await sendAsJace(channel, { embeds: [embed], components: [row] });
}

async function sendMmTos(channel) {
  const embed = new EmbedBuilder().setDescription(JACE_CONTENT.mmTosTeaser).setColor(0x5865F2);
  const row   = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("view_tos")
      .setLabel("View ToS")
      .setStyle(ButtonStyle.Primary)
  );
  await sendAsJace(channel, { embeds: [embed], components: [row] });
}

async function sendLeaderboard(channel) {
  const monthName = new Date().toLocaleString("en-US", { month: "long" });

  // Header text
  await sendAsJace(channel, {
    content:
      `Top 3 of the previous month will get @Top 3 Clients role, the rest will get @Top 10 Clients. ` +
      `You get one point for each deal you complete.\n` +
      `This leaderboard is only for Manual tickets. Use /leaderboard for Auto tickets leaderboard.`,
  });
  await sleep(400);

  // All-time leaderboard image
  if (fs.existsSync(ALLTIME_LB_IMG)) {
    await sendAsJace(channel, {
      files: [new AttachmentBuilder(ALLTIME_LB_IMG, { name: "alltime-lb.png" })],
    });
  } else {
    console.warn("⚠️  alltime-lb.png not found in bot folder.");
  }
  await sleep(400);

  // Monthly leaderboard image + View Your Stats button
  const statsBtn = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("view_your_stats")
      .setLabel("View Your Stats")
      .setStyle(ButtonStyle.Primary)
  );

  if (fs.existsSync(MONTHLY_LB_IMG)) {
    await sendAsJace(channel, {
      files:      [new AttachmentBuilder(MONTHLY_LB_IMG, { name: "monthly-lb.png" })],
      components: [statsBtn],
    });
  } else {
    console.warn("⚠️  monthly-lb.png not found in bot folder.");
    await sendAsJace(channel, {
      content:    `📊 **Top Clients [Monthly] - [${monthName}]**\n*(Place monthly-lb.png in bot folder)*`,
      components: [statsBtn],
    });
  }
}

async function sendShoppingCart(channel) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("shopping_cart_join")
      .setLabel("Join 🛒")
      .setStyle(ButtonStyle.Primary)
  );

  await sendAsJace(channel, { components: [row] });
}

async function sendAutoCrypto(channel, completedCryptoId) {
  const mainEmbed = new EmbedBuilder()
    .setTitle("Jace's Auto Middleman")
    .setDescription("• Paid Service\n• Read our ToS before using the bot in: <#" + process.env.TOS_CRYPTO_CHANNEL_ID + ">")
    .addFields({
      name: "Fees:",
      value: "• Deals $250+: $1.50\n• Deals under $250: $0.50\n• Deals under $50 are FREE",
    })
    .setColor(0x2b2d31);

  const tutorialBtn = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Tutorial")
      .setURL("https://jaces.xyz/")
      .setStyle(ButtonStyle.Link)
      .setEmoji("↗️")
  );

  await sendAsAutoMm(channel, { embeds: [mainEmbed], components: [tutorialBtn] });
  await sleep(400);

  const ltcEmbed = new EmbedBuilder()
    .setTitle("<:ltc:1504243625415147581> • Request Litecoin • <:ltc:1504243625415147581>")
    .setColor(0x2b2d31);
  const ltcRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("request_ltc")
      .setLabel("Request LTC")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("<:ltc:1504243625415147581>")
  );
  await sendAsAutoMm(channel, { embeds: [ltcEmbed], components: [ltcRow] });
  await sleep(400);

  const usdtEmbed = new EmbedBuilder()
    .setTitle("<:usdt:1504243543764369483> • Request USDT [BEP-20] • <:usdt:1504243543764369483>")
    .setDescription("• Network: BSC (BEP-20)")
    .setColor(0x2b2d31);
  const usdtRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("request_usdt")
      .setLabel("Request USDT [BEP-20]")
      .setStyle(ButtonStyle.Success)
      .setEmoji("<:usdt:1504243543764369483>")
  );
  await sendAsAutoMm(channel, { embeds: [usdtEmbed], components: [usdtRow] });
  await sleep(400);

  await sendAsAutoMm(channel, {
    content: `Biggest Trade: <#${completedCryptoId}> 💬 **$17,995**`,
  });
}
async function sendPlainContent(channel, content, useEmbed = false) {
  if (!content) return;
  if (useEmbed) {
    await sendAsJace(channel, { embeds: [{ description: content, color: 0x5865F2 }] });
  } else {
    const chunks = content.match(/[\s\S]{1,1900}/g) || [content];
    for (const chunk of chunks) {
      await sendAsJace(channel, { content: chunk });
      await sleep(200);
    }
  }
}

async function sendPlainContentAs(channel, content, useEmbed = false, senderFn) {
  if (!content) return;
  if (useEmbed) {
    await senderFn(channel, { embeds: [{ description: content, color: 0x5865F2 }] });
  } else {
    const chunks = content.match(/[\s\S]{1,1900}/g) || [content];
    for (const chunk of chunks) {
      await senderFn(channel, { content: chunk });
      await sleep(200);
    }
  }
}

// ─── Jace server structure ───────────────────────────────────────────────────
const JACE_STRUCTURE = [
  {
    categoryName: "Important",
    channels: [
      { name: "๑˚᲼·╭⎼᲼rules",     content: JACE_CONTENT.rules,   embed: true },
      { name: "๑˚‧᲼│⎯᲼updates",   content: JACE_CONTENT.updates             },
      { name: "๑˚‧᲼│⎯᲼giveaways", content: null                             },
      { name: "๑˚‧᲼│⎯᲼servers",   content: JACE_CONTENT.servers             },
      { name: "๑˚‧᲼╰⎼᲼boosts",    content: null                             },
    ],
  },
  {
    categoryName: "Middleman Request",
    channels: [
      { name: "╭⎼᲼⎼᲼mm-req",   content: null, mmReq: true       },
      { name: "╰⎼᲼⎼᲼mm-tos",   content: null, mmTos: true       },
      { name: "👑⎼᲼clients-lb", content: null, leaderboard: true },
    ],
  },
  {
    categoryName: "Social",
    channels: [
      { name: "chat",     content: null },
      { name: "commands", content: null },
      { name: "🛒", content: null, shoppingCart: true },
    ],
  },
{
  categoryName: "auto crypto",
  channels: [
    { name: "auto-crypto",      content: null, autoMm: true, autoCryptoEmbed: true },
    { name: "tos-crypto",       content: JACE_CONTENT.tosCrypto, autoMm: true },
    { name: "completed-crypto", content: null,                   autoMm: true },
  ],
},
];
// ─── Switch to JACE ──────────────────────────────────────────────────────────
async function switchToJace(guild, notifyChannel) {
  const everyoneRole = guild.roles.everyone;

  try { await guild.setIcon(JMS_ICON); await guild.setName("Jace's MM Service"); }
  catch (err) { console.error("Icon/name error:", err.message); }

  for (const id of [...Object.values(MARKET_CHANNELS), ...Object.values(MARKET_CATEGORIES)]) {
    const ch = guild.channels.cache.get(id);
    if (ch) await ch.permissionOverwrites.edit(everyoneRole, { ViewChannel: false }).catch(() => {});
    await sleep(200);
  }

  let completedCryptoId = null;

  for (const catData of JACE_STRUCTURE) {
    const category = await guild.channels.create({
      name: catData.categoryName,
      type: 4,
      permissionOverwrites: [{ id: everyoneRole.id, allow: ["ViewChannel"] }],
    });
    await sleep(500);

    for (const chData of catData.channels) {
      const channel = await guild.channels.create({
        name:   chData.name,
        type:   0,
        parent: category.id,
        permissionOverwrites: [
          { id: everyoneRole.id, allow: ["ViewChannel"], deny: ["SendMessages"] },
        ],
      });
      await sleep(500);

      if (chData.name === "completed-crypto") completedCryptoId = channel.id;

      if      (chData.mmReq)           await sendMmReq(channel);
      else if (chData.mmTos)           await sendMmTos(channel);
      else if (chData.leaderboard)     await sendLeaderboard(channel);
      else if (chData.shoppingCart)    await sendShoppingCart(channel);
      else if (chData.autoCryptoEmbed) {} // skip, sent after all channels created
      else if (chData.content && chData.autoMm)
        await sendPlainContentAs(channel, chData.content, chData.embed || false, sendAsAutoMm);
      else if (chData.content)
        await sendPlainContent(channel, chData.content, chData.embed || false);

      await sleep(300);
    }
  }

  const autoCryptoCh = guild.channels.cache.find(c => c.name === "auto-crypto");
  if (autoCryptoCh) await sendAutoCrypto(autoCryptoCh, completedCryptoId);

  console.log("✅ switchToJace complete");
  notifyChannel?.send("✅ Switched to **Jace's MM Service**! 🎉").catch(() => {});
}
// ─── Switch to MARKET ────────────────────────────────────────────────────────
async function switchToMarket(guild, notifyChannel) {
  const everyoneRole = guild.roles.everyone;

  try { await guild.setIcon(MARKET_ICON); await guild.setName("Joo's Market"); }
  catch (err) { console.error("Icon/name error:", err.message); }

  const keepIds = new Set([
    ...Object.values(MARKET_CHANNELS),
    ...Object.values(MARKET_CATEGORIES),
    ...Object.values(STAFF_CHANNELS),
    STAFF_CATEGORY,
  ]);

  const allChannels  = [...guild.channels.cache.values()];
  const textChannels = allChannels.filter((c) => c.type !== 4 && !keepIds.has(c.id));
  const categories   = allChannels.filter((c) => c.type === 4 && !keepIds.has(c.id));

  for (const ch of textChannels) { await ch.delete().catch(() => {}); await sleep(300); }
  for (const cat of categories) {
    const fresh = guild.channels.cache.get(cat.id);
    if (fresh?.children?.cache.size === 0) { await cat.delete().catch(() => {}); await sleep(300); }
  }

  for (const id of [...Object.values(MARKET_CHANNELS), ...Object.values(MARKET_CATEGORIES)]) {
    const ch = guild.channels.cache.get(id);
    if (ch) await ch.permissionOverwrites.edit(everyoneRole, { ViewChannel: true }).catch(() => {});
    await sleep(200);
  }

  console.log("✅ switchToMarket complete");
  notifyChannel?.send("✅ Switched back to **Joo's Market**! 📈").catch(() => {});
}

// ─── Ready ───────────────────────────────────────────────────────────────────
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

// ─── Interactions ────────────────────────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {

  // ── Button: Request Middleman ──────────────────────────────────────────
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

  // ── Button: View ToS ──────────────────────────────────────────────────
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

  // ── Button: View Your Stats ────────────────────────────────────────────
  // Plain text embed, exactly like image 3.
  // User is always shown at the very last rank with 0 points.
  if (interaction.isButton() && interaction.customId === "view_your_stats") {
    const username  = interaction.user.username;
    const monthName = new Date().toLocaleString("en-US", { month: "long" });

    // All-time lines: #1 kadderr — 365 ... then user at the bottom
    const atLines = FAKE_ALLTIME.map((e, i) => `#${i + 1} ${e.username} — ${e.points}`);
    atLines.push(`** #734 ${username} — 6(YOU)**`);

    // Monthly lines
    const moLines = FAKE_MONTHLY.map((e, i) => `#${i + 1} ${e.username} — ${e.points}`);
    moLines.push(`** #734 ${username} — 6(YOU)**`);

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

// ── Button: Shopping Cart Join ─────────────────────────────────────────
if (interaction.isButton() && interaction.customId === "shopping_cart_join") {
  await interaction.deferUpdate();
  const msg = await interaction.channel.send({
    content: "https://jaces.xyz/\nhttps://discord.gg/fQbPUNvCFx",
  });
  setTimeout(() => msg.delete().catch(() => {}), 10000);
  return;
}
  // ── Slash: /switch ─────────────────────────────────────────────────────
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

  try {
  await interaction.reply({
    content: `⏳ Switching to **${theme === "jace" ? "Jace's MM Service" : "Joo's Market"}**... this may take a few minutes. I'll ping in staff chat when done.`,
    flags: 64,
  });
} catch {}

  currentMode = theme;
  saveState({ mode: currentMode });

  const notifyChannel = interaction.guild.channels.cache.get(STAFF_CHANNELS.staffChat) ?? null;
  const switchFn = theme === "jace" ? switchToJace : switchToMarket;
  switchFn(interaction.guild, notifyChannel).catch((err) => {
    console.error(`${theme} switch error:`, err);
    notifyChannel?.send(`❌ Error during switch to **${theme}** — check bot logs.`).catch(() => {});
  });
});

// ─── Prevent crashes ─────────────────────────────────────────────────────────
process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));

client.login(process.env.DISCORD_TOKEN);