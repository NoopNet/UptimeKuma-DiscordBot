// === NoopNet Dual Uptime Bot (v1.1) ===
// One Node process, two Discord bots (Team + Public), each with its own groups & branding.
// Reads from Uptime Kuma (private API), renders pretty embeds with custom emojis.

// Shared ENV (both bots use the same Kuma):
//   KUMA_URL=https://uptime.noopnet.net
//   STATUS_PAGE=default
//   KUMA_API_KEY=eyJ... (required if private)
//   UPDATE_TIME=60
//
// TEAM bot ENV:
//   DISCORD_TOKEN_TEAM=xxxxx
//   DISCORD_GUILD_ID_TEAM=111111111111111111
//   DISCORD_CHANNEL_ID_TEAM=222222222222222222
//   GROUPS_INCLUDE_TEAM=Team,Spieler
//   AUTHOR_NAME_TEAM=Team-Status · NoopNet
//   EMBED_COLOR_TEAM=#ff7a00
//
// PUBLIC bot ENV:
//   DISCORD_TOKEN_PUBLIC=yyyyy
//   DISCORD_GUILD_ID_PUBLIC=333333333333333333
//   DISCORD_CHANNEL_ID_PUBLIC=444444444444444444
//   GROUPS_INCLUDE_PUBLIC=Spieler
//   AUTHOR_NAME_PUBLIC=Status · NoopNet
//   EMBED_COLOR_PUBLIC=#ff7a00
//
// Optional:
//   HEALTH_PORT=3000

const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const http = require("http");

// ---------- SHARED KUMA CONFIG ----------
const BASE = {
  kumaBase: (process.env.KUMA_URL || "https://uptime.noopnet.net").replace(/\/+$/, ""),
  statusSlug: process.env.STATUS_PAGE || "default",
  apiKey: process.env.KUMA_API_KEY || null,
  updateTime: parseInt(process.env.UPDATE_TIME || "60", 10),
  authorIcon: process.env.AUTHOR_ICON || "https://uptime.noopnet.net/favicon.ico",
  botVersion: process.env.BOT_VERSION || "NoopNet-uptime-Bot v1.0",
};

// ---------- CUSTOM EMOJIS (your SimpleCloud set) ----------
const EMOJI = {
  up: "<:Green:1424768725009174610>",
  down: "<:Red:1424769166702809200>",
  pending: "<:Yellow:1424769287171735583>",
  unknown: "<:Gray:1424769261313720390>",
};

function emojiFromStatusNumeric(n) {
  if (n === 1) return EMOJI.up;
  if (n === 0) return EMOJI.down;
  if (n === 2) return EMOJI.pending;
  return EMOJI.unknown;
}

function latestOf(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[arr.length - 1];
}

// ---------- FETCH FROM KUMA ----------
async function fetchMonitors() {
  const slug = encodeURIComponent(BASE.statusSlug);
  const headers = BASE.apiKey ? { Authorization: `Bearer ${BASE.apiKey}` } : {};
  const httpClient = axios.create({ timeout: 10000, headers });

  // 1) Meta: groups + monitors (names, ids)
  const metaRes = await httpClient.get(`${BASE.kumaBase}/api/status-page/${slug}`);
  const publicGroupList = Array.isArray(metaRes.data?.publicGroupList) ? metaRes.data.publicGroupList : [];

  const nameById = new Map(); // id -> { name, group }
  for (const g of publicGroupList) {
    const gName = g?.name || null;
    const list = Array.isArray(g?.monitorList) ? g.monitorList : [];
    for (const m of list) {
      if (m?.id != null) {
        nameById.set(String(m.id), { name: m.name || `Monitor ${m.id}`, group: gName });
      }
    }
  }

  // 2) Heartbeats + uptime
  const hbRes = await httpClient.get(`${BASE.kumaBase}/api/status-page/heartbeat/${slug}`);
  const heartbeatList = hbRes.data?.heartbeatList || {};
  const uptimeList = hbRes.data?.uptimeList || {};

  // 3) Merge into uniform array
  const out = [];
  for (const [id, arr] of Object.entries(heartbeatList)) {
    const latest = latestOf(arr);
    const meta = nameById.get(String(id)) || { name: `Monitor ${id}`, group: null };
    const emoji = emojiFromStatusNumeric(latest?.status);
    const uptimeKey24 = `${id}_24`;
    const uptimePct = typeof uptimeList[uptimeKey24] === "number" ? uptimeList[uptimeKey24] * 100 : null;

    out.push({
      id: Number(id),
      name: meta.name,
      group: meta.group || "Allgemein",
      emoji,
      ping: typeof latest?.ping === "number" ? latest.ping : null,
      uptime: typeof uptimePct === "number" ? uptimePct : null,
    });
  }

  out.sort((a, b) => (a.group || "").localeCompare(b.group || "") || a.name.localeCompare(b.name));
  return out;
}

// ---------- BOT FACTORY (one client per bot) ----------
function parseGroupList(v) {
  return (v || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function createBotFromEnv(prefix /* e.g., "TEAM" or "PUBLIC" */) {
  const token = process.env[`DISCORD_TOKEN_${prefix}`];
  const guildID = process.env[`DISCORD_GUILD_ID_${prefix}`];
  const channelID = process.env[`DISCORD_CHANNEL_ID_${prefix}`];

  if (!token || !guildID || !channelID) {
    console.warn(`⚠️ Skipping ${prefix}: token/guild/channel missing`);
    return null;
  }

  const groupsInclude = parseGroupList(process.env[`GROUPS_INCLUDE_${prefix}`]);
  const authorName = process.env[`AUTHOR_NAME_${prefix}`] || (prefix === "TEAM" ? "Team-Status · NoopNet" : "Status · NoopNet");
  const embedColor = process.env[`EMBED_COLOR_${prefix}`] || "#ff7a00";

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });

  let messageId = null;

  async function updateStatus(channel) {
    try {
      const all = await fetchMonitors();

      // Case-insensitive group include (if provided)
      const filtered = groupsInclude.length
        ? all.filter(m => groupsInclude.map(x => x.toLowerCase()).includes((m.group || "").toLowerCase()))
        : all;

      const grouped = {};
      for (const m of filtered) {
        const key = m.group || "Allgemein";
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(m);
      }

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
        .setAuthor({ name: authorName, iconURL: BASE.authorIcon })
        .setColor(embedColor)
        .setDescription(lines.join("\n") || "_Keine Monitore gefunden._")
        .setURL(`${BASE.kumaBase}/status/${encodeURIComponent(BASE.statusSlug)}`)
        .setFooter({
          text: `Last updated: ${new Date().toLocaleString("de-DE")}\n${BASE.botVersion}`,
        });

      if (messageId) {
        const msg = await channel.messages.fetch(messageId).catch(() => null);
        if (msg) {
          await msg.edit({ embeds: [embed] });
          return;
        }
      }
      const newMsg = await channel.send({ embeds: [embed] });
      messageId = newMsg.id;
    } catch (err) {
      console.error(`❌ [${authorName}] Update failed:`, err?.message || err);
    }
  }

  client.once("ready", async () => {
    console.log(`✅ ${authorName} logged in as ${client.user.tag}`);
    try {
      const guild = await client.guilds.fetch(guildID);
      const channel = await guild.channels.fetch(channelID);
      if (!channel?.isTextBased()) throw new Error("Channel is not text-based.");

      // Clean start (soft-fail if perms/dates prevent bulk delete)
      try {
        const fetched = await channel.messages.fetch({ limit: 100 });
        if (fetched.size) await channel.bulkDelete(fetched);
      } catch {}

      await updateStatus(channel);
      setInterval(() => updateStatus(channel), BASE.updateTime * 1000);
    } catch (e) {
      console.error(`❌ [${authorName}] Setup error:`, e?.message || e);
    }
  });

  client.login(token).catch(e => console.error(`❌ [${authorName}] Login failed:`, e?.message || e));
  return client;
}

// ---------- START BOTH (if configured) ----------
createBotFromEnv("TEAM");
createBotFromEnv("PUBLIC");

// ---------- HEALTH FOR COOLIFY ----------
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
