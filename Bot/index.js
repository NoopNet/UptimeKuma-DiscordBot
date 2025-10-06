// === Uptime Kuma Discord Bot (Private API Key Ready) ===
// Fetches directly from Kuma. Always uses Bearer token when provided.
// Tries status-page heartbeat first; falls back to private monitor list.

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

  // 🔐 REQUIRED for private setups
  apiKey: process.env.KUMA_API_KEY || null,
};

// ---- DEBUG ----
console.table({
  DISCORD_TOKEN: CONFIG.token ? "✅ set" : "❌ missing",
  GUILD_ID: CONFIG.guildID || "❌",
  CHANNEL_ID: CONFIG.channelID || "❌",
  KUMA_URL: CONFIG.kumaBase,
  STATUS_PAGE: CONFIG.statusSlug,
  KUMA_API_KEY: CONFIG.apiKey ? "✅ set" : "❌ missing (public only)",
});

// ---- DISCORD CLIENT ----
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

let messageId = null;

// ---- HELPERS ----
const httpClient = axios.create({
  timeout: 10000,
  headers: CONFIG.apiKey ? { Authorization: `Bearer ${CONFIG.apiKey}` } : {},
});

// Normalize different Kuma payloads into a common array:
// [{ name, status, uptime, ping }]
function normalizeMonitorsFromStatusPage(json) {
  // Expected: { monitors: [ { name, status, uptime, ... } ] }
  const list = Array.isArray(json?.monitors) ? json.monitors : [];
  return list.map(m => ({
    name: m.name ?? m.monitor_name ?? "Unknown",
    status: (m.status || "").toLowerCase(), // 'up' | 'down' | 'pending' | ...
    uptime: typeof m.uptime === "number" ? m.uptime : (typeof m.uptime24h === "number" ? m.uptime24h : null),
    ping: typeof m.ping === "number" ? m.ping : null,
  }));
}

function normalizeMonitorsFromPrivateList(json) {
  // Common private endpoints return { monitors: [...] } or a raw array.
  const raw = Array.isArray(json?.monitors) ? json.monitors : (Array.isArray(json) ? json : []);
  return raw.map(m => ({
    name: m.name ?? m.monitor_name ?? "Unknown",
    // Private list may use numeric status; map to text:
    // 0/1/2/3 patterns vary; we coerce to up/down/pending as best effort
    status: (() => {
      if (typeof m.status === "string") return m.status.toLowerCase();
      if (typeof m.status === "number") {
        // heuristic: 1=up, 0=down, 2=pending, 3=unknown
        return m.status === 1 ? "up" : m.status === 0 ? "down" : m.status === 2 ? "pending" : "unknown";
      }
      return "unknown";
    })(),
    uptime: (typeof m.uptime === "number" ? m.uptime : null),
    ping: (typeof m.ping === "number" ? m.ping : null),
  }));
}

// Try endpoints in order with auth header.
// 1) /api/status-page/heartbeat/<slug>
// 2) /api/monitor/list          (common)
// 3) /api/monitor/overview      (alternative on some builds)
async function fetchMonitors() {
  const base = CONFIG.kumaBase.replace(/\/+$/, "");
  const tries = [
    {
      name: "status-page",
      url: `${base}/api/status-page/heartbeat/${encodeURIComponent(CONFIG.statusSlug)}`,
      normalize: normalizeMonitorsFromStatusPage,
    },
    {
      name: "monitor-list",
      url: `${base}/api/monitor/list`,
      normalize: normalizeMonitorsFromPrivateList,
    },
    {
      name: "monitor-overview",
      url: `${base}/api/monitor/overview`,
      normalize: normalizeMonitorsFromPrivateList,
    },
  ];

  let lastErr = null;
  for (const t of tries) {
    try {
      const res = await httpClient.get(t.url);
      const monitors = t.normalize(res.data);
      if (Array.isArray(monitors) && monitors.length >= 0) {
        console.log(`✅ Source: ${t.name} (${t.url})`);
        return monitors;
      }
    } catch (err) {
      lastErr = err;
      const code = err.response?.status;
      console.warn(`⚠️ Fetch failed (${t.name}): ${code || err.code || err.message}`);
      // If unauthorized and we have no key, no point trying private endpoints
      if (code === 401 && !CONFIG.apiKey) break;
    }
  }
  throw lastErr || new Error("No Kuma endpoint returned data.");
}

function statusEmoji(status) {
  const s = (status || "").toLowerCase();
  if (s === "up") return "🟢";
  if (s === "down") return "🔴";
  if (s === "pending" || s === "maintenance") return "🟡";
  return "⚪";
}

// ---- UPDATE LOOP ----
async function updateStatus(channel) {
  try {
    console.log(`🌐 Fetching from Kuma (auth=${CONFIG.apiKey ? "yes" : "no"})…`);
    const monitors = await fetchMonitors();

    const lines = monitors.map(m => {
      const pct = (typeof m.uptime === "number") ? `${m.uptime.toFixed(2)}%` : "—";
      const ping = (typeof m.ping === "number") ? `${m.ping} ms` : "";
      return `${statusEmoji(m.status)} **${m.name}** — ${m.status.toUpperCase()} ${ping ? `(${ping})` : ""} ${pct !== "—" ? `• ${pct}` : ""}`;
    });

    const embed = new EmbedBuilder()
      .setTitle("📊 Uptime Status")
      .setColor(CONFIG.embedColor)
      .setDescription(lines.join("\n") || "No monitors found.")
      .setFooter({ text: `Last update: ${new Date().toLocaleString()}` })
      .setURL(`${CONFIG.kumaBase.replace(/\/+$/, "")}/status/${encodeURIComponent(CONFIG.statusSlug)}`);

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

// ---- STARTUP ----
client.once('ready', async () => {
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

// ---- UTIL ----
async function clearChannel(channel) {
  try {
    const fetched = await channel.messages.fetch({ limit: 100 });
    if (fetched.size) await channel.bulkDelete(fetched);
    console.log("🧹 Channel cleared");
  } catch (e) {
    console.warn("⚠️ Could not clear channel:", e.message);
  }
}

// ---- LOGIN ----
client.login(CONFIG.token).catch(e => console.error("❌ Discord login failed:", e.message));

// ---- HEALTHZ for Coolify ----
const port = process.env.HEALTH_PORT || 3000;
http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(port, () => console.log(`❤️ Health endpoint on :${port}`));
