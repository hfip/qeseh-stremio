const https = require("https");
const http = require("http");

const BASE = "https://wwv.qeseh.com";
const ADDON_NAME = "Qeseh by Abdulluh.X";
const ADDON_ID = "community.qeseh.abdulluhx.v11";
const ADDON_LOGO = "https://qeseh.net/wp-content/uploads/2026/02/cropped-qeseh2026-192x192.png";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ar,en-US;q=0.8,en;q=0.5"
};

const manifest = {
  id: ADDON_ID,
  version: "1.0.8",
  name: ADDON_NAME,
  description: "مسلسلات وافلام تركية مترجمة من قصة عشق",
  logo: ADDON_LOGO,
  resources: ["stream"],
  types: ["series"],
  idPrefixes: ["tt"]
};

function fetchText(url, referer) {
  return new Promise((resolve) => {
    const client = url.startsWith("https") ? https : http;
    const timer = setTimeout(() => resolve(""), 8000);
    try {
      const req = client.get(url, {
        headers: { ...HEADERS, "Referer": referer || BASE }
      }, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          clearTimeout(timer);
          return resolve(fetchText(new URL(res.headers.location, url).toString(), referer));
        }
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString("utf-8")); });
      });
      req.on("error", () => { clearTimeout(timer); resolve(""); });
    } catch (e) { clearTimeout(timer); resolve(""); }
  });
}

function fetchJson(url) {
  return new Promise((resolve) => {
    const client = url.startsWith("https") ? https : http;
    const timer = setTimeout(() => resolve({}), 8000);
    try {
      const req = client.get(url, {
        headers: { ...HEADERS, "Accept": "application/json" }
      }, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => { clearTimeout(timer); try { resolve(JSON.parse(data)); } catch (e) { resolve({}); } });
      });
      req.on("error", () => { clearTimeout(timer); resolve({}); });
    } catch (e) { clearTimeout(timer); resolve({}); }
  });
}

async function getTmdbMeta(imdbId) {
  const TMDB_KEY = "439c478a771f35c05022f9feabcca01c";
  const data = await fetchJson(`https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id`);
  const tv = data.tv_results && data.tv_results[0];
  if (!tv) return null;
  const enData = await fetchJson(`https://api.themoviedb.org/3/tv/${tv.id}?api_key=${TMDB_KEY}&language=en-US`);
  return {
    originalTitle: enData.original_name || tv.original_name || "",
    englishTitle: enData.name || tv.name || ""
  };
}

function romanizeToSlug(name) {
  const map = { "ş": "s", "Ş": "s", "ü": "u", "Ü": "u", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c", "ı": "i", "İ": "i", "ğ": "g", "Ğ": "g" };
  return String(name || "").replace(/[şŞüÜöÖçÇıİğĞ]/g, c => map[c] || c).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function unpackPACK(html) {
  try {
    const match = html.match(/eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('((?:[^'\\]|\\.)*)',\s*(\d+)\s*,\s*(\d+)\s*,'((?:[^'\\]|\\.)*)'.split\('\|'\)/);
    if (!match) return "";
    let [, p, a, c, k] = match;
    a = parseInt(a);
    c = parseInt(c);
    k = k.split("|");
    const dict = {};
    while (c--) {
      const key = c.toString(a > 10 ? 36 : 10);
      dict[key] = k[c] || key;
    }
    return p.replace(/\b(\w+)\b/g, m => dict[m] !== undefined ? dict[m] : m);
  } catch { return ""; }
}

function extractM3u8(text) {
  const m = text.match(/(?:file|src)\s*:\s*["'](https?:\/\/[^"']*\.m3u8[^"']*)["']/i);
  if (m) return m[1].replace(/&amp;/g, '&');
  const m2 = text.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
  return m2 ? m2[0].replace(/&amp;/g, '&') : "";
}

async function tryEmbed(embedUrl, referer) {
  const html = await fetchText(embedUrl, referer);
  if (!html || html.length < 100 || html.includes("File is no longer available")) return null;
  if (html.includes("eval(function(p,a,c,k,e,d)")) {
    const unpacked = unpackPACK(html);
    const m3u8 = extractM3u8(unpacked);
    if (m3u8) return { m3u8, embedUrl };
  }
  const m3u8 = extractM3u8(html);
  if (m3u8) return { m3u8, embedUrl };
  return null;
}

function buildStreams(result, serverName) {
  if (!result || !result.m3u8) return [];
  const referer = (result.embedUrl || "").match(/^(https?:\/\/[^/]+)/)?.[1] || "";
  const headers = {
    "Referer": referer + "/",
    "Origin": referer,
    "User-Agent": HEADERS["User-Agent"]
  };

  const emoji = serverName.toLowerCase().includes("hd") ? "🎬" : "📺";
  const varMatch = result.m3u8.match(/^(.+_),([a-zA-Z]+(?:,[a-zA-Z]+)*),\.urlset\/master\.m3u8(\?.+)?$/);
  
  if (varMatch) {
    const qualMap = { x: "1080P", h: "720P", n: "480P", l: "360P" };
    return varMatch[2].split(",").filter(s => qualMap[s]).map(s => ({
      name: `Qeseh [${qualMap[s]}]`,
      title: `${emoji} ${serverName} - ${qualMap[s]} | مترجم`,
      url: varMatch[1] + s + "/index-v1-a1.m3u8" + (varMatch[3] || ""),
      behaviorHints: { notWebReady: false, headers: headers }
    }));
  }

  return [{
    name: "Qeseh by Abdulluh.X",
    title: `${emoji} ${serverName} | مترجم عربي`,
    url: result.m3u8,
    behaviorHints: { notWebReady: false, headers: headers }
  }];
}

async function findEpisodeUrl(meta, episode) {
    const slugs = [];
    if (meta.originalTitle) slugs.push(romanizeToSlug(meta.originalTitle));
    if (meta.englishTitle) slugs.push(romanizeToSlug(meta.englishTitle));
    if (meta.originalTitle) slugs.push(romanizeToSlug(meta.originalTitle.split(":")[0].trim()));

    for (const slug of slugs) {
        const url = `${BASE}/clarus/${slug}-episode-${episode}/`;
        const html = await fetchText(url);
        if (html && html.length > 1000 && !html.includes("404")) return url;
    }

    for (const title of [meta.originalTitle, meta.englishTitle].filter(Boolean)) {
        const searchHtml = await fetchText(`${BASE}/?s=${encodeURIComponent(title)}`);
        if (!searchHtml) continue;
        const epPattern = new RegExp(`href="(${BASE.replace(/\./g, "\\.")}/clarus/[^"]*episode-${episode}[^"]*/)"`, "i");
        const m = searchHtml.match(epPattern);
        if (m) return m[1];
    }
    return null;
}

async function getQesehStreams(imdbId, season, episode) {
  const meta = await getTmdbMeta(imdbId);
  if (!meta) return [];

  const episodeUrl = await findEpisodeUrl(meta, episode);
  if (!episodeUrl) return [];

  const epHtml = await fetchText(episodeUrl);
  const watchMatch = epHtml.match(/href="(https?:\/\/(?:qesen\.net|thenextstop\.net|maxmoto\.net)[^"]*\?post=([A-Za-z0-9+/=]+))"/);
  if (!watchMatch) return [];

  try {
    const decoded = JSON.parse(Buffer.from(watchMatch[2], "base64").toString("utf-8"));
    const allStreams = [];
    for (const server of decoded.servers) {
      let embedUrl = "";
      let referer = "https://maxmoto.net/";
      if (["arab hd", "pro hd", "red hd", "turk"].includes(server.name.toLowerCase())) {
        embedUrl = `https://v.turkvearab.com/embed-${server.id}.html`;
        referer = "https://v.turkvearab.com/";
      } else if (server.name.toLowerCase().includes("estream")) {
        embedUrl = `https://arabveturk.com/embed-${server.id}.html`;
        referer = "https://arabveturk.com/";
      }

      if (embedUrl) {
        const res = await tryEmbed(embedUrl, referer);
        if (res) allStreams.push(...buildStreams(res, server.name));
      } else if (server.id.startsWith("http")) {
        allStreams.push({ name: server.name, title: `🎬 ${server.name}`, url: server.id });
      }
    }
    return allStreams;
  } catch (e) { return []; }
}

module.exports = async function(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  const url = req.url || "/";
  if (url === "/" || url.includes("/manifest.json")) return res.end(JSON.stringify(manifest));
  const streamMatch = url.match(/\/stream\/series\/(.+)\.json/);
  if (streamMatch) {
    try {
      const [imdbId, season = "1", episode = "1"] = streamMatch[1].split(":");
      const streams = await getQesehStreams(imdbId, parseInt(season), parseInt(episode));
      return res.end(JSON.stringify({ streams }));
    } catch (e) { return res.end(JSON.stringify({ streams: [] })); }
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "Not found" }));
};
