// Serverless proxy for WeatherAPI's search.json (autocomplete) endpoint.
// Same reasoning as api/weather.js: key stays server-side, results are
// cached briefly since place-name suggestions barely change minute to minute.

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
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
    if (cache.size > 300) {
        const oldestKey = cache.keys().next().value;
        cache.delete(oldestKey);
    }
}

module.exports = async (req, res) => {
    const apiKey = process.env.WEATHERAPI_KEY;
    if (!apiKey) {
        res.status(500).json({ error: { message: "Server is missing WEATHERAPI_KEY." } });
        return;
    }

    const q = (req.query.q || "").toString().trim();
    if (q.length < 2) {
        res.status(200).json([]);
        return;
    }

    const cacheKey = `search:${q.toLowerCase()}`;
    const cached = getCached(cacheKey);
    if (cached) {
        res.setHeader("X-Atmos-Cache", "HIT");
        res.setHeader("Cache-Control", "public, max-age=120");
        res.status(200).json(cached);
        return;
    }

    try {
        const upstream = await fetch(
            `https://api.weatherapi.com/v1/search.json?key=${apiKey}&q=${encodeURIComponent(q)}`
        );
        const data = await upstream.json();

        if (!upstream.ok) {
            res.status(upstream.status).json(data);
            return;
        }

        setCached(cacheKey, data);
        res.setHeader("X-Atmos-Cache", "MISS");
        res.setHeader("Cache-Control", "public, max-age=120");
        res.status(200).json(data);
    } catch (error) {
        res.status(502).json({ error: { message: "Upstream search service is unreachable." } });
    }
};
