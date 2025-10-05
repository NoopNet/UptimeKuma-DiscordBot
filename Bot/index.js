// === Uptime Kuma Discord Bot ===
// Full production version for Coolify (no config.json required)

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

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
    console.log("Loaded ENV Variables:");
    console.table({
        DISCORD_TOKEN: config.token ? "✅ set" : "❌ missing",
        DISCORD_GUILD_ID: config.guildID || "❌ missing",
        DISCORD_CHANNEL_ID: config.channelID || "❌ missing",
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

// === BOT READY EVENT ===
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

// === MAIN UPDATE FUNCTION ===
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

// === SEND OR UPDATE EMBED MESSAGE ===
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

// === CLEAR CHANNEL ON START ===
async function clearChannel(channel) {
    try {
        const fetched = await channel.messages.fetch();
        await channel.bulkDelete(fetched);
        console.log("🧹 Channel cleared");
    } catch (err) {
        console.error("⚠️ Could not clear channel:", err.message);
    }
}

// === DISCORD LOGIN ===
client.login(config.token).catch(err => {
    console.error("❌ Discord Login failed:", err.message);
});

// === OPTIONAL HEALTH ENDPOINT ===
// Helps Coolify show "Healthy" instead of "Degraded"
const http = require('http');
const port = process.env.HEALTH_PORT || 3000;
http.createServer((req, res) => {
    if (req.url === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
    } else {
        res.writeHead(404);
        res.end();
    }
}).listen(port, () => console.log(`❤️ Health endpoint active on :${port}`));
