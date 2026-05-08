const https = require("https");
const http = require("http");

const BASE = "https://3iskk.online";
const MANIFEST = {
    id: "community.3iskk.abdulluhx",
    version: "1.0.3",
    name: "3iskk by Abdulluh.X",
    description: "مسلسلات وافلام تركية مترجمة من موقع قصة عشق الجديد",
    logo: "https://3iskk.online/wp-content/uploads/2026/04/cropped-3isk-favicon1-192x192.png",
    types: ["series", "movie"],
    catalogs: [],
    resources: ["stream"],
    idPrefixes: ["tt"]
};

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.8,en;q=0.5"
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

async function getTmdbMeta(imdbId) {
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
        originalTitle: enData.original_name || enData.original_title || "",
        type: type
    };
}

function romanizeToSlug(name) {
    const map = { "ş": "s", "Ş": "s", "ü": "u", "Ü": "u", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c", "ı": "i", "İ": "i", "ğ": "g", "Ğ": "g" };
    return String(name || "").replace(/[şŞüÜöÖçÇıİğĞ]/g, c => map[c] || c).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function findContentUrl(meta, type, season, episode) {
    const slugs = [romanizeToSlug(meta.originalTitle), romanizeToSlug(meta.title)];
    for (const slug of slugs) {
        if (!slug) continue;
        const url = type === "tv" ? 
            `${BASE}/watch/episodes/serie-${slug}-season-${season}-episode-${episode}/see/` :
            `${BASE}/watch/movies/movie-${slug}/see/`;
        
        const html = await fetchText(url);
        if (html && html.length > 1000 && !html.includes("404")) return url;
    }

    // Search Fallback
    const searchHtml = await fetchText(`${BASE}/?s=${encodeURIComponent(meta.title)}`);
    const linkPattern = /href="(https?:\/\/3iskk\.online\/(?:serie|movie)-[^"]+)"/g;
    let match;
    if (searchHtml) {
        while ((match = linkPattern.exec(searchHtml)) !== null) {
            const url = match[1];
            const slug = url.split('/').filter(Boolean).pop();
            const epUrl = type === "tv" ? 
                `${BASE}/watch/episodes/${slug}-season-${season}-episode-${episode}/see/` :
                `${BASE}/watch/movies/${slug}/see/`;
            const epHtml = await fetchText(epUrl);
            if (epHtml && epHtml.length > 1000 && !epHtml.includes("404")) return epUrl;
        }
    }
    return null;
}

function extractM3u8(text) {
    const m = text.match(/https?:\/\/[^\s"'<>|]+\.m3u8[^\s"'<>|]*/g);
    return m ? [...new Set(m)].map(u => u.replace(/&amp;/g, '&')) : [];
}

async function getStreams(imdbId, type, season, episode) {
    const meta = await getTmdbMeta(imdbId);
    if (!meta) return [];

    const watchPageUrl = await findContentUrl(meta, type, season, episode);
    if (!watchPageUrl) return [];

    const html = await fetchText(watchPageUrl);
    const iframeMatches = html.match(/src="(https?:\/\/3iskk\.online\/embed\/[^"]+)"/g);
    if (!iframeMatches) return [];

    const streams = [];
    for (const iframe of iframeMatches) {
        const embedUrl = iframe.match(/src="([^"]+)"/)[1];
        const embedHtml = await fetchText(embedUrl, watchPageUrl);
        
        const subIframe = embedHtml.match(/<iframe[^>]+src="([^"]+)"/);
        if (subIframe) {
            const finalEmbedUrl = subIframe[1];
            const finalHtml = await fetchText(finalEmbedUrl, embedUrl);
            const m3u8s = extractM3u8(finalHtml);
            
            for (const m3u8 of m3u8s) {
                const domain = new URL(m3u8).hostname;
                const headers = {
                    "Referer": finalEmbedUrl,
                    "Origin": new URL(finalEmbedUrl).origin,
                    "User-Agent": HEADERS["User-Agent"]
                };

                const urlsetMatch = m3u8.match(/^(.+_),([a-zA-Z0-9,]+),\.urlset\/master\.m3u8(\?.+)?$/);
                if (urlsetMatch) {
                    const qualMap = { x: "1080P", h: "720P", n: "480P", l: "360P" };
                    urlsetMatch[2].split(",").forEach(q => {
                        if (q && qualMap[q]) {
                            streams.push({
                                name: `3iskk [${qualMap[q]}]`,
                                title: `🎬 Server: ${domain} - ${qualMap[q]}`,
                                url: `${urlsetMatch[1]}${q}/index-v1-a1.m3u8${urlsetMatch[3] || ""}`,
                                behaviorHints: { notWebReady: true, proxyHeaders: { "common": headers } }
                            });
                        }
                    });
                } else {
                    streams.push({
                        name: "3iskk by Abdulluh.X",
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
        const type = streamMatch[1] === "movie" ? "movie" : "tv";
        const parts = streamMatch[2].split(":");
        const imdbId = parts[0];
        const season = type === "tv" ? parts[1] : "1";
        const episode = type === "tv" ? parts[2] : "1";
        
        try {
            const streams = await getStreams(imdbId, type, season, episode);
            return res.end(JSON.stringify({ streams }));
        } catch (e) { return res.end(JSON.stringify({ streams: [] })); }
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Not found" }));
};
