const https = require("https");
const http = require("http");

const BASE = "https://qeseh.net";
const FALLBACK_POSTER = "https://qeseh.net/wp-content/uploads/2026/02/cropped-qeseh2026-192x192.png";

const MANIFEST = {
    id: "community.qeseh.abdulluhx",
    version: "1.0.1",
    name: "Qeseh by Abdulluh.X",
    description: "مسلسلات وافلام تركية مترجمة من قصة عشق",
    logo: "https://qeseh.net/wp-content/uploads/2026/02/cropped-qeseh2026-192x192.png",
    types: ["series"],
    catalogs: [],
    resources: ["stream"],
    idPrefixes: ["tt"]
};

function fetchText(url, referer) {
    return new Promise((resolve) => {
        const client = url.startsWith("https") ? https : http;
        const timer = setTimeout(() => resolve(""), 8000);
        try {
            const req = client.get(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
                    "Accept-Language": "ar,en;q=0.9",
                    "Referer": referer || BASE
                }
            }, (res) => {
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
                headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
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
    const data = await fetchJson("https://api.themoviedb.org/3/find/" + imdbId + "?api_key=" + TMDB_KEY + "&external_source=imdb_id");
    const tv = data.tv_results && data.tv_results[0];
    if (!tv) return null;
    const enData = await fetchJson("https://api.themoviedb.org/3/tv/" + tv.id + "?api_key=" + TMDB_KEY + "&language=en-US");
    return {
        originalTitle: enData.original_name || tv.original_name || "",
        englishTitle: enData.name || tv.name || ""
    };
}

function romanizeToSlug(name) {
    const map = { "ş": "s", "Ş": "s", "ü": "u", "Ü": "u", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c", "ı": "i", "İ": "i", "ğ": "g", "Ğ": "g" };
    return name.replace(/[şŞüÜöÖçÇıİğĞ]/g, c => map[c] || c).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function findEpisodeUrl(originalTitle, englishTitle, episode) {
    const slugs = [];
    if (originalTitle) slugs.push(romanizeToSlug(originalTitle));
    if (englishTitle) slugs.push(romanizeToSlug(englishTitle));
    if (originalTitle) slugs.push(romanizeToSlug(originalTitle.split(":")[0].trim()));

    for (const slug of slugs) {
        const url = BASE + "/clarus/" + slug + "-episode-" + episode + "/";
        const html = await fetchText(url);
        if (html && html.length > 1000 && !html.includes("404") && html.includes("qeseh")) {
            return url;
        }
    }

    for (const title of [originalTitle, englishTitle].filter(Boolean)) {
        const searchHtml = await fetchText(BASE + "/?s=" + encodeURIComponent(title));
        if (!searchHtml) continue;
        const epPattern = new RegExp("href=\"(" + BASE.replace(/\./g, "\\.") + "/clarus/[^\"]*episode-" + episode + "[^\"]*/)\"", "i");
        const m = searchHtml.match(epPattern);
        if (m) return m[1];
    }

    return null;
}

async function extractPlayerData(episodeUrl) {
    const html = await fetchText(episodeUrl);
    if (!html) return null;

    const watchMatch = html.match(/href="(https?:\/\/(?:qesen\.net|thenextstop\.net)[^"]*\?post=([A-Za-z0-9+/=]+))"/);
    if (!watchMatch) return null;

    try {
        const decoded = JSON.parse(Buffer.from(watchMatch[2], "base64").toString("utf-8"));
        return {
            watchUrl: watchMatch[1],
            servers: decoded.servers || [],
            postID: decoded.postID
        };
    } catch (e) {
        return null;
    }
}

async function extractM3u8FromEmbed(embedUrl, referer) {
    const html = await fetchText(embedUrl, referer);
    if (!html || html.length < 100) return null;

    // 1. Try to find direct sources in the HTML (standard JWPlayer)
    const sourcesMatch = html.match(/sources:\[{file:"(https?:\/\/[^"]+\.m3u8[^"]*)"/i);
    if (sourcesMatch) return sourcesMatch[1];

    // 2. Try to extract from P.A.C.K.E.R encoded script
    try {
        const splitIdx = html.lastIndexOf(".split('|'))");
        if (splitIdx < 0) return null;

        const beforeSplit = html.slice(0, splitIdx);
        const lastQ = beforeSplit.lastIndexOf("'");
        const prevQ = beforeSplit.lastIndexOf("'", lastQ - 1);
        if (lastQ < 0 || prevQ < 0) return null;

        const keys = beforeSplit.slice(prevQ + 1, lastQ).split("|");
        
        // Find required components from keys
        const file_code = keys.find(k => /^[a-z0-9]{12}$/.test(k)); 
        const folder1 = keys.find(k => /^\d{2}$/.test(k)); 
        const folder2 = keys.find(k => /^\d{5}$/.test(k)); 
        
        const trkarb = keys.find(k => k === "trkarb");
        const cdn1 = keys.find(k => k === "cdn1");
        const lsi = keys.find(k => k === "lsi");
        const cdnz = keys.find(k => k === "cdnz");
        const online = keys.find(k => k === "online");
        const enc1 = keys.find(k => k === "enc1");
        const qlf = keys.find(k => k === "qlf");
        
        const t = keys.find(k => k.length > 30); 
        const s = keys.find(k => /^\d{10}$/.test(k)); 
        const v = keys.find(k => /^\d{9}$/.test(k)); 
        
        if (file_code && folder1 && folder2 && t && s && v) {
            const cdnHost = `${trkarb || "trkarb"}-${cdn1 || "cdn1"}-${lsi || "lsi"}.${cdnz || "cdnz"}.${online || "online"}`;
            const srv = `${trkarb || "trkarb"}-${enc1 || "enc1"}-${qlf || "qlf"}`;
            return `https://${cdnHost}/hls2/${folder1}/${folder2}/${file_code}_,l,n,h,.urlset/master.m3u8?t=${t}&s=${s}&e=43200&v=${v}&srv=${srv}&i=0.3&sp=0`;
        }
    } catch (e) {
        console.error("Extraction error:", e);
    }

    return null;
}

function buildEmbedInfo(serverName, serverId) {
    const name = serverName.toLowerCase();
    if (name === "arab hd" || name === "pro hd" || name === "red hd") {
        return {
            embedUrl: "https://v.turkvearab.com/embed-" + serverId + ".html",
            referer: "https://qesen.net/",
            streamReferer: "https://v.turkvearab.com/"
        };
    }
    if (name === "estream") {
        return {
            embedUrl: "https://arabveturk.com/embed-" + serverId + ".html",
            referer: "https://qesen.net/",
            streamReferer: "https://arabveturk.com/"
        };
    }
    return null;
}

async function getQesehStreams(imdbId, season, episode) {
    const meta = await getTmdbMeta(imdbId);
    if (!meta) return [];

    console.log("[Qeseh] " + meta.originalTitle + " E" + episode);

    const episodeUrl = await findEpisodeUrl(meta.originalTitle, meta.englishTitle, episode);
    if (!episodeUrl) {
        console.log("[Qeseh] Episode not found");
        return [];
    }

    const playerData = await extractPlayerData(episodeUrl);
    if (!playerData) return [];

    const supportedServers = playerData.servers.filter(s =>
        ["arab hd", "estream", "pro hd", "red hd"].includes(s.name.toLowerCase())
    );

    const results = await Promise.allSettled(
        supportedServers.map(async (server) => {
            const info = buildEmbedInfo(server.name, server.id);
            if (!info) return null;
            const m3u8 = await extractM3u8FromEmbed(info.embedUrl, info.referer);
            if (!m3u8) return null;
            return { name: server.name, url: m3u8, streamReferer: info.streamReferer };
        })
    );

    const streams = [];
    for (const r of results) {
        if (r.status === "fulfilled" && r.value) {
            const emoji = r.value.name.toLowerCase() === "arab hd" ? "🎬" : "📺";
            streams.push({
                name: "Qeseh by Abdulluh.X",
                title: emoji + " " + r.value.name + " | مترجم عربي",
                url: r.value.url,
                behaviorHints: {
                    notWebReady: false,
                    headers: {
                        "Referer": r.value.streamReferer,
                        "Origin": r.value.streamReferer.replace(/\/$/, "")
                    }
                }
            });
        }
    }

    return streams;
}

module.exports = async function(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");

    const url = req.url || "/";

    if (url === "/" || url.includes("/manifest.json")) {
        return res.end(JSON.stringify(MANIFEST));
    }

    const streamMatch = url.match(/\/stream\/series\/(.+)\.json/);
    if (streamMatch) {
        try {
            const fullId = streamMatch[1];
            const parts = fullId.split(":");
            const imdbId = parts[0];
            const season = parseInt(parts[1] || "1");
            const episode = parseInt(parts[2] || "1");

            const streams = await getQesehStreams(imdbId, season, episode);
            return res.end(JSON.stringify({ streams }));
        } catch (e) {
            console.error("[Qeseh] Error: " + e.message);
            return res.end(JSON.stringify({ streams: [] }));
        }
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Not found" }));
};
