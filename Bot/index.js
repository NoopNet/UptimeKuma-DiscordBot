// === NoopNet Uptime Discord Bot (v1.0 Final) ===
// Liest direkt aus Uptime Kuma (private API) und postet hübsch formatierte Status-Embeds.

const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const http = require("http");

// ---------- CONFIG ----------
const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  guildID: process.env.DISCORD_GUILD_ID,
  channelID: process.env.DISCORD_CHANNEL_ID,

  updateTime: parseInt(process.env.UPDATE_TIME || "60", 10),

  kumaBase: (process.env.KUMA_URL || "https://uptime.noopnet.net").replace(/\/+$/, ""),
  statusSlug: process.env.STATUS_PAGE || "default",
  apiKey: process.env.KUMA_API_KEY || null,

  // Embed-Styling
  embedColor: process.env.EMBED_COLOR || "#ff7a00", // Orange
  authorName: "Webseiten-Status · NoopNet",
  authorIcon: "https://uptime.noopnet.net/favicon.ico",
  botVersion: "NoopNet-Web-Status-Bot v1.0",
};

// ---------- DEBUG ----------
console.table({
  DISCORD_TOKEN: CONFIG.token ? "✅ set" : "❌ missing",
  GUILD_ID: CONFIG.guildID || "❌",
  CHANNEL_ID: CONFIG.channelID || "❌",
  KUMA_URL: CONFIG.kumaBase,
  STATUS_PAGE: CONFIG.statusSlug,
  KUMA_API_KEY: CONFIG.apiKey ? "✅ set" : "❌ missing (required for private)",
});

// ---------- DISCORD CLIENT ----------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

let messageId = null;

// ---------- HTTP CLIENT ----------
const httpClient = axios.create({
  timeout: 10000,
  headers: CONFIG.apiKey ? { Authorization: `Bearer ${CONFIG.apiKey}` } : {},
});

// ---------- EMOJIS ----------
function statusEmojiFromNumeric(n) {
  const emojiUp = "<:Green:1424768725009174610>";        // Grün – up
  const emojiDown = "<:Red:1424769166702809200>";        // Rot – down
  const emojiPending = "<:Yellow:1424769287171735583>";  // Gelb – pending
  const emojiUnknown = "<:Gray:1424769261313720390>";    // Grau – unknown / offline

  if (n === 1) return { label: "up", emoji: emojiUp };
  if (n === 0) return { label: "down", emoji: emojiDown };
  if (n === 2) return { label: "pending", emoji: emojiPending };
  return { label: "unknown", emoji: emojiUnknown };
}

// ---------- HELPERS ----------
function latestOf(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[arr.length - 1];
}

// ---------- FETCH DATA ----------
async function fetchMonitors() {
  const slugEnc = encodeURIComponent(CONFIG.statusSlug);

  // Meta-Daten
  const metaRes = await httpClient.get(`${CONFIG.kumaBase}/api/status-page/${slugEnc}`);
  const groups = Array.isArray(metaRes.data?.publicGroupList) ? metaRes.data.publicGroupList : [];
  const nameById = new Map();

  for (const g of groups) {
    const gName = g?.name || null;
    const list = Array.isArray(g?.monitorList) ? g.monitorList : [];
    for (const m of list) {
      if (m?.id != null) {
        nameById.set(String(m.id), { name: m.name || `Monitor ${m.id}`, group: gName });
      }
    }
  }

  // Heartbeats
  const hbRes = await httpClient.get(`${CONFIG.kumaBase}/api/status-page/heartbeat/${slugEnc}`);
  const heartbeatList = hbRes.data?.heartbeatList || {};
  const uptimeList = hbRes.data?.uptimeList || {};

  // Merge
  const out = [];
  for (const [id, hbArray] of Object.entries(heartbeatList)) {
    const latest = latestOf(hbArray);
    const meta = nameById.get(String(id)) || { name: `Monitor ${id}`, group: null };
    const map = statusEmojiFromNumeric(latest?.status);
    const uptimeKey24 = `${id}_24`;
    const uptimePct = typeof uptimeList[uptimeKey24] === "number" ? uptimeList[uptimeKey24] * 100 : null;

    out.push({
      id: Number(id),
      name: meta.name,
      group: meta.group,
      emoji: map.emoji,
      ping: typeof latest?.ping === "number" ? latest.ping : null,
      uptime: typeof uptimePct === "number" ? uptimePct : null,
    });
  }

  out.sort((a, b) => (a.group || "").localeCompare(b.group || "") || a.name.localeCompare(b.name));
  return out;
}

// ---------- EMBED ----------
async function updateStatus(channel) {
  try {
    console.log(`🌐 Fetching from Kuma (auth=${CONFIG.apiKey ? "yes" : "no"})…`);
    const monitors = await fetchMonitors();

    // Gruppieren
    const grouped = {};
    for (const m of monitors) {
      const key = m.group || "Allgemein";
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(m);
    }

    // Beschreibung aufbauen
    const lines = [];
    for (const [group, list] of Object.entries(grouped)) {
      lines.push(`> **${group}**`);
      for (const m of list) {
        const pct = typeof m.uptime === "number" ? `${m.uptime.toFixed(2)}%` : "—";
        const ping = typeof m.ping === "number" ? `Ping ${m.ping} ms` : "Ping —";
        lines.push(`> ${m.emoji}  **${m.name}**  •  ${pct}  •  ${ping}`);
      }
      lines.push("");
    }

    const embed = new EmbedBuilder()
      .setAuthor({ name: CONFIG.authorName, iconURL: CONFIG.authorIcon })
      .setColor(CONFIG.embedColor)
      .setDescription(lines.join("\n") || "_Keine Monitore gefunden._")
      .setURL(`${CONFIG.kumaBase}/status/${encodeURIComponent(CONFIG.statusSlug)}`)
      .setFooter({
        text:
          `Last updated: ${new Date().toLocaleString("de-DE")}\n` +
          `${CONFIG.botVersion}`,
      });

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

// ---------- DISCORD ----------
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  try {
    const guild = await client.guilds.fetch(CONFIG.guildID);
    const channel = await guild.channels.fetch(CONFIG.channelID);
    if (!channel?.isTextBased()) throw new Error("Channel is not text-based.");

    try {
      const fetched = await channel.messages.fetch({ limit: 100 });
      if (fetched.size) await channel.bulkDelete(fetched);
      console.log("🧹 Channel cleared");
    } catch (e) {
      console.warn("⚠️ Could not clear channel:", e.message);
    }

    await updateStatus(channel);
    console.log(`🕒 Updating every ${CONFIG.updateTime}s`);
    setInterval(() => updateStatus(channel), CONFIG.updateTime * 1000);
  } catch (e) {
    console.error("❌ Setup error:", e.message);
  }
});

client.login(CONFIG.token).catch(e => console.error("❌ Discord login failed:", e.message));

// ---------- HEALTH ENDPOINT ----------
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
