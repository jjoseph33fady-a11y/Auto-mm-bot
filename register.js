require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("switch")
    .setDescription("Switch the server theme")
    .addStringOption((opt) =>
      opt.setName("theme").setDescription("Which theme?").setRequired(true)
        .addChoices(
          { name: "Jace", value: "jace" },
          { name: "Market", value: "market" }
        )
    ),
].map((c) => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
  console.log("✅ Commands registered");
})();