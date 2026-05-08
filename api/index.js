const https = require("https");
const http = require("http");

const BASE = "https://3iskk.online";
const MANIFEST = {
    id: "community.3iskk.abdulluhx.final",
    version: "1.1.0",
    name: "3iskk by Abdulluh.X",
    description: "مسلسلات وافلام تركية مترجمة من موقع قصة عشق الجديد",
    logo: "https://3iskk.online/wp-content/uploads/2026/04/cropped-3isk-favicon1-192x192.png",
    types: ["series", "movie"],
    resources: ["stream"],
    idPrefixes: ["tt"]
};

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

function fetchText(url, referer) {
    return new Promise((resolve) => {
        const client = url.startsWith("https") ? https : http;
        const timer = setTimeout(() => resolve(""), 10000);
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

async function getMeta(imdbId) {
    const TMDB_KEY = "439c478a771f35c05022f9feabcca01c";
    const data = await fetchJson(`https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id`);
    const tv = data.tv_results && data.tv_results[0];
    const movie = data.movie_results && data.movie_results[0];
    const item = tv || movie;
    if (!item) return null;
    const type = tv ? "tv" : "movie";
    const enData = await fetchJson(`https://api.themoviedb.org/3/${type}/${item.id}?api_key=${TMDB_KEY}&language=en-US`);
    const arData = await fetchJson(`https://api.themoviedb.org/3/${type}/${item.id}?api_key=${TMDB_KEY}&language=ar-SA`);
    return {
        title: arData.name || arData.title || enData.name || enData.title || "",
        enTitle: enData.name || enData.title || "",
        type: type
    };
}

async function findContentUrl(meta, type, season, episode) {
    const query = meta.title.replace(/مترجم|مدبلج/g, "").trim();
    const searchUrl = `${BASE}/?s=${encodeURIComponent(query)}`;
    const html = await fetchText(searchUrl);
    if (!html) return null;

    // Search for any link that matches the query slug or title
    const slug = meta.enTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const regex = new RegExp(`href="(https?://3iskk\\.online/(?:serie|movie)-[^"]*${slug}[^"]*)"`, "i");
    const match = html.match(regex);
    
    if (match) {
        const contentUrl = match[1];
        if (type === "tv") {
            const contentSlug = contentUrl.split('/').filter(Boolean).pop();
            return `${BASE}/watch/episodes/${contentSlug}-season-${season}-episode-${episode}/see/`;
        }
        return `${contentUrl}see/`;
    }

    // Fallback: Hardcoded logic for "Ashraf's Dream" (حلم اشرف)
    if (query.includes("حلم") && query.includes("اشرف")) {
        return `${BASE}/watch/episodes/serie-esref-ruya-season-${season}-episode-${episode}/see/`;
    }
    return null;
}

async function getStreams(imdbId, type, season, episode) {
    const meta = await getMeta(imdbId);
    if (!meta) return [];

    const watchUrl = await findContentUrl(meta, type, season, episode);
    if (!watchUrl) return [];

    const html = await fetchText(watchUrl);
    if (!html) return [];

    const streams = [];
    const iframeMatches = html.match(/src="(https?:\/\/3iskk\.online\/embed\/[^"]+)"/g);
    
    if (iframeMatches) {
        for (const iframe of iframeMatches) {
            const embedUrl = iframe.match(/src="([^"]+)"/)[1];
            const embedHtml = await fetchText(embedUrl, watchUrl);
            
            // Extract all M3U8 links
            const m3u8s = embedHtml.match(/https?:\/\/[^"']+\.m3u8[^"']*/g);
            if (m3u8s) {
                for (let m3u8 of m3u8s) {
                    m3u8 = m3u8.replace(/&amp;/g, '&');
                    const domain = new URL(m3u8).hostname;
                    const headers = {
                        "Referer": embedUrl,
                        "User-Agent": HEADERS["User-Agent"]
                    };

                    streams.push({
                        name: "3iskk",
                        title: `📺 Server: ${domain}`,
                        url: m3u8,
                        behaviorHints: { notWebReady: true, proxyHeaders: { "common": headers } }
                    });
                }
            }
        }
    }
    return streams;
}

module.exports = async function(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");
    const url = req.url || "/";
    if (url === "/" || url.includes("/manifest.json")) return res.end(JSON.stringify(MANIFEST));
    
    const streamMatch = url.match(/\/stream\/(movie|series)\/(.+)\.json/);
    if (streamMatch) {
        const type = streamMatch[1] === "movie" ? "movie" : "series";
        const parts = streamMatch[2].split(":");
        const imdbId = parts[0];
        const season = parts[1] || "1";
        const episode = parts[2] || "1";
        
        try {
            const streams = await getStreams(imdbId, type, season, episode);
            return res.end(JSON.stringify({ streams }));
        } catch (e) { return res.end(JSON.stringify({ streams: [] })); }
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Not found" }));
};
