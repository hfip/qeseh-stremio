const https = require("https");
const http = require("http");

const BASE = "https://wwv.qeseh.com";
const FALLBACK_POSTER = "https://qeseh.net/wp-content/uploads/2026/02/cropped-qeseh2026-192x192.png";

const MANIFEST = {
    id: "community.qeseh.abdulluhx",
    version: "1.0.4",
    name: "Qeseh by Abdulluh.X",
    description: "مسلسلات وافلام تركية مترجمة من قصة عشق",
    logo: "https://qeseh.net/wp-content/uploads/2026/02/cropped-qeseh2026-192x192.png",
    types: ["series"],
    catalogs: [],
    resources: ["stream"],
    idPrefixes: ["tt"]
};

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "ar,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
};

function fetchText(url, referer) {
    return new Promise((resolve) => {
        const client = url.startsWith("https") ? https : http;
        const timer = setTimeout(() => resolve(""), 8000);
        try {
            const req = client.get(url, {
                headers: {
                    ...HEADERS,
                    "Referer": referer || BASE
                }
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
    return name.replace(/[şŞüÜöÖçÇıİğĞ]/g, c => map[c] || c).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function findEpisodeUrl(originalTitle, englishTitle, episode) {
    const slugs = [];
    if (originalTitle) slugs.push(romanizeToSlug(originalTitle));
    if (englishTitle) slugs.push(romanizeToSlug(englishTitle));
    if (originalTitle) slugs.push(romanizeToSlug(originalTitle.split(":")[0].trim()));

    for (const slug of slugs) {
        const url = `${BASE}/clarus/${slug}-episode-${episode}/`;
        const html = await fetchText(url);
        if (html && html.length > 1000 && !html.includes("404") && (html.includes("qeseh") || html.includes("modern-player"))) {
            return url;
        }
    }

    for (const title of [originalTitle, englishTitle].filter(Boolean)) {
        const searchHtml = await fetchText(`${BASE}/?s=${encodeURIComponent(title)}`);
        if (!searchHtml) continue;
        const epPattern = new RegExp(`href="(${BASE.replace(/\./g, "\\.")}/clarus/[^"]*episode-${episode}[^"]*/)"`, "i");
        const m = searchHtml.match(epPattern);
        if (m) return m[1];
    }

    return null;
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

async function extractM3u8FromEmbed(embedUrl, referer) {
    const html = await fetchText(embedUrl, referer);
    if (!html || html.length < 100 || html.includes("File is no longer available")) return null;

    if (html.includes("eval(function(p,a,c,k,e,d)")) {
        const unpacked = unpackPACK(html);
        const m3u8 = extractM3u8(unpacked);
        if (m3u8) return m3u8;
    }
    return extractM3u8(html);
}

function buildEmbedInfo(serverName, serverId) {
    const name = serverName.toLowerCase();
    const common = { referer: "https://qesen.net/" };

    if (name.includes("arab") || name.includes("pro") || name.includes("red") || name.includes("turk")) {
        return {
            ...common,
            embedUrl: `https://v.turkvearab.com/embed-${serverId}.html`,
            streamReferer: "https://v.turkvearab.com/"
        };
    }
    if (name.includes("estream")) {
        return {
            ...common,
            embedUrl: `https://arabveturk.com/embed-${serverId}.html`,
            streamReferer: "https://arabveturk.com/"
        };
    }
    if (serverId.startsWith("http")) return { url: serverId, name: serverName };
    return null;
}

async function getQesehStreams(imdbId, season, episode) {
    const meta = await getTmdbMeta(imdbId);
    if (!meta) return [];

    const episodeUrl = await findEpisodeUrl(meta.originalTitle, meta.englishTitle, episode);
    if (!episodeUrl) return [];

    const html = await fetchText(episodeUrl);
    const watchMatch = html.match(/href="(https?:\/\/(?:qesen\.net|thenextstop\.net)[^"]*\?post=([A-Za-z0-9+/=]+))"/);
    if (!watchMatch) return [];

    try {
        const decoded = JSON.parse(Buffer.from(watchMatch[2], "base64").toString("utf-8"));
        const results = await Promise.allSettled(
            decoded.servers.map(async (server) => {
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
                const isHD = r.value.name.toLowerCase().includes("hd");
                const emoji = isHD ? "🎬" : "📺";
                
                // Multi-quality support for urlset
                const urlsetMatch = r.value.url.match(/^(.+_),([a-zA-Z]+(?:,[a-zA-Z]+)*),\.urlset\/master\.m3u8(\?.+)?$/);
                if (urlsetMatch) {
                    const qualMap = { x: "1080P", h: "720P", n: "480P", l: "360P" };
                    urlsetMatch[2].split(",").forEach(q => {
                        if (qualMap[q]) {
                            streams.push({
                                name: `Qeseh [${qualMap[q]}]`,
                                title: `${emoji} ${r.value.name} - ${qualMap[q]}`,
                                url: `${urlsetMatch[1]}${q}/index-v1-a1.m3u8${urlsetMatch[3] || ""}`,
                                behaviorHints: {
                                    notWebReady: true,
                                    proxyHeaders: {
                                        "common": {
                                            "Referer": r.value.streamReferer,
                                            "Origin": r.value.streamReferer.replace(/\/$/, ""),
                                            "User-Agent": HEADERS["User-Agent"]
                                        }
                                    }
                                }
                            });
                        }
                    });
                } else {
                    streams.push({
                        name: "Qeseh by Abdulluh.X",
                        title: `${emoji} ${r.value.name} | مترجم عربي`,
                        url: r.value.url,
                        behaviorHints: {
                            notWebReady: true,
                            proxyHeaders: {
                                "common": {
                                    "Referer": r.value.streamReferer || "https://v.turkvearab.com/",
                                    "Origin": (r.value.streamReferer || "https://v.turkvearab.com/").replace(/\/$/, ""),
                                    "User-Agent": HEADERS["User-Agent"]
                                }
                            }
                        }
                    });
                }
            }
        }
        return streams;
    } catch (e) { return []; }
}

module.exports = async function(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");

    const url = req.url || "/";
    if (url === "/" || url.includes("/manifest.json")) return res.end(JSON.stringify(MANIFEST));

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
