// === Uptime Kuma Discord Bot ===
// Full version with environment variables only
// (no config.json required)

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
require('dotenv').config(); // optional, just in case .env is used locally

// === CONFIG LOADER ===
function loadConfig() {
    let config = {};

    // === Load from Environment Variables ===
    config.token = process.env.DISCORD_TOKEN || null;
    config.clientID = process.env.DISCORD_CLIENT_ID || null;
    config.guildID = process.env.DISCORD_GUILD_ID || null;
    config.channelID = process.env.DISCORD_CHANNEL_ID || null;

    config.updateTime = parseInt(
        process.env.UPDATE_TIME || process.env.UPDATE_INTERVAL_SEC || "60"
    );
    config.embedColor = process.env.EMBED_COLOR || "#0099ff";
    config.uptimeKumaAPIKey = process.env.API_KEY || null;

    config.urls = {
        uptimeKumaBase: process.env.KUMA_URL || "https://uptime.noopnet.net",
        uptimeKumaDashboard: process.env.KUMA_DASHBOARD || "https://uptime.noopnet.net/status/default",
        backend: process.env.BACKEND_URL || "https://uptime-api.uptime.noopnet.net/api",
    };

    // === Debug Info ===
    console.log("Loaded from ENV:");
    console.table({
        DISCORD_TOKEN: config.token ? "✅ set" : "❌ missing",
        DISCORD_GUILD_ID: config.guildID,
        DISCORD_CHANNEL_ID: config.channelID,
        BACKEND_URL: config.urls.backend,
        KUMA_URL: config.urls.uptimeKumaBase,
    });

    // === Static Monitor Groups ===
    config.monitorGroups = {
        Gaming: ["Lobby", "Skyblock", "Survival", "Creative", "KitPvP", "Factions", "Prison", "Skywars"],
        Discord: ["Discord bot", "Status bot"],
        Web: ["web1", "web2", "web3"]
    };

    return config;
}

let config = loadConfig();

// === DISCORD CLIENT SETUP ===
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let monitorMessages = Object.keys(config.monitorGroups).reduce((acc, groupName) => {
    acc[groupName] = null;
    return acc;
}, {});

// === BOT START ===
client.once('ready', async () => {
    console.log(`✅ Bot is online as ${client.user.tag}`);

    try {
        const guild = await client.guilds.fetch(config.guildID);
        if (!guild) throw new Error(`Guild not found: ${config.guildID}`);

        const channel = await guild.channels.fetch(config.channelID);
        if (!channel || !channel.isTextBased()) {
            throw new Error(`Invalid text channel ID: ${config.channelID}`);
        }

        await clearChannel(channel);
        await updateMessages();

        console.log(`🕒 Updating every ${config.updateTime} seconds...`);
        setInterval(updateMessages, config.updateTime * 1000);
    } catch (err) {
        console.error("❌ Setup Error:", err.message);
    }
});

// === UPDATE STATUS MESSAGES ===
async function updateMessages() {
    try {
        console.log("🌐 Fetching monitors from:", config.urls.backend);
        const response = await axios.get(config.urls.backend);
        const monitors = response.data;

        const guild = await client.guilds.fetch(config.guildID);
        const channel = await guild.channels.fetch(config.channelID);

        for (const [groupName, monitorNames] of Object.entries(config.monitorGroups)) {
            const groupMonitors = monitors.filter(m => monitorNames.includes(m.monitor_name));
            await sendMonitorsMessage(channel, groupName, groupMonitors);
        }

    } catch (error) {
        console.error("❌ Error updating monitors:", error.response?.status, error.response?.data || error.message);
    }
}

// === SEND / UPDATE EMBEDS ===
async function sendMonitorsMessage(channel, category, monitors) {
    let description = monitors.map(m => {
        const emoji = ['🔴', '🟢', '🟡', '🔵'][m.status] || '❓';
        return `${emoji} | ${m.monitor_name}`;
    }).join('\n') || 'No monitors found.';

    const embed = new EmbedBuilder()
        .setTitle(`${category} Monitors`)
        .setColor(config.embedColor)
        .setDescription(description)
        .setFooter({ text: `Last updated: ${new Date().toLocaleString()}` })
        .setURL(config.urls.uptimeKumaDashboard);

    try {
        if (monitorMessages[category]) {
            const msg = await channel.messages.fetch(monitorMessages[category]).catch(() => null);
            if (msg) {
                await msg.edit({ embeds: [embed] });
                console.log(`🔁 Updated ${category} message`);
                return;
            }
        }
        const newMsg = await channel.send({ embeds: [embed] });
        monitorMessages[category] = newMsg.id;
        console.log(`🆕 Sent ${category} monitors message`);
    } catch (err) {
        console.error(`❌ Failed to send ${category} message:`, err.message);
    }
}

// === CLEAR CHANNEL ===
async function clearChannel(channel) {
    try {
        const fetched = await channel.messages.fetch();
        await channel.bulkDelete(fetched);
        console.log("🧹 Channel cleared");
    } catch (err) {
        console.error("⚠️ Could not clear channel:", err.message);
    }
}

// === LOGIN ===
client.login(config.token).catch(err => {
    console.error("❌ Discord Login failed:", err.message);
});
