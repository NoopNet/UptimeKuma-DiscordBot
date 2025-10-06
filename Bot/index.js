// === Uptime Kuma Discord Bot (Full private API version) ===
// Compatible with latest Kuma (heartbeat + status-page merge)

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const http = require('http');

// ---- CONFIG ----
const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  guildID: process.env.DISCORD_GUILD_ID,
  channelID: process.env.DISCORD_CHANNEL_ID,

  updateTime: parseInt(process.env.UPDATE_TIME || "60", 10),
  embedColor: process.env.EMBED_COLOR || "#0099ff",

  kumaBase: process.env.KUMA_URL || "https://uptime.noopnet.net",
  statusSlug: process.env.STATUS_PAGE || "default",
  apiKey: process.env.KUMA_API_KEY || null, // required for private Kuma
};

// ---- DEBUG ----
console.table({
  DISCORD_TOKEN: CONFIG.token ? "✅ set" : "❌ missing",
  GUILD_ID: CONFIG.guildID || "❌",
  CHANNEL_ID: CONFIG.channelID || "❌",
  KUMA_URL: CONFIG.kumaBase,
  STATUS_PAGE: CONFIG.statusSlug,
  KUMA_API_KEY: CONFIG.apiKey ? "✅ set" : "❌ missing",
});

// ---- DISCORD CLIENT ----
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

let messageId = null;

// ---- HTTP CLIENT ----
const httpClient = axios.create({
  timeout: 10000,
  headers: CONFIG.apiKey ? { Authorization: `Bearer ${CONFIG.apiKey}` } : {},
});

// ---- UTILITIES ----
function statusEmojiFromNumeric(n) {
  // Deine benutzerdefinierten SimpleCloud-Emojis
  const emojiUp = "<:Green:1424768725009174610>";       // Grün – up
  const emojiDown = "<:Red:1424769166702809200>";      // Rot – down
  const emojiPending = "<:Yellow:1424769287171735583>";  // Gelb – pending
  const emojiUnknown = "<:Gray:1424769261313720390>";   // Grau – unknown / offline

  if (n === 1) return { label: "up", emoji: emojiUp };
  if (n === 0) return { label: "down", emoji: emojiDown };
  if (n === 2) return { label: "pending", emoji: emojiPending };
  return { label: "unknown", emoji: emojiUnknown };
}

function latestOf(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[arr.length - 1];
}

// ---- FETCH MONITORS ----
async function fetchMonitors() {
  const base = CONFIG.kumaBase.replace(/\/+$/, "");
  const slug = encodeURIComponent(CONFIG.statusSlug);

  // 1️⃣ Fetch monitor meta (names, groups)
  const metaRes = await httpClient.get(`${base}/api/status-page/${slug}`);
  const groups = Array.isArray(metaRes.data?.publicGroupList) ? metaRes.data.publicGroupList : [];
  const nameById = new Map();
  for (const g of groups) {
    const gName = g?.name || null;
    const monitors = Array.isArray(g?.monitorList) ? g.monitorList : [];
    for (const m of monitors) {
      if (m?.id != null) {
        nameById.set(String(m.id), { name: m.name || `Monitor ${m.id}`, group: gName });
      }
    }
  }

  // 2️⃣ Fetch heartbeat data
  const hbRes = await httpClient.get(`${base}/api/status-page/heartbeat/${slug}`);
  const heartbeatList = hbRes.data?.heartbeatList || {};
  const uptimeList = hbRes.data?.uptimeList || {};

  // 3️⃣ Merge both datasets
  const result = [];
  for (const [id, hbArray] of Object.entries(heartbeatList)) {
    const latest = latestOf(hbArray);
    const meta = nameById.get(String(id)) || { name: `Monitor ${id}`, group: null };
    const map = statusEmojiFromNumeric(latest?.status);
    const uptimeKey24h = `${id}_24`;
    const uptimePct =
      typeof uptimeList[uptimeKey24h] === "number" ? uptimeList[uptimeKey24h] * 100 : null;

    result.push({
      id: Number(id),
      name: meta.name,
      group: meta.group,
      status: map.label,
      emoji: map.emoji,
      ping: typeof latest?.ping === "number" ? latest.ping : null,
      uptime: typeof uptimePct === "number" ? uptimePct : null,
    });
  }

  // Sort for clean embed
  result.sort(
    (a, b) =>
      (a.group || "").localeCompare(b.group || "") ||
      a.name.localeCompare(b.name)
  );

  return result;
}

// ---- BUILD & SEND EMBED ----
async function updateStatus(channel) {
  try {
    console.log(`🌐 Fetching from Kuma (auth=${CONFIG.apiKey ? "yes" : "no"})…`);
    const monitors = await fetchMonitors();

    if (!Array.isArray(monitors) || monitors.length === 0) {
      console.warn("⚠️ No monitors found in response.");
    }

    // Group by category name
    const grouped = {};
    for (const m of monitors) {
      const key = m.group || "Ungrouped";
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(m);
    }

    // Build lines
    const lines = [];
    for (const [group, list] of Object.entries(grouped)) {
      lines.push(`**__${group}__**`);
      for (const m of list) {
        const pct =
          typeof m.uptime === "number" ? `${m.uptime.toFixed(2)}%` : "—";
        const ping =
          typeof m.ping === "number" ? `${m.ping} ms` : "";
        lines.push(
          `${m.emoji} **${m.name}** — ${m.status.toUpperCase()} ${ping ? `(${ping})` : ""} ${pct !== "—" ? `• ${pct}` : ""}`
        );
      }
      lines.push(""); // spacing
    }

    const embed = new EmbedBuilder()
      .setTitle("📊 Uptime Status")
      .setColor(CONFIG.embedColor)
      .setDescription(lines.join("\n") || "No monitors found.")
      .setFooter({ text: `Last update: ${new Date().toLocaleString()}` })
      .setURL(`${CONFIG.kumaBase.replace(/\/+$/, "")}/status/${encodeURIComponent(CONFIG.statusSlug)}`);

    // Update or send message
    if (messageId) {
      const msg = await channel.messages.fetch(messageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embed] });
        console.log("🔁 Updated status message");
        return;
      }
    }
    const newMsg = await channel.send({ embeds: [embed] });
    messageId = newMsg.id;
    console.log("🆕 Posted status message");
  } catch (err) {
    const code = err.response?.status;
    const msg = err.response?.data || err.message;
    console.error(`❌ Update failed (${code || ""}): ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
  }
}

// ---- CLEAR CHANNEL ----
async function clearChannel(channel) {
  try {
    const fetched = await channel.messages.fetch({ limit: 100 });
    if (fetched.size) await channel.bulkDelete(fetched);
    console.log("🧹 Channel cleared");
  } catch (e) {
    console.warn("⚠️ Could not clear channel:", e.message);
  }
}

// ---- DISCORD LOGIN ----
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  try {
    const guild = await client.guilds.fetch(CONFIG.guildID);
    const channel = await guild.channels.fetch(CONFIG.channelID);
    if (!channel?.isTextBased()) throw new Error("Channel not text-based.");

    await clearChannel(channel);
    await updateStatus(channel);
    console.log(`🕒 Updating every ${CONFIG.updateTime}s`);
    setInterval(() => updateStatus(channel), CONFIG.updateTime * 1000);
  } catch (e) {
    console.error("❌ Setup error:", e.message);
  }
});

client.login(CONFIG.token).catch((e) =>
  console.error("❌ Discord login failed:", e.message)
);

// ---- HEALTHZ (Coolify support) ----
const port = process.env.HEALTH_PORT || 3000;
http
  .createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
    } else {
      res.writeHead(404);
      res.end();
    }
  })
  .listen(port, () => console.log(`❤️ Health endpoint on :${port}`));
