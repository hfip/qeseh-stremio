const https = require("https");
const http = require("http");

const BASE = "https://wwv.qeseh.com";
const FALLBACK_POSTER = "https://qeseh.net/wp-content/uploads/2026/02/cropped-qeseh2026-192x192.png";

const MANIFEST = {
    id: "community.qeseh.abdulluhx",
    version: "1.0.3",
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

function unpack(p, a, c, k, e, d) {
    while (c--) {
        if (k[c]) {
            p = p.replace(new RegExp('\\b' + c.toString(a) + '\\b', 'g'), k[c]);
        }
    }
    return p;
}

async function extractM3u8FromEmbed(embedUrl, referer) {
    const html = await fetchText(embedUrl, referer);
    if (!html || html.length < 100) return null;

    if (html.includes("File is no longer available")) return null;

    // 1. Try direct sources
    const sourcesMatch = html.match(/sources:\[{file:"(https?:\/\/[^"]+\.m3u8[^"]*)"/i);
    if (sourcesMatch) return sourcesMatch[1].replace(/&amp;/g, '&');

    // 2. Try P.A.C.K.E.R
    const packedMatch = html.match(/eval\(function\(p,a,c,k,e,d\)\{.*\}\((.*)\)\)/);
    if (packedMatch) {
        try {
            const paramsStr = packedMatch[1];
            const kStart = paramsStr.indexOf("'");
            const kEnd = paramsStr.lastIndexOf("'");
            const kStr = paramsStr.substring(kStart + 1, kEnd);
            const kArr = kStr.split('|');
            const pStr = paramsStr.substring(1, paramsStr.indexOf("',", 0));
            const otherParams = paramsStr.substring(paramsStr.lastIndexOf("',") + 2).split(',');
            const aVal = parseInt(otherParams[1]);
            const cVal = parseInt(otherParams[2]);
            const unpacked = unpack(pStr, aVal, cVal, kArr, 0, {});
            
            const m3u8Match = unpacked.match(/https?:\/\/[^"']+\.m3u8[^"']*/);
            if (m3u8Match) {
                let url = m3u8Match[0].replace(/&amp;/g, '&');
                // Construct URL if it's incomplete in the unpacked script
                if (url.includes("master.m3u8") && (!url.includes("?t=") || !url.includes("&s="))) {
                    const t = kArr.find(k => k.length > 30);
                    const s = kArr.find(k => /^\d{10}$/.test(k));
                    const v = kArr.find(k => /^\d{8,9}$/.test(k));
                    const sp = kArr.find(k => k === "43200");
                    if (t && !url.includes("t=")) url += (url.includes("?") ? "&" : "?") + "t=" + t;
                    if (s && !url.includes("s=")) url += "&s=" + s;
                    if (sp && !url.includes("e=")) url += "&e=" + sp;
                    if (v && !url.includes("v=")) url += "&v=" + v;
                    if (!url.includes("sp=")) url += "&sp=0";
                }
                return url;
            }
        } catch (e) {}
    }

    return null;
}

function buildEmbedInfo(serverName, serverId) {
    const name = serverName.toLowerCase();
    const common = { referer: "https://qesen.net/" };

    if (name.includes("arab") || name.includes("pro") || name.includes("red") || name.includes("turk")) {
        return {
            ...common,
            embedUrl: "https://v.turkvearab.com/embed-" + serverId + ".html",
            streamReferer: "https://v.turkvearab.com/"
        };
    }
    if (name === "estream") {
        return {
            ...common,
            embedUrl: "https://arabveturk.com/embed-" + serverId + ".html",
            streamReferer: "https://arabveturk.com/"
        };
    }
    // Handle direct URLs (like cloud.mail.ru)
    if (serverId.startsWith("http")) {
        return { url: serverId, name: serverName };
    }
    return null;
}

async function getQesehStreams(imdbId, season, episode) {
    const meta = await getTmdbMeta(imdbId);
    if (!meta) return [];

    const episodeUrl = await findEpisodeUrl(meta.originalTitle, meta.englishTitle, episode);
    if (!episodeUrl) return [];

    const playerData = await extractPlayerData(episodeUrl);
    if (!playerData) return [];

    const results = await Promise.allSettled(
        playerData.servers.map(async (server) => {
            const info = buildEmbedInfo(server.name, server.id);
            if (!info) return null;
            if (info.url) return { name: info.name, url: info.url };
            const m3u8 = await extractM3u8FromEmbed(info.embedUrl, info.referer);
            if (!m3u8) return null;
            return { name: server.name, url: m3u8, streamReferer: info.streamReferer };
        })
    );

    const streams = [];
    for (const r of results) {
        if (r.status === "fulfilled" && r.value) {
            const emoji = r.value.name.toLowerCase().includes("hd") ? "🎬" : "📺";
            streams.push({
                name: "Qeseh by Abdulluh.X",
                title: emoji + " " + r.value.name + " | مترجم عربي",
                url: r.value.url,
                behaviorHints: {
                    notWebReady: false,
                    headers: r.value.streamReferer ? {
                        "Referer": r.value.streamReferer,
                        "Origin": r.value.streamReferer.replace(/\/$/, "")
                    } : {}
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
            return res.end(JSON.stringify({ streams: [] }));
        }
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Not found" }));
};
