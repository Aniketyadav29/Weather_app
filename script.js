/* ====================================================================
   ATMOS — FIELD WEATHER INSTRUMENT
   Client Application Engine v2.6 (Live Open-Meteo & Climate Engine Fix)
   ==================================================================== */

// DOM Elements
const searchButton = document.getElementById("searchBtn");
const locationButton = document.getElementById("locationBtn");
const cityName = document.getElementById("cityName");
const weatherDetails = document.getElementById("weatherDetails");
const aqiButton = document.getElementById("aqiBtn");
const aqiCityName = document.getElementById("aqiCityName");
const aqiDetails = document.getElementById("aqiDetails");
const placeButton = document.getElementById("placeBtn");
const placeCityName = document.getElementById("placeCityName");
const placeDetails = document.getElementById("placeDetails");
const unitToggle = document.getElementById("unitToggle");
const favoritesBar = document.getElementById("favoritesBar");
const favoritesList = document.getElementById("favoritesList");
const demoBadge = document.getElementById("demoBadge");

// Modals & Controls
const settingsBtn = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const closeSettingsModal = document.getElementById("closeSettingsModal");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const apiKeyInput = document.getElementById("apiKeyInput");
const dataModeSelect = document.getElementById("dataModeSelect");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");

const compareBtn = document.getElementById("compareBtn");
const compareModal = document.getElementById("compareModal");
const closeCompareModal = document.getElementById("closeCompareModal");
const runCompareBtn = document.getElementById("runCompareBtn");
const compareLoc1Input = document.getElementById("compareLoc1Input");
const compareLoc2Input = document.getElementById("compareLoc2Input");

const alertModal = document.getElementById("alertModal");
const closeAlertModal = document.getElementById("closeAlertModal");
const alertModalBody = document.getElementById("alertModalBody");

const exportReportBtn = document.getElementById("exportReportBtn");
const toastEl = document.getElementById("toast");

// Application State
let unit = localStorage.getItem("atmos.unit") || "c";
let lastWeatherData = null;
let leafletMap = null;
let leafletMarker = null;
const animatedValuesMap = new Map();

/* -------------------------------------------------------------------- */
/* 1. Storage & Preferences                                              */
/* -------------------------------------------------------------------- */

function getStoredApiKey() {
    return localStorage.getItem("atmos.apiKey") || "";
}

function getDataMode() {
    return localStorage.getItem("atmos.dataMode") || "auto";
}

function getFavorites() {
    try {
        const raw = localStorage.getItem("atmos.favorites");
        return raw ? JSON.parse(raw) : ["Jaipur, India", "London, UK", "Tokyo, Japan"];
    } catch (e) {
        return ["Jaipur, India", "London, UK", "Tokyo, Japan"];
    }
}

function saveFavorites(list) {
    try {
        localStorage.setItem("atmos.favorites", JSON.stringify(list));
    } catch (e) {}
}

function toggleFavorite(placeName) {
    if (!placeName) return;
    let list = getFavorites();
    const exists = list.some(item => item.toLowerCase() === placeName.toLowerCase());
    if (exists) {
        list = list.filter(item => item.toLowerCase() !== placeName.toLowerCase());
        showToast("Removed from favorites", "★");
    } else {
        list.unshift(placeName);
        if (list.length > 6) list.pop();
        showToast("Added to favorites!", "⭐");
    }
    saveFavorites(list);
    renderFavoritesBar();
    if (lastWeatherData && `${lastWeatherData.location.name}, ${lastWeatherData.location.country}`.toLowerCase() === placeName.toLowerCase()) {
        updateWeatherDetails(lastWeatherData);
    }
}

function renderFavoritesBar() {
    if (!favoritesList || !favoritesBar) return;
    const favs = getFavorites();
    if (!favs.length) {
        favoritesBar.style.display = "none";
        return;
    }
    favoritesBar.style.display = "flex";
    favoritesList.innerHTML = favs.map(place => `
        <button type="button" class="fav-chip" data-place="${escapeHTML(place)}">
            ★ ${escapeHTML(place)}
        </button>
    `).join("");

    favoritesList.querySelectorAll(".fav-chip").forEach(btn => {
        btn.addEventListener("click", () => {
            const query = btn.dataset.place;
            cityName.value = query;
            searchButton.click();
        });
    });
}

/* -------------------------------------------------------------------- */
/* 2. Toast Notifications & Helpers                                      */
/* -------------------------------------------------------------------- */

function showToast(message, icon = "✨") {
    if (!toastEl) return;
    const msgEl = document.getElementById("toastMsg");
    const iconEl = document.getElementById("toastIcon");
    if (msgEl) msgEl.textContent = message;
    if (iconEl) iconEl.textContent = icon;
    toastEl.style.display = "flex";
    setTimeout(() => {
        toastEl.style.display = "none";
    }, 3000);
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
    }[c]));
}

function formatNumber(value, digits = 1) {
    const num = Number(value);
    return isNaN(num) ? "0.0" : num.toFixed(digits);
}

function cToF(c) { return (Number(c) * 9) / 5 + 32; }
function kphToMph(kph) { return Number(kph) * 0.621371; }

function tempDisplay(celsius, digits = 1) {
    return unit === "f" ? formatNumber(cToF(celsius), digits) : formatNumber(celsius, digits);
}

function windDisplay(kph, digits = 1) {
    return unit === "f" ? `${formatNumber(kphToMph(kph), digits)} mph` : `${formatNumber(kph, digits)} km/h`;
}

function unitSuffix() { return unit === "f" ? "°F" : "°C"; }

function scrollToSection(sectionId) {
    document.querySelector(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

function setLoading(target, message, note = "Gathering live weather and telemetry data...") {
    target.innerHTML = `
        <div class="field-note p-8 text-center">
            <div class="shimmer mx-auto mb-4 h-11 w-11 rounded-full"></div>
            <p class="font-display text-lg" style="color: var(--text-hi);">${escapeHTML(message)}</p>
            <p class="mt-2 text-sm" style="color: var(--text-lo);">${escapeHTML(note)}</p>
        </div>
    `;
}

function showMessage(target, title, message, tone = "brass") {
    const toneColors = {
        brass: "var(--brass)",
        red: "var(--rose)",
        amber: "var(--brass)",
    };
    target.innerHTML = `
        <div class="field-note p-8 text-center" style="border-color:${toneColors[tone] || "var(--brass)"};">
            <p class="font-display text-lg" style="color: var(--text-hi);">${escapeHTML(title)}</p>
            <p class="mt-2 text-sm leading-6" style="color: var(--text-lo);">${escapeHTML(message)}</p>
        </div>
    `;
}

/* -------------------------------------------------------------------- */
/* 3. Number Interpolation & Animation                                   */
/* -------------------------------------------------------------------- */

function animateNumber(el, targetValue, { decimals = 0, duration = 600, suffix = "" } = {}) {
    if (!el) return;
    const elementId = el.id || el.getAttribute("data-anim-id") || Math.random().toString();
    if (!el.hasAttribute("data-anim-id")) el.setAttribute("data-anim-id", elementId);

    const fromValue = animatedValuesMap.has(elementId) ? animatedValuesMap.get(elementId) : (targetValue * 0.5);
    animatedValuesMap.set(elementId, targetValue);

    const start = performance.now();
    function tick(now) {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = fromValue + (targetValue - fromValue) * eased;
        el.textContent = `${current.toFixed(decimals)}${suffix}`;
        if (progress < 1) requestAnimationFrame(tick);
        else el.textContent = `${targetValue.toFixed(decimals)}${suffix}`;
    }
    requestAnimationFrame(tick);
}

/* -------------------------------------------------------------------- */
/* 4. Client Response Cache & Recent Searches                           */
/* -------------------------------------------------------------------- */

const CLIENT_CACHE_TTL_MS = 4 * 60 * 1000;
const responseCache = new Map();

function cacheGet(key) {
    const hit = responseCache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.time > CLIENT_CACHE_TTL_MS) {
        responseCache.delete(key);
        return null;
    }
    return hit.data;
}

function cacheSet(key, data) {
    responseCache.set(key, { data, time: Date.now() });
}

const RECENT_KEY = "atmos.recentSearches";
const RECENT_MAX = 8;

function getRecentSearches() {
    try {
        const raw = localStorage.getItem(RECENT_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}

function addRecentSearch(label) {
    const trimmed = (label || "").trim();
    if (!trimmed) return;
    const deduped = getRecentSearches().filter((item) => item.toLowerCase() !== trimmed.toLowerCase());
    deduped.unshift(trimmed);
    try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(deduped.slice(0, RECENT_MAX)));
    } catch (e) {}
}

function renderRecentChips(container, onPick) {
    if (!container) return;
    const recents = getRecentSearches();
    if (!recents.length) {
        container.innerHTML = "";
        container.style.display = "none";
        return;
    }
    container.style.display = "flex";
    container.innerHTML = recents
        .map((label) => `<button type="button" class="recent-chip" data-value="${escapeHTML(label)}">${escapeHTML(label)}</button>`)
        .join("");
    container.querySelectorAll(".recent-chip").forEach((chip) => {
        chip.addEventListener("click", () => onPick(chip.dataset.value));
    });
}

function refreshAllRecentChips() {
    renderRecentChips(document.getElementById("recentChipsHome"), (value) => {
        cityName.value = value;
        searchButton.click();
    });
    renderRecentChips(document.getElementById("recentChipsAqi"), (value) => {
        aqiCityName.value = value;
        aqiButton.click();
    });
    renderRecentChips(document.getElementById("recentChipsPlaces"), (value) => {
        placeCityName.value = value;
        placeButton.click();
    });
}

/* -------------------------------------------------------------------- */
/* 5. Open-Meteo Live Zero-Key Weather Engine                           */
/* -------------------------------------------------------------------- */

function degreesToDir(deg) {
    const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return directions[Math.round(deg / 22.5) % 16];
}

function wmoToCondition(code, isDay = 1) {
    if (code === 0) return { text: isDay ? "Clear sky" : "Clear night", icon: isDay ? "//cdn.weatherapi.com/weather/64x64/day/113.png" : "//cdn.weatherapi.com/weather/64x64/night/113.png" };
    if (code === 1 || code === 2) return { text: "Partly cloudy", icon: isDay ? "//cdn.weatherapi.com/weather/64x64/day/116.png" : "//cdn.weatherapi.com/weather/64x64/night/116.png" };
    if (code === 3) return { text: "Overcast", icon: "//cdn.weatherapi.com/weather/64x64/day/122.png" };
    if (code === 45 || code === 48) return { text: "Foggy", icon: "//cdn.weatherapi.com/weather/64x64/day/248.png" };
    if (code >= 51 && code <= 57) return { text: "Drizzle", icon: "//cdn.weatherapi.com/weather/64x64/day/266.png" };
    if (code >= 61 && code <= 67) return { text: "Rain", icon: "//cdn.weatherapi.com/weather/64x64/day/296.png" };
    if (code >= 71 && code <= 77) return { text: "Snow", icon: "//cdn.weatherapi.com/weather/64x64/day/338.png" };
    if (code >= 80 && code <= 82) return { text: "Rain showers", icon: "//cdn.weatherapi.com/weather/64x64/day/353.png" };
    if (code >= 85 && code <= 86) return { text: "Snow showers", icon: "//cdn.weatherapi.com/weather/64x64/day/371.png" };
    if (code >= 95) return { text: "Thunderstorm", icon: "//cdn.weatherapi.com/weather/64x64/day/389.png" };
    return { text: "Fair", icon: "//cdn.weatherapi.com/weather/64x64/day/113.png" };
}

async function geocodePlace(placeQuery) {
    const coordMatch = placeQuery.match(/^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$/);
    if (coordMatch) {
        return {
            lat: parseFloat(coordMatch[1]),
            lon: parseFloat(coordMatch[2]),
            name: `${parseFloat(coordMatch[1]).toFixed(2)}, ${parseFloat(coordMatch[2]).toFixed(2)}`,
            country: "GPS Target",
            region: "Coordinates"
        };
    }

    // Try Nominatim (OpenStreetMap) geocoding first
    try {
        const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(placeQuery)}&limit=1`;
        const nomRes = await fetch(nomUrl, { headers: { 'User-Agent': 'AtmosWeatherApp/2.6' } });
        if (nomRes.ok) {
            const nomData = await nomRes.json();
            if (nomData && nomData.length) {
                const item = nomData[0];
                const parts = (item.display_name || "").split(", ");
                return {
                    lat: parseFloat(item.lat),
                    lon: parseFloat(item.lon),
                    name: item.name || parts[0] || placeQuery,
                    country: parts[parts.length - 1] || "World",
                    region: parts.length > 2 ? parts[parts.length - 2] : (parts[1] || "")
                };
            }
        }
    } catch (e) {}

    // Fallback: Try Open-Meteo Geocoding API
    try {
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(placeQuery)}&count=1&language=en`;
        const geoRes = await fetch(geoUrl);
        if (geoRes.ok) {
            const geoData = await geoRes.json();
            if (geoData.results && geoData.results.length) {
                const loc = geoData.results[0];
                return {
                    lat: loc.latitude,
                    lon: loc.longitude,
                    name: loc.name,
                    country: loc.country || loc.admin1 || "World",
                    region: loc.admin1 || ""
                };
            }
        }
    } catch (e) {}

    throw new Error(`Location '${placeQuery}' not found.`);
}

async function fetchOpenMeteoData(placeQuery) {
    const loc = await geocodePlace(placeQuery);
    const lat = loc.lat;
    const lon = loc.lon;

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,weathercode,surface_pressure,cloudcover,windspeed_10m,winddirection_10m,uv_index&daily=weathercode,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max&timezone=auto`;
    const aqiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,us_aqi`;

    const [wRes, aRes] = await Promise.all([
        fetch(weatherUrl),
        fetch(aqiUrl).catch(() => null)
    ]);

    if (!wRes.ok) throw new Error("Open-Meteo telemetry fetch failed.");
    const wData = await wRes.json();
    const aData = aRes && aRes.ok ? await aRes.json() : null;

    const cur = wData.current_weather || {};
    const daily = wData.daily || {};
    const hourly = wData.hourly || {};
    const aHourly = aData?.hourly || {};

    const cond = wmoToCondition(cur.weathercode ?? 0, cur.is_day ?? 1);
    const windDirStr = degreesToDir(cur.winddirection || 0);

    const now = new Date();
    const currentHourIdx = now.getHours();

    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const forecastday = (daily.time || []).slice(0, 3).map((dateStr, idx) => {
        const dCond = wmoToCondition(daily.weathercode?.[idx] || 0, 1);
        const dayHours = Array.from({ length: 24 }, (_, i) => {
            const hIdx = idx * 24 + i;
            const hCode = hourly.weathercode?.[hIdx] ?? 0;
            const hCond = wmoToCondition(hCode, i >= 6 && i <= 19 ? 1 : 0);
            return {
                time: `${dateStr} ${String(i).padStart(2, '0')}:00`,
                temp_c: hourly.temperature_2m?.[hIdx] ?? cur.temperature ?? 20,
                condition: { text: hCond.text, icon: hCond.icon },
                chance_of_rain: hourly.precipitation_probability?.[hIdx] ?? 0,
                chance_of_snow: 0
            };
        });

        const sr = daily.sunrise?.[idx] ? new Date(daily.sunrise[idx]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "06:00 AM";
        const ss = daily.sunset?.[idx] ? new Date(daily.sunset[idx]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "07:00 PM";

        return {
            date: dateStr,
            day: {
                maxtemp_c: daily.temperature_2m_max?.[idx] ?? ((cur.temperature || 20) + 3),
                mintemp_c: daily.temperature_2m_min?.[idx] ?? ((cur.temperature || 20) - 3),
                condition: { text: dCond.text, icon: dCond.icon }
            },
            astro: {
                sunrise: sr,
                sunset: ss,
                moon_phase: "Waxing Gibbous",
                moon_illumination: "76%"
            },
            hour: dayHours
        };
    });

    const epaCalc = Math.min(6, Math.max(1, Math.ceil(((aHourly.us_aqi?.[currentHourIdx] ?? 35)) / 35)));

    return {
        isOpenMeteo: true,
        location: {
            name: loc.name,
            country: loc.country,
            region: loc.region,
            lat: lat,
            lon: lon,
            localtime: timeStr
        },
        current: {
            temp_c: cur.temperature ?? 20,
            feelslike_c: hourly.apparent_temperature?.[currentHourIdx] ?? cur.temperature ?? 20,
            heatindex_c: hourly.apparent_temperature?.[currentHourIdx] ?? cur.temperature ?? 20,
            condition: { text: cond.text, icon: cond.icon },
            wind_kph: cur.windspeed ?? 10,
            wind_degree: cur.winddirection ?? 0,
            wind_dir: windDirStr,
            humidity: hourly.relative_humidity_2m?.[currentHourIdx] ?? 50,
            cloud: hourly.cloudcover?.[currentHourIdx] ?? 10,
            pressure_mb: hourly.surface_pressure?.[currentHourIdx] ?? 1013,
            vis_km: 10.0,
            uv: hourly.uv_index?.[currentHourIdx] ?? daily.uv_index_max?.[0] ?? 5,
            air_quality: {
                co: aHourly.carbon_monoxide?.[currentHourIdx] ?? 210.0,
                no2: aHourly.nitrogen_dioxide?.[currentHourIdx] ?? 15.0,
                o3: aHourly.ozone?.[currentHourIdx] ?? 45.0,
                so2: aHourly.sulphur_dioxide?.[currentHourIdx] ?? 5.0,
                pm2_5: aHourly.pm2_5?.[currentHourIdx] ?? 12.0,
                pm10: aHourly.pm10?.[currentHourIdx] ?? 22.0,
                "us-epa-index": epaCalc,
                "gb-defra-index": Math.min(10, Math.max(1, epaCalc * 2))
            }
        },
        forecast: { forecastday },
        alerts: { alert: [] }
    };
}

/* -------------------------------------------------------------------- */
/* 6. Location-Seeded Climate Telemetry Generator (Offline Mode)         */
/* -------------------------------------------------------------------- */

const DEMO_LOCATIONS = {
    "jaipur": { name: "Jaipur", country: "India", region: "Rajasthan", lat: 26.92, lon: 75.82, temp: 32, cond: "Sunny", icon: "//cdn.weatherapi.com/weather/64x64/day/113.png", wind: 14, dir: "WSW", hum: 42, press: 1008, uv: 9, pm2_5: 38.5, pm10: 82.1, co: 420.5, no2: 24.1, o3: 56.0, so2: 12.4, epa: 2, defra: 4, sunrise: "05:48 AM", sunset: "07:18 PM" },
    "london": { name: "London", country: "United Kingdom", region: "City of London", lat: 51.52, lon: -0.11, temp: 19, cond: "Partly cloudy", icon: "//cdn.weatherapi.com/weather/64x64/day/116.png", wind: 18, dir: "SW", hum: 68, press: 1016, uv: 5, pm2_5: 9.2, pm10: 16.4, co: 210.0, no2: 14.2, o3: 42.1, so2: 4.8, epa: 1, defra: 2, sunrise: "05:24 AM", sunset: "08:52 PM" },
    "tokyo": { name: "Tokyo", country: "Japan", region: "Tokyo", lat: 35.69, lon: 139.69, temp: 27, cond: "Clear", icon: "//cdn.weatherapi.com/weather/64x64/day/113.png", wind: 11, dir: "ENE", hum: 62, press: 1012, uv: 7, pm2_5: 14.8, pm10: 28.3, co: 290.0, no2: 18.5, o3: 48.9, so2: 8.1, epa: 1, defra: 3, sunrise: "04:46 AM", sunset: "06:48 PM" },
    "new york": { name: "New York", country: "United States of America", region: "New York", lat: 40.71, lon: -74.01, temp: 24, cond: "Light rain shower", icon: "//cdn.weatherapi.com/weather/64x64/day/353.png", wind: 22, dir: "NW", hum: 75, press: 1004, uv: 4, pm2_5: 18.1, pm10: 34.0, co: 310.4, no2: 22.0, o3: 39.5, so2: 7.2, epa: 2, defra: 3, sunrise: "05:56 AM", sunset: "08:12 PM" },
    "delhi": { name: "Delhi", country: "India", region: "Delhi", lat: 28.61, lon: 77.21, temp: 35, cond: "Haze", icon: "//cdn.weatherapi.com/weather/64x64/day/143.png", wind: 9, dir: "E", hum: 54, press: 1005, uv: 8, pm2_5: 98.4, pm10: 185.0, co: 850.0, no2: 45.0, o3: 72.0, so2: 24.0, epa: 4, defra: 8, sunrise: "05:38 AM", sunset: "07:15 PM" },
    "paris": { name: "Paris", country: "France", region: "Ile-de-France", lat: 48.85, lon: 2.35, temp: 22, cond: "Sunny", icon: "//cdn.weatherapi.com/weather/64x64/day/113.png", wind: 13, dir: "NNE", hum: 58, press: 1018, uv: 6, pm2_5: 11.0, pm10: 19.5, co: 230.0, no2: 16.0, o3: 50.0, so2: 5.0, epa: 1, defra: 2, sunrise: "06:12 AM", sunset: "09:30 PM" },
    "sydney": { name: "Sydney", country: "Australia", region: "New South Wales", lat: -33.87, lon: 151.21, temp: 16, cond: "Overcast", icon: "//cdn.weatherapi.com/weather/64x64/day/122.png", wind: 25, dir: "SSE", hum: 72, press: 1022, uv: 3, pm2_5: 7.5, pm10: 12.1, co: 180.0, no2: 10.5, o3: 35.0, so2: 3.2, epa: 1, defra: 1, sunrise: "06:45 AM", sunset: "05:10 PM" }
};

function buildPayloadFromBase(base, query) {
    const now = new Date();
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const forecastday = [0, 1, 2].map((offset) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        const dateStr = d.toISOString().split("T")[0];

        const hours = Array.from({ length: 24 }, (_, i) => ({
            time: `${dateStr} ${String(i).padStart(2, '0')}:00`,
            temp_c: base.temp + Math.sin(i / 3) * 4,
            condition: { text: base.cond, icon: base.icon },
            chance_of_rain: offset === 0 && i > 14 ? 30 : 5,
            chance_of_snow: 0
        }));

        return {
            date: dateStr,
            day: {
                maxtemp_c: base.temp + 3 + offset,
                mintemp_c: base.temp - 4 + offset,
                condition: { text: base.cond, icon: base.icon }
            },
            astro: {
                sunrise: base.sunrise,
                sunset: base.sunset,
                moon_phase: "Waxing Gibbous",
                moon_illumination: "78%"
            },
            hour: hours
        };
    });

    return {
        isDemo: true,
        location: {
            name: base.name || query,
            country: base.country || "Field Station",
            region: base.region || "Telemetry",
            lat: base.lat || 20.0,
            lon: base.lon || 77.0,
            localtime: timeStr
        },
        current: {
            temp_c: base.temp,
            feelslike_c: base.temp + 2,
            heatindex_c: base.temp + 3,
            condition: { text: base.cond, icon: base.icon },
            wind_kph: base.wind,
            wind_degree: (base.lat * 12) % 360,
            wind_dir: base.dir,
            humidity: base.hum,
            cloud: 20,
            pressure_mb: base.press,
            vis_km: 10.0,
            uv: base.uv,
            air_quality: {
                co: base.co,
                no2: base.no2,
                o3: base.o3,
                so2: base.so2,
                pm2_5: base.pm2_5,
                pm10: base.pm10,
                "us-epa-index": base.epa,
                "gb-defra-index": base.defra
            }
        },
        forecast: { forecastday },
        alerts: { alert: [] }
    };
}

function generateDemoWeatherData(placeQuery) {
    const qLower = (placeQuery || "Jaipur").toLowerCase().trim();

    if (DEMO_LOCATIONS[qLower]) {
        return buildPayloadFromBase(DEMO_LOCATIONS[qLower], placeQuery);
    }
    const matchingKey = Object.keys(DEMO_LOCATIONS).find(k => qLower.includes(k) || k.includes(qLower));
    if (matchingKey) {
        return buildPayloadFromBase(DEMO_LOCATIONS[matchingKey], placeQuery);
    }

    let hash = 0;
    for (let i = 0; i < qLower.length; i++) {
        hash = (hash << 5) - hash + qLower.charCodeAt(i);
        hash |= 0;
    }
    const absHash = Math.abs(hash);

    const isCold = /snow|ice|mountain|kashmir|alps|himalaya|iceland|alaska|switzerland|norway|greenland|antarctica|siberia|ladakh|gulmarg|shimla|manali|cold|north|polar/i.test(qLower);
    const isHot = /desert|sahara|dubai|rajasthan|cairo|phoenix|nevada|qatar|riyadh|desert|heat|hot|sun/i.test(qLower);
    const isTropical = /island|beach|hawaii|kerala|miami|bali|caribbean|goa|maldives|sea|coast/i.test(qLower);

    let temp, condText, icon, humidity, windSpeed, uvVal, epaVal, press;

    if (isCold) {
        temp = (absHash % 14) - 4;
        condText = (absHash % 2 === 0) ? "Snow shower" : "Freezing fog";
        icon = "//cdn.weatherapi.com/weather/64x64/day/338.png";
        humidity = 82 + (absHash % 15);
        windSpeed = 16 + (absHash % 18);
        uvVal = 2 + (absHash % 3);
        epaVal = 1;
        press = 1018 + (absHash % 10);
    } else if (isHot) {
        temp = 34 + (absHash % 12);
        condText = "Sunny";
        icon = "//cdn.weatherapi.com/weather/64x64/day/113.png";
        humidity = 20 + (absHash % 25);
        windSpeed = 12 + (absHash % 15);
        uvVal = 9 + (absHash % 3);
        epaVal = 2 + (absHash % 2);
        press = 1004 + (absHash % 8);
    } else if (isTropical) {
        temp = 27 + (absHash % 6);
        condText = "Passing tropical shower";
        icon = "//cdn.weatherapi.com/weather/64x64/day/353.png";
        humidity = 78 + (absHash % 18);
        windSpeed = 20 + (absHash % 14);
        uvVal = 7 + (absHash % 3);
        epaVal = 1;
        press = 1010 + (absHash % 6);
    } else {
        temp = 14 + (absHash % 18);
        const conditions = ["Clear sky", "Partly cloudy", "Light rain", "Passing clouds", "Fair", "Overcast", "Hazy sun"];
        const icons = [
            "//cdn.weatherapi.com/weather/64x64/day/113.png",
            "//cdn.weatherapi.com/weather/64x64/day/116.png",
            "//cdn.weatherapi.com/weather/64x64/day/296.png",
            "//cdn.weatherapi.com/weather/64x64/day/116.png",
            "//cdn.weatherapi.com/weather/64x64/day/113.png",
            "//cdn.weatherapi.com/weather/64x64/day/122.png",
            "//cdn.weatherapi.com/weather/64x64/day/143.png"
        ];
        const cIdx = absHash % conditions.length;
        condText = conditions[cIdx];
        icon = icons[cIdx];
        humidity = 40 + (absHash % 45);
        windSpeed = 8 + (absHash % 22);
        uvVal = 4 + (absHash % 6);
        epaVal = 1 + (absHash % 3);
        press = 1008 + (absHash % 16);
    }

    const windDirs = ["N", "NE", "ENE", "E", "ESE", "SE", "S", "SW", "WSW", "W", "NW", "NNW"];
    const windDir = windDirs[absHash % windDirs.length];

    const base = {
        name: placeQuery.charAt(0).toUpperCase() + placeQuery.slice(1),
        country: isCold ? "Northern Region" : (isHot ? "Arid Zone" : "Field Station"),
        region: "Telemetry Reading",
        lat: ((absHash % 1400) / 10) - 70,
        lon: ((absHash % 3600) / 10) - 180,
        temp: temp,
        cond: condText,
        icon: icon,
        wind: windSpeed,
        dir: windDir,
        hum: humidity,
        press: press,
        uv: uvVal,
        pm2_5: 8.0 + (absHash % 40),
        pm10: 16.0 + (absHash % 70),
        co: 180.0 + (absHash % 300),
        no2: 10.0 + (absHash % 25),
        o3: 30.0 + (absHash % 40),
        so2: 4.0 + (absHash % 12),
        epa: epaVal,
        defra: Math.min(10, epaVal * 2),
        sunrise: "05:45 AM",
        sunset: "07:15 PM"
    };

    return buildPayloadFromBase(base, placeQuery);
}

/* -------------------------------------------------------------------- */
/* 7. Multi-Tier API Fetcher Engine                                      */
/* -------------------------------------------------------------------- */

async function parseApiError(response) {
    try {
        const body = await response.json();
        return body?.error?.message || `HTTP ${response.status}`;
    } catch (e) {
        return `HTTP ${response.status}`;
    }
}

async function fetchWeatherData(placeQuery) {
    const mode = getDataMode();
    const userApiKey = getStoredApiKey();
    const cacheKey = `weather:${placeQuery.toLowerCase()}`;

    if (mode === "demo") {
        setDemoBadge(true);
        return generateDemoWeatherData(placeQuery);
    }

    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    // Tier 1: Try Serverless API Proxy (/api/weather)
    if (mode === "auto" || mode === "proxy") {
        try {
            const res = await fetch(`/api/weather?q=${encodeURIComponent(placeQuery)}&days=3&aqi=yes&alerts=yes`);
            if (res.ok) {
                const data = await res.json();
                setDemoBadge(false);
                cacheSet(cacheKey, data);
                return data;
            }
            if (mode === "proxy") throw new Error(await parseApiError(res));
        } catch (err) {
            console.warn("Proxy /api/weather unavailable. Falling back to Open-Meteo...", err);
        }
    }

    // Tier 2: Try Direct Client Key Fetch
    if (userApiKey) {
        try {
            const directRes = await fetch(`https://api.weatherapi.com/v1/forecast.json?key=${userApiKey}&q=${encodeURIComponent(placeQuery)}&days=3&aqi=yes&alerts=yes`);
            if (directRes.ok) {
                const data = await directRes.json();
                setDemoBadge(false);
                cacheSet(cacheKey, data);
                return data;
            }
        } catch (err) {
            console.warn("Direct WeatherAPI fetch failed.", err);
        }
    }

    // Tier 3: Try Live Zero-Key Open-Meteo API Fetch
    try {
        const omData = await fetchOpenMeteoData(placeQuery);
        setDemoBadge(false);
        cacheSet(cacheKey, omData);
        return omData;
    } catch (err) {
        console.warn("Open-Meteo live fetch failed. Falling back to climate generator...", err);
    }

    // Tier 4: Location-Seeded Deterministic Climate Generator (Offline Fallback)
    setDemoBadge(true);
    const demoData = generateDemoWeatherData(placeQuery);
    cacheSet(cacheKey, demoData);
    return demoData;
}

async function fetchCoordsData(lat, lon) {
    return fetchWeatherData(`${lat},${lon}`);
}

function setDemoBadge(show) {
    if (demoBadge) demoBadge.style.display = show ? "inline-block" : "none";
}

/* -------------------------------------------------------------------- */
/* 8. Autocomplete Setup                                                 */
/* -------------------------------------------------------------------- */

function setupAutocomplete({ input, dropdown, onSelect }) {
    if (!input || !dropdown) return;

    let items = [];
    let activeIndex = -1;

    function closeDropdown() {
        dropdown.style.display = "none";
        dropdown.innerHTML = "";
        items = [];
        activeIndex = -1;
        input.setAttribute("aria-expanded", "false");
    }

    function highlight() {
        dropdown.querySelectorAll(".autocomplete-item").forEach((el, index) => {
            el.classList.toggle("active", index === activeIndex);
        });
    }

    function pick(item) {
        const label = typeof item === "string"
            ? item
            : [item.name, item.region, item.country].filter(Boolean).join(", ");
        input.value = label;
        closeDropdown();
        onSelect(label);
    }

    function renderItems(results, isRecent = false) {
        items = results;
        activeIndex = -1;
        if (!results.length) {
            dropdown.innerHTML = `<div class="autocomplete-empty">No matching places found.</div>`;
        } else {
            dropdown.innerHTML = results
                .map((item, index) => `
                    <div class="autocomplete-item" data-index="${index}">
                        <p class="name">${escapeHTML(item.name)}</p>
                        <p class="meta">${escapeHTML(isRecent ? "Recent search" : [item.region, item.country].filter(Boolean).join(", "))}</p>
                    </div>
                `)
                .join("");
            dropdown.querySelectorAll(".autocomplete-item").forEach((el) => {
                el.addEventListener("mousedown", (event) => {
                    event.preventDefault();
                    pick(items[Number(el.dataset.index)]);
                });
            });
        }
        dropdown.style.display = "block";
        input.setAttribute("aria-expanded", "true");
    }

    function showRecents() {
        const recents = getRecentSearches();
        if (recents.length) {
            renderItems(recents.map((label) => ({ name: label })), true);
        } else {
            closeDropdown();
        }
    }

    const fetchSuggestions = debounce(async (query) => {
        try {
            const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
            if (response.ok) {
                const results = await response.json();
                renderItems(Array.isArray(results) ? results.slice(0, 8) : []);
                return;
            }
        } catch (e) {}

        // Fallback: Open-Meteo Geocoding Autocomplete
        try {
            const omGeoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=en`);
            if (omGeoRes.ok) {
                const omGeo = await omGeoRes.json();
                if (omGeo.results && omGeo.results.length) {
                    const matches = omGeo.results.map(r => ({
                        name: r.name,
                        region: r.admin1 || "",
                        country: r.country || "World"
                    }));
                    renderItems(matches);
                    return;
                }
            }
        } catch (e) {}

        // Fallback: Demo locations filter
        const matches = Object.values(DEMO_LOCATIONS)
            .filter(loc => loc.name.toLowerCase().includes(query.toLowerCase()) || loc.country.toLowerCase().includes(query.toLowerCase()))
            .map(loc => ({ name: loc.name, region: loc.region, country: loc.country }));

        renderItems(matches);
    }, 220);

    input.addEventListener("input", () => {
        const value = input.value.trim();
        if (value.length < 2) {
            showRecents();
            return;
        }
        fetchSuggestions(value);
    });

    input.addEventListener("focus", () => {
        if (input.value.trim().length < 2) showRecents();
    });

    input.addEventListener("keydown", (event) => {
        if (dropdown.style.display !== "block" || !items.length) return;
        if (event.key === "ArrowDown") {
            event.preventDefault();
            activeIndex = Math.min(activeIndex + 1, items.length - 1);
            highlight();
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            activeIndex = Math.max(activeIndex - 1, 0);
            highlight();
        } else if (event.key === "Escape") {
            closeDropdown();
        } else if (event.key === "Enter" && activeIndex >= 0) {
            event.preventDefault();
            pick(items[activeIndex]);
        }
    });

    document.addEventListener("click", (event) => {
        if (event.target !== input && !dropdown.contains(event.target)) closeDropdown();
    });
}

/* -------------------------------------------------------------------- */
/* 9. Sky Strip & Timeline Parser                                        */
/* -------------------------------------------------------------------- */

function parseAstroTime(timeStr) {
    if (!timeStr) return null;
    const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
    if (!match) return null;
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const meridian = match[3].toUpperCase();
    if (meridian === "PM" && hours !== 12) hours += 12;
    if (meridian === "AM" && hours === 12) hours = 0;
    return hours + minutes / 60;
}

function updateSkyStrip({ hourNow, sunrise, sunset, timeFormatted } = {}) {
    const now = typeof hourNow === "number" ? hourNow : (new Date().getHours() + new Date().getMinutes() / 60);
    const nowPercent = Math.min(100, Math.max(0, (now / 24) * 100));

    const skyNow = document.getElementById("skyNow");
    const skyNowTime = document.getElementById("skyNowTime");
    if (skyNow) skyNow.style.left = `${nowPercent}%`;
    if (skyNowTime) {
        skyNowTime.textContent = timeFormatted || `${String(Math.floor(now)).padStart(2, '0')}:${String(Math.floor((now % 1) * 60)).padStart(2, '0')}`;
    }

    const sunriseEl = document.getElementById("skySunrise");
    const sunsetEl = document.getElementById("skySunset");
    const sunriseLabel = document.getElementById("skySunriseLabel");
    const sunsetLabel = document.getElementById("skySunsetLabel");

    if (sunrise != null && sunriseEl && sunriseLabel) {
        sunriseEl.style.left = `${(sunrise / 24) * 100}%`;
        sunriseEl.style.display = "block";
        sunriseLabel.textContent = `Sunrise`;
    }
    if (sunset != null && sunsetEl && sunsetLabel) {
        sunsetEl.style.left = `${(sunset / 24) * 100}%`;
        sunsetEl.style.display = "block";
        sunsetLabel.textContent = `Sunset`;
    }
}

/* -------------------------------------------------------------------- */
/* 10. Leaflet Interactive Map                                           */
/* -------------------------------------------------------------------- */

function initOrUpdateMap(lat, lon, locationName) {
    const mapEl = document.getElementById("weatherMap");
    if (!mapEl || typeof L === "undefined") return;

    if (!leafletMap) {
        leafletMap = L.map('weatherMap', { zoomControl: true }).setView([lat, lon], 10);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap'
        }).addTo(leafletMap);
    } else {
        leafletMap.setView([lat, lon], 10);
    }

    if (leafletMarker) leafletMap.removeLayer(leafletMarker);

    leafletMarker = L.marker([lat, lon]).addTo(leafletMap)
        .bindPopup(`<b>${escapeHTML(locationName)}</b><br>Lat: ${lat.toFixed(2)}, Lon: ${lon.toFixed(2)}`)
        .openPopup();
}

/* -------------------------------------------------------------------- */
/* 11. Field Gauges & Renderers                                          */
/* -------------------------------------------------------------------- */

function renderUvGauge(uvValue) {
    const uv = Number(uvValue ?? 0);
    let level = "Low";
    let color = "var(--emerald)";
    let tip = "Minimal sun protection required.";

    if (uv >= 11) { level = "Extreme"; color = "#c25a7a"; tip = "Avoid sun exposure 10am-4pm. Shirt, sunscreen, hat mandatory."; }
    else if (uv >= 8) { level = "Very High"; color = "var(--rose)"; tip = "Extra protection needed. Seek shade during midday hours."; }
    else if (uv >= 6) { level = "High"; color = "var(--brass)"; tip = "Protection required. Wear hat, sunglasses, and SPF 30+."; }
    else if (uv >= 3) { level = "Moderate"; color = "var(--cyan)"; tip = "Take precautions. Cover up if outside for long periods."; }

    return `
        <div class="gauge-card">
            <div class="flex items-start justify-between">
                <div>
                    <p class="lbl text-xs font-bold uppercase tracking-widest" style="color: var(--text-lo);">Solar UV Index</p>
                    <p class="val mt-2 text-3xl font-bold" style="color: ${color};">${formatNumber(uv, 0)}</p>
                    <p class="text-xs font-bold mt-1 uppercase tracking-wider" style="color:${color};">${level}</p>
                </div>
                <div class="uv-arc" style="background: conic-gradient(${color} ${(uv/12)*360}deg, var(--ink-3) 0deg);">
                    <div class="gauge-inner">
                        <span class="text-xs font-mono font-bold">${formatNumber(uv,0)}</span>
                    </div>
                </div>
            </div>
            <p class="mt-3 text-xs leading-5" style="color: var(--text-mid);">${tip}</p>
        </div>
    `;
}

function renderWindCompass(windKph, windDegree, windDir) {
    const deg = Number(windDegree ?? 0);
    return `
        <div class="gauge-card">
            <div class="flex items-start justify-between">
                <div>
                    <p class="lbl text-xs font-bold uppercase tracking-widest" style="color: var(--text-lo);">Wind Compass</p>
                    <p class="val mt-2 text-2xl font-bold">${windDisplay(windKph)}</p>
                    <p class="text-xs font-semibold mt-1" style="color: var(--cyan);">Heading: ${escapeHTML(windDir || "N/A")} (${deg}°)</p>
                </div>
                <div class="compass-ring">
                    <div class="compass-needle" style="transform: rotate(${deg}deg);"></div>
                    <span class="absolute -top-3 text-[0.6rem] font-mono text-amber-400 font-bold">N</span>
                </div>
            </div>
            <p class="mt-3 text-xs leading-5" style="color: var(--text-mid);">Atmospheric airflow direction and velocity vector.</p>
        </div>
    `;
}

function renderBarometer(pressureMb) {
    const press = Number(pressureMb ?? 1013);
    let trend = "Normal / Stable";
    let percent = Math.min(100, Math.max(0, ((press - 970) / 80) * 100));
    if (press < 1000) trend = "Low Pressure / Unstable Stormy";
    else if (press > 1025) trend = "High Pressure / Clear Skies";

    return `
        <div class="gauge-card">
            <div class="flex items-start justify-between">
                <div>
                    <p class="lbl text-xs font-bold uppercase tracking-widest" style="color: var(--text-lo);">Barometric Pressure</p>
                    <p class="val mt-2 text-2xl font-bold">${formatNumber(press, 0)} <span class="text-sm font-normal">mb</span></p>
                    <p class="text-xs font-semibold mt-1" style="color: var(--brass-hi);">${trend}</p>
                </div>
            </div>
            <div class="barometer-meter mt-4">
                <div class="barometer-fill" style="width: ${percent}%;"></div>
            </div>
            <div class="flex justify-between font-mono text-[0.65rem] mt-1 text-slate-500">
                <span>970 mb</span><span>1013 mb</span><span>1050 mb</span>
            </div>
        </div>
    `;
}

function renderMoonPhase(astro) {
    const phase = astro?.moon_phase || "Waxing Gibbous";
    const illum = astro?.moon_illumination || "75%";
    return `
        <div class="gauge-card">
            <div class="flex items-start justify-between">
                <div>
                    <p class="lbl text-xs font-bold uppercase tracking-widest" style="color: var(--text-lo);">Lunar Phase</p>
                    <p class="val mt-2 text-xl font-bold">${escapeHTML(phase)}</p>
                    <p class="text-xs font-semibold mt-1" style="color: var(--cyan);">Illumination: ${escapeHTML(illum)}</p>
                </div>
                <div class="moon-disc flex items-center justify-center">
                    <span class="text-lg">🌙</span>
                </div>
            </div>
            <p class="mt-3 text-xs leading-5" style="color: var(--text-mid);">Sunrise: ${escapeHTML(astro?.sunrise || "—")} · Sunset: ${escapeHTML(astro?.sunset || "—")}</p>
        </div>
    `;
}

function buildFieldNote(current) {
    const tempC = Number(current.temp_c);
    const condition = (current.condition?.text || "").toLowerCase();
    const windKph = Number(current.wind_kph);
    const uv = Number(current.uv ?? 0);

    const notes = [];
    if (tempC <= 5) notes.push("heavy thermal layers and windproof outerwear recommended");
    else if (tempC <= 12) notes.push("insulated jacket advisable");
    else if (tempC <= 18) notes.push("mild weather, light outer layer suitable");
    else if (tempC <= 27) notes.push("comfortable temperature, breathable cotton apparel");
    else notes.push("high thermal load, hydration and shade prioritized");

    if (condition.includes("rain") || condition.includes("drizzle") || condition.includes("shower")) {
        notes.push("waterproof shell or umbrella required");
    } else if (condition.includes("snow") || condition.includes("sleet") || condition.includes("ice")) {
        notes.push("slippery traction surfaces expect non-slip footwear");
    } else if (condition.includes("thunder")) {
        notes.push("lightning risk stay indoors if thunder rolls");
    }

    if (windKph >= 35) notes.push("strong wind shear active");
    if (uv >= 7) notes.push("solar radiation elevated");

    return `Field Instrument Summary: ${notes.join("; ")}.`;
}

/* -------------------------------------------------------------------- */
/* 12. Render Weather Telemetry                                         */
/* -------------------------------------------------------------------- */

function updateWeatherDetails(data) {
    if (!data) return;
    lastWeatherData = data;

    const current = data.current;
    const placeName = `${data.location.name}, ${data.location.country}`;
    const location = `${escapeHTML(data.location.name)}, ${escapeHTML(data.location.country)}`;
    const region = data.location.region ? `${escapeHTML(data.location.region)} • ` : "";
    const condition = escapeHTML(current.condition.text);
    const icon = current.condition.icon.startsWith("//") ? `https:${current.condition.icon}` : current.condition.icon;
    const astro = data.forecast?.forecastday?.[0]?.astro;
    const forecastDays = data.forecast?.forecastday || [];

    const isFav = getFavorites().some(item => item.toLowerCase() === placeName.toLowerCase());

    const sunriseHour = astro ? parseAstroTime(astro.sunrise) : null;
    const sunsetHour = astro ? parseAstroTime(astro.sunset) : null;
    const timeParts = (data.location.localtime || "").split(" ")[1]?.split(":") || [];
    const localHour = timeParts.length >= 2 ? Number(timeParts[0]) + Number(timeParts[1]) / 60 : undefined;
    updateSkyStrip({ hourNow: localHour, sunrise: sunriseHour, sunset: sunsetHour, timeFormatted: timeParts.join(":") });

    if (data.location.lat && data.location.lon) {
        initOrUpdateMap(data.location.lat, data.location.lon, placeName);
    }

    weatherDetails.innerHTML = `
        ${buildAlertBanner(data.alerts)}

        <article class="readout-card p-6 sm:p-8">
            <div class="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div class="flex items-center gap-3">
                        <p class="font-mono text-xs uppercase tracking-widest" style="color: var(--brass);">${region}${escapeHTML(data.location.localtime)}</p>
                        <button type="button" onclick="toggleFavorite('${escapeHTML(placeName)}')" class="text-sm transition-transform hover:scale-125" title="Toggle Favorite">
                            ${isFav ? "⭐" : "☆"}
                        </button>
                    </div>
                    <h3 class="font-display mt-2 text-3xl" style="color: var(--text-hi);">${location}</h3>
                    <p class="mt-1 text-lg" style="color: var(--text-mid);">${condition}</p>
                </div>
                <div class="flex items-center gap-4">
                    <img src="${icon}" alt="${condition}" class="h-16 w-16 rounded-2xl" style="background: rgba(255,255,255,0.06); padding: 0.4rem;">
                    <div class="text-right">
                        <p class="temp-num text-6xl" id="tempReadout">0${unitSuffix()}</p>
                        <p class="mt-1 text-sm font-semibold" style="color: var(--text-lo);">Feels like ${tempDisplay(current.feelslike_c, 0)}${unitSuffix()}</p>
                    </div>
                </div>
            </div>
        </article>

        <div class="field-note p-5">
            <p class="text-sm leading-6" style="color: var(--text-mid);">${escapeHTML(buildFieldNote(current))}</p>
        </div>

        <!-- Telemetry Gauges Grid -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            ${renderUvGauge(current.uv)}
            ${renderWindCompass(current.wind_kph, current.wind_degree, current.wind_dir)}
            ${renderBarometer(current.pressure_mb)}
            ${renderMoonPhase(astro)}
        </div>

        ${buildHourlyStrip(forecastDays)}
        ${forecastDays.length ? buildForecastStrip(forecastDays) : ""}
    `;

    const tempEl = document.getElementById("tempReadout");
    if (tempEl) {
        animateNumber(tempEl, Number(tempDisplay(current.temp_c, 0)), { decimals: 0, suffix: unitSuffix() });
    }
}

function buildForecastStrip(days) {
    const cards = days.map((day) => {
        const date = new Date(day.date + "T00:00:00");
        const label = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
        const icon = day.day.condition.icon.startsWith("//") ? `https:${day.day.condition.icon}` : day.day.condition.icon;
        return `
            <div class="dial-card flex flex-col items-center gap-2 p-4 text-center">
                <p class="font-mono text-xs uppercase tracking-widest" style="color: var(--text-lo);">${label}</p>
                <img src="${icon}" alt="${escapeHTML(day.day.condition.text)}" class="h-10 w-10">
                <p class="val text-sm font-bold">${tempDisplay(day.day.maxtemp_c, 0)}° / ${tempDisplay(day.day.mintemp_c, 0)}°</p>
                <p class="lbl text-xs">${escapeHTML(day.day.condition.text)}</p>
            </div>
        `;
    }).join("");

    return `
        <div>
            <p class="font-mono mb-3 text-xs uppercase tracking-widest" style="color: var(--brass);">3-Day Outlook</p>
            <div class="grid grid-cols-3 gap-3">${cards}</div>
        </div>
    `;
}

function buildHourlyStrip(forecastDays) {
    if (!forecastDays.length) return "";
    const allHours = forecastDays.flatMap((day) => day.hour || []);
    if (!allHours.length) return "";

    const upcoming = allHours.slice(0, 12);
    const cards = upcoming.map((hour) => {
        const date = new Date(hour.time.replace(" ", "T"));
        const label = isNaN(date.getTime()) ? hour.time.split(" ")[1] : date.toLocaleTimeString(undefined, { hour: "numeric" });
        const icon = hour.condition.icon.startsWith("//") ? `https:${hour.condition.icon}` : hour.condition.icon;
        const precipChance = Math.max(Number(hour.chance_of_rain || 0), Number(hour.chance_of_snow || 0));
        return `
            <div class="hour-card flex flex-col items-center gap-1.5 p-3 text-center">
                <p class="font-mono text-xs uppercase tracking-widest" style="color: var(--text-lo);">${escapeHTML(label)}</p>
                <img src="${icon}" alt="${escapeHTML(hour.condition.text)}" class="h-8 w-8">
                <p class="val text-sm font-bold">${tempDisplay(hour.temp_c, 0)}°</p>
                <p class="font-mono text-xs" style="color: ${precipChance > 0 ? "var(--cyan)" : "var(--text-lo)"};">${precipChance}%</p>
            </div>
        `;
    }).join("");

    return `
        <div>
            <p class="font-mono mb-3 text-xs uppercase tracking-widest" style="color: var(--brass);">Next 12 Hours Forecast</p>
            <div class="hour-strip">${cards}</div>
        </div>
    `;
}

function buildAlertBanner(alerts) {
    const list = alerts?.alert || [];
    if (!list.length) {
        return `
            <div class="alert-banner calm">
                <p class="font-mono text-xs uppercase tracking-widest" style="color: var(--text-lo);">Alert Monitor</p>
                <p class="mt-1 text-sm font-semibold" style="color: var(--text-mid);">No active hazardous weather warnings for this location.</p>
            </div>
        `;
    }

    const items = list.map((alert, idx) => {
        const headline = alert.headline || alert.event || "Weather Warning";
        return `
            <div class="alert-item">
                <div class="flex items-center justify-between">
                    <p class="font-display text-lg" style="color: var(--text-hi);">${escapeHTML(headline)}</p>
                    <button type="button" onclick="openAlertDetail(${idx})" class="font-mono text-xs px-3 py-1 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-950/30">Read Full Notice</button>
                </div>
            </div>
        `;
    }).join("");

    return `
        <div class="alert-banner">
            <p class="font-mono text-xs uppercase tracking-widest" style="color: var(--rose);">⚠ Active Severe Weather Warnings (${list.length})</p>
            ${items}
        </div>
    `;
}

function openAlertDetail(index) {
    if (!lastWeatherData?.alerts?.alert?.[index]) return;
    const item = lastWeatherData.alerts.alert[index];
    if (alertModalBody) {
        alertModalBody.innerHTML = `
            <p class="font-bold text-lg text-white">${escapeHTML(item.headline || item.event)}</p>
            <p class="font-mono text-xs text-amber-400">Severity: ${escapeHTML(item.severity || "Moderate")} · Areas: ${escapeHTML(item.areas || "Region")}</p>
            <div class="p-4 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono whitespace-pre-wrap max-h-96 overflow-y-auto">${escapeHTML(item.desc || "No full description available.")}</div>
        `;
    }
    if (alertModal) alertModal.style.display = "flex";
}

/* -------------------------------------------------------------------- */
/* 13. AQI Render Engine with Scientific Units                          */
/* -------------------------------------------------------------------- */

const EPA_LABELS = { 1: "Good", 2: "Moderate", 3: "Unhealthy for Sensitive Groups", 4: "Unhealthy", 5: "Very Unhealthy", 6: "Hazardous" };
const EPA_COLORS = { 1: "#5fbf7a", 2: "#c9d15f", 3: "#e3b96a", 4: "#dd7a5f", 5: "#c25a7a", 6: "#8a4a6a" };
const EPA_ADVICE = {
    1: "Air quality is satisfactory. Outdoor activities are safe for all groups.",
    2: "Acceptable air quality. Unusually sensitive individuals should limit prolonged outdoor exertion.",
    3: "Members of sensitive groups (asthma, elderly, children) may experience health effects.",
    4: "Everyone may begin to experience health effects; sensitive groups should avoid outdoor exertion.",
    5: "Health alert: everyone may experience more serious health effects. Stay indoors.",
    6: "Health warnings of emergency conditions. Entire population is affected."
};

function updateAQIDetails(data) {
    if (!data) return;

    const air = data.current.air_quality || {};
    const place = `${escapeHTML(data.location.name)}, ${escapeHTML(data.location.country)}`;
    const region = data.location.region ? `${escapeHTML(data.location.region)} • ` : "";
    const epaIndex = air["us-epa-index"] ?? 1;
    const gbIndex = air["gb-defra-index"] ?? "N/A";
    const epaColor = EPA_COLORS[epaIndex] || "var(--text-lo)";
    const epaLabel = EPA_LABELS[epaIndex] || "Moderate";
    const epaTip = EPA_ADVICE[epaIndex] || "Maintain awareness during outdoor exposure.";
    const gaugeDeg = (epaIndex / 6) * 360;

    aqiDetails.innerHTML = `
        <article class="readout-card p-6 sm:p-8">
            <p class="font-mono text-xs uppercase tracking-widest" style="color: var(--brass);">${region}${escapeHTML(data.location.localtime)}</p>
            <h3 class="font-display mt-2 text-3xl" style="color: var(--text-hi);">${place}</h3>
            <p class="mt-2 text-sm" style="color: var(--text-mid);">Air quality & particulate telemetry for ${escapeHTML(data.current.condition.text)} conditions.</p>
            <div class="mt-6 flex flex-col items-center gap-6 sm:flex-row sm:items-center">
                <div class="gauge" style="background: conic-gradient(${epaColor} ${gaugeDeg}deg, rgba(255,255,255,0.08) 0deg);">
                    <div class="gauge-inner">
                        <span class="n">${epaIndex}</span>
                        <span class="t">US EPA</span>
                    </div>
                </div>
                <div>
                    <p class="font-display text-xl font-bold" style="color: ${epaColor};">${epaLabel}</p>
                    <p class="mt-1 text-xs font-mono" style="color: var(--text-lo);">GB DEFRA Index: <span class="font-bold text-white">${gbIndex}</span></p>
                    <p class="mt-2 text-sm leading-6 max-w-md" style="color: var(--text-mid);">${epaTip}</p>
                </div>
            </div>
        </article>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
            ${airQualityItem("PM2.5", air.pm2_5, "μg/m³")}
            ${airQualityItem("PM10", air.pm10, "μg/m³")}
            ${airQualityItem("CO", air.co, "μg/m³")}
            ${airQualityItem("NO2", air.no2, "μg/m³")}
            ${airQualityItem("O3", air.o3, "μg/m³")}
            ${airQualityItem("SO2", air.so2, "μg/m³")}
        </div>
    `;
}

function airQualityItem(label, value, unitLabel = "μg/m³") {
    return `
        <div class="pollutant-chip p-4 text-center">
            <p class="font-mono text-xs font-black uppercase tracking-wider" style="color: var(--text-lo);">${label}</p>
            <p class="val mt-2 text-lg font-black">${formatNumber(value, 1)} <span class="text-[0.65rem] font-normal text-slate-400">${unitLabel}</span></p>
        </div>
    `;
}

/* -------------------------------------------------------------------- */
/* 14. Famous Places Engine with Wikipedia Photos                        */
/* -------------------------------------------------------------------- */

/* -------------------------------------------------------------------- */
/* 14. Famous Places Engine with Wikipedia Photos                        */
/* -------------------------------------------------------------------- */

const CURATED_PLACES = {
    "lucknow": [
        { title: "Bara Imambara", snippet: "Grand 1784 architectural complex featuring the world's largest unsupported vaulted hall and Bhulbhulaiya labyrinth.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/Bara_Imambara_Lucknow.jpg/640px-Bara_Imambara_Lucknow.jpg" },
        { title: "Rumi Darwaza", snippet: "60-foot historic Awadhi gateway built in 1784, known as the Turkish Gate of Lucknow.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Rumi_Darwaza_Lucknow.jpg/640px-Rumi_Darwaza_Lucknow.jpg" },
        { title: "Chota Imambara", snippet: "Palace of Lights adorned with Belgian crystal chandeliers, gilded domes, and historic calligraphy.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Chota_Imambara_Lucknow.jpg/640px-Chota_Imambara_Lucknow.jpg" },
        { title: "Ambedkar Memorial Park", snippet: "Sprawling 107-acre monument park crafted from Rajasthan red sandstone with giant elephant stupas.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Ambedkar_Park_Lucknow.jpg/640px-Ambedkar_Park_Lucknow.jpg" },
        { title: "The British Residency, Lucknow", snippet: "Historic 1857 siege compound and ruined gardens, now a protected national monument.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Residency_Lucknow.jpg/640px-Residency_Lucknow.jpg" }
    ],
    "manali": [
        { title: "Hadimba Devi Temple", snippet: "Ancient 1553 cave temple surrounded by giant cedar trees at the foot of the Himalayas in Dhungri forest.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Hidimba_Devi_Temple_Manali.jpg/640px-Hidimba_Devi_Temple_Manali.jpg" },
        { title: "Solang Valley", snippet: "Picturesque side valley famous for snow sports, paragliding, quads, and gondola cable car rides.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Solang_Valley_Manali.jpg/640px-Solang_Valley_Manali.jpg" },
        { title: "Rohtang Pass", snippet: "High mountain pass at 3,978m on the Pir Panjal Range connecting Kullu with Lahaul and Spiti valleys.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/Rohtang_Pass_Manali.jpg/640px-Rohtang_Pass_Manali.jpg" },
        { title: "Vashisht Hot Springs", snippet: "Natural thermal sulfur water springs and ancient stone temple dedicated to Sage Vashisht.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Vashisht_Temple_Manali.jpg/640px-Vashisht_Temple_Manali.jpg" },
        { title: "Jogini Waterfalls", snippet: "Cascade falling from 150ft cliffs through apple orchards, pine forests, and mountain streams.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Jogini_Falls_Manali.jpg/640px-Jogini_Falls_Manali.jpg" }
    ],
    "jaipur": [
        { title: "Hawa Mahal", snippet: "Palace of Winds constructed in 1799 with 953 honeycomb windows designed for royal ladies.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/East_facade_Hawa_Mahal_Jaipur.jpg/640px-East_facade_Hawa_Mahal_Jaipur.jpg" },
        { title: "Amber Fort", snippet: "Grand hilltop fortress overlooking Maota Lake, famous for its Sheesh Mahal mirror hall.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Amer_Fort_Jaipur.jpg/640px-Amer_Fort_Jaipur.jpg" },
        { title: "City Palace, Jaipur", snippet: "Royal complex showcasing Rajasthani and Mughal architecture, courtyards, and museum galleries.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/City_Palace_Jaipur.jpg/640px-City_Palace_Jaipur.jpg" },
        { title: "Jantar Mantar, Jaipur", snippet: "UNESCO World Heritage astronomical site featuring Samrat Yantra, the world's largest stone sundial.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/Jantar_Mantar_Jaipur.jpg/640px-Jantar_Mantar_Jaipur.jpg" },
        { title: "Jal Mahal", snippet: "Water Palace positioned in the middle of Man Sagar Lake against the Aravalli hills.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Jal_Mahal_Jaipur.jpg/640px-Jal_Mahal_Jaipur.jpg" }
    ],
    "jammu": [
        { title: "Bahu Fort & Garden", snippet: "Historic fort along Tawi River with Mahakali temple and terraced gardens.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Bahu_Fort_Jammu.jpg/640px-Bahu_Fort_Jammu.jpg" },
        { title: "Raghunath Temple", snippet: "Major Hindu temple complex consisting of seven shrines built by Maharaja Gulab Singh.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f8/Raghunath_Temple_Jammu.jpg/640px-Raghunath_Temple_Jammu.jpg" }
    ],
    "kashmir": [
        { title: "Dal Lake & Houseboats", snippet: "Iconic Srinagar lake with carved wooden houseboats, floating vegetable markets, and Shikara rides.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/Dal_Lake_Srinagar.jpg/640px-Dal_Lake_Srinagar.jpg" },
        { title: "Gulmarg Gondola & Ski Resort", snippet: "Premier Himalayan snow resort featuring the world's highest passenger gondola cable car.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/Gulmarg_Gondola.jpg/640px-Gulmarg_Gondola.jpg" },
        { title: "Pahalgam Valley", snippet: "Valley of Shepherds with Betaab Valley, pine forests, and Lidder River trekking trails.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Pahalgam_Valley.jpg/640px-Pahalgam_Valley.jpg" },
        { title: "Shalimar Bagh Mughal Garden", snippet: "Historic royal terraced garden built by Emperor Jahangir for his wife Nur Jahan in 1619.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Shalimar_Bagh_Srinagar.jpg/640px-Shalimar_Bagh_Srinagar.jpg" }
    ],
    "srinagar": [
        { title: "Dal Lake", snippet: "Iconic lake with Shikara rides and houseboats.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/Dal_Lake_Srinagar.jpg/640px-Dal_Lake_Srinagar.jpg" },
        { title: "Shalimar Bagh", snippet: "Royal Mughal terraced garden.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Shalimar_Bagh_Srinagar.jpg/640px-Shalimar_Bagh_Srinagar.jpg" }
    ],
    "shimla": [
        { title: "The Ridge & Mall Road", snippet: "Open cultural hub in the center of Shimla featuring panoramic mountain vistas.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/The_Ridge_Shimla.jpg/640px-The_Ridge_Shimla.jpg" },
        { title: "Jakhoo Temple", snippet: "Ancient temple dedicated to Lord Hanuman situated on Jakhoo Hill peak (2,455m).", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/77/Jakhoo_Temple_Shimla.jpg/640px-Jakhoo_Temple_Shimla.jpg" },
        { title: "Kufri Snow Resort", snippet: "Hill station near Shimla famous for winter sports, Himalayan Nature Park, and yak rides.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Kufri_Shimla.jpg/640px-Kufri_Shimla.jpg" }
    ],
    "delhi": [
        { title: "Red Fort (Lal Qila)", snippet: "Historic 17th-century Mughal fort constructed from red sandstone by Shah Jahan.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/Red_Fort_Delhi.jpg/640px-Red_Fort_Delhi.jpg" },
        { title: "Qutub Minar", snippet: "73-meter tall UNESCO World Heritage brick minaret built in 1192 by Qutb-ud-din Aibak.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Qutub_Minar_Delhi.jpg/640px-Qutub_Minar_Delhi.jpg" },
        { title: "India Gate", snippet: "War memorial arch dedicated to 84,000 soldiers located on Kartavya Path.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/India_Gate_Delhi.jpg/640px-India_Gate_Delhi.jpg" }
    ],
    "paris": [
        { title: "Eiffel Tower", snippet: "330-meter wrought-iron lattice tower on Champ de Mars, global symbol of Paris.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg/640px-Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg" },
        { title: "Louvre Museum", snippet: "World's largest art museum housing Mona Lisa and Venus de Milo in historic royal palace.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Louvre_Museum_Paris.jpg/640px-Louvre_Museum_Paris.jpg" },
        { title: "Arc de Triomphe", snippet: "Monument honoring those who fought for France, located at western end of Champs-Élysées.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ce/Arc_de_Triomphe_Paris.jpg/640px-Arc_de_Triomphe_Paris.jpg" }
    ],
    "london": [
        { title: "Big Ben & Palace of Westminster", snippet: "Elizabeth Tower clock tower and Houses of Parliament along River Thames.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Clock_Tower_-_Big_Ben_London.jpg/640px-Clock_Tower_-_Big_Ben_London.jpg" },
        { title: "Tower Bridge", snippet: "Combined bascule and suspension bridge built between 1886 and 1894 over Thames.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/Tower_Bridge_London.jpg/640px-Tower_Bridge_London.jpg" }
    ],
    "tokyo": [
        { title: "Senso-ji Temple", snippet: "Ancient Buddhist temple in Asakusa founded in 645 AD, Tokyo's oldest temple.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Sensoji_Temple_Asakusa_Tokyo.jpg/640px-Sensoji_Temple_Asakusa_Tokyo.jpg" },
        { title: "Tokyo Skytree", snippet: "634-meter broadcasting and observation tower, tallest structure in Japan.", thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Tokyo_Skytree_2012.jpg/640px-Tokyo_Skytree_2012.jpg" }
    ]
};

async function getFamousPlaces(placeQuery) {
    const qLower = (placeQuery || "").toLowerCase().trim();

    // 1. Check Curated Destination Map
    for (const key in CURATED_PLACES) {
        if (qLower.includes(key) || key.includes(qLower)) {
            return CURATED_PLACES[key].map(p => ({ ...p, source: "Visitable Landmarks" }));
        }
    }

    // 2. Dynamic Wikipedia Attraction Search with Strict Disambiguation
    const cleanPlace = placeQuery.replace(/,.*$/, "").trim();
    const searchQueries = [
        `${cleanPlace} tourist attractions landmarks`,
        `${cleanPlace} fort temple palace museum lake park waterfall valley imambara garden`,
        `points of interest in ${cleanPlace}`
    ];

    const excludeWords = [
        "list of", "tourism in", "category:", "outline of", "history of", "geography of",
        "economy of", "demographics of", "constituency", "railway division", "assembly",
        "election", "attack", "politics", "revocation", "cinema of", "national stock exchange",
        "megaprojects", "new hampshire", "moultonborough", "jaunpur"
    ];

    let hits = [];

    for (const queryStr of searchQueries) {
        try {
            const endpoint = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=8&srsearch=${encodeURIComponent(queryStr)}`;
            const response = await fetch(endpoint, { headers: { 'User-Agent': 'AtmosApp/2.6' } });
            if (response.ok) {
                const data = await response.json();
                const items = data.query?.search || [];
                for (const item of items) {
                    const tLower = item.title.toLowerCase();
                    const sLower = (item.snippet || "").toLowerCase();
                    const isExcluded = excludeWords.some(w => tLower.includes(w) || sLower.includes(w));
                    if (!isExcluded && !hits.some(h => h.title.toLowerCase() === tLower)) {
                        hits.push(item);
                    }
                }
            }
        } catch (e) {}
        if (hits.length >= 4) break;
    }

    if (hits.length > 0) {
        const detailedPlaces = await Promise.all(
            hits.slice(0, 4).map(async (item) => {
                try {
                    const summaryRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(item.title)}`);
                    if (summaryRes.ok) {
                        const summary = await summaryRes.json();
                        return {
                            title: summary.title,
                            snippet: summary.extract || stripSnippet(item.snippet),
                            thumbnail: summary.thumbnail?.source || null,
                            link: summary.content_urls?.desktop?.page || `https://en.wikipedia.org/?curid=${item.pageid}`,
                            source: "Visitable Landmark"
                        };
                    }
                } catch (e) {}
                return {
                    title: item.title,
                    snippet: stripSnippet(item.snippet),
                    thumbnail: null,
                    link: `https://en.wikipedia.org/?curid=${item.pageid}`,
                    source: "Visitable Landmark"
                };
            })
        );

        const filtered = detailedPlaces.filter(p => p.title);
        if (filtered.length) return filtered;
    }

    return getFallbackPlaces(placeQuery);
}

function getFallbackPlaces(placeQuery) {
    const name = placeQuery.replace(/,.*$/, "").trim();
    return [
        { title: `${name} Historic Heritage Park`, snippet: `Cultural heritage landmark and scenic public park situated in ${name}.`, thumbnail: "https://images.unsplash.com/photo-1564507592333-c60657eea523?auto=format&fit=crop&w=600&q=80", link: "#", source: "Visitable Landmark" },
        { title: `${name} Royal Palace & Gardens`, snippet: `Architectural landmark showcasing regional culture, courtyards, and botanical gardens.`, thumbnail: "https://images.unsplash.com/photo-1599661046289-e31897846e41?auto=format&fit=crop&w=600&q=80", link: "#", source: "Visitable Landmark" }
    ];
}

function stripSnippet(value) {
    const container = document.createElement("div");
    container.innerHTML = value || "";
    return container.textContent || container.innerText || "";
}

function updatePlaceDetails(results, placeQuery) {
    if (!results || !results.length) {
        showMessage(placeDetails, "No places found", "Try searching a broader region, state, or country name.", "amber");
        return;
    }

    placeDetails.innerHTML = `
        <article class="readout-card p-6">
            <p class="font-mono text-xs uppercase tracking-widest" style="color: var(--rose);">Nearby Cultural Landmarks</p>
            <h3 class="font-display mt-2 text-2xl" style="color: var(--text-hi);">${escapeHTML(placeQuery)}</h3>
            <p class="mt-2 text-sm" style="color: var(--text-lo);">Curated attractions with Wikipedia photography and Google Maps navigation.</p>
        </article>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            ${results.map((item) => placeCard(item, placeQuery)).join("")}
        </div>
    `;
}

function placeCard(item, locationContext) {
    const title = escapeHTML(item.title);
    const snippet = escapeHTML(item.snippet || "").slice(0, 140);
    const link = item.link || "#";
    const thumbHtml = item.thumbnail
        ? `<img src="${escapeHTML(item.thumbnail)}" alt="${title}" class="place-thumb">`
        : `<div class="place-thumb flex items-center justify-center text-3xl">🏛️</div>`;

    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(title + " " + locationContext)}`;

    return `
        <div class="place-card block">
            ${thumbHtml}
            <div class="p-5">
                <p class="font-display text-lg font-bold" style="color: var(--text-hi);">${title}</p>
                <p class="mt-2 text-xs leading-5" style="color: var(--text-lo);">${snippet}…</p>
                <div class="flex items-center justify-between mt-4">
                    <a href="${link}" target="_blank" rel="noopener noreferrer" class="source-tag text-amber-400 hover:underline">Wikipedia Guide →</a>
                    <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="source-tag text-cyan-400 hover:underline">🗺️ Directions</a>
                </div>
            </div>
        </div>
    `;
}

/* -------------------------------------------------------------------- */
/* 15. Navigation & Modals Wiring                                        */
/* -------------------------------------------------------------------- */

function setupActiveNav() {
    const links = document.querySelectorAll("#mainNav .nav-link");
    const sections = ["home", "weather", "aqi", "places", "mapSection"]
        .map((id) => document.getElementById(id))
        .filter(Boolean);

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                links.forEach((link) => link.classList.remove("active"));
                const activeLink = document.querySelector(`.nav-link[data-section="${entry.target.id}"]`);
                activeLink?.classList.add("active");
            });
        },
        { rootMargin: "-40% 0px -50% 0px", threshold: 0 }
    );

    sections.forEach((section) => observer.observe(section));
}

// Unit Toggle Event Listener
unitToggle?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-unit]");
    if (!button) return;
    const nextUnit = button.dataset.unit;
    if (nextUnit === unit) return;
    unit = nextUnit;
    localStorage.setItem("atmos.unit", unit);
    unitToggle.querySelectorAll("button").forEach((btn) => btn.classList.toggle("active", btn.dataset.unit === unit));
    if (lastWeatherData) updateWeatherDetails(lastWeatherData);
});

// Settings Modal Wire-up
settingsBtn?.addEventListener("click", () => {
    if (apiKeyInput) apiKeyInput.value = getStoredApiKey();
    if (dataModeSelect) dataModeSelect.value = getDataMode();
    if (settingsModal) settingsModal.style.display = "flex";
});

closeSettingsModal?.addEventListener("click", () => {
    if (settingsModal) settingsModal.style.display = "none";
});

saveSettingsBtn?.addEventListener("click", () => {
    if (apiKeyInput) localStorage.setItem("atmos.apiKey", apiKeyInput.value.trim());
    if (dataModeSelect) localStorage.setItem("atmos.dataMode", dataModeSelect.value);
    if (settingsModal) settingsModal.style.display = "none";
    showToast("Settings saved!", "⚙️");
});

clearHistoryBtn?.addEventListener("click", () => {
    localStorage.removeItem(RECENT_KEY);
    refreshAllRecentChips();
    showToast("Search history cleared", "🧹");
});

// Compare Modal Wire-up
compareBtn?.addEventListener("click", () => {
    if (compareModal) compareModal.style.display = "flex";
});

closeCompareModal?.addEventListener("click", () => {
    if (compareModal) compareModal.style.display = "none";
});

runCompareBtn?.addEventListener("click", async () => {
    const loc1 = compareLoc1Input.value.trim() || "London";
    const loc2 = compareLoc2Input.value.trim() || "Tokyo";

    const card1 = document.getElementById("compareLoc1Card");
    const card2 = document.getElementById("compareLoc2Card");

    if (card1) setLoading(card1, `Loading ${loc1}...`);
    if (card2) setLoading(card2, `Loading ${loc2}...`);

    const [data1, data2] = await Promise.all([fetchWeatherData(loc1), fetchWeatherData(loc2)]);

    if (card1) renderCompareCard(card1, data1);
    if (card2) renderCompareCard(card2, data2);
});

function renderCompareCard(container, data) {
    if (!data) {
        container.innerHTML = `<p class="text-xs text-red-400">Failed to load data.</p>`;
        return;
    }
    const c = data.current;
    container.innerHTML = `
        <div class="text-left space-y-2">
            <p class="font-bold text-white text-base">${escapeHTML(data.location.name)}, ${escapeHTML(data.location.country)}</p>
            <p class="text-xs text-amber-400 font-mono">${escapeHTML(c.condition.text)}</p>
            <p class="text-2xl font-bold font-mono text-white">${tempDisplay(c.temp_c)}°</p>
            <div class="text-xs font-mono space-y-1 text-slate-300">
                <p>Feels: ${tempDisplay(c.feelslike_c)}°</p>
                <p>Wind: ${windDisplay(c.wind_kph)} (${c.wind_dir})</p>
                <p>Humidity: ${c.humidity}%</p>
                <p>Pressure: ${c.pressure_mb} mb</p>
                <p>UV Index: ${c.uv}</p>
                <p>EPA AQI: ${c.air_quality?.["us-epa-index"] || 1}</p>
            </div>
        </div>
    `;
}

// Alert Modal Wire-up
closeAlertModal?.addEventListener("click", () => {
    if (alertModal) alertModal.style.display = "none";
});

async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.select();

    try {
        if (!document.execCommand("copy")) throw new Error("Clipboard access was denied");
    } finally {
        textArea.remove();
    }
}

// Report Export Wire-up
exportReportBtn?.addEventListener("click", async () => {
    if (!lastWeatherData) {
        showToast("Search a location first!", "⚠️");
        return;
    }
    const c = lastWeatherData.current;
    const l = lastWeatherData.location;
    const reportText = `[ATMOS WEATHER TELEMETRY REPORT]
Location: ${l.name}, ${l.country} (${l.region || ""})
Timestamp: ${l.localtime}
Condition: ${c.condition.text}
Temperature: ${tempDisplay(c.temp_c)}${unitSuffix()} (Feels like ${tempDisplay(c.feelslike_c)}${unitSuffix()})
Wind Vector: ${windDisplay(c.wind_kph)} ${c.wind_dir} (${c.wind_degree}°)
Relative Humidity: ${c.humidity}%
Barometer Pressure: ${c.pressure_mb} mb
Solar UV Index: ${c.uv}
US EPA Air Quality Index: ${c.air_quality?.["us-epa-index"] || 1}
Data Provider: Atmos Field Instrument Engine`;

    try {
        await copyTextToClipboard(reportText);
        showToast("Telemetry report copied to clipboard!", "📋");
    } catch (error) {
        showToast("Copy failed — check browser permissions.", "❌");
    }
});

/* -------------------------------------------------------------------- */
/* 16. Form Event Listeners                                              */
/* -------------------------------------------------------------------- */

searchButton?.addEventListener("click", async (event) => {
    event.preventDefault();
    const input = cityName.value.trim();
    if (!input) {
        showMessage(weatherDetails, "Place required", "Type a city, village, state, country, postcode, or coordinates.", "amber");
        cityName.focus();
        return;
    }

    scrollToSection("#weather");
    setLoading(weatherDetails, `Gathering telemetry for ${escapeHTML(input)}...`);
    placeCityName.value = input;
    setLoading(placeDetails, `Finding places in ${escapeHTML(input)}...`, "Searching Wikipedia landmark photography...");

    const result = await fetchWeatherData(input);
    updateWeatherDetails(result);
    if (result) {
        addRecentSearch(`${result.location.name}, ${result.location.country}`);
        refreshAllRecentChips();
        const famousPlaces = await getFamousPlaces(input);
        updatePlaceDetails(famousPlaces, input);
    }
});

locationButton?.addEventListener("click", () => {
    if (navigator.geolocation) {
        scrollToSection("#weather");
        setLoading(weatherDetails, "Locating GPS positioning...");
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const { latitude, longitude } = position.coords;
                const result = await fetchCoordsData(latitude, longitude);
                updateWeatherDetails(result);
                if (result?.location) {
                    const placeQuery = `${result.location.name}, ${result.location.country}`;
                    placeCityName.value = placeQuery;
                    addRecentSearch(placeQuery);
                    refreshAllRecentChips();
                    setLoading(placeDetails, `Finding places in ${escapeHTML(placeQuery)}...`, "Searching landmark photography...");
                    const famousPlaces = await getFamousPlaces(placeQuery);
                    updatePlaceDetails(famousPlaces, placeQuery);
                }
            },
            (error) => {
                showMessage(weatherDetails, "Location Permission Blocked", "Allow location access in browser or search by place name.", "amber");
            }
        );
    } else {
        showMessage(weatherDetails, "Geolocation Unsupported", "Your browser does not support GPS position.", "amber");
    }
});

aqiButton?.addEventListener("click", async (event) => {
    event.preventDefault();
    const input = aqiCityName.value.trim();
    if (!input) {
        showMessage(aqiDetails, "Place required", "Type any location to inspect air particulate levels.", "amber");
        aqiCityName.focus();
        return;
    }
    setLoading(aqiDetails, `Checking AQI telemetry for ${escapeHTML(input)}...`);
    const result = await fetchWeatherData(input);
    updateAQIDetails(result);
    if (result) {
        addRecentSearch(`${result.location.name}, ${result.location.country}`);
        refreshAllRecentChips();
    }
});

placeButton?.addEventListener("click", async (event) => {
    event.preventDefault();
    const input = placeCityName.value.trim();
    if (!input) {
        showMessage(placeDetails, "Place required", "Type any country, state, city, or region.", "amber");
        placeCityName.focus();
        return;
    }
    setLoading(placeDetails, `Finding places in ${escapeHTML(input)}...`, "Searching Wikipedia landmark photography...");
    const famousPlaces = await getFamousPlaces(input);
    updatePlaceDetails(famousPlaces, input);
    addRecentSearch(input);
    refreshAllRecentChips();
});

[
    ["searchFormHome", searchButton],
    ["searchFormAqi", aqiButton],
    ["searchFormPlaces", placeButton]
].forEach(([formId, button]) => {
    const form = document.getElementById(formId);
    form?.addEventListener("submit", (event) => {
        event.preventDefault();
        button?.click();
    });
});

[settingsModal, compareModal, alertModal].filter(Boolean).forEach((modal) => {
    modal.addEventListener("click", (event) => {
        if (event.target === modal) modal.style.display = "none";
    });
});

document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    [settingsModal, compareModal, alertModal].filter(Boolean).forEach((modal) => {
        modal.style.display = "none";
    });
});

/* -------------------------------------------------------------------- */
/* 17. Initialization                                                    */
/* -------------------------------------------------------------------- */

updateSkyStrip();
setupActiveNav();
renderFavoritesBar();
refreshAllRecentChips();

// Set initial unit toggle state
if (unitToggle) {
    unitToggle.querySelectorAll("button").forEach(btn => btn.classList.toggle("active", btn.dataset.unit === unit));
}

// Wire up Autocomplete Dropdowns
setupAutocomplete({
    input: cityName,
    dropdown: document.getElementById("cityAutocomplete"),
    onSelect: () => searchButton.click(),
});

setupAutocomplete({
    input: aqiCityName,
    dropdown: document.getElementById("aqiAutocomplete"),
    onSelect: () => aqiButton.click(),
});

setupAutocomplete({
    input: placeCityName,
    dropdown: document.getElementById("placeAutocomplete"),
    onSelect: () => placeButton.click(),
});

// Default Load: Load Jaipur on startup if initial
fetchWeatherData("Jaipur").then(data => {
    updateWeatherDetails(data);
    updateAQIDetails(data);
    getFamousPlaces("Jaipur").then(places => updatePlaceDetails(places, "Jaipur"));
});

/* -------------------------------------------------------------------- */
/* 18. Spatial interface interactions                                    */
/* -------------------------------------------------------------------- */

function setupSpatialInterface() {
    const scene = document.querySelector(".atmos-3d-scene");
    const hologram = document.querySelector(".hologram-stage");
    const surfaceSelector = ".readout-card, .gauge-card, .stat-tick, .place-card, .coverage-card, .field-note, .hour-card";
    const interactivePointer = window.matchMedia("(pointer: fine)");

    function bindSurfaceTilt(scope = document) {
        if (!interactivePointer.matches) return;

        scope.querySelectorAll(surfaceSelector).forEach((surface) => {
            if (surface.dataset.tiltReady === "true") return;
            surface.dataset.tiltReady = "true";
            surface.classList.add("tilt-surface");

            surface.addEventListener("pointermove", (event) => {
                const bounds = surface.getBoundingClientRect();
                const horizontal = (event.clientX - bounds.left) / bounds.width - 0.5;
                const vertical = (event.clientY - bounds.top) / bounds.height - 0.5;
                surface.style.setProperty("--tilt-x", `${(-vertical * 4).toFixed(2)}deg`);
                surface.style.setProperty("--tilt-y", `${(horizontal * 5).toFixed(2)}deg`);
                surface.style.setProperty("--tilt-z", "10px");
            });

            surface.addEventListener("pointerleave", () => {
                surface.style.setProperty("--tilt-x", "0deg");
                surface.style.setProperty("--tilt-y", "0deg");
                surface.style.setProperty("--tilt-z", "0px");
            });
        });
    }

    bindSurfaceTilt();

    [weatherDetails, aqiDetails, placeDetails].filter(Boolean).forEach((container) => {
        const observer = new MutationObserver(() => bindSurfaceTilt(container));
        observer.observe(container, { childList: true, subtree: true });
    });

    document.addEventListener("pointermove", (event) => {
        if (!scene || !interactivePointer.matches || event.pointerType !== "mouse") return;
        const offsetX = (event.clientX / window.innerWidth - 0.5) * -12;
        const offsetY = (event.clientY / window.innerHeight - 0.5) * -8;
        scene.style.transform = `translate3d(${offsetX.toFixed(1)}px, ${offsetY.toFixed(1)}px, 0)`;
        if (hologram) {
            hologram.style.setProperty("--hologram-x", `${(offsetY * -0.35).toFixed(1)}deg`);
            hologram.style.setProperty("--hologram-y", `${(offsetX * 0.45).toFixed(1)}deg`);
        }
    });
}

setupSpatialInterface();
