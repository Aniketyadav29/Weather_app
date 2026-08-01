// Serverless proxy for WeatherAPI's forecast.json endpoint.
//
// Why this exists: the original client called WeatherAPI directly with the
// key hardcoded in script.js, which means anyone opening dev tools could
// copy the key and burn through the quota. This function keeps the key on
// the server (read from an environment variable) and adds a short-lived
// in-memory cache so repeated searches for the same place within a few
// minutes don't cost a second upstream request.
//
// Deploy target: Vercel (zero-config — any file in /api becomes a function).
// Set WEATHERAPI_KEY in your project's environment variables before deploying.

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map();

function getCached(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.time > CACHE_TTL_MS) {
        cache.delete(key);
        return null;
    }
    return hit.data;
}

function setCached(key, data) {
    cache.set(key, { data, time: Date.now() });
    // Keep the cache from growing without bound on a long-lived instance.
    if (cache.size > 300) {
        const oldestKey = cache.keys().next().value;
        cache.delete(oldestKey);
    }
}

module.exports = async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        res.status(200).end();
        return;
    }

    const apiKey = process.env.WEATHERAPI_KEY;
    if (!apiKey) {
        res.status(500).json({ error: { message: "Server is missing WEATHERAPI_KEY." } });
        return;
    }

    const q = (req.query.q || "").toString().trim();
    if (!q) {
        res.status(400).json({ error: { message: "Missing q parameter." } });
        return;
    }

    const days = (req.query.days || "3").toString();
    const aqi = req.query.aqi === "no" ? "no" : "yes";
    const alerts = req.query.alerts === "no" ? "no" : "yes";

    const cacheKey = `forecast:${q.toLowerCase()}:${days}:${aqi}:${alerts}`;
    const cached = getCached(cacheKey);
    if (cached) {
        res.setHeader("X-Atmos-Cache", "HIT");
        res.setHeader("Cache-Control", "public, max-age=60");
        res.status(200).json(cached);
        return;
    }

    try {
        const upstream = await fetch(
            `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${encodeURIComponent(q)}&days=${encodeURIComponent(days)}&aqi=${aqi}&alerts=${alerts}`
        );
        const data = await upstream.json();

        if (!upstream.ok) {
            res.status(upstream.status).json(data);
            return;
        }

        setCached(cacheKey, data);
        res.setHeader("X-Atmos-Cache", "MISS");
        res.setHeader("Cache-Control", "public, max-age=60");
        res.status(200).json(data);
    } catch (error) {
        res.status(502).json({ error: { message: "Upstream weather service is unreachable." } });
    }
};
