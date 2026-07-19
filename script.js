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

// In-memory unit preference and last reading, so toggling °C/°F re-renders instantly.
let unit = "c";
let lastWeatherData = null;

/* ---------------------------------------------------------------- */
/* Helpers                                                            */
/* ---------------------------------------------------------------- */

function setLoading(target, message, note = "Gathering live weather and air quality data...") {
    target.innerHTML = `
        <div class="field-note p-8 text-center">
            <div class="shimmer mx-auto mb-4 h-11 w-11 rounded-full"></div>
            <p class="font-display text-lg" style="color: var(--text-hi);">${message}</p>
            <p class="mt-2 text-sm" style="color: var(--text-lo);">${note}</p>
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
        <div class="field-note p-8 text-center" style="border-color:${toneColors[tone]};">
            <p class="font-display text-lg" style="color: var(--text-hi);">${title}</p>
            <p class="mt-2 text-sm leading-6" style="color: var(--text-lo);">${message}</p>
        </div>
    `;
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
    }[character]));
}

function formatNumber(value, digits = 1) {
    return Number(value ?? 0).toFixed(digits);
}

function cToF(c) {
    return (Number(c) * 9) / 5 + 32;
}

function kphToMph(kph) {
    return Number(kph) * 0.621371;
}

function scrollToSection(sectionId) {
    document.querySelector(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function stripSnippet(value) {
    const container = document.createElement("div");
    container.innerHTML = value || "";
    return container.textContent || container.innerText || "";
}

function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

/* ---------------------------------------------------------------- */
/* Client-side response cache                                        */
/* ---------------------------------------------------------------- */
/* The /api/weather proxy already caches on the server, but this saves
   a network round trip entirely when the same place is re-read within
   a session (e.g. switching tabs, or re-clicking the same search). */

const CLIENT_CACHE_TTL_MS = 3 * 60 * 1000;
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

/* ---------------------------------------------------------------- */
/* Recent searches (localStorage)                                    */
/* ---------------------------------------------------------------- */

const RECENT_KEY = "atmos.recentSearches";
const RECENT_MAX = 8;

function getRecentSearches() {
    try {
        const raw = localStorage.getItem(RECENT_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch (error) {
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
    } catch (error) {
        // Private browsing / storage full — recents just won't persist. Not fatal.
    }
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

/* ---------------------------------------------------------------- */
/* Autocomplete                                                      */
/* ---------------------------------------------------------------- */

function setupAutocomplete({ input, dropdown, onSelect }) {
    if (!input || !dropdown) return;

    let items = [];
    let activeIndex = -1;

    function closeDropdown() {
        dropdown.style.display = "none";
        dropdown.innerHTML = "";
        items = [];
        activeIndex = -1;
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
            dropdown.innerHTML = `<div class="autocomplete-empty">No matches — try a different spelling.</div>`;
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
            if (!response.ok) {
                closeDropdown();
                return;
            }
            const results = await response.json();
            renderItems(Array.isArray(results) ? results.slice(0, 8) : []);
        } catch (error) {
            closeDropdown();
        }
    }, 250);

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

/* ---------------------------------------------------------------- */
/* Sky strip — signature day/night timeline                          */
/* ---------------------------------------------------------------- */

function parseAstroTime(timeStr, baseDate) {
    // timeStr like "06:02 AM"
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

function updateSkyStrip({ hourNow, sunrise, sunset } = {}) {
    const now = typeof hourNow === "number" ? hourNow : new Date().getHours() + new Date().getMinutes() / 60;
    const nowPercent = (now / 24) * 100;
    const skyNow = document.getElementById("skyNow");
    if (skyNow) skyNow.style.left = `${nowPercent}%`;

    const sunriseEl = document.getElementById("skySunrise");
    const sunsetEl = document.getElementById("skySunset");
    const sunriseLabel = document.getElementById("skySunriseLabel");
    const sunsetLabel = document.getElementById("skySunsetLabel");

    if (sunrise != null && sunriseEl && sunriseLabel) {
        sunriseEl.style.left = `${(sunrise / 24) * 100}%`;
        sunriseEl.style.display = "block";
        sunriseLabel.textContent = "Sunrise";
    }
    if (sunset != null && sunsetEl && sunsetLabel) {
        sunsetEl.style.left = `${(sunset / 24) * 100}%`;
        sunsetEl.style.display = "block";
        sunsetLabel.textContent = "Sunset";
    }
}

/* ---------------------------------------------------------------- */
/* Weather + forecast fetch (via server-side proxy)                  */
/* ---------------------------------------------------------------- */

async function parseApiError(response) {
    try {
        const body = await response.json();
        return body?.error?.message || `HTTP ${response.status}`;
    } catch (e) {
        return `HTTP ${response.status}`;
    }
}

async function getDataByPlace(placeQuery, target = weatherDetails) {
    const cacheKey = `place:${placeQuery.toLowerCase()}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    try {
        const response = await fetch(
            `/api/weather?q=${encodeURIComponent(placeQuery)}&days=3&aqi=yes&alerts=yes`
        );
        if (!response.ok) {
            const reason = await parseApiError(response);
            throw new Error(reason);
        }
        const data = await response.json();
        cacheSet(cacheKey, data);
        return data;
    } catch (error) {
        console.error("Failed to fetch data:", error);
        showMessage(
            target,
            "Couldn't load that place",
            `${escapeHTML(error.message)} — try a more specific city, village, state, country, postcode, or latitude-longitude search.`,
            "red"
        );
    }
}

async function getDataByCoords(lat, lon) {
    const cacheKey = `coords:${lat},${lon}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    try {
        const response = await fetch(
            `/api/weather?q=${lat},${lon}&days=3&aqi=yes&alerts=yes`
        );
        if (!response.ok) {
            const reason = await parseApiError(response);
            throw new Error(reason);
        }
        const data = await response.json();
        cacheSet(cacheKey, data);
        return data;
    } catch (error) {
        console.error("Failed to fetch data:", error);
        showMessage(weatherDetails, "Weather unavailable", `${escapeHTML(error.message)} — your location was detected, but the weather service did not respond.`, "red");
    }
}

/* ---------------------------------------------------------------- */
/* Field-note suggestion engine                                      */
/* ---------------------------------------------------------------- */

function buildFieldNote(current) {
    const tempC = Number(current.temp_c);
    const condition = (current.condition?.text || "").toLowerCase();
    const windKph = Number(current.wind_kph);
    const uv = Number(current.uv ?? 0);

    const notes = [];

    if (tempC <= 5) notes.push("heavy layers and a windproof shell");
    else if (tempC <= 12) notes.push("a jacket, ideally insulated");
    else if (tempC <= 18) notes.push("a light layer for the morning");
    else if (tempC <= 27) notes.push("light, breathable clothing");
    else notes.push("loose fabrics and shade when you can find it");

    if (condition.includes("rain") || condition.includes("drizzle") || condition.includes("shower")) {
        notes.push("carry something waterproof");
    } else if (condition.includes("snow") || condition.includes("sleet") || condition.includes("ice")) {
        notes.push("grip matters more than warmth today");
    } else if (condition.includes("thunder")) {
        notes.push("keep an eye on the sky if you're heading out");
    }

    if (windKph >= 35) notes.push("wind will be the story, not the temperature");

    if (uv >= 8) notes.push("UV is high — sunscreen earns its keep");
    else if (uv >= 6) notes.push("moderate-to-high UV, worth a hat");

    return `Field note: ${notes.join("; ")}.`;
}

/* ---------------------------------------------------------------- */
/* Weather render                                                     */
/* ---------------------------------------------------------------- */

function animateNumber(el, targetValue, { decimals = 0, duration = 700, suffix = "" } = {}) {
    const start = performance.now();
    const from = 0;
    function tick(now) {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        const value = from + (targetValue - from) * eased;
        el.textContent = `${value.toFixed(decimals)}${suffix}`;
        if (progress < 1) requestAnimationFrame(tick);
        else el.textContent = `${targetValue.toFixed(decimals)}${suffix}`;
    }
    requestAnimationFrame(tick);
}

function tempDisplay(celsius, digits = 1) {
    return unit === "f" ? formatNumber(cToF(celsius), digits) : formatNumber(celsius, digits);
}

function windDisplay(kph, digits = 1) {
    return unit === "f" ? `${formatNumber(kphToMph(kph), digits)} mph` : `${formatNumber(kph, digits)} kph`;
}

function unitSuffix() {
    return unit === "f" ? "°F" : "°C";
}

function updateWeatherDetails(data) {
    if (!data) return;
    lastWeatherData = data;

    const current = data.current;
    const location = `${escapeHTML(data.location.name)}, ${escapeHTML(data.location.country)}`;
    const region = data.location.region ? `${escapeHTML(data.location.region)} • ` : "";
    const condition = escapeHTML(current.condition.text);
    const icon = `https:${current.condition.icon}`;
    const air = current.air_quality || {};
    const astro = data.forecast?.forecastday?.[0]?.astro;
    const forecastDays = data.forecast?.forecastday || [];

    const sunriseHour = astro ? parseAstroTime(astro.sunrise) : null;
    const sunsetHour = astro ? parseAstroTime(astro.sunset) : null;
    const [hh, mm] = (data.location.localtime || "").split(" ")[1]?.split(":") || [];
    const localHour = hh != null ? Number(hh) + Number(mm) / 60 : undefined;
    updateSkyStrip({ hourNow: localHour, sunrise: sunriseHour, sunset: sunsetHour });

    weatherDetails.innerHTML = `
        ${buildAlertBanner(data.alerts)}

        <article class="readout-card p-6 sm:p-8">
            <div class="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <p class="font-mono text-xs uppercase tracking-widest" style="color: var(--brass);">${region}${escapeHTML(data.location.localtime)}</p>
                    <h3 class="font-display mt-2 text-3xl" style="color: var(--text-hi);">${location}</h3>
                    <p class="mt-1 text-lg" style="color: var(--text-mid);">${condition}</p>
                </div>
                <div class="flex items-center gap-4">
                    <img src="${icon}" alt="${condition}" class="h-16 w-16 rounded-2xl" style="background: rgba(255,255,255,0.06); padding: 0.4rem;">
                    <div class="text-right">
                        <p class="temp-num text-6xl" id="tempReadout">0${unitSuffix()}</p>
                        <p class="mt-1 text-sm font-semibold" style="color: var(--text-lo);">Feels ${tempDisplay(current.feelslike_c, 0)}${unitSuffix()}</p>
                    </div>
                </div>
            </div>
        </article>

        <div class="field-note p-5">
            <p class="text-sm leading-6" style="color: var(--text-mid);">${escapeHTML(buildFieldNote(current))}</p>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            ${dialCard("Temperature", `${tempDisplay(current.temp_c)}${unitSuffix()}`, "Heat index", `${tempDisplay(current.heatindex_c)}${unitSuffix()}`, "var(--rose)")}
            ${dialCard("Wind", windDisplay(current.wind_kph), "Direction", escapeHTML(current.wind_dir), "var(--cyan)")}
            ${dialCard("Humidity", `${current.humidity}%`, "Cloud cover", `${current.cloud}%`, "var(--brass)")}
            ${dialCard("Visibility", `${formatNumber(current.vis_km)} km`, "Pressure", `${formatNumber(current.pressure_mb, 0)} mb`, "var(--text-hi)")}
            ${dialCard("UV Index", `${formatNumber(current.uv, 0)}`, "Sunrise", astro?.sunrise || "—", "var(--brass-hi)")}
            ${dialCard("Sunset", astro?.sunset || "—", "Local time", escapeHTML((data.location.localtime || "").split(" ")[1] || "—"), "var(--cyan)")}
        </div>

        ${buildHourlyStrip(forecastDays, data.location.localtime)}

        ${forecastDays.length ? buildForecastStrip(forecastDays) : ""}

        <div class="dial-card p-5">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <p class="lbl text-sm font-bold uppercase tracking-widest">Air quality</p>
                    <h4 class="font-display mt-1 text-2xl" style="color: var(--text-hi);">Clean-air indicators</h4>
                </div>
                <p class="text-sm font-semibold" style="color: var(--text-lo);">Values from WeatherAPI</p>
            </div>
            <div class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
                ${airQualityItem("CO", air.co)}
                ${airQualityItem("NO2", air.no2)}
                ${airQualityItem("O3", air.o3)}
                ${airQualityItem("PM2.5", air.pm2_5)}
                ${airQualityItem("PM10", air.pm10)}
            </div>
        </div>
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
        const icon = `https:${day.day.condition.icon}`;
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
            <p class="font-mono mb-3 text-xs uppercase tracking-widest" style="color: var(--brass);">3-day outlook</p>
            <div class="grid grid-cols-3 gap-3">${cards}</div>
        </div>
    `;
}

function buildHourlyStrip(forecastDays, localtimeStr) {
    if (!forecastDays.length) return "";
    const allHours = forecastDays.flatMap((day) => day.hour || []);
    if (!allHours.length) return "";

    const referenceMs = new Date((localtimeStr || "").replace(" ", "T")).getTime();
    const cutoff = (Number.isFinite(referenceMs) ? referenceMs : Date.now()) - 30 * 60 * 1000;

    const upcoming = allHours
        .filter((hour) => new Date(hour.time.replace(" ", "T")).getTime() >= cutoff)
        .slice(0, 12);

    if (!upcoming.length) return "";

    const cards = upcoming.map((hour) => {
        const date = new Date(hour.time.replace(" ", "T"));
        const label = date.toLocaleTimeString(undefined, { hour: "numeric" });
        const icon = `https:${hour.condition.icon}`;
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
            <p class="font-mono mb-3 text-xs uppercase tracking-widest" style="color: var(--brass);">Next 12 hours</p>
            <div class="hour-strip">${cards}</div>
        </div>
    `;
}

function buildAlertBanner(alerts) {
    const list = alerts?.alert || [];

    if (!list.length) {
        return `
            <div class="alert-banner calm">
                <p class="font-mono text-xs uppercase tracking-widest" style="color: var(--text-lo);">Alerts</p>
                <p class="mt-1 text-sm font-semibold" style="color: var(--text-mid);">No active weather alerts for this location.</p>
            </div>
        `;
    }

    const items = list.map((alert) => {
        const desc = alert.desc || "";
        const trimmedDesc = desc.length > 280 ? `${desc.slice(0, 280)}…` : desc;
        const meta = [alert.severity, alert.areas].filter(Boolean).join(" · ");
        return `
            <div class="alert-item">
                <p class="font-display text-lg" style="color: var(--text-hi);">${escapeHTML(alert.headline || alert.event || "Weather alert")}</p>
                ${meta ? `<p class="mt-1 font-mono text-xs uppercase tracking-widest" style="color: var(--rose);">${escapeHTML(meta)}</p>` : ""}
                ${trimmedDesc ? `<p class="mt-2 text-sm leading-6" style="color: var(--text-mid);">${escapeHTML(trimmedDesc)}</p>` : ""}
            </div>
        `;
    }).join("");

    return `
        <div class="alert-banner">
            <p class="font-mono text-xs uppercase tracking-widest" style="color: var(--rose);">⚠ Active alerts</p>
            ${items}
        </div>
    `;
}

function dialCard(title, value, label, subValue, accent) {
    return `
        <div class="dial-card p-5">
            <div class="flex items-start justify-between gap-4">
                <div>
                    <p class="lbl text-xs font-bold uppercase tracking-widest">${title}</p>
                    <p class="val mt-3 text-2xl font-bold">${value}</p>
                    <p class="lbl mt-2 text-sm font-semibold">${label}: ${subValue}</p>
                </div>
                <span class="dial-swatch" style="background: color-mix(in srgb, ${accent} 18%, transparent);">
                    <span style="width:0.6rem;height:0.6rem;border-radius:999px;background:${accent};display:block;"></span>
                </span>
            </div>
        </div>
    `;
}

function airQualityItem(label, value) {
    return `
        <div class="pollutant-chip p-4 text-center">
            <p class="font-mono text-xs font-black uppercase tracking-wider" style="color: var(--text-lo);">${label}</p>
            <p class="val mt-2 text-lg font-black">${formatNumber(value)}</p>
        </div>
    `;
}

/* ---------------------------------------------------------------- */
/* AQI render                                                         */
/* ---------------------------------------------------------------- */

const EPA_LABELS = { 1: "Good", 2: "Moderate", 3: "Unhealthy (SG)", 4: "Unhealthy", 5: "Very unhealthy", 6: "Hazardous" };
const EPA_COLORS = { 1: "#5fbf7a", 2: "#c9d15f", 3: "#e3b96a", 4: "#dd7a5f", 5: "#c25a7a", 6: "#8a4a6a" };

function updateAQIDetails(data) {
    if (!data) return;

    const air = data.current.air_quality || {};
    const place = `${escapeHTML(data.location.name)}, ${escapeHTML(data.location.country)}`;
    const region = data.location.region ? `${escapeHTML(data.location.region)} • ` : "";
    const epaIndex = air["us-epa-index"] ?? null;
    const gbIndex = air["gb-defra-index"] ?? "N/A";
    const epaColor = epaIndex ? EPA_COLORS[epaIndex] : "var(--text-lo)";
    const epaLabel = epaIndex ? EPA_LABELS[epaIndex] : "Unavailable";
    const gaugeDeg = epaIndex ? (epaIndex / 6) * 360 : 0;

    aqiDetails.innerHTML = `
        <article class="readout-card p-6 sm:p-8">
            <p class="font-mono text-xs uppercase tracking-widest" style="color: var(--brass);">${region}${escapeHTML(data.location.localtime)}</p>
            <h3 class="font-display mt-2 text-3xl" style="color: var(--text-hi);">${place}</h3>
            <p class="mt-2 text-sm" style="color: var(--text-mid);">Air quality report for ${escapeHTML(data.current.condition.text)} conditions.</p>
            <div class="mt-6 flex flex-col items-center gap-6 sm:flex-row sm:items-center">
                <div class="gauge" style="background: conic-gradient(${epaColor} ${gaugeDeg}deg, rgba(255,255,255,0.08) 0deg);">
                    <div class="gauge-inner">
                        <span class="n">${epaIndex ?? "—"}</span>
                        <span class="t">US EPA</span>
                    </div>
                </div>
                <div>
                    <p class="font-display text-xl" style="color: var(--text-hi);">${epaLabel}</p>
                    <p class="mt-1 text-sm" style="color: var(--text-lo);">GB DEFRA index: <span class="font-mono font-bold" style="color: var(--text-hi);">${gbIndex}</span></p>
                </div>
            </div>
        </article>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
            ${airQualityItem("CO", air.co)}
            ${airQualityItem("NO2", air.no2)}
            ${airQualityItem("O3", air.o3)}
            ${airQualityItem("SO2", air.so2)}
            ${airQualityItem("PM2.5", air.pm2_5)}
            ${airQualityItem("PM10", air.pm10)}
        </div>
    `;
}

/* ---------------------------------------------------------------- */
/* Famous places                                                      */
/* ---------------------------------------------------------------- */

async function getFamousPlaces(placeQuery) {
    try {
        const entity = await findWikidataLocation(placeQuery);
        if (entity) {
            const wikidataPlaces = await getWikidataPlaces(entity.id);
            if (wikidataPlaces.length) return wikidataPlaces;
        }
        return getWikipediaFallbackPlaces(placeQuery);
    } catch (error) {
        console.error("Failed to fetch famous places:", error);
        return getWikipediaFallbackPlaces(placeQuery);
    }
}

async function findWikidataLocation(placeQuery) {
    const endpoint = `https://www.wikidata.org/w/api.php?action=wbsearchentities&language=en&format=json&origin=*&limit=5&search=${encodeURIComponent(placeQuery)}`;
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    const data = await response.json();
    return data.search?.find((item) => item.id && item.label) || null;
}

async function getWikidataPlaces(entityId) {
    const query = `
        PREFIX schema: <http://schema.org/>
        SELECT DISTINCT ?place ?placeLabel ?description ?article WHERE {
          {
            ?place wdt:P131* wd:${entityId}.
          }
          UNION
          {
            ?place wdt:P17 wd:${entityId}.
          }
          ?place wdt:P31/wdt:P279* ?type.
          VALUES ?type {
            wd:Q570116
            wd:Q33506
            wd:Q4989906
            wd:Q23413
            wd:Q839954
            wd:Q46169
            wd:Q17431399
            wd:Q9259
            wd:Q16560
            wd:Q8502
            wd:Q24354
            wd:Q22698
          }
          ?article schema:about ?place;
                   schema:isPartOf <https://en.wikipedia.org/>.
          SERVICE wikibase:label {
            bd:serviceParam wikibase:language "en".
            ?place rdfs:label ?placeLabel.
            ?place schema:description ?description.
          }
        }
        LIMIT 8
    `;
    const endpoint = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
    const response = await fetch(endpoint, { headers: { Accept: "application/sparql-results+json" } });
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    const data = await response.json();
    return (data.results?.bindings || []).map((item) => ({
        title: item.placeLabel?.value || "Famous place",
        snippet: item.description?.value || "A visitable attraction connected to this location.",
        link: item.article?.value || item.place?.value,
        source: "Wikidata",
    }));
}

async function getWikipediaFallbackPlaces(placeQuery) {
    const searchQueries = [
        `tourist attractions in ${placeQuery}`,
        `landmarks in ${placeQuery}`,
        `museums monuments parks in ${placeQuery}`,
    ];
    for (const query of searchQueries) {
        const endpoint = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=8&srsearch=${encodeURIComponent(query)}`;
        const response = await fetch(endpoint);
        if (!response.ok) continue;
        const data = await response.json();
        const filtered = (data.query?.search || [])
            .filter((item) => isLikelyPlaceResult(item.title))
            .slice(0, 6)
            .map((item) => ({
                title: item.title,
                snippet: stripSnippet(item.snippet),
                link: `https://en.wikipedia.org/?curid=${item.pageid}`,
                source: "Wikipedia",
            }));
        if (filtered.length) return filtered;
    }
    return [];
}

function isLikelyPlaceResult(title) {
    const lowerTitle = title.toLowerCase();
    const broadWords = ["tourism in", "list of", "category:", "outline of", "history of"];
    return !broadWords.some((word) => lowerTitle.includes(word));
}

function updatePlaceDetails(results, placeQuery) {
    if (!results.length) {
        showMessage(
            placeDetails,
            "No places found",
            "Try a more specific city, state, country, landmark area, or nearby larger region.",
            "amber"
        );
        return;
    }

    placeDetails.innerHTML = `
        <article class="readout-card p-6">
            <p class="font-mono text-xs uppercase tracking-widest" style="color: var(--rose);">Travel suggestions</p>
            <h3 class="font-display mt-2 text-2xl" style="color: var(--text-hi);">${escapeHTML(placeQuery)}</h3>
            <p class="mt-2 text-sm" style="color: var(--text-lo);">Structured attraction results from Wikidata, with a Wikipedia fallback.</p>
        </article>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            ${results.map((item) => placeCard(item)).join("")}
        </div>
    `;
}

function placeCard(item) {
    const title = escapeHTML(item.title);
    const snippet = escapeHTML(stripSnippet(item.snippet)).slice(0, 150);
    const link = item.link || "#";
    const source = escapeHTML(item.source || "Places API");

    return `
        <a href="${link}" target="_blank" rel="noopener noreferrer" class="place-card block p-5">
            <p class="font-display text-lg" style="color: var(--text-hi);">${title}</p>
            <p class="mt-3 text-sm leading-6" style="color: var(--text-lo);">${snippet || "Open this result to learn more about the place."}</p>
            <p class="source-tag mt-4 font-bold" style="color: var(--rose);">View details · ${source}</p>
        </a>
    `;
}

/* ---------------------------------------------------------------- */
/* Active nav highlight                                               */
/* ---------------------------------------------------------------- */

function setupActiveNav() {
    const links = document.querySelectorAll("#mainNav .nav-link");
    const sections = ["home", "weather", "aqi", "places", "coverage"]
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
        { rootMargin: "-45% 0px -50% 0px", threshold: 0 }
    );

    sections.forEach((section) => observer.observe(section));
}

/* ---------------------------------------------------------------- */
/* Unit toggle                                                        */
/* ---------------------------------------------------------------- */

unitToggle?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-unit]");
    if (!button) return;
    const nextUnit = button.dataset.unit;
    if (nextUnit === unit) return;
    unit = nextUnit;
    unitToggle.querySelectorAll("button").forEach((btn) => btn.classList.toggle("active", btn.dataset.unit === unit));
    if (lastWeatherData) updateWeatherDetails(lastWeatherData);
});

/* ---------------------------------------------------------------- */
/* Event wiring                                                       */
/* ---------------------------------------------------------------- */

searchButton.addEventListener("click", async () => {
    const input = cityName.value.trim();
    if (!input) {
        showMessage(weatherDetails, "Place required", "Type a city, village, state, country, postcode, or coordinates.", "amber");
        cityName.focus();
        return;
    }

    scrollToSection("#weather");
    setLoading(weatherDetails, `Checking ${escapeHTML(input)}...`);
    placeCityName.value = input;
    setLoading(placeDetails, `Finding places in ${escapeHTML(input)}...`, "Searching attractions, landmarks, parks, and monuments...");
    const result = await getDataByPlace(input, weatherDetails);
    updateWeatherDetails(result);
    if (result) {
        addRecentSearch(`${result.location.name}, ${result.location.country}`);
        refreshAllRecentChips();
        const famousPlaces = await getFamousPlaces(input);
        updatePlaceDetails(famousPlaces, input);
    }
});

cityName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchButton.click();
});

locationButton.addEventListener("click", () => {
    if (navigator.geolocation) {
        scrollToSection("#weather");
        setLoading(weatherDetails, "Finding your local forecast...");
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const { latitude, longitude } = position.coords;
                const result = await getDataByCoords(latitude, longitude);
                updateWeatherDetails(result);
                if (result?.location) {
                    const placeQuery = `${result.location.name}, ${result.location.country}`;
                    placeCityName.value = placeQuery;
                    addRecentSearch(placeQuery);
                    refreshAllRecentChips();
                    setLoading(placeDetails, `Finding places in ${escapeHTML(placeQuery)}...`, "Searching attractions, landmarks, parks, and monuments...");
                    const famousPlaces = await getFamousPlaces(placeQuery);
                    updatePlaceDetails(famousPlaces, placeQuery);
                }
            },
            (error) => {
                console.error("Error getting location:", error);
                showMessage(weatherDetails, "Location blocked", "Allow location access in your browser or search by place name instead.", "amber");
            }
        );
    } else {
        showMessage(weatherDetails, "Location unsupported", "Your browser does not support geolocation. Search by place name instead.", "amber");
    }
});

aqiButton.addEventListener("click", async () => {
    const input = aqiCityName.value.trim();
    if (!input) {
        showMessage(aqiDetails, "Place required", "Type any city, village, state, country, postcode, or coordinates to check AQI.", "amber");
        aqiCityName.focus();
        return;
    }
    setLoading(aqiDetails, `Checking AQI for ${escapeHTML(input)}...`);
    const result = await getDataByPlace(input, aqiDetails);
    updateAQIDetails(result);
    if (result) {
        addRecentSearch(`${result.location.name}, ${result.location.country}`);
        refreshAllRecentChips();
    }
});

aqiCityName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") aqiButton.click();
});

placeButton.addEventListener("click", async () => {
    const input = placeCityName.value.trim();
    if (!input) {
        showMessage(placeDetails, "Place required", "Type any country, state, city, village, region, or landmark area.", "amber");
        placeCityName.focus();
        return;
    }
    setLoading(placeDetails, `Finding places in ${escapeHTML(input)}...`, "Searching attractions, landmarks, parks, and monuments...");
    const famousPlaces = await getFamousPlaces(input);
    updatePlaceDetails(famousPlaces, input);
    addRecentSearch(input);
    refreshAllRecentChips();
});

placeCityName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") placeButton.click();
});

/* ---------------------------------------------------------------- */
/* Init                                                                */
/* ---------------------------------------------------------------- */

updateSkyStrip();
setupActiveNav();
refreshAllRecentChips();

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
