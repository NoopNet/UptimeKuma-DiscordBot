function loadConfig() {
    let config = {};

    // === 1️⃣ Load from environment ===
    config.token = process.env.DISCORD_TOKEN || null;
    config.clientID = process.env.DISCORD_CLIENT_ID || null;
    config.guildID = process.env.DISCORD_GUILD_ID || null;
    config.channelID = process.env.DISCORD_CHANNEL_ID || null;
    config.updateTime = parseInt(process.env.UPDATE_TIME || process.env.UPDATE_INTERVAL_SEC || "60");
    config.embedColor = process.env.EMBED_COLOR || "#0099ff";
    config.uptimeKumaAPIKey = process.env.API_KEY || null;

    config.urls = {
        uptimeKumaBase: process.env.KUMA_URL || "https://uptime.noopnet.net",
        uptimeKumaDashboard: process.env.KUMA_DASHBOARD || "https://uptime.noopnet.net/status/default",
        backend: process.env.BACKEND_URL || "https://uptime-api.uptime.noopnet.net/api"
    };

    try {
        const jsonPath = path.join(__dirname, '../config.json');
        if (fs.existsSync(jsonPath)) {
            console.log('Found config.json, merging...');
            const fileConfig = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            config = { ...config, ...fileConfig };
        } else {
            console.log('No config.json found — using only environment variables.');
        }
    } catch (e) {
        console.warn('Could not read config.json, using env only.');
    }

    config.monitorGroups = {
        Gaming: ["Lobby", "Skyblock", "Survival", "Creative", "KitPvP", "Factions", "Prison", "Skywars"],
        Discord: ["Discord bot", "Status bot"],
        Web: ["web1", "web2", "web3"]
    };

    // Debug log to confirm envs loaded:
    console.log("Loaded ENV:", {
        guildID: config.guildID,
        channelID: config.channelID,
        backend: config.urls.backend
    });

    return config;
}


let config = loadConfig();

// Discord client setup
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

client.once('ready', async () => {
    console.log('✅ Bot is online as', client.user.tag);
    const channel = await client.channels.fetch(config.channelID);
    if (channel && channel.isTextBased()) {
        await clearChannel(channel);
    }
    await updateMessages();
    setInterval(updateMessages, config.updateTime * 1000);
});

async function updateMessages() {
    try {
        console.log('Fetching from:', config.urls.backend);
        const response = await axios.get(config.urls.backend);
        const monitors = response.data;

        const guild = await client.guilds.fetch(config.guildID);
        const channel = await guild.channels.fetch(config.channelID);

        for (const [groupName, monitorNames] of Object.entries(config.monitorGroups)) {
            const groupMonitors = monitors.filter(m => monitorNames.includes(m.monitor_name));
            await sendMonitorsMessage(channel, groupName, groupMonitors);
        }
    } catch (error) {
        console.error('❌ Error updating messages:', error.response?.status, error.response?.data || error.message);
    }
}

async function sendMonitorsMessage(channel, category, monitors) {
    let description = monitors.map(m => {
        const emoji = ['🔴', '🟢', '🟡', '🔵'][m.status] || '❓';
        return `${emoji} | ${m.monitor_name}`;
    }).join('\n');

    const embed = new EmbedBuilder()
        .setTitle(`${category} Monitor`)
        .setColor(config.embedColor)
        .setDescription(description)
        .setFooter({ text: `Last updated: ${new Date().toLocaleString()}` })
        .setURL(config.urls.uptimeKumaDashboard);

    const msg = monitorMessages[category]
        ? await channel.messages.fetch(monitorMessages[category]).catch(() => null)
        : null;

    if (msg) {
        await msg.edit({ embeds: [embed] });
        console.log(`🔁 Updated ${category} monitors`);
    } else {
        const newMsg = await channel.send({ embeds: [embed] });
        monitorMessages[category] = newMsg.id;
        console.log(`🆕 Sent ${category} monitors message`);
    }
}

async function clearChannel(channel) {
    try {
        const fetched = await channel.messages.fetch();
        await channel.bulkDelete(fetched);
        console.log('🧹 Channel cleared');
    } catch (e) {
        console.error('Error clearing channel:', e);
    }
}

client.login(config.token).catch(err => console.error('❌ Login failed:', err));
