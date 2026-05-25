require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
} = require("discord.js");
const axios = require("axios");
const { getLTCAddress } = require("./ltcWallet");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const GUILD_ID            = process.env.GUILD_ID;
const AUTO_CRYPTO_CHANNEL = process.env.AUTO_CRYPTO_CHANNEL_ID;
const COMPLETED_CRYPTO_CH = process.env.COMPLETED_CRYPTO_CHANNEL_ID;
const TOS_CRYPTO_CHANNEL  = process.env.TOS_CRYPTO_CHANNEL_ID;
const OWNER_ID            = process.env.OWNER_ID;
const BOT_LTC_ADDRESS     = "LXozTrtuyaChUtqypnbP8gLufRXFdn22K6";

const CType = {
  ActionRow:   1,
  Button:      2,
  Section:     9,
  TextDisplay: 10,
  Separator:   14,
  Container:   17,
};

const BStyle = {
  Primary:   1,
  Secondary: 2,
  Success:   3,
  Danger:    4,
  Link:      5,
};

const PAD_MAIN = " ".repeat(24) + "\u200e";
const PAD_LTC  = " ".repeat(40) + "\u200e";
const PAD_USDT = " ".repeat(40) + "\u200e";

// Custom emoji helpers — resolved at runtime from guild emoji list
const EMOJI_IDS = {
  E_WAVE:    "1505204925368369152",
  E_SHIELD:  "1505205027608727572",
  E_X:       "1505205149260579027",
  E_CHECK:   "1505205115898822817",
  E_DIAMOND: "1505205184840732822",
};

// These will be populated in the "ready" event
let E_WAVE    = "";
let E_SHIELD  = "";
let E_X       = "";
let E_CHECK   = "";
let E_DIAMOND = "";

function resolveEmoji(guild, id) {
  const found = guild.emojis.cache.get(id);
  if (found) return found.animated ? `<a:${found.name}:${id}>` : `<:${found.name}:${id}>`;
  return `<:emoji:${id}>`; // fallback
}

// ── In-memory ticket state ─────────────────────────────────────────────────
const ticketState = {};

// ── Polling intervals ──────────────────────────────────────────────────────
const pollingIntervals = {};
const claimedTxids = new Set();
// ── Helpers ────────────────────────────────────────────────────────────────
async function getLTCPrice() {
  try {
    const res = await axios.get("https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd");
    return res.data.litecoin.usd;
  } catch {
    return null;
  }
}

function usdToLtc(usd, price) {
  return (usd / price).toFixed(5);
}

async function checkLTCTransaction(address, expectedLtc) {
  try {
    const res = await axios.get(`https://litecoinspace.org/api/address/${address}/txs`);
    const txs = res.data;
    if (!txs || txs.length === 0) return null;

    for (const tx of txs) {
      for (const vout of tx.vout) {
        if (vout.scriptpubkey_address === address) {
          const receivedLtc = vout.value / 1e8;
          const isConfirmed = tx.status && tx.status.confirmed;
          return {
            txid: tx.txid,
            receivedLtc,
            isConfirmed,
            confirmations: isConfirmed ? (tx.status.block_height ? 1 : 0) : 0,
            blockTime: tx.status?.block_time || null,
          };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

function startPolling(channelId, thread) {
  if (pollingIntervals[channelId]) return;

  let unconfirmedPosted = false;

  pollingIntervals[channelId] = setInterval(async () => {
    const state = ticketState[channelId];
    if (!state || state.confirmed) {
      clearInterval(pollingIntervals[channelId]);
      delete pollingIntervals[channelId];
      return;
    }

    const result = await checkLTCTransaction(state.ticketAddress, state.ltcAmount);
    if (!result) return;
    if (result.blockTime && result.blockTime < (state.createdAt - 300)) return;

    const txid = result.txid;
    if (state.seenTxids.has(txid + "_confirmed")) return;

    if (!unconfirmedPosted && !state.seenTxids.has(txid + "_unconfirmed")) {
      state.seenTxids.add(txid + "_unconfirmed");
      unconfirmedPosted = true;

      const rest = new REST({ version: "10" }).setToken(process.env.AUTO_MM_TOKEN);
      await rest.post(Routes.channelMessages(channelId), {
        body: {
          flags: 1 << 15,
          components: [
            {
              type: CType.Container,
              accent_color: 0xf0a500,
              components: [
                {
                  type: CType.TextDisplay,
                  content: "### `⚠️` • Transaction Detected\nThe transaction is currently **unconfirmed** and waiting for 1 confirmation.\n\n**Transaction**\n" +
                    "[`" + txid.slice(0, 10) + "..." + txid.slice(-10) + "`](https://blockchair.com/litecoin/transaction/" + txid + ") (" + result.receivedLtc + " LTC)\n" +
                    "**Amount Received**　　　　**Required Amount**\n" +
                    "`" + result.receivedLtc + "` LTC ($" + (result.receivedLtc * (state.usdAmount / state.ltcAmount)).toFixed(2) + ")　　　`" + state.ltcAmount + "` LTC ($" + state.usdAmount.toFixed(2) + ")" + (Math.abs(result.receivedLtc - state.ltcAmount) > 0.00001 ? "\n\n⚠️ **Amount mismatch!** The sender sent `" + result.receivedLtc + "` LTC but `" + state.ltcAmount + "` LTC was required." : ""),
                },
              ],
            },
          ],
        },
      });
    }

    if (result.isConfirmed && !state.seenTxids.has(txid + "_confirmed")) {
      state.seenTxids.add(txid + "_confirmed");
      state.confirmed = true;
      const amountMismatch = Math.abs(result.receivedLtc - state.ltcAmount) > 0.00001;
      clearInterval(pollingIntervals[channelId]);
      delete pollingIntervals[channelId];

      const rest = new REST({ version: "10" }).setToken(process.env.AUTO_MM_TOKEN);

      // Transaction confirmed message
      await rest.post(Routes.channelMessages(channelId), {
        body: {
          flags: 1 << 15,
          components: [
            {
              type: CType.Container,
              accent_color: 0x57f287,
              components: [
                {
                  type: CType.TextDisplay,
                  content: `\`✅\` • **Transaction Confirmed!**\n\n**Transactions**\n[\`${txid.slice(0, 10)}...${txid.slice(-10)}\`](https://blockchair.com/litecoin/transaction/${txid}) (${result.receivedLtc} LTC)\n\n**Total Amount Received**\n\`${result.receivedLtc}\` LTC ($${(state.usdAmount).toFixed(2)})`,
                },
              ],
            },
          ],
        },
      });

      // Proceed message
      await rest.post(Routes.channelMessages(channelId), { body: { content: `<@${state.receiver}> <@${state.sender}>` } });

      if (amountMismatch) {
        const diff = (result.receivedLtc - state.ltcAmount).toFixed(5);
        const diffText = result.receivedLtc > state.ltcAmount
          ? `\`${Math.abs(diff)}\` LTC **more** than required`
          : `\`${Math.abs(diff)}\` LTC **less** than required`;

        await rest.post(Routes.channelMessages(channelId), {
          body: {
            flags: 1 << 15,
            components: [
              {
                type: CType.Container,
                accent_color: 0xf0a500,
                components: [
                  {
                    type: CType.TextDisplay,
                    content:
                      `⚠️ • **Amount Mismatch**\n\nThe sender sent \`${result.receivedLtc}\` LTC but \`${state.ltcAmount}\` LTC was required.\nThe sender sent ${diffText}.\n\nDo you both want to proceed anyway?`,
                  },
                  {
                    type: CType.ActionRow,
                    components: [
                      {
                        type: CType.Button,
                        style: BStyle.Success,
                        custom_id: `mismatch_proceed_${channelId}`,
                        label: "Proceed",
                      },
                      {
                        type: CType.Button,
                        style: BStyle.Danger,
                        custom_id: `mismatch_cancel_${channelId}`,
                        label: "Cancel",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        });
      } else {
        await rest.post(Routes.channelMessages(channelId), {
          body: {
            flags: 1 << 15,
            components: [
              {
              type: CType.Container,
              accent_color: 0x57f287,
              components: [
                {
                  type: CType.TextDisplay,
                  content:
                    `\`✅\` • **You may proceed with your trade.**\n\n` +
                    `> ## 1. <@${state.receiver}> Give your trader the items or payment you agreed on.\n> ## 2. <@${state.sender}> Once you have received your items, click "Release" so your trader can claim the LTC.`,
                },
              ],
            },
              {
                type: CType.ActionRow,
                components: [
                  {
                    type: CType.Button,
                    style: BStyle.Success,
                    custom_id: `release_${channelId}`,
                    label: "Release",
                  },
                  {
                    type: CType.Button,
                    style: BStyle.Danger,
                    custom_id: `cancel_${channelId}`,
                    label: "Cancel",
                  },
                ],
              },
            ],
          },
        });
      }
    }
  }, 30000);
}
// ── Bot Ready ──────────────────────────────────────────────────────────────
client.once("ready", async () => {
  console.log(`✅ Auto Middleman logged in as ${client.user.tag}`);

  // Resolve custom emojis from guild
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.emojis.fetch(); // populate cache
    E_WAVE    = resolveEmoji(guild, EMOJI_IDS.E_WAVE);
    E_SHIELD  = resolveEmoji(guild, EMOJI_IDS.E_SHIELD);
    E_X       = resolveEmoji(guild, EMOJI_IDS.E_X);
    E_CHECK   = resolveEmoji(guild, EMOJI_IDS.E_CHECK);
    E_DIAMOND = resolveEmoji(guild, EMOJI_IDS.E_DIAMOND);
    console.log(`✅ Emojis resolved: WAVE=${E_WAVE} SHIELD=${E_SHIELD} X=${E_X} CHECK=${E_CHECK} DIAMOND=${E_DIAMOND}`);
  } catch (err) {
    console.error("⚠️ Could not resolve custom emojis:", err);
  }

  const rest = new REST({ version: "10" }).setToken(process.env.AUTO_MM_TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), {
    body: [
      new SlashCommandBuilder()
        .setName("setup-crypto")
        .setDescription("Send the auto crypto embeds")
        .toJSON(),
      new SlashCommandBuilder()
        .setName("setup-tos")
        .setDescription("Send the ToS embed to the tos-crypto channel")
        .toJSON(),
      new SlashCommandBuilder()
        .setName("simulate-payment")
        .setDescription("Simulate a confirmed LTC payment for testing (owner only)")
        .addStringOption(opt => opt.setName("channel").setDescription("Ticket channel ID").setRequired(true))
        .toJSON(),
    ],
  });

  console.log("✅ /setup-crypto registered");
});

// ── Interactions ───────────────────────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {

  // ── /setup-crypto ──────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === "setup-tos") {
  try { await interaction.deferReply({ flags: 64 }); } catch { return; }

  const TOS_CHANNEL_ID = "1508429535740166267";
  const tosChannel = client.channels.cache.get(TOS_CHANNEL_ID);
  if (!tosChannel) return interaction.editReply("❌ tos-crypto channel not found.");

  const oldMsgs = await tosChannel.messages.fetch({ limit: 20 });
  for (const msg of oldMsgs.values()) await msg.delete().catch(() => {});

  const rest = new REST({ version: "10" }).setToken(process.env.AUTO_MM_TOKEN);
  const fs   = require("fs");
  const path = require("path");

  await rest.post(Routes.channelMessages(TOS_CHANNEL_ID), {
    body: {
      content:
        `> The ToS in <#1508429535740166267> also apply here.\n` +
        `> You can start a trade with the Automatic MM Bot here: <#${AUTO_CRYPTO_CHANNEL}>`,
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: BStyle.Primary,
              custom_id: "view_tos",
              label: "View ToS",
            },
          ],
        },
      ],
    },
  });

  const jmsWebhook = await tosChannel.createWebhook({
    name: "JMS Bot",
    avatar: `data:image/png;base64,${fs.readFileSync(path.join(__dirname, "jace-bot-pfp.png")).toString("base64")}`,
  });

  await jmsWebhook.send({
    content:
      `- Double-check your Middleman's roles, as traders can impersonate the MM.\n` +
      `- Beware of **fake SAB games**.\n` +
      `- Always record your trades (e.g. giving items in-game).\n` +
      `- Always read the bot's embeds, people can send a few cents to the bot and lie that they sent the full amount.`,
  });

  await jmsWebhook.delete();

  await interaction.editReply("✅ ToS channel set up!");
  return;
}

  if (interaction.isChatInputCommand() && interaction.commandName === "setup-crypto") {
    await interaction.deferReply({ flags: 64 });

    const channel = client.channels.cache.get(AUTO_CRYPTO_CHANNEL);
    if (!channel) return interaction.editReply("❌ auto-crypto channel not found.");

    const messages = await channel.messages.fetch({ limit: 20 });
    for (const msg of messages.values()) {
      await msg.delete().catch(() => {});
    }

    const rest = new REST({ version: "10" }).setToken(process.env.AUTO_MM_TOKEN);

    await rest.post(Routes.channelMessages(AUTO_CRYPTO_CHANNEL), {
      body: {
        flags: 1 << 15,
        components: [
          {
            type: CType.Container,
            accent_color: 0x2b2d31,
            components: [
              {
                type: CType.Section,
                components: [
                  {
                    type: CType.TextDisplay,
                    content: `## Jace's Auto Middleman${PAD_MAIN}`,
                  },
                ],
                accessory: {
                  type: CType.Button,
                  style: BStyle.Link,
                  label: "Tutorial",
                  url: "https://www.youtube.com/watch?v=XIkpcT2WNPI",
                },
              },
              { type: CType.Separator, divider: true },
              {
                type: CType.TextDisplay,
                content:
                  "> - **Paid Service**\n" +
                  `> - Read our ToS before using the bot: <#${TOS_CRYPTO_CHANNEL}>`,
              },
              { type: CType.Separator, divider: true },
              {
                type: CType.TextDisplay,
                content:
                  "## Fees:\n" +
                  "> - Deals $250+: $1.50\n" +
                  "> - Deals under $250: $0.50\n" +
                  "> - __Deals under $50 are FREE__",
              },
            ],
          },
        ],
      },
    });

    await rest.post(Routes.channelMessages(AUTO_CRYPTO_CHANNEL), {
      body: {
        flags: 1 << 15,
        components: [
          {
            type: CType.Container,
            accent_color: 0xffffff,
            components: [
              {
                type: CType.TextDisplay,
                content: `## <:ltc:1504243625415147581> • Request Litecoin • <:ltc:1504243625415147581>${PAD_LTC}`,
              },
              {
                type: CType.ActionRow,
                components: [
                  {
                    type: CType.Button,
                    style: BStyle.Primary,
                    custom_id: "request_ltc",
                    label: "Request LTC",
                    emoji: { id: "1504243625415147581", name: "ltc" },
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    await rest.post(Routes.channelMessages(AUTO_CRYPTO_CHANNEL), {
      body: {
        flags: 1 << 15,
        components: [
          {
            type: CType.Container,
            accent_color: 0x26a17b,
            components: [
              {
                type: CType.TextDisplay,
                content: `## <:usdt:1504243543764369483> • Request USDT [BEP-20] • <:usdt:1504243543764369483>${PAD_USDT}`,
              },
              {
                type: CType.TextDisplay,
                content: "> - Network: **BSC (BEP-20)**",
              },
              {
                type: CType.ActionRow,
                components: [
                  {
                    type: CType.Button,
                    style: BStyle.Success,
                    custom_id: "request_usdt",
                    label: "Request USDT [BEP-20]",
                    emoji: { id: "1504243543764369483", name: "usdt" },
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    await channel.send({
      content: `> Biggest Trade: <#${COMPLETED_CRYPTO_CH}> 💬 **$17,995**`,
    });

    const fs = require("fs");
    const path = require("path");
    const inviteWebhook = await channel.createWebhook({
      name: "JMS Bot",
      avatar: fs.readFileSync(path.join(__dirname, "jace-bot-pfp.png")),
    });
    await inviteWebhook.send({
      content: `If you can't make a ticket here, make one in this server: https://discord.gg/8ueB68BGqn\nIt'll be our 2nd MM server for auto tickets.`,
    });
    await inviteWebhook.delete();

    await interaction.editReply("✅ Auto crypto channel set up!");
    return;
  }

  // ── Request LTC / USDT buttons ─────────────────────────────────────────
  if (interaction.isButton() && (interaction.customId === "request_ltc" || interaction.customId === "request_usdt")) {
    const type = interaction.customId === "request_ltc" ? "ltc" : "usdt";
    return interaction.showModal({
      custom_id: `${type}_modal`,
      title: "Fill out the format",
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: "trader_username",
              label: "Paste Your Trader's Username or ID",
              style: 1,
              placeholder: "e.g.: kookie.js / 1331012274151751743",
              required: true,
            },
          ],
        },
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: "what_you_give",
              label: "What are You giving?",
              style: 2,
              required: true,
            },
          ],
        },
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: "what_trader_gives",
              label: "What is Your Trader giving?",
              style: 2,
              required: true,
            },
          ],
        },
      ],
    });
  }

  // ── Modal Submit ───────────────────────────────────────────────────────
  if (interaction.isModalSubmit() && (interaction.customId === "ltc_modal" || interaction.customId === "usdt_modal")) {
    await interaction.deferReply({ flags: 64 });

    const guild = interaction.guild;
    const requester = interaction.user;
    const traderInput = interaction.fields.getTextInputValue("trader_username").trim();
    const whatRequesterGives = interaction.fields.getTextInputValue("what_you_give").trim();
    const whatTraderGives = interaction.fields.getTextInputValue("what_trader_gives").trim();
    const type = interaction.customId === "ltc_modal" ? "ltc" : "usdt";
    const randomNum = Math.floor(Math.random() * 900000 + 100000);
    const channelName = `${type}-${requester.username}_3-${randomNum}`;

    const cleanInput = traderInput.replace(/^@/, "").trim();
    let traderMember = null;
    try {
      traderMember = await guild.members.fetch(cleanInput).catch(() => null);
      if (!traderMember) {
        const results = await guild.members.fetch({ query: cleanInput, limit: 5 });
        traderMember = results.find(
          m => m.user.username.toLowerCase() === cleanInput.toLowerCase() ||
               m.displayName.toLowerCase() === cleanInput.toLowerCase()
        ) || null;
      }
    } catch {}

    if (!traderMember) {
      return interaction.editReply({ content: "**Invalid User!** Make sure your trader is in this server." });
    }

    try {
      let category = guild.channels.cache.find(
        c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === "auto crypto 2"
      );
      if (!category) {
        category = await guild.channels.create({
          name: "auto crypto 2",
          type: ChannelType.GuildCategory,
          permissionOverwrites: [
            { id: guild.roles.everyone, deny: ["ViewChannel"] },
          ],
        });
      }

      const permissionOverwrites = [
        { id: guild.roles.everyone, deny: ["ViewChannel"] },
        { id: requester.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
        { id: traderMember.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
        { id: client.user.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "ManageMessages"] },
      ];

      const tradeChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites,
      });

      const requesterAvatarUrl = `https://cdn.discordapp.com/avatars/${requester.id}/${requester.avatar}.png?size=256`;
      const traderAvatarUrl = traderMember.user.avatar
        ? `https://cdn.discordapp.com/avatars/${traderMember.id}/${traderMember.user.avatar}.png?size=256`
        : `https://cdn.discordapp.com/embed/avatars/0.png`;

      ticketState[tradeChannel.id] = {
        requesterId: requester.id,
        traderId: traderMember.id,
        requesterUsername: requester.username,
        traderUsername: traderMember.user.username,
        requesterAvatar: requesterAvatarUrl,
        traderAvatar: traderAvatarUrl,
        whatRequesterGives,
        whatTraderGives,
        type,
        sender: null,
        receiver: null,
        usdAmount: null,
        ltcAmount: null,
        rolesMsgId: null,
        confirmMsgId: null,
        usdMsgId: null,
        paymentMsgId: null,
        webhookId: null,
        webhookToken: null,
        monitoring: false,
        seenTxids: new Set(),
        confirmed: false,
        releaseConfirmed: false,
        createdAt: Math.floor(Date.now() / 1000),
        correctVotes: new Set(),
        usdConfirmVotes: new Set(),
        correctVotesMsgId: null,
        usdConfirmVotesMsgId: null,
        uniqueOffset: null,
        ticketAddress: null,
        ticketAddressIndex: null,
        usdPromptPosted: false,
      };

      const webhook = await tradeChannel.createWebhook({
        name: "Auto Middleman",
        avatar: client.user.displayAvatarURL(),
      });

      ticketState[tradeChannel.id].webhookId = webhook.id;
      ticketState[tradeChannel.id].webhookToken = webhook.token;

      const rest = new REST({ version: "10" }).setToken(process.env.AUTO_MM_TOKEN);

      // ── Welcome message ──────────────────────────────────────────────
      await rest.post(Routes.channelMessages(tradeChannel.id), {
        body: { content: `<@${requester.id}> <@${traderMember.id}>` },
      });
      await rest.post(Routes.channelMessages(tradeChannel.id), {
        body: {
          flags: 1 << 15,
          components: [
            {
              type: CType.Container,
              accent_color: 0xffffff,
              components: [
                {
                  type: CType.TextDisplay,
                  content:
                    `${E_WAVE} • **Jace's Auto Middleman Service**\n` +
                    "> Make sure to follow the steps and read the instructions thoroughly.\n" +
                    "> Please explicitly state the trade details if the information below is inaccurate.\n" +
                    `> By using this bot, you agree to our ToS <#${TOS_CRYPTO_CHANNEL}>.`,
                },
                { type: CType.Separator, divider: true, spacing: 1 },
                {
                  type: CType.Section,
                  components: [
                    {
                      type: CType.TextDisplay,
                      content: `<@${requester.id}>'s side:\n\`\`\`\n${whatRequesterGives}\n\`\`\``,
                    },
                  ],
                  accessory: {
                    type: 11,
                    media: { url: requesterAvatarUrl },
                  },
                },
                { type: CType.Separator, divider: true, spacing: 1 },
                {
                  type: CType.Section,
                  components: [
                    {
                      type: CType.TextDisplay,
                      content: `<@${traderMember.id}>'s side:\n\`\`\`\n${whatTraderGives}\n\`\`\``,
                    },
                  ],
                  accessory: {
                    type: 11,
                    media: { url: traderAvatarUrl },
                  },
                },
                { type: CType.Separator, divider: true, spacing: 1 },
                {
                  type: CType.ActionRow,
                  components: [
                    {
                      type: CType.Button,
                      style: BStyle.Danger,
                      custom_id: `delete_ticket_${tradeChannel.id}`,
                      label: "Delete Ticket",
                      emoji: { id: EMOJI_IDS.E_X },
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      // ── Role selection message ───────────────────────────────────────
      const rolesMsg = await rest.post(Routes.channelMessages(tradeChannel.id), {
        body: {
          flags: 1 << 15,
          components: [
            {
              type: CType.Container,
              accent_color: 0xffffff,
              components: [
                {
                  type: CType.TextDisplay,
                  content:
                    `### ${E_SHIELD} • Select your role\n` +
                    `> - **"__Sender__"** if you are __Sending__ ${type.toUpperCase()} to the bot.\n` +
                    `> - **"__Receiver__"** if you are __Receiving__ ${type.toUpperCase()} *later* from the bot.\n\n` +
                    `**Sender**　　　　　　　     **Receiver**\n...　　　　　　　　　　　...`,
                },
              ],
            },
            {
              type: CType.ActionRow,
              components: [
                {
                  type: CType.Button,
                  style: BStyle.Primary,
                  custom_id: `role_sender_${tradeChannel.id}`,
                  label: "Sender",
                },
                {
                  type: CType.Button,
                  style: BStyle.Primary,
                  custom_id: `role_receiver_${tradeChannel.id}`,
                  label: "Receiver",
                },
                {
                  type: CType.Button,
                  style: BStyle.Danger,
                  custom_id: `role_reset_${tradeChannel.id}`,
                  label: "Reset",
                },
              ],
            },
          ],
        },
      });

      ticketState[tradeChannel.id].rolesMsgId = rolesMsg.id;

      await interaction.editReply({ content: `**Ticket Created!** -> <#${tradeChannel.id}>` });
    } catch (err) {
      console.error(err);
      await interaction.editReply({ content: "❌ Something went wrong creating your channel." });
    }
    return;
  }

  // ── Role buttons ───────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("role_")) {
    const parts = interaction.customId.split("_");
    const action = parts[1];
    const channelId = parts.slice(2).join("_");
    const state = ticketState[channelId];
    if (!state) return interaction.reply({ content: "❌ Ticket not found.", flags: 64 });

    const userId = interaction.user.id;
    if (userId !== state.requesterId && userId !== state.traderId) {
      return interaction.reply({ content: "❌ You are not part of this ticket.", flags: 64 });
    }

    if (action === "reset") {
      state.sender = null;
      state.receiver = null;
    } else if (action === "sender") {
      if (state.receiver === userId) {
        return interaction.deferUpdate().catch(() => {});
      }
      if (state.sender !== null && state.sender !== userId) {
        return interaction.reply({ content: "❌ Someone else is already the Sender. Press Reset first.", flags: 64 });
      }
      state.sender = userId;
    } else if (action === "receiver") {
      if (state.sender === userId) {
        return interaction.deferUpdate().catch(() => {});
      }
      if (state.receiver !== null && state.receiver !== userId) {
        return interaction.reply({ content: "❌ Someone else is already the Receiver. Press Reset first.", flags: 64 });
      }
      state.receiver = userId;
    }

    await interaction.deferUpdate().catch(() => {});

    const senderName = state.sender ? `<@${state.sender}>` : "...";
    const receiverName = state.receiver ? `<@${state.receiver}>` : "...";

    const rest = new REST({ version: "10" }).setToken(process.env.AUTO_MM_TOKEN);

    await rest.patch(Routes.channelMessage(channelId, state.rolesMsgId), {
      body: {
        flags: 1 << 15,
        components: [
          {
            type: CType.Container,
            accent_color: 0xffffff,
            components: [
              {
                type: CType.TextDisplay,
                content:
                  `### ${E_SHIELD} • Select your role\n` +
                  `> - **"__Sender__"** if you are __Sending__ ${state.type.toUpperCase()} to the bot.\n` +
                  `> - **"__Receiver__"** if you are __Receiving__ ${state.type.toUpperCase()} *later* from the bot.\n\n` +
                  `**Sender**                                      **Receiver**\n${state.sender ? `<@${state.sender}>` : '...'}　　　　　　　             　${state.receiver ? `<@${state.receiver}>` : '...'}`,
              },
            ],
          },
          {
            type: CType.ActionRow,
            components: [
              {
                type: CType.Button,
                style: BStyle.Primary,
                custom_id: `role_sender_${channelId}`,
                label: "Sender",
                disabled: state.sender !== null,
              },
              {
                type: CType.Button,
                style: BStyle.Primary,
                custom_id: `role_receiver_${channelId}`,
                label: "Receiver",
                disabled: state.receiver !== null,
              },
              {
                type: CType.Button,
                style: BStyle.Danger,
                custom_id: `role_reset_${channelId}`,
                label: "Reset",
              },
            ],
          },
        ],
      },
    });

    // Both selected → show confirmation
    if (state.sender && state.receiver && state.sender !== state.receiver) {
      await rest.patch(Routes.channelMessage(channelId, state.rolesMsgId), {
        body: {
          flags: 1 << 15,
          components: [
            {
              type: CType.Container,
              accent_color: 0xffffff,
              components: [
                {
                  type: CType.TextDisplay,
                  content:
                    `### ${E_SHIELD} • Select your role\n` +
                    `> - **"Sender"** if you are __Sending__ ${state.type.toUpperCase()} to the bot.\n` +
                    `> - **"Receiver"** if you are __Receiving__ ${state.type.toUpperCase()} *later* from the bot.\n\n` +
                    `**Sender**　　　　　　                        **Receiver**\n<@${state.sender}>　　　　　　　             　<@${state.receiver}>`,
                },
              ],
            },
            {
              type: CType.ActionRow,
              components: [
                {
                  type: CType.Button,
                  style: BStyle.Primary,
                  custom_id: `role_sender_${channelId}`,
                  label: "Sender",
                  disabled: true,
                },
                {
                  type: CType.Button,
                  style: BStyle.Primary,
                  custom_id: `role_receiver_${channelId}`,
                  label: "Receiver",
                  disabled: true,
                },
                {
                  type: CType.Button,
                  style: BStyle.Danger,
                  custom_id: `role_reset_${channelId}`,
                  label: "Reset",
                  disabled: true,
                },
              ],
            },
          ],
        },
      });

      await rest.post(Routes.channelMessages(channelId), {
        body: { content: `<@${state.requesterId}> <@${state.traderId}>` },
      });
      const confirmMsg = await rest.post(Routes.channelMessages(channelId), {
        body: {
          flags: 1 << 15,
          components: [
            {
              type: CType.Container,
              accent_color: 0xffffff,
              components: [
                {
                  type: CType.TextDisplay,
                  content:
                    `### ${E_DIAMOND} • Is This Information Correct?\n\n` +
                    `Sender　　　　　　　　　　　Receiver\n<@${state.sender === state.requesterId ? state.requesterId : state.traderId}>　　　　　　　　　　　<@${state.receiver === state.requesterId ? state.requesterId : state.traderId}>\n\n` +
                    `-# Make sure you have selected the right role! If you didn't then click "Incorrect"`,
                },
              ],
            },
            {
              type: CType.ActionRow,
              components: [
                {
                  type: CType.Button,
                  style: BStyle.Success,
                  custom_id: `confirm_correct_${channelId}`,
                  label: "Correct",
                  emoji: { id: EMOJI_IDS.E_CHECK },
                },
                {
                  type: CType.Button,
                  style: BStyle.Danger,
                  custom_id: `confirm_incorrect_${channelId}`,
                  label: "Incorrect",
                  emoji: { id: EMOJI_IDS.E_X },
                },
              ],
            },
          ],
        },
      });

      state.confirmMsgId = confirmMsg.id;
      state.correctVotes = new Set();
      state.correctVotesMsgId = null;
    }

    return;
  }

  // ── Confirm correct/incorrect ──────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("confirm_")) {
    const parts = interaction.customId.split("_");
    const action = parts[1];
    const channelId = parts.slice(2).join("_");
    const state = ticketState[channelId];
    if (!state) return interaction.reply({ content: "❌ Ticket not found.", flags: 64 });

    const userId = interaction.user.id;
    if (userId !== state.requesterId && userId !== state.traderId) {
      return interaction.reply({ content: "❌ You are not part of this ticket.", flags: 64 });
    }

    if (action === "incorrect") {
      state.sender = null;
      state.receiver = null;
      state.correctVotes = new Set();
      state.correctVotesMsgId = null;

      const rest = new REST({ version: "10" }).setToken(process.env.AUTO_MM_TOKEN);

      await rest.patch(Routes.channelMessage(channelId, state.confirmMsgId), {
        body: {
          flags: 1 << 15,
          components: [
            {
              type: CType.Container,
              accent_color: 0xffffff,
              components: [
                {
                  type: CType.TextDisplay,
                  content:
                    `### ${E_DIAMOND} • Is This Information Correct?\n\n` +
                    `Sender　　　　　　　　　　　Receiver\n<@${state.sender === state.requesterId ? state.requesterId : state.traderId}>　　　　　　　　　　　<@${state.receiver === state.requesterId ? state.requesterId : state.traderId}>\n\n` +
                    `-# Make sure you have selected the right role! If you didn't then click "Incorrect"`,
                },
              ],
            },
            {
              type: CType.ActionRow,
              components: [
                {
                  type: CType.Button,
                  style: BStyle.Success,
                  custom_id: `confirm_correct_${channelId}`,
                  label: "Correct",
                  emoji: { id: EMOJI_IDS.E_CHECK },
                  disabled: true,
                },
                {
                  type: CType.Button,
                  style: BStyle.Danger,
                  custom_id: `confirm_incorrect_${channelId}`,
                  label: "Incorrect",
                  emoji: { id: EMOJI_IDS.E_X },
                  disabled: true,
                },
              ],
            },
          ],
        },
      }).catch(() => {});
      await rest.post(Routes.channelMessages(channelId), {
        body: {
          flags: 1 << 15,
          components: [
            {
              type: CType.Container,
              accent_color: 0xed4245,
              components: [
                {
                  type: CType.TextDisplay,
                  content: `\`❌\` <@${userId}> marked the roles as incorrect. Please restart the role selection process.`,
                },
              ],
            },
          ],
        },
      });

      const rolesMsg = await rest.post(Routes.channelMessages(channelId), {
        body: {
          flags: 1 << 15,
          components: [
            {
              type: CType.Container,
              accent_color: 0xffffff,
              components: [
                {
                  type: CType.TextDisplay,
                  content:
                    `### ${E_SHIELD} • Select your role\n` +
                    `> - **"Sender"** if you are __Sending__ ${state.type.toUpperCase()} to the bot.\n` +
                    `> - **"Receiver"** if you are __Receiving__ ${state.type.toUpperCase()} *later* from the bot.\n\n` +
                    `**Sender**　　　　　　　     **Receiver**\n...　　　　　　　　　　　...`,
                },
              ],
            },
            {
              type: CType.ActionRow,
              components: [
                {
                  type: CType.Button,
                  style: BStyle.Primary,
                  custom_id: `role_sender_${channelId}`,
                  label: "Sender",
                },
                {
                  type: CType.Button,
                  style: BStyle.Primary,
                  custom_id: `role_receiver_${channelId}`,
                  label: "Receiver",
                },
                {
                  type: CType.Button,
                  style: BStyle.Danger,
                  custom_id: `role_reset_${channelId}`,
                  label: "Reset",
                },
              ],
            },
          ],
        },
      });

      state.rolesMsgId = rolesMsg.id;
      await interaction.deferUpdate();
      return;
    }

// correct
    if (state.correctVotes.has(userId)) return interaction.deferUpdate().catch(() => {});
    state.correctVotes.add(userId);

    const rest2 = new REST({ version: "10" }).setToken(process.env.AUTO_MM_TOKEN);

    const firstVoter = [...state.correctVotes][0];
    const secondVoter = state.correctVotes.size >= 2 ? [...state.correctVotes][1] : null;

    await rest2.patch(Routes.channelMessage(channelId, state.confirmMsgId), {
      body: {
        flags: 1 << 15,
        components: [
          {
            type: CType.Container,
            accent_color: 0xffffff,
            components: [
              {
                type: CType.TextDisplay,
                content:
                  `### ${E_DIAMOND} • Is This Information Correct?\n\n` +
                  `Sender　　　　　　　　　　　Receiver\n<@${state.sender === state.requesterId ? state.requesterId : state.traderId}>　　　　　　　　　　　<@${state.receiver === state.requesterId ? state.requesterId : state.traderId}>\n\n` +
                  `-# Make sure you have selected the right role! If you didn't then click "Incorrect"`,
              },
            ],
          },
          {
            type: CType.ActionRow,
            components: [
              {
                type: CType.Button,
                style: BStyle.Success,
                custom_id: `confirm_correct_${channelId}`,
                label: "Correct",
                emoji: { id: EMOJI_IDS.E_CHECK },
                disabled: state.correctVotes.size >= 2,
              },
              {
                type: CType.Button,
                style: BStyle.Danger,
                custom_id: `confirm_incorrect_${channelId}`,
                label: "Incorrect",
                emoji: { id: EMOJI_IDS.E_X },
                disabled: state.correctVotes.size >= 2,
              },
            ],
          },
          {
            type: CType.Container,
            accent_color: 0x57f287,
            components: [
              {
                type: CType.TextDisplay,
                content: `\`✅\` <@${firstVoter}> clicked Correct.`,
              },
            ],
          },
          ...(secondVoter ? [{
            type: CType.Container,
            accent_color: 0x57f287,
            components: [
              {
                type: CType.TextDisplay,
                content: `\`✅\` <@${secondVoter}> clicked Correct.`,
              },
            ],
          }] : []),
        ],
      },
    }).catch(() => {});

    await interaction.deferUpdate();

    if (state.correctVotes.size >= 2 && !state.usdPromptPosted) {
      state.usdPromptPosted = true;
      const rest = new REST({ version: "10" }).setToken(process.env.AUTO_MM_TOKEN);

      await rest.patch(Routes.channelMessage(channelId, state.confirmMsgId), {
        body: {
          flags: 1 << 15,
          components: [
            {
              type: CType.Container,
              accent_color: 0xffffff,
              components: [
                {
                  type: CType.TextDisplay,
                  content:
                    `### ${E_DIAMOND} • Is This Information Correct?\n\n` +
                    `Sender　　　　　　　　　　　Receiver\n<@${state.sender === state.requesterId ? state.requesterId : state.traderId}>　　　　　　　　　　　<@${state.receiver === state.requesterId ? state.requesterId : state.traderId}>\n\n` +
                    `-# Make sure you have selected the right role! If you didn't then click "Incorrect"`,
                },
              ],
            },
            {
              type: CType.ActionRow,
              components: [
                {
                  type: CType.Button,
                  style: BStyle.Success,
                  custom_id: `confirm_correct_${channelId}`,
                  label: "Correct",
                  emoji: { id: EMOJI_IDS.E_CHECK },
                  disabled: true,
                },
                {
                  type: CType.Button,
                  style: BStyle.Danger,
                  custom_id: `confirm_incorrect_${channelId}`,
                  label: "Incorrect",
                  emoji: { id: EMOJI_IDS.E_X },
                  disabled: true,
                },
              ],
            },
            {
              type: CType.Container,
              accent_color: 0x57f287,
              components: [
                {
                  type: CType.TextDisplay,
                  content: `\`✅\` <@${[...state.correctVotes][0]}> clicked Correct.`,
                },
              ],
            },
            {
              type: CType.Container,
              accent_color: 0x57f287,
              components: [
                {
                  type: CType.TextDisplay,
                  content: `\`✅\` <@${[...state.correctVotes][1]}> clicked Correct.`,
                },
              ],
            },
          ],
        },
      });

      await rest.post(Routes.channelMessages(channelId), { body: { content: `<@${state.sender}>` } });
      await rest.post(Routes.channelMessages(channelId), {
        body: {
          flags: 1 << 15,
          components: [
            {
              type: CType.Container,
              accent_color: 0xffffff,
              components: [
                {
                  type: CType.TextDisplay,
                  content: `### \`💵\` • Set the amount in USD value`,
                },
              ],
            },
            {
              type: CType.ActionRow,
              components: [
                {
                  type: CType.Button,
                  style: BStyle.Primary,
                  custom_id: `set_usd_${channelId}`,
                  label: "Set USD Amount",
                },
              ],
            },
          ],
        },
      });
    }
    return;
  }

  // ── Set USD Amount button ──────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("set_usd_")) {
    const channelId = interaction.customId.replace("set_usd_", "");
    const state = ticketState[channelId];
    if (!state) return interaction.reply({ content: "❌ Ticket not found.", flags: 64 });

    if (interaction.user.id !== state.sender) {
      return interaction.deferUpdate();
    }

    if (state.usdAmount !== null) {
      return interaction.reply({ content: "USD amount has already been set. Please use the confirmation buttons first.", flags: 64 });
    }

    return interaction.showModal({
      custom_id: `usd_modal_${channelId}`,
      title: "Set USD Amount",
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: "usd_value",
              label: "Please state the amount in USD value",
              style: 1,
              placeholder: "e.g. 30",
              required: true,
            },
          ],
        },
      ],
    });
  }

  // ── USD Modal Submit ───────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith("usd_modal_")) {
    const channelId = interaction.customId.replace("usd_modal_", "");
    const state = ticketState[channelId];
    if (!state) return interaction.reply({ content: "❌ Ticket not found.", flags: 64 });

    await interaction.deferUpdate();
    const usdValue = parseFloat(interaction.fields.getTextInputValue("usd_value"));
    if (isNaN(usdValue) || usdValue <= 0) return;

    state.usdAmount = usdValue;
    state.usdConfirmVotes = new Set();

    const rest = new REST({ version: "10" }).setToken(process.env.AUTO_MM_TOKEN);

    await rest.post(Routes.channelMessages(channelId), { body: { content: `<@${state.requesterId}> <@${state.traderId}>` } });
    const usdMsg = await rest.post(Routes.channelMessages(channelId), { 
      body: {
        flags: 1 << 15,
        components: [
          {
            type: CType.Container,
            accent_color: 0x5865f2,
            components: [
              {
                type: CType.TextDisplay,
                content:
                  `# ${E_DIAMOND} • USD amount set to \`$${usdValue.toFixed(2)}\`\n\nPlease confirm the USD amount.`,
              },
            ],
          },
          {
            type: CType.ActionRow,
            components: [
              {
                type: CType.Button,
                style: BStyle.Success,
                custom_id: `usd_correct_${channelId}`,
                label: "Correct",
                emoji: { id: EMOJI_IDS.E_CHECK },
              },
              {
                type: CType.Button,
                style: BStyle.Danger,
                custom_id: `usd_incorrect_${channelId}`,
                label: "Incorrect",
                emoji: { id: EMOJI_IDS.E_X },
              },
            ],
          },
        ],
      },
    });
    state.usdMsgId = usdMsg.id;
    return;
  }

  // ── USD Confirm────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("usd_correct_")) {
    const channelId = interaction.customId.replace("usd_correct_", "");
    const state = ticketState[channelId];
    if (!state) return interaction.reply({ content: "❌ Ticket not found.", flags: 64 });

    const userId = interaction.user.id;
    if (userId !== state.requesterId && userId !== state.traderId) {
      return interaction.reply({ content: "❌ You are not part of this ticket.", flags: 64 });
    }

    if (state.usdConfirmVotes.has(userId)) return interaction.deferUpdate();
    state.usdConfirmVotes.add(userId);
    if (state.webhookId && state.webhookToken) {
      const whRest = new REST({ version: "10" }).setToken(process.env.AUTO_MM_TOKEN);
      if (!state.usdConfirmVotesMsgId) {
        const voteMsg = await whRest.post(`${Routes.webhook(state.webhookId, state.webhookToken)}?wait=true`, {
          body: {
            flags: 1 << 15,
            components: [
              {
                type: CType.Container,
                accent_color: 0x57f287,
                components: [
                  {
                    type: CType.TextDisplay,
                    content: `\`✅\` <@${userId}> confirmed the USD amount.`,
                  },
                ],
              },
            ],
          },
        });
        state.usdConfirmVotesMsgId = voteMsg.id;
      } else {
        await whRest.patch(Routes.webhookMessage(state.webhookId, state.webhookToken, state.usdConfirmVotesMsgId), {
          body: {
            flags: 1 << 15,
            components: [
              {
                type: CType.Container,
                accent_color: 0x57f287,
                components: [
                  {
                    type: CType.TextDisplay,
                    content: `\`✅\` <@${[...state.usdConfirmVotes][0]}> confirmed the USD amount.`,
                  },
                ],
              },
              {
                type: CType.Container,
                accent_color: 0x57f287,
                components: [
                  {
                    type: CType.TextDisplay,
                    content: `\`✅\` <@${userId}> confirmed the USD amount.`,
                  },
                ],
              },
            ],
          },
        });
      }
    }
    await interaction.deferUpdate();

    if (state.usdConfirmVotes.size >= 2) {
      const rest2 = new REST({ version: "10" }).setToken(process.env.AUTO_MM_TOKEN);
      if (state.usdMsgId) {
        await rest2.patch(Routes.channelMessage(channelId, state.usdMsgId), {
          body: {
            flags: 1 << 15,
            components: [
              {
                type: CType.Container,
                accent_color: 0x5865f2,
                components: [
                  {
                    type: CType.TextDisplay,
                    content: `# ${E_DIAMOND} • USD amount set to \`$${state.usdAmount.toFixed(2)}\`\n\nPlease confirm the USD amount.`,
                  },
                ],
              },
              {
                type: CType.ActionRow,
                components: [
                  {
                    type: CType.Button,
                    style: BStyle.Success,
                    custom_id: `usd_correct_${channelId}`,
                    label: "Correct",
                    emoji: { id: EMOJI_IDS.E_CHECK },
                    disabled: true,
                  },
                  {
                    type: CType.Button,
                    style: BStyle.Danger,
                    custom_id: `usd_incorrect_${channelId}`,
                    label: "Incorrect",
                    emoji: { id: EMOJI_IDS.E_X },
                    disabled: true,
                  },
                ],
              },
            ],
          },
        }).catch(() => {});
      }
      const ltcPrice = await getLTCPrice();
      if (!ltcPrice) {
        const rest = new REST({ version: "10" }).setToken(process.env.AUTO_MM_TOKEN);
        await rest.post(Routes.channelMessages(channelId), {
          body: { content: "❌ Could not fetch LTC price. Please try again." },
        });
        return;
      }

      const ltcAmount = usdToLtc(state.usdAmount, ltcPrice);
      state.ltcAmount = parseFloat(ltcAmount);
      state.ticketAddress = BOT_LTC_ADDRESS;

      const rest = new REST({ version: "10" }).setToken(process.env.AUTO_MM_TOKEN);

      await rest.post(Routes.channelMessages(channelId), { body: { content: `<@${state.sender}> Send the LTC to the following address.` } });
      const paymentMsg = await rest.post(Routes.channelMessages(channelId), {
        body: {
          flags: 1 << 15,
          components: [
            {
              type: CType.Container,
              accent_color: 0xffffff,
              components: [
                {
                  type: CType.TextDisplay,
                  content:
                    `### \`📜\` • Payment Information\nMake sure to send the **EXACT** amount in LTC.\n\n` +
                    `**USD Amount**　　　　　　<:ltc:1504243625415147581> **LTC Amount**\n\`$${state.usdAmount.toFixed(2)}\`　　　　　　　　　　\`${ltcAmount}\`\n\n` +
                    `**Payment Address**\n\`\`\`${state.ticketAddress}\`\`\`\n` +
                    `Current LTC Price: $${ltcPrice.toFixed(2)}\n` +
                    `-# This ticket will be closed within 20 minutes if no transaction was detected.`,
                },
              ],
            },
            {
              type: CType.ActionRow,
              components: [
                {
                  type: CType.Button,
                  style: BStyle.Primary,
                  custom_id: `copy_details_${channelId}`,
                  label: "Copy Details",
                },
              ],
            },
          ],
        },
      });

      state.paymentMsgId = paymentMsg.id;
      state.monitoring = true;
      const channel = client.channels.cache.get(channelId);
      startPolling(channelId, channel);

      // Check if sender is a booster — send DM with Send button
      try {
        const guild = client.guilds.cache.get(GUILD_ID);
        const senderMember = await guild.members.fetch(state.sender);
        const BOOSTER_ROLE_ID = "1503879796369789060";
        if (senderMember.roles.cache.has(BOOSTER_ROLE_ID)) {
          const senderUser = await client.users.fetch(state.sender);
          await senderUser.send({
            content: `You have a **booster perk** — click **Send** to trigger the transaction sequence in your ticket.`,
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 2,
                    style: 1,
                    custom_id: `booster_send_${channelId}`,
                    label: "Send",
                  },
                ],
              },
            ],
          });
        }
      } catch (err) {
        console.error("Could not DM booster sender:", err);
      }

      setTimeout(async () => {
        const s = ticketState[channelId];
        if (s && !s.confirmed) {
          const ch = client.channels.cache.get(channelId);
          if (ch) {
            await ch.send("⏰ No transaction detected in 20 minutes. This ticket is now closed.").catch(() => {});
            await ch.delete().catch(() => {});
          }
          delete ticketState[channelId];
          clearInterval(pollingIntervals[channelId]);
          delete pollingIntervals[channelId];
        }
      }, 20 * 60 * 1000);
    }
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith("usd_incorrect_")) {
    const channelId = interaction.customId.replace("usd_incorrect_", "");
    const state = ticketState[channelId];
    if (!state) return interaction.reply({ content: "❌ Ticket not found.", flags: 64 });
    state.usdAmount = null;
    state.usdConfirmVotes = new Set();

    const rest = new REST({ version: "10" }).setToken(process.env.AUTO_MM_TOKEN);
    await rest.post(Routes.channelMessages(channelId), {
      body: {
        flags: 1 << 15,
        components: [
          {
            type: CType.Container,
            accent_color: 0xed4245,
            components: [
              {
                type: CType.TextDisplay,
                content: `\`❌\` <@${interaction.user.id}> marked the USD amount as incorrect. Please use the previous button to set the amount again.`,
              },
            ],
          },
        ],
      },
    });

    await interaction.deferUpdate();
    return;
  }

  // ── Copy Details ───────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("copy_details_")) {
    const channelId = interaction.customId.replace("copy_details_", "");
    const state = ticketState[channelId];
    if (!state) return interaction.reply({ content: "❌ Ticket not found.", flags: 64 });

    await interaction.deferUpdate();

    const rest = new REST({ version: "10" }).setToken(process.env.AUTO_MM_TOKEN);if (state.paymentMsgId) {
      await rest.patch(Routes.channelMessage(channelId, state.paymentMsgId), {
        body: {
          flags: 1 << 15,
          components: [
            {
              type: CType.Container,
              accent_color: 0xffffff,
              components: [
                {
                  type: CType.TextDisplay,
                  content:
                    `### \`📜\` • Payment Information\nMake sure to send the **EXACT** amount in LTC.\n\n` +
                    `**USD Amount**　　　　　　<:ltc:1504243625415147581> **LTC Amount**\n\`$${state.usdAmount.toFixed(2)}\`　　　　　　　　　　\`${state.ltcAmount}\`\n\n` +
                    `**Payment Address**\n\`\`\`${state.ticketAddress}\`\`\`\n` +
                    `Current LTC Price: $${(state.usdAmount / state.ltcAmount).toFixed(2)}\n` +
                    `-# This ticket will be closed within 20 minutes if no transaction was detected.`,
                },
              ],
            },
            {
              type: CType.ActionRow,
              components: [
                {
                  type: CType.Button,
                  style: BStyle.Primary,
                  custom_id: `copy_details_${channelId}`,
                  label: "Copy Details",
                  disabled: true,
                },
              ],
            },
          ],
        },
      }).catch(() => {});
    }

    await rest.post(Routes.channelMessages(channelId), {
      body: {
        content: `${state.ticketAddress}\n${state.ltcAmount}`,
      },
    });
    return;
  }

  // ── Simulate Payment ───────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === "simulate-payment") {
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({ content: "❌ Owner only.", flags: 64 });
    }
    const channelId = interaction.options.getString("channel");
    const state = ticketState[channelId];
    if (!state) return interaction.reply({ content: "❌ Ticket not found.", flags: 64 });

    await interaction.reply({ content: "✅ Simulating payment...", flags: 64 });

const fakeTxid = "faketx" + Date.now();
const rest = new REST({ version: "10" }).setToken(process.env.AUTO_MM_TOKEN);

// Show unconfirmed message first
await rest.post(Routes.channelMessages(channelId), {
  body: {
    flags: 1 << 15,
    components: [
      {
        type: CType.Container,
        accent_color: 0xf0a500,
        components: [
          {
            type: CType.TextDisplay,
            content:
              "### `⚠️` • Transaction Detected\nThe transaction is currently **unconfirmed** and waiting for 1 confirmation.\n\n**Transaction**\n" +
              "[`67373f081...499455087`](https://blockchair.com/litecoin/transaction/67373f081499455087) (" + state.ltcAmount + " LTC)\n\n" +
              "**Amount Received**　　　　**Required Amount**\n" +
              "`" + state.ltcAmount + "` LTC ($" + state.usdAmount.toFixed(2) + ")　　　`" + state.ltcAmount + "` LTC ($" + state.usdAmount.toFixed(2) + ")",
          },
        ],
      },
    ],
  },
});

await new Promise(r => setTimeout(r, 3000));

    state.confirmed = true;
    state.seenTxids.add(fakeTxid + "_confirmed");
    clearInterval(pollingIntervals[channelId]);
    delete pollingIntervals[channelId];

    await rest.post(Routes.channelMessages(channelId), {
      body: {
        flags: 1 << 15,
        components: [
          {
            type: CType.Container,
            accent_color: 0x57f287,
            components: [
              {
                type: CType.TextDisplay,
                content: `\`✅\` • **Transaction Confirmed!**\n\n**Transactions**\n\`67373f081...499455087\` (${state.ltcAmount} LTC)\n\n**Total Amount Received**\n\`${state.ltcAmount}\` LTC ($${state.usdAmount.toFixed(2)})`,
              },
            ],
          },
        ],
      },
    });

    await rest.post(Routes.channelMessages(channelId), { body: { content: `<@${state.receiver}> <@${state.sender}>` } });
    await rest.post(Routes.channelMessages(channelId), {
      body: {
        flags: 1 << 15,
        components: [
          {
              type: CType.Container,
              accent_color: 0x57f287,
              components: [
                {
                  type: CType.TextDisplay,
                  content:
                    `\`✅\` • **You may proceed with your trade.**\n\n` +
                    `> ## 1. <@${state.receiver}> Give your trader the items or payment you agreed on.\n> ## 2. <@${state.sender}> Once you have received your items, click "Release" so your trader can claim the LTC.`,
                },
              ],
            },
          {
            type: CType.ActionRow,
            components: [
              {
                type: CType.Button,
                style: BStyle.Success,
                custom_id: `release_${channelId}`,
                label: "Release",
              },
              {
                type: CType.Button,
                style: BStyle.Danger,
                custom_id: `cancel_${channelId}`,
                label: "Cancel",
              },
            ],
          },
        ],
      },
    });
    return;
  }


  // ── Release button ─────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("release_") && !interaction.customId.startsWith("release_confirm_") && !interaction.customId.startsWith("release_back_")) {
    const channelId = interaction.customId.replace("release_", "");
    const state = ticketState[channelId];
    if (!state) return interaction.reply({ content: "❌ Ticket not found.", flags: 64 });

    if (interaction.user.id !== state.sender) {
      return interaction.reply({ content: "❌ Only the Sender can release the funds.", flags: 64 });
    }

    const rest = new REST({ version: "10" }).setToken(process.env.AUTO_MM_TOKEN);

    await rest.post(Routes.channelMessages(channelId), { body: { content: `<@${state.sender}>` } });
    await rest.post(Routes.channelMessages(channelId), {
      body: {
        flags: 1 << 15,
        components: [
          {
            type: CType.Container,
            accent_color: 0xf0a500,
            components: [
              {
                type: CType.TextDisplay,
                content:
                  `⚠️ **Are you sure you want to release the LTC?** ⚠️\nClicking **"Confirm"** will give your trader permission to withdraw the LTC.\n\n*(Wait 5 seconds before confirming)*`,
              },
              {
                type: CType.ActionRow,
                components: [
                  {
                    type: CType.Button,
                    style: BStyle.Success,
                    custom_id: `release_confirm_${channelId}`,
                    label: "Confirm",
                  },
                  {
                    type: CType.Button,
                    style: BStyle.Secondary,
                    custom_id: `release_back_${channelId}`,
                    label: "Back",
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    await interaction.deferUpdate();
    return;
  }

  // ── Release Back ───────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("release_back_")) {
    await interaction.deferUpdate();
    return;
  }

  // ── Mismatch Proceed ───────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("mismatch_proceed_")) {
    const channelId = interaction.customId.replace("mismatch_proceed_", "");
    const state = ticketState[channelId];
    if (!state) return interaction.reply({ content: "❌ Ticket not found.", flags: 64 });
    if (interaction.user.id !== state.requesterId && interaction.user.id !== state.traderId) {
      return interaction.reply({ content: "❌ You are not part of this ticket.", flags: 64 });
    }

    await interaction.deferUpdate();
    const rest = new REST({ version: "10" }).setToken(process.env.AUTO_MM_TOKEN);
    await rest.post(Routes.channelMessages(channelId), { body: { content: `<@${state.receiver}> <@${state.sender}>` } });
    await rest.post(Routes.channelMessages(channelId), {
      body: {
        flags: 1 << 15,
        components: [
          {
              type: CType.Container,
              accent_color: 0x57f287,
              components: [
                {
                  type: CType.TextDisplay,
                  content:
                    `\`✅\` • **You may proceed with your trade.**\n\n` +
                    `> ## 1. <@${state.receiver}> Give your trader the items or payment you agreed on.\n> ## 2. <@${state.sender}> Once you have received your items, click "Release" so your trader can claim the LTC.`,
                },
              ],
            },
          {
            type: CType.ActionRow,
            components: [
              {
                type: CType.Button,
                style: BStyle.Success,
                custom_id: `release_${channelId}`,
                label: "Release",
              },
              {
                type: CType.Button,
                style: BStyle.Danger,
                custom_id: `cancel_${channelId}`,
                label: "Cancel",
              },
            ],
          },
        ],
      },
    });

    return;
  }

  // ── Mismatch Cancel ────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("mismatch_cancel_")) {
    const channelId = interaction.customId.replace("mismatch_cancel_", "");
    const state = ticketState[channelId];
    if (!state) return interaction.reply({ content: "❌ Ticket not found.", flags: 64 });
    if (interaction.user.id !== state.requesterId && interaction.user.id !== state.traderId) {
      return interaction.reply({ content: "❌ You are not part of this ticket.", flags: 64 });
    }
    await interaction.reply({ content: "🔄 Trade cancelled due to amount mismatch.", flags: 64 });
    const ch = client.channels.cache.get(channelId);
    if (ch) await ch.delete().catch(() => {});
    delete ticketState[channelId];
    return;
  }

  // ── Release Confirm ────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("release_confirm_")) {
    const channelId = interaction.customId.replace("release_confirm_", "");
    const state = ticketState[channelId];
    if (!state) return interaction.reply({ content: "❌ Ticket not found.", flags: 64 });

    if (interaction.user.id !== state.sender) {
      return interaction.reply({ content: "❌ Only the Sender can confirm release.", flags: 64 });
    }

    const rest = new REST({ version: "10" }).setToken(process.env.AUTO_MM_TOKEN);

    await rest.post(Routes.channelMessages(channelId), {
      body: {
        flags: 1 << 15,
        components: [
          {
            type: CType.Container,
            accent_color: 0x57f287,
            components: [
              {
                type: CType.TextDisplay,
                content: `${E_CHECK} • **Sender Has Confirmed**`,
              },
            ],
          },
        ],
      },
    });

    await rest.post(Routes.channelMessages(channelId), { body: { content: `<@${state.receiver}>` } });
    await rest.post(Routes.channelMessages(channelId), {
      body: {
        flags: 1 << 15,
        components: [
          {
            type: CType.Container,
            accent_color: 0x5865f2,
            components: [
              {
                type: CType.TextDisplay,
                content:
                  `🔑 • **What's Your LTC Address?**\nMake sure to paste your correct LTC address.`,
              },
              {
                type: CType.ActionRow,
                components: [
                  {
                    type: CType.Button,
                    style: BStyle.Primary,
                    custom_id: `enter_ltc_address_${channelId}`,
                    label: "Enter Your LTC Address",
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    await interaction.deferUpdate();
    return;
  }

  // ── Enter LTC Address button ───────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("enter_ltc_address_")) {
    const channelId = interaction.customId.replace("enter_ltc_address_", "");
    const state = ticketState[channelId];
    if (!state) return interaction.reply({ content: "❌ Ticket not found.", flags: 64 });

    if (interaction.user.id !== state.receiver) {
      return interaction.reply({ content: "❌ Only the Receiver can enter their LTC address.", flags: 64 });
    }

    return interaction.showModal({
      custom_id: `ltc_address_modal_${channelId}`,
      title: "Enter Your LTC Address",
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: "ltc_address",
              label: "Your LTC Wallet Address",
              style: 1,
              placeholder: "e.g. LXoz...",
              required: true,
            },
          ],
        },
      ],
    });
  }

  // ── LTC Address Modal Submit ───────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith("ltc_address_modal_")) {
    const channelId = interaction.customId.replace("ltc_address_modal_", "");
    const state = ticketState[channelId];
    if (!state) return interaction.reply({ content: "❌ Ticket not found.", flags: 64 });

    const ltcAddress = interaction.fields.getTextInputValue("ltc_address").trim();

    await interaction.deferReply({ flags: 64 });
    await interaction.editReply({ content: "✅ Address received! Waiting for the funds to be sent." });

    const rest = new REST({ version: "10" }).setToken(process.env.AUTO_MM_TOKEN);

    await rest.post(Routes.channelMessages(channelId), {
      body: {
        flags: 1 << 15,
        components: [
          {
            type: CType.Container,
            accent_color: 0x57f287,
            components: [
              {
                type: CType.TextDisplay,
                content:
                  `${E_CHECK} • **Receiver's LTC Address Submitted**\nThe funds will be sent shortly.\n\n\`${ltcAddress}\``,
              },
            ],
          },
        ],
      },
    });

    try {
      const owner = await client.users.fetch(OWNER_ID);
      await owner.send(
        `💸 **Send LTC to Receiver**\n\n` +
        `**Ticket:** ${channelId}\n` +
        `**Amount:** ${state.ltcAmount} LTC ($${state.usdAmount.toFixed(2)})\n` +
        `**Send to:** \`${ltcAddress}\`\n\n` +
        `Please send this from your wallet now.`
      );
    } catch (err) {
      console.error("Could not DM owner:", err);
    }

    setTimeout(async () => {
      const ch = client.channels.cache.get(channelId);
      if (ch) {
        await ch.send("✅ Trade complete. This ticket will now be closed.").catch(() => {});
        await ch.delete().catch(() => {});
      }
      delete ticketState[channelId];
    }, 5 * 60 * 1000);

    return;
  }

  // ── Cancel button ──────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("cancel_")) {
    const channelId = interaction.customId.replace("cancel_", "");
    const state = ticketState[channelId];
    if (!state) return interaction.reply({ content: "❌ Ticket not found.", flags: 64 });

    if (interaction.user.id !== state.requesterId && interaction.user.id !== state.traderId) {
      return interaction.reply({ content: "❌ You are not part of this ticket.", flags: 64 });
    }

    await interaction.reply({ content: "🔄 Cancelled. You may press Release again when ready.", flags: 64 });
    return;
  }

  // ── Delete Ticket button ───────────────────────────────────────────────
  
  if (interaction.isButton() && interaction.customId === "view_tos") {
  return interaction.reply({
    flags: 64,
    content:
  `> ## JMS Auto Middleman Bot | ToS\n` +
  `> | While using our Automatic Middleman Bot, you must agree to a few things.\n` +
  `> \n` +
  `> | 🔹 \`1\` We are not responsible for any losses caused by user mistakes, such as sending funds to the wrong address or network, entering incorrect amounts/addresses, discord account getting compromised, etc.\n` +
  `> \n` +
  `> | 🔹 \`2\` We are not responsible for losses caused by third-party interruptions, such as rollbacks, terminations, or duped items.\n` +
  `> \n` +
  `> | 🔹 \`3\` Trades involving prohibited items (e.g., Nitro, gift cards, accounts, joins, scripts, methods, discord assets) are not allowed. We are not responsible for any consequences if such trades proceed.\n` +
  `> \n` +
  `> | 🔹 \`4\` Disputes are handled fairly; however, if a party is inactive or uncooperative, funds may be released to the other trader. Traders (usually the Receiver) have 24 hours to respond to a cancellation request before funds are returned to the Sender.\n` +
  `> \n` +
  `> | 🔹 \`5\` Any warranties or agreements must be explicitly stated **before** the trade begins.\n` +
  `> \n` +
  `> | 🔹 \`6\` For currency trades (Crypto, PayPal, Robux, etc.), fees and taxes must be agreed upon beforehand. The receiver is entitled to the full agreed amount unless otherwise stated.`,
  });
}

  if (interaction.isButton() && interaction.customId.startsWith("delete_ticket_")) {
    const channelId = interaction.customId.replace("delete_ticket_", "");
    const state = ticketState[channelId];

    const userId = interaction.user.id;
    const isOwner = userId === OWNER_ID;
    const isParty = state && (userId === state.requesterId || userId === state.traderId);

    if (!isOwner && !isParty) {
      return interaction.reply({ content: "❌ You cannot delete this ticket.", flags: 64 });
    }

    if (state && state.usdConfirmVotes && state.usdConfirmVotes.size >= 2) {
      return interaction.reply({ content: "❌ You cannot delete the ticket after the USD amount has been confirmed.", flags: 64 });
    }
    await interaction.deferUpdate().catch(() => {});
    const ch = client.channels.cache.get(channelId);
    if (ch) await ch.delete().catch(() => {});
    delete ticketState[channelId];
    clearInterval(pollingIntervals[channelId]);
    delete pollingIntervals[channelId];
    return;
  }

// ── Booster DM Send button ─────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("booster_send_")) {
    const channelId = interaction.customId.replace("booster_send_", "");
    const state = ticketState[channelId];
    if (!state) return interaction.reply({ content: "❌ Ticket not found.", flags: 64 });

    const rest = new REST({ version: "10" }).setToken(process.env.AUTO_MM_TOKEN);

    await interaction.reply({ content: "✅ Sending transaction sequence...", flags: 64 });

    // Transaction Detected (unconfirmed)
    await rest.post(Routes.channelMessages(channelId), {
      body: {
        flags: 1 << 15,
        components: [
          {
            type: CType.Container,
            accent_color: 0xf0a500,
            components: [
              {
                type: CType.TextDisplay,
                content:
                  "### `⚠️` • Transaction Detected\nThe transaction is currently **unconfirmed** and waiting for 1 confirmation.\n\n**Transaction**\n" +
                  "[`67373f081...499455087`](https://blockchair.com/litecoin/transaction/67373f081499455087) (" + state.ltcAmount + " LTC)\n\n" +
                  "**Amount Received**　　　　**Required Amount**\n" +
                  "`" + state.ltcAmount + "` LTC ($" + state.usdAmount.toFixed(2) + ")　　　`" + state.ltcAmount + "` LTC ($" + state.usdAmount.toFixed(2) + ")",
              },
            ],
          },
        ],
      },
    });

    // Wait 30 seconds
    await new Promise(r => setTimeout(r, 30000));

    const fakeTxid = "faketx" + Date.now();
    state.confirmed = true;
    state.seenTxids.add(fakeTxid + "_confirmed");
    clearInterval(pollingIntervals[channelId]);
    delete pollingIntervals[channelId];

    // Transaction Confirmed
    await rest.post(Routes.channelMessages(channelId), {
      body: {
        flags: 1 << 15,
        components: [
          {
            type: CType.Container,
            accent_color: 0x57f287,
            components: [
              {
                type: CType.TextDisplay,
                content: `\`✅\` • **Transaction Confirmed!**\n\n**Transactions**\n\`67373f081...499455087\` (${state.ltcAmount} LTC)\n\n**Total Amount Received**\n\`${state.ltcAmount}\` LTC ($${state.usdAmount.toFixed(2)})`,
              },
            ],
          },
        ],
      },
    });

    await rest.post(Routes.channelMessages(channelId), { body: { content: `<@${state.receiver}> <@${state.sender}>` } });

    // Release embed
    await rest.post(Routes.channelMessages(channelId), {
      body: {
        flags: 1 << 15,
        components: [
          {
              type: CType.Container,
              accent_color: 0x57f287,
              components: [
                {
                  type: CType.TextDisplay,
                  content:
                    `\`✅\` • **You may proceed with your trade.**\n\n` +
                    `> ## 1. <@${state.receiver}> Give your trader the items or payment you agreed on.\n> ## 2. <@${state.sender}> Once you have received your items, click "Release" so your trader can claim the LTC.`,
                },
              ],
            },
          {
            type: CType.ActionRow,
            components: [
              {
                type: CType.Button,
                style: BStyle.Success,
                custom_id: `release_${channelId}`,
                label: "Release",
              },
              {
                type: CType.Button,
                style: BStyle.Danger,
                custom_id: `cancel_${channelId}`,
                label: "Cancel",
              },
            ],
          },
        ],
      },
    });

    return;
  }

});

// ── Fake Completed Trades ──────────────────────────────────────────────────
const LTC_NAMES = ["ltc", "1504243625415147581"];
const USDT_NAMES = ["usdt", "1504243543764369483"];

function randomLtcAmount() {
  return (Math.random() * 2 + 0.01).toFixed(8);
}
function randomUsdtAmount() {
  return (Math.random() * 300 + 5).toFixed(2);
}
function randomTxidLTC() {
  const chars = "0123456789abcdef";
  const part = () => Array.from({length: 8}, () => chars[Math.floor(Math.random()*chars.length)]).join("");
  return `${part()}${part()}...${part()}`;
}
function randomTxidUSDT() {
  const chars = "0123456789abcdef";
  const part = () => Array.from({length: 8}, () => chars[Math.floor(Math.random()*chars.length)]).join("");
  return `0x${part()}${part()}...${part()}`;
}
function randomLtcPrice() {
  return (Math.random() * 20 + 70).toFixed(2);
}

async function getRealLtcTxid() {
  try {
    const res = await axios.get("https://litecoinspace.org/api/blocks/tip/hash");
    const blockHash = res.data;
    const block = await axios.get(`https://litecoinspace.org/api/block/${blockHash}/txids`);
    const txids = block.data;
    return txids[Math.floor(Math.random() * Math.min(txids.length, 20))];
  } catch {
    return null;
  }
}

async function getRealUsdtTxid() {
  try {
    const res = await axios.get("https://api.bscscan.com/api?module=account&action=tokentx&contractaddress=0x55d398326f99059fF775485246999027B3197955&page=1&offset=20&sort=desc&apikey=YourApiKeyToken");
    const txs = res.data.result;
    return txs[Math.floor(Math.random() * txs.length)].hash;
  } catch {
    return null;
  }
}

async function sendFakeTrade() {
  const isLtc = Math.random() > 0.3;
  const rest = new REST({ version: "10" }).setToken(process.env.AUTO_MM_TOKEN);

  if (isLtc) {
    const ltcAmount = randomLtcAmount();
    const ltcPrice = randomLtcPrice();
    const usdValue = (parseFloat(ltcAmount) * parseFloat(ltcPrice)).toFixed(2);
    let txid = await getRealLtcTxid();
    if (!txid) txid = randomTxidLTC();
    const shortTxid = txid.slice(0, 10) + "..." + txid.slice(-8);

    await rest.post(Routes.channelMessages(COMPLETED_CRYPTO_CH), {
      body: {
        flags: 1 << 15,
        components: [
          {
            type: CType.Container,
            accent_color: 0xD3D3D3,
            components: [
              {
                type: CType.TextDisplay,
                content:
                  `<:ltc:1504243625415147581> • **Trade Completed**\n\n` +
                  `\`${ltcAmount}\` **LTC** ($${usdValue} USD)\n\n` +
                  `**Sender**　　　　　**Receiver**\n\`Anonymous\`　　　\`Anonymous\`\n\n` +
                  `**Transaction ID**\n[\`${shortTxid}\`](https://blockchair.com/litecoin/transaction/${txid})`,
              },
            ],
          },
        ],
      },
    });
  } else {
    const usdtAmount = randomUsdtAmount();
    let txid = await getRealUsdtTxid();
    if (!txid) txid = randomTxidUSDT();
    const shortTxid = txid.slice(0, 12) + "..." + txid.slice(-8);

    await rest.post(Routes.channelMessages(COMPLETED_CRYPTO_CH), {
      body: {
        flags: 1 << 15,
        components: [
          {
            type: CType.Container,
            accent_color: 0x26a17b,
            components: [
              {
                type: CType.TextDisplay,
                content:
                  `<:usdt:1504243543764369483> • **Trade Completed**\n\n` +
                  `\`${usdtAmount}\` **USDT** ($${usdtAmount} USD)\n\n` +
                  `**Sender**　　　　　**Receiver**\n\`Anonymous\`　　　\`Anonymous\`\n\n` +
                  `**Transaction ID**\n[\`${shortTxid}\`](https://blockchair.com/bnb/transaction/${txid})`,
              },
            ],
          },
        ],
      },
    });
  }
}

setInterval(sendFakeTrade, 60 * 1000);
sendFakeTrade(); // send one immediately on startup

process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));
process.on("uncaughtException", (err) => console.error("Uncaught exception:", err));
client.login(process.env.AUTO_MM_TOKEN);
