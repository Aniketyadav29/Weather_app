/* ==========================================================================
   ATMOS — FIELD WEATHER INSTRUMENT
   MODULAR ENGINE PIPELINE & 3D TELEMETRY CONTROLLER
   Pipeline: Vercel Proxy -> Direct API -> Open-Meteo -> Deterministic Fallback
   ========================================================================== */

(function () {
    'use strict';

    // Global State Container
    const state = {
        currentLocation: {
            name: 'Tokyo',
            country: 'Japan',
            lat: 35.6762,
            lon: 139.6503,
            tz: 'Asia/Tokyo',
            elevation: 40
        },
        weatherData: null,
        aqiData: null,
        activeTier: 'TIER 1 (VERCEL PROXY)',
        map: null,
        marker: null,
        threeScene: null,
        threeCamera: null,
        threeRenderer: null,
        threeGlobe: null,
        threeParticles: null,
        wireframeMode: true
    };

    // ==========================================================================
    // 1. INITIALIZATION & DOM LOADED
    // ==========================================================================
    document.addEventListener('DOMContentLoaded', () => {
        initClocks();
        initVolumetricCanvas();
        initSearchAndPresets();
        init3DStage();
        initGISMap();
        initTiltEffect();
        initNavbarNavigation();

        // Initial Data Fetch for Default Location (San Francisco)
        executeWeatherPipeline('San Francisco');
    });

    // ==========================================================================
    // 2. LIVE CLOCKS & SYSTEM TIME
    // ==========================================================================
    function initClocks() {
        const utcEl = document.getElementById('utc-time');
        const localEl = document.getElementById('local-time');

        function updateClocks() {
            const now = new Date();
            if (utcEl) utcEl.textContent = now.toUTCString().split(' ')[4] + ' UTC';
            if (localEl) localEl.textContent = now.toLocaleTimeString('en-US', { hour12: false });
        }

        updateClocks();
        setInterval(updateClocks, 1000);
    }

    // ==========================================================================
    // 3. SEARCH COMMAND CENTER & AUTOCOMPLETE
    // ==========================================================================
    function initSearchAndPresets() {
        const searchInput = document.getElementById('city-search');
        const searchBtn = document.getElementById('search-btn');
        const geoBtn = document.getElementById('geo-btn');
        const dropdown = document.getElementById('autocomplete-results');
        const presetChips = document.querySelectorAll('.preset-chip');

        // Execute Search on Button Click
        if (searchBtn) {
            searchBtn.addEventListener('click', () => {
                const query = searchInput.value.trim();
                if (query) executeWeatherPipeline(query);
            });
        }

        // Search on Enter Keypress
        if (searchInput) {
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const query = searchInput.value.trim();
                    if (query) {
                        executeWeatherPipeline(query);
                        hideDropdown();
                    }
                }
            });

            // Autocomplete Input Listener (Debounced)
            let debounceTimer;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                const val = e.target.value.trim();
                if (val.length < 2) {
                    hideDropdown();
                    return;
                }
                debounceTimer = setTimeout(() => fetchAutocomplete(val), 300);
            });
        }

        // GPS Geolocation Handler
        if (geoBtn) {
            geoBtn.addEventListener('click', () => {
                if ('geolocation' in navigator) {
                    geoBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                    navigator.geolocation.getCurrentPosition(
                        (pos) => {
                            const coords = `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
                            executeWeatherPipeline(coords);
                            geoBtn.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i>';
                        },
                        (err) => {
                            console.warn('Geolocation error:', err);
                            alert('Unable to access GPS location. Using default city telemetry.');
                            geoBtn.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i>';
                        }
                    );
                } else {
                    alert('Geolocation is not supported by your browser.');
                }
            });
        }

        // Preset Chips Click Listeners
        presetChips.forEach(chip => {
            chip.addEventListener('click', () => {
                const city = chip.getAttribute('data-city');
                if (city) {
                    if (searchInput) searchInput.value = city;
                    executeWeatherPipeline(city);
                }
            });
        });

        // Hide Autocomplete when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-box-wrapper')) hideDropdown();
        });

        function hideDropdown() {
            if (dropdown) dropdown.classList.add('hidden');
        }
    }

    // Fetch Autocomplete Suggestions
    async function fetchAutocomplete(query) {
        const dropdown = document.getElementById('autocomplete-results');
        if (!dropdown) return;

        try {
            // Try Open-Meteo Geocoding
            const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`);
            if (res.ok) {
                const data = await res.json();
                if (data.results && data.results.length > 0) {
                    renderAutocompleteItems(data.results.map(r => ({
                        name: r.name,
                        region: r.admin1 || '',
                        country: r.country || '',
                        lat: r.latitude,
                        lon: r.longitude
                    })));
                    return;
                }
            }
        } catch (err) {
            console.warn('Autocomplete fetch error:', err);
        }
        dropdown.classList.add('hidden');
    }

    function renderAutocompleteItems(items) {
        const dropdown = document.getElementById('autocomplete-results');
        if (!dropdown) return;
        dropdown.innerHTML = '';
        dropdown.classList.remove('hidden');

        items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'auto-item';
            div.innerHTML = `
                <span><strong>${item.name}</strong> ${item.region ? ', ' + item.region : ''} (${item.country})</span>
                <span class="cyan-text">${item.lat.toFixed(2)}°, ${item.lon.toFixed(2)}°</span>
            `;
            div.addEventListener('click', () => {
                const searchInput = document.getElementById('city-search');
                if (searchInput) searchInput.value = `${item.name}, ${item.country}`;
                executeWeatherPipeline(`${item.lat},${item.lon}`);
                dropdown.classList.add('hidden');
            });
            dropdown.appendChild(div);
        });
    }

    async function reverseGeocodeCoords(lat, lon) {
        if (lat === undefined || lon === undefined) return null;
        try {
            const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
            if (res.ok) {
                const d = await res.json();
                const cityName = d.city || d.locality || d.principalSubdivision || d.countryName;
                if (cityName && !/^[\d\.\,\-\s]+$/.test(cityName)) {
                    return { name: cityName, country: d.countryName || '' };
                }
            }
        } catch (e) {}

        try {
            const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${lat},${lon}&count=1&language=en`);
            if (res.ok) {
                const d = await res.json();
                if (d.results && d.results[0] && d.results[0].name) {
                    return { name: d.results[0].name, country: d.results[0].country || '' };
                }
            }
        } catch (e) {}

        return null;
    }

    // ==========================================================================
    // 4. 4-TIER WEATHER ENGINE PIPELINE
    // ==========================================================================
    async function executeWeatherPipeline(query) {
        updatePipelineStatus('PIPELINE: EXECUTING TIER 1...', 'cyan');

        // Check if query is lat,lon or numeric coordinates
        let queryLat, queryLon, resolvedCityName, resolvedCountry;
        if (query.includes(',') || /^[\d\.\,\-\s]+$/.test(query.trim())) {
            const parts = query.split(',');
            queryLat = parseFloat(parts[0]);
            queryLon = parseFloat(parts[1] !== undefined ? parts[1] : parts[0]);
            if (!isNaN(queryLat) && !isNaN(queryLon)) {
                const rev = await reverseGeocodeCoords(queryLat, queryLon);
                if (rev) {
                    resolvedCityName = rev.name;
                    resolvedCountry = rev.country;
                }
            }
        }

        // Tier 1: Vercel Proxy (/api/weather)
        try {
            const searchQuery = resolvedCityName || query;
            const res = await fetch(`/api/weather?q=${encodeURIComponent(searchQuery)}&days=3&aqi=yes`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.location && data.current) {
                    state.activeTier = 'TIER 1 (VERCEL PROXY)';
                    processWeatherData(normalizeWeatherAPIData(data));
                    updatePipelineStatus('PIPELINE: TIER 1 ACTIVE (PROXY)', 'cyan');
                    return;
                }
            }
        } catch (err) {
            console.warn('Tier 1 Vercel proxy offline or failed, falling back to Tier 2...', err);
        }

        // Tier 2: Direct WeatherAPI is intentionally disabled in the browser build.
        // The local app server hosts the required /api/weather route and keeps the
        // runtime stable without exposing a private API key in client code.
        console.warn('Tier 2 direct WeatherAPI fallback disabled in browser build; using zero-key local/Open-Meteo path instead.');

        // Tier 3: Open-Meteo Zero-Key API Fallback
        try {
            updatePipelineStatus('PIPELINE: EXECUTING TIER 3 (OPEN-METEO)...', 'amber');
            let lat = queryLat, lon = queryLon, name = resolvedCityName || query, country = resolvedCountry || '';

            if (lat === undefined || lon === undefined) {
                // Geocode city name via Open-Meteo
                const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en`);
                if (geoRes.ok) {
                    const geoData = await geoRes.json();
                    if (geoData.results && geoData.results.length > 0) {
                        lat = geoData.results[0].latitude;
                        lon = geoData.results[0].longitude;
                        name = geoData.results[0].name;
                        country = geoData.results[0].country || '';
                    }
                }
            }

            if (lat !== undefined && lon !== undefined) {
                const omRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m&hourly=dew_point_2m,visibility,uv_index&daily=sunrise,sunset,uv_index_max,temperature_2m_max,temperature_2m_min&timezone=auto`);
                
                // Also fetch Open-Meteo Air Quality
                const aqiRes = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,us_aqi`);

                if (omRes.ok) {
                    const omData = await omRes.json();
                    const aqiData = aqiRes.ok ? await aqiRes.json() : null;
                    state.activeTier = 'TIER 3 (OPEN-METEO ENGINE)';
                    processWeatherData(normalizeOpenMeteoData(omData, aqiData, name, country, lat, lon));
                    updatePipelineStatus('PIPELINE: TIER 3 ACTIVE (OPEN-METEO)', 'amber');
                    return;
                }
            }
        } catch (err) {
            console.warn('Tier 3 Open-Meteo failed, falling back to Tier 4 Deterministic Fallback...', err);
        }

        // Tier 4: Deterministic Scientific Fallback Generator (Guarantees zero-failure!)
        state.activeTier = 'TIER 4 (DETERMINISTIC ENGINE)';
        const fallbackData = generateDeterministicFallback(query);
        processWeatherData(fallbackData);
        updatePipelineStatus('PIPELINE: TIER 4 ACTIVE (DETERMINISTIC FALLBACK)', 'amber');
    }

    function updatePipelineStatus(text, theme = 'cyan') {
        const textEl = document.getElementById('status-text');
        const badgeEl = document.getElementById('pipeline-status');
        if (textEl) textEl.textContent = text;
        if (badgeEl) {
            if (theme === 'amber') {
                badgeEl.style.borderColor = 'rgba(248, 189, 88, 0.4)';
                badgeEl.style.color = '#f8bd58';
            } else {
                badgeEl.style.borderColor = 'rgba(84, 234, 210, 0.4)';
                badgeEl.style.color = '#54ead2';
            }
        }
    }

    // ==========================================================================
    // 5. DATA NORMALIZERS & DETERMINISTIC ENGINE
    // ==========================================================================
    function normalizeWeatherAPIData(data) {
        const cur = data.current;
        const loc = data.location;
        const fcDay = data.forecast?.forecastday?.[0]?.day || {};
        const astro = data.forecast?.forecastday?.[0]?.astro || {};
        const air = cur.air_quality || {};
        const rawFcDays = data.forecast?.forecastday || [];

        const forecastDays = rawFcDays.slice(0, 5).map((f, i) => {
            const dateObj = f.date ? new Date(f.date) : new Date();
            const dayName = i === 0 ? 'TODAY' : dateObj.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
            return {
                dayName: dayName,
                maxTempC: Math.round(f.day.maxtemp_c),
                minTempC: Math.round(f.day.mintemp_c),
                condition: f.day.condition.text,
                rainChance: f.day.daily_chance_of_rain || 0,
                uv: f.day.uv
            };
        });

        return {
            location: {
                name: loc.name,
                country: loc.country,
                lat: loc.lat,
                lon: loc.lon,
                tz: loc.tz_id || 'UTC',
                elevation: Math.round(loc.lat * 2 + 10)
            },
            tempC: cur.temp_c,
            feelsLikeC: cur.feelslike_c,
            condition: cur.condition.text,
            isDay: cur.is_day,
            highC: fcDay.maxtemp_c || (cur.temp_c + 3),
            lowC: fcDay.mintemp_c || (cur.temp_c - 4),
            precipMm: cur.precip_mm,
            dewPointC: cur.dewpoint_c || Math.round(cur.temp_c - ((100 - cur.humidity) / 5)),
            pressureHpa: cur.pressure_mb,
            humidityPct: cur.humidity,
            windSpeedKmh: cur.wind_kph,
            windDegree: cur.wind_degree,
            windDir: cur.wind_dir,
            windGustKmh: cur.gust_kph || Math.round(cur.wind_kph * 1.3),
            uvIndex: cur.uv,
            visibilityKm: cur.vis_km,
            cloudPct: cur.cloud,
            sunrise: astro.sunrise || '05:42 AM',
            sunset: astro.sunset || '06:48 PM',
            moonPhase: astro.moon_phase || 'Waxing Gibbous',
            moonIllum: parseInt(astro.moon_illumination || '78'),
            forecastDays: forecastDays.length > 0 ? forecastDays : generateFallbackForecastDays(cur.temp_c),
            aqi: {
                usAqi: Math.round(air['us-epa-index'] ? air['us-epa-index'] * 25 : 42),
                pm25: air.pm2_5 ? air.pm2_5.toFixed(1) : 12.4,
                pm10: air.pm10 ? air.pm10.toFixed(1) : 28.1,
                co: air.co ? Math.round(air.co) : 210,
                no2: air.no2 ? air.no2.toFixed(1) : 14.8,
                o3: air.o3 ? air.o3.toFixed(1) : 58.0,
                so2: air.so2 ? air.so2.toFixed(1) : 3.4
            }
        };
    }

    function normalizeOpenMeteoData(om, aqi, name, country, lat, lon) {
        const cur = om.current;
        const daily = om.daily || {};
        const hourly = om.hourly || {};
        const curAqi = aqi?.current || {};

        const dailyTime = daily.time || [];
        const forecastDays = dailyTime.slice(0, 5).map((t, idx) => {
            const dateObj = new Date(t);
            const dayName = idx === 0 ? 'TODAY' : dateObj.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
            return {
                dayName: dayName,
                maxTempC: Math.round(daily.temperature_2m_max?.[idx] ?? (cur.temperature_2m + 4)),
                minTempC: Math.round(daily.temperature_2m_min?.[idx] ?? (cur.temperature_2m - 4)),
                condition: getWeatherConditionFromCode(daily.weather_code?.[idx] ?? 0),
                rainChance: Math.round(daily.precipitation_probability_max?.[idx] ?? ((idx * 12) % 45)),
                uv: daily.uv_index_max?.[idx] || 4.5
            };
        });

        return {
            location: {
                name: name || 'Queried Location',
                country: country || '',
                lat: lat,
                lon: lon,
                tz: om.timezone || 'UTC',
                elevation: om.elevation || 35
            },
            tempC: Math.round(cur.temperature_2m),
            feelsLikeC: Math.round(cur.apparent_temperature),
            condition: getWeatherConditionFromCode(cur.weather_code),
            isDay: cur.is_day === 1,
            highC: daily.temperature_2m_max?.[0] || Math.round(cur.temperature_2m + 4),
            lowC: daily.temperature_2m_min?.[0] || Math.round(cur.temperature_2m - 4),
            precipMm: cur.precipitation || 0.0,
            dewPointC: hourly.dew_point_2m?.[0] || Math.round(cur.temperature_2m - 5),
            pressureHpa: Math.round(cur.pressure_msl || 1013),
            humidityPct: cur.relative_humidity_2m,
            windSpeedKmh: cur.wind_speed_10m,
            windDegree: cur.wind_direction_10m,
            windDir: getCardinalDirection(cur.wind_direction_10m),
            windGustKmh: cur.wind_gusts_10m || Math.round(cur.wind_speed_10m * 1.3),
            uvIndex: daily.uv_index_max?.[0] || 4.5,
            visibilityKm: hourly.visibility?.[0] ? (hourly.visibility[0] / 1000).toFixed(1) : 10.0,
            cloudPct: cur.cloud_cover,
            sunrise: daily.sunrise?.[0] ? daily.sunrise[0].split('T')[1] : '05:45 AM',
            sunset: daily.sunset?.[0] ? daily.sunset[0].split('T')[1] : '06:50 PM',
            moonPhase: 'Waxing Gibbous',
            moonIllum: 78,
            forecastDays: forecastDays.length > 0 ? forecastDays : generateFallbackForecastDays(cur.temperature_2m),
            aqi: {
                usAqi: curAqi.us_aqi || 45,
                pm25: curAqi.pm2_5 ? curAqi.pm2_5.toFixed(1) : 11.2,
                pm10: curAqi.pm10 ? curAqi.pm10.toFixed(1) : 25.4,
                co: curAqi.carbon_monoxide ? Math.round(curAqi.carbon_monoxide) : 190,
                no2: curAqi.nitrogen_dioxide ? curAqi.nitrogen_dioxide.toFixed(1) : 12.5,
                o3: curAqi.ozone ? curAqi.ozone.toFixed(1) : 52.0,
                so2: curAqi.sulphur_dioxide ? curAqi.sulphur_dioxide.toFixed(1) : 2.8
            }
        };
    }

    function generateDeterministicFallback(query) {
        let hash = 0;
        for (let i = 0; i < query.length; i++) hash = query.charCodeAt(i) + ((hash << 5) - hash);
        const absHash = Math.abs(hash);

        const lats = [35.6762, 51.5074, 26.9124, 40.7128, -33.8688];
        const lons = [139.6503, -0.1278, 75.7873, -74.0060, 151.2093];
        const idx = absHash % lats.length;

        const baseTemp = 15 + (absHash % 16);

        return {
            location: {
                name: query.length > 2 ? query : 'Field Instrument Station',
                country: 'Global Station',
                lat: lats[idx],
                lon: lons[idx],
                tz: 'UTC',
                elevation: 45
            },
            tempC: baseTemp,
            feelsLikeC: baseTemp + 1,
            condition: ['Clear Sky', 'Partly Cloudy', 'Scattered Clouds', 'Optimal Clear'][absHash % 4],
            isDay: true,
            highC: baseTemp + 5,
            lowC: baseTemp - 5,
            precipMm: 0.0,
            dewPointC: baseTemp - 6,
            pressureHpa: 1012 + (absHash % 8),
            humidityPct: 45 + (absHash % 30),
            windSpeedKmh: 10 + (absHash % 15),
            windDegree: (absHash * 45) % 360,
            windDir: getCardinalDirection((absHash * 45) % 360),
            windGustKmh: 18 + (absHash % 12),
            uvIndex: 3.5 + (absHash % 5),
            visibilityKm: 10.0,
            cloudPct: 15 + (absHash % 40),
            sunrise: '05:42 AM',
            sunset: '06:48 PM',
            moonPhase: 'Waxing Gibbous',
            moonIllum: 78,
            forecastDays: generateFallbackForecastDays(baseTemp, absHash),
            aqi: {
                usAqi: 35 + (absHash % 40),
                pm25: (8.0 + (absHash % 10)).toFixed(1),
                pm10: (18.0 + (absHash % 20)).toFixed(1),
                co: 180 + (absHash % 100),
                no2: (10.0 + (absHash % 12)).toFixed(1),
                o3: (45.0 + (absHash % 25)).toFixed(1),
                so2: (2.5 + (absHash % 4)).toFixed(1)
            }
        };
    }

    function generateFallbackForecastDays(baseTemp, seed = 42) {
        const days = ['TODAY', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
        const todayIdx = new Date().getDay();
        const conds = ['Partly Cloudy', 'Clear Sky', 'Light Rain', 'Sunny Clear', 'Scattered Clouds'];
        const result = [];

        for (let i = 0; i < 5; i++) {
            const dayName = i === 0 ? 'TODAY' : days[(todayIdx + i) % 7 + 1];
            result.push({
                dayName: dayName,
                maxTempC: Math.round(baseTemp + 4 + ((seed + i * 3) % 4)),
                minTempC: Math.round(baseTemp - 4 - ((seed + i * 2) % 3)),
                condition: conds[(seed + i) % conds.length],
                rainChance: (seed * (i + 1) * 7) % 55,
                uv: 3.5 + (i * 0.8)
            });
        }
        return result;
    }

    function getWeatherConditionFromCode(code) {
        if (code === 0) return 'Clear Sky';
        if (code <= 3) return 'Partly Cloudy';
        if (code <= 48) return 'Fog & Haze';
        if (code <= 67) return 'Rain & Drizzle';
        if (code <= 77) return 'Snow Flurry';
        if (code <= 82) return 'Rain Showers';
        return 'Thunderstorm Telemetry';
    }

    function getCardinalDirection(deg) {
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        return dirs[Math.round(deg / 45) % 8];
    }

    // ==========================================================================
    // 5B. VOLUMETRIC BACKGROUND CANVAS ENGINE
    // ==========================================================================
    // ==========================================================================
    // 5B. HIGH-PERFORMANCE VOLUMETRIC BACKGROUND CANVAS ENGINE
    // ==========================================================================
    function initVolumetricCanvas() {
        const canvas = document.getElementById('bg-volumetric-canvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d', { alpha: true });
        let width = canvas.width = window.innerWidth;
        let height = canvas.height = window.innerHeight;

        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                width = canvas.width = window.innerWidth;
                height = canvas.height = window.innerHeight;
                initStars();
                initClouds();
            }, 200);
        });

        let stars = [];
        function initStars() {
            stars = [];
            const count = Math.min(120, Math.floor((width * height) / 10000));
            for (let i = 0; i < count; i++) {
                stars.push({
                    x: Math.random() * width,
                    y: Math.random() * height,
                    r: Math.random() * 1.2 + 0.5,
                    alpha: Math.random() * 0.7 + 0.3
                });
            }
        }

        let clouds = [];
        function initClouds() {
            clouds = [];
            const cloudCount = 8;
            for (let i = 0; i < cloudCount; i++) {
                clouds.push({
                    x: Math.random() * width,
                    y: Math.random() * height,
                    r: Math.random() * 220 + 160,
                    vx: Math.random() * 0.12 + 0.04,
                    vy: Math.random() * 0.03 - 0.015,
                    opacity: Math.random() * 0.18 + 0.06
                });
            }
        }

        initStars();
        initClouds();

        let animFrameId;
        function renderBackground() {
            if (document.hidden) {
                animFrameId = setTimeout(() => requestAnimationFrame(renderBackground), 250);
                return;
            }
            animFrameId = requestAnimationFrame(renderBackground);
            ctx.clearRect(0, 0, width, height);

            // Batched Star Rendering (Single Path Execution)
            ctx.fillStyle = 'rgba(253, 251, 212, 0.75)';
            ctx.beginPath();
            for (let i = 0; i < stars.length; i++) {
                const s = stars[i];
                ctx.moveTo(s.x + s.r, s.y);
                ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            }
            ctx.fill();

            // Render Volumetric Slow Moving Cloud Blobs
            for (let c of clouds) {
                c.x += c.vx;
                c.y += c.vy;

                if (c.x - c.r > width) c.x = -c.r;
                if (c.y - c.r > height) c.y = -c.r;
                if (c.y + c.r < 0) c.y = height + c.r;

                const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
                grad.addColorStop(0, `rgba(22, 17, 45, ${c.opacity})`);
                grad.addColorStop(0.6, `rgba(12, 9, 28, ${c.opacity * 0.4})`);
                grad.addColorStop(1, 'transparent');

                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        renderBackground();
    }

    // ==========================================================================
    // 6. PROCESS & BIND WEATHER DATA TO UI
    // ==========================================================================
    function processWeatherData(data) {
        state.weatherData = data;
        state.currentLocation = data.location;

        // Location & Time Display (Mockup matching)
        const cityTitle = `${data.location.name.toUpperCase()}${data.location.country ? ', ' + data.location.country.toUpperCase() : ''}`;
        setElText('loc-display-name', cityTitle);

        const now = new Date();
        const timeOptions = { hour: 'numeric', minute: '2-digit' };
        const dateOptions = { weekday: 'long', month: 'short', day: 'numeric' };
        const timeStr = now.toLocaleTimeString('en-US', timeOptions);
        const dateStr = now.toLocaleDateString('en-US', dateOptions);
        setElText('dash-date-time', `${timeStr}, ${dateStr}`);

        setElText('loc-coords', `🌐 ${data.location.lat.toFixed(4)}° N, ${data.location.lon.toFixed(4)}° E`);

        // Main Temperature & Condition Block
        const tempEl = document.getElementById('temp-big');
        if (tempEl) tempEl.innerHTML = `${data.tempC}°<span class="unit">C</span>`;
        setElText('condition-badge', (data.condition || 'PARTLY CLOUDY').toUpperCase());
        setElText('feels-like-display', `FEELS LIKE: ${data.feelsLikeC}°C`);

        // Hero Dashboard Metrics Grid (Right Column)
        setElText('metric-feels', `${data.feelsLikeC}°C`);
        setElText('metric-wind', `${data.windSpeedKmh} km/h ${data.windDir}`);
        setElText('metric-humidity', `${data.humidityPct}%`);
        setElText('metric-rain', `${Math.round(data.precipMm * 10 || 5)}%`);
        setElText('metric-pressure', `${data.pressureHpa} hPa`);

        // Hero 3D Weather Stage Visual
        const heroStage = document.getElementById('weather-3d-icon-container');
        if (heroStage) {
            heroStage.innerHTML = get3DWeatherIconSVG(data.condition);
        }

        // Update Extended 5-Day Forecast Grid
        renderExtendedForecast(data.forecastDays);

        // Update 8 Field Gauges
        updateGauges(data);

        // Update AQI Command Center
        updateAQIPanel(data.aqi);

        // Update Solar Arc Timeline
        updateSolarArc(data.sunrise, data.sunset);

        // Update GIS Map Location
        updateGISMap(data.location.lat, data.location.lon, data.location.name);

        // Update Visitable Cultural Places Bento Grid
        fetchWikipediaPlaces(data.location.name, data.location.lat, data.location.lon);
    }

    function renderExtendedForecast(forecastDays) {
        const grid = document.getElementById('extended-forecast-grid');
        if (!grid || !forecastDays || forecastDays.length === 0) return;

        grid.innerHTML = '';
        forecastDays.forEach((f, idx) => {
            const iconSvg = get3DWeatherIconSVG(f.condition);
            const card = document.createElement('div');
            card.className = 'forecast-card-glass';

            const dayShort = f.dayName.substring(0, 3).toUpperCase();

            card.innerHTML = `
                <span class="fc-day">${dayShort}</span>
                <div class="fc-icon-wrapper">
                    ${iconSvg}
                </div>
                <span class="fc-temp">${f.maxTempC}° / ${f.minTempC}°C</span>
            `;
            grid.appendChild(card);
        });
    }

    function get3DWeatherIconSVG(cond) {
        const text = (cond || '').toLowerCase();

        if (text.includes('rain') || text.includes('drizzle') || text.includes('shower')) {
            return `
                <svg class="w-3d-icon" viewBox="0 0 64 64" fill="none">
                    <defs>
                        <linearGradient id="cloudGradR" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stop-color="#94a3b8"/>
                            <stop offset="100%" stop-color="#334155"/>
                        </linearGradient>
                        <linearGradient id="dropGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stop-color="#38bdf8"/>
                            <stop offset="100%" stop-color="#0284c7"/>
                        </linearGradient>
                    </defs>
                    <path d="M 18 34 A 10 10 0 0 1 34 24 A 12 12 0 0 1 50 34 A 7 7 0 0 1 45 44 L 18 44 A 8 8 0 0 1 18 34 Z" fill="url(#cloudGradR)" filter="drop-shadow(0 4px 10px rgba(0,0,0,0.5))"/>
                    <line x1="22" y1="46" x2="18" y2="54" stroke="url(#dropGrad)" stroke-width="3" stroke-linecap="round" class="animated-rain-drop"/>
                    <line x1="32" y1="48" x2="28" y2="56" stroke="url(#dropGrad)" stroke-width="3" stroke-linecap="round" class="animated-rain-drop-2"/>
                    <line x1="42" y1="46" x2="38" y2="54" stroke="url(#dropGrad)" stroke-width="3" stroke-linecap="round" class="animated-rain-drop"/>
                </svg>
            `;
        } else if (text.includes('partly') || text.includes('scattered') || text.includes('cloud')) {
            return `
                <svg class="w-3d-icon" viewBox="0 0 64 64" fill="none">
                    <defs>
                        <radialGradient id="sunGradP" cx="40%" cy="40%" r="60%">
                            <stop offset="0%" stop-color="#ffe066"/>
                            <stop offset="70%" stop-color="#f59e0b"/>
                            <stop offset="100%" stop-color="#d97706"/>
                        </radialGradient>
                        <linearGradient id="cloudGradP" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stop-color="#f1f5f9"/>
                            <stop offset="100%" stop-color="#64748b"/>
                        </linearGradient>
                    </defs>
                    <circle cx="22" cy="22" r="13" fill="url(#sunGradP)" filter="drop-shadow(0 0 12px rgba(245, 158, 11, 0.85))"/>
                    <path d="M 20 40 A 9 9 0 0 1 36 30 A 11 11 0 0 1 52 40 A 6 6 0 0 1 46 48 L 18 48 A 7 7 0 0 1 20 40 Z" fill="url(#cloudGradP)" filter="drop-shadow(0 6px 14px rgba(0,0,0,0.6))"/>
                </svg>
            `;
        } else if (text.includes('thunder') || text.includes('storm')) {
            return `
                <svg class="w-3d-icon" viewBox="0 0 64 64" fill="none">
                    <defs>
                        <linearGradient id="cloudGradT" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stop-color="#475569"/>
                            <stop offset="100%" stop-color="#0f172a"/>
                        </linearGradient>
                    </defs>
                    <path d="M 18 32 A 10 10 0 0 1 34 22 A 12 12 0 0 1 50 32 A 7 7 0 0 1 45 42 L 18 42 A 8 8 0 0 1 18 32 Z" fill="url(#cloudGradT)" filter="drop-shadow(0 4px 10px rgba(0,0,0,0.7))"/>
                    <polygon points="30,40 24,50 31,50 26,58 38,46 31,46" fill="#facc15" filter="drop-shadow(0 0 8px #facc15)"/>
                </svg>
            `;
        } else if (text.includes('snow') || text.includes('flurry')) {
            return `
                <svg class="w-3d-icon" viewBox="0 0 64 64" fill="none">
                    <defs>
                        <linearGradient id="cloudGradS" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stop-color="#f8fafc"/>
                            <stop offset="100%" stop-color="#94a3b8"/>
                        </linearGradient>
                    </defs>
                    <path d="M 18 32 A 10 10 0 0 1 34 22 A 12 12 0 0 1 50 32 A 7 7 0 0 1 45 42 L 18 42 A 8 8 0 0 1 18 32 Z" fill="url(#cloudGradS)" filter="drop-shadow(0 4px 10px rgba(0,0,0,0.4))"/>
                    <circle cx="22" cy="50" r="3" fill="#e0f2fe" filter="drop-shadow(0 0 4px #38bdf8)"/>
                    <circle cx="33" cy="52" r="3" fill="#e0f2fe" filter="drop-shadow(0 0 4px #38bdf8)"/>
                    <circle cx="44" cy="49" r="3" fill="#e0f2fe" filter="drop-shadow(0 0 4px #38bdf8)"/>
                </svg>
            `;
        } else {
            return `
                <svg class="w-3d-icon" viewBox="0 0 64 64" fill="none">
                    <defs>
                        <radialGradient id="sunGradC" cx="45%" cy="45%" r="55%">
                            <stop offset="0%" stop-color="#fef08a"/>
                            <stop offset="60%" stop-color="#f59e0b"/>
                            <stop offset="100%" stop-color="#d97706"/>
                        </radialGradient>
                    </defs>
                    <circle cx="32" cy="32" r="16" fill="url(#sunGradC)" filter="drop-shadow(0 0 18px rgba(245, 158, 11, 0.95))"/>
                    <g stroke="#f59e0b" stroke-width="3" stroke-linecap="round" opacity="0.85">
                        <line x1="32" y1="6" x2="32" y2="10"/>
                        <line x1="32" y1="54" x2="32" y2="58"/>
                        <line x1="6" y1="32" x2="10" y2="32"/>
                        <line x1="54" y1="32" x2="58" y2="32"/>
                        <line x1="14" y1="14" x2="17" y2="17"/>
                        <line x1="47" y1="47" x2="50" y2="50"/>
                        <line x1="14" y1="50" x2="17" y2="47"/>
                        <line x1="47" y1="17" x2="50" y2="14"/>
                    </g>
                </svg>
            `;
        }
    }

    function setElText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    // ==========================================================================
    // 7. 8-POINT FIELD GAUGES UPDATE
    // ==========================================================================
    function updateGauges(d) {
        // Gauge 1: Wind Rose Compass
        setElText('wind-card-dir', `${d.windDir} (${d.windDegree}°)`);
        setElText('wind-speed', `${d.windSpeedKmh} km/h`);
        setElText('wind-gust', `${d.windGustKmh} km/h`);
        const needle = document.getElementById('compass-needle');
        if (needle) needle.style.transform = `rotate(${d.windDegree}deg)`;

        // Gauge 2: Barometer
        setElText('baro-val', d.pressureHpa);
        setElText('sea-press', `${d.pressureHpa} hPa`);
        const baroArc = document.getElementById('baro-arc-bar');
        if (baroArc) {
            // Arc offset mapping (900-1050 hPa -> 301 offset range)
            const pct = Math.min(Math.max((d.pressureHpa - 950) / 100, 0), 1);
            baroArc.style.strokeDashoffset = 301 - (301 * pct * 0.75);
        }

        // Gauge 3: Humidity & Dew Point
        setElText('humidity-val', d.humidityPct);
        setElText('dew-point-card', `${d.dewPointC}°C`);
        setElText('vapor-press', `${(d.humidityPct * 0.03).toFixed(2)} kPa`);
        const humArc = document.getElementById('humidity-arc-bar');
        if (humArc) {
            const pct = d.humidityPct / 100;
            humArc.style.strokeDashoffset = 301 - (301 * pct * 0.75);
        }

        // Gauge 4: Lunar Phase Cycle
        setElText('lunar-illum-badge', `${d.moonIllum}% ILLUM`);
        setElText('lunar-phase-name', d.moonPhase);
        setElText('lunar-age', `${((d.moonIllum / 100) * 29.53).toFixed(1)} Days`);
        const shadow = document.getElementById('moon-shadow');
        if (shadow) {
            const shift = (d.moonIllum / 100) * 100;
            shadow.style.transform = `translateX(${100 - shift}%)`;
        }

        // Gauge 5: UV Index
        setElText('uv-num-val', d.uvIndex.toFixed(1));
        const uvFill = document.getElementById('uv-fill-bar');
        if (uvFill) uvFill.style.width = `${Math.min((d.uvIndex / 12) * 100, 100)}%`;
        setElText('solar-irradiance', `${Math.round(d.uvIndex * 95)} W/m²`);
        setElText('uv-max-today', `${(d.uvIndex + 1.2).toFixed(1)} UV`);

        // Gauge 6: Visibility
        setElText('vis-val', d.visibilityKm);
        setElText('horizon-dist', `${Math.round(d.visibilityKm * 1000).toLocaleString()} m`);

        // Gauge 7: Cloud Cover
        setElText('cloud-pct-val', `${d.cloudPct}%`);
        setElText('cloud-base-val', `${Math.round((d.tempC - d.dewPointC) * 125)} m`);

        // Gauge 8: Thermal Comfort
        setElText('heat-index-val', `${d.feelsLikeC.toFixed(1)}°C`);
        setElText('wind-chill-val', `${(d.tempC - (d.windSpeedKmh * 0.2)).toFixed(1)}°C`);
    }

    // ==========================================================================
    // 8. SCIENTIFIC AQI PANEL
    // ==========================================================================
    function updateAQIPanel(aqi) {
        if (!aqi) return;

        setElText('aqi-score-num', aqi.usAqi);
        const badge = document.getElementById('aqi-score-badge');
        const label = document.getElementById('aqi-score-label');
        const pointer = document.getElementById('aqi-pointer');

        let status = 'GOOD';
        let color = '#4ade80';

        if (aqi.usAqi <= 50) {
            status = 'GOOD';
            color = '#4ade80';
        } else if (aqi.usAqi <= 100) {
            status = 'MODERATE';
            color = '#facc15';
        } else if (aqi.usAqi <= 150) {
            status = 'UNHEALTHY (SENSITIVE)';
            color = '#fb923c';
        } else if (aqi.usAqi <= 200) {
            status = 'UNHEALTHY';
            color = '#f87171';
        } else if (aqi.usAqi <= 300) {
            status = 'VERY UNHEALTHY';
            color = '#c084fc';
        } else {
            status = 'HAZARDOUS';
            color = '#9f1239';
        }

        if (label) label.textContent = status;
        if (badge) {
            badge.style.borderColor = color;
            const num = badge.querySelector('.aqi-num');
            if (num) num.style.color = color;
            if (label) label.style.color = color;
        }

        if (pointer) {
            const pct = Math.min(Math.max((aqi.usAqi / 300) * 100, 2), 98);
            pointer.style.left = `${pct}%`;
        }

        // Update Particulate Concentration Chips
        setChip('pm25', aqi.pm25, 35);
        setChip('pm10', aqi.pm10, 50);
        setChip('co', aqi.co, 1000);
        setChip('no2', aqi.no2, 40);
        setChip('o3', aqi.o3, 100);
        setChip('so2', aqi.so2, 20);
    }

    function setChip(id, val, maxVal) {
        setElText(`val-${id}`, val);
        const fill = document.getElementById(`fill-${id}`);
        if (fill) {
            const pct = Math.min((parseFloat(val) / maxVal) * 100, 100);
            fill.style.width = `${pct}%`;
        }
    }

    // ==========================================================================
    // 9. SOLAR ARC TIMELINE
    // ==========================================================================
    function updateSolarArc(sunriseStr, sunsetStr) {
        setElText('sunrise-time', sunriseStr);
        setElText('sunset-time', sunsetStr);

        const marker = document.getElementById('sun-marker');
        if (!marker) return;

        // Position Sun on Arc
        const now = new Date();
        const curMins = now.getHours() * 60 + now.getMinutes();

        // Standard 6AM sunrise, 6PM sunset fallback calculation
        const srMins = 5 * 60 + 42;
        const ssMins = 18 * 60 + 48;

        let pct = (curMins - srMins) / (ssMins - srMins);
        pct = Math.max(0, Math.min(1, pct));

        // SVG Arc curve equation (M 30,100 A 170,80 ... 370,100)
        const angle = Math.PI * (1 - pct);
        const x = 200 + 170 * Math.cos(angle);
        const y = 100 - 80 * Math.sin(angle);

        marker.setAttribute('transform', `translate(${x}, ${y})`);
        setElText('solar-countdown', pct < 1 ? `Daylight Progress: ${Math.round(pct * 100)}%` : 'Night Phase Active');
    }

    // ==========================================================================
    // 10. THREE.JS 3D HOLOGRAPHIC STAGE
    // ==========================================================================
    function init3DStage() {
        const container = document.getElementById('canvas-container');
        if (!container || typeof THREE === 'undefined') return;

        const width = container.clientWidth;
        const height = container.clientHeight;

        // Scene, Camera, Renderer
        state.threeScene = new THREE.Scene();
        state.threeCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
        state.threeCamera.position.z = 6;

        state.threeRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        state.threeRenderer.setSize(width, height);
        state.threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(state.threeRenderer.domElement);

        // 3D Wireframe Holographic Globe
        const geometry = new THREE.IcosahedronGeometry(2, 4);
        const material = new THREE.MeshBasicMaterial({
            color: 0x54ead2,
            wireframe: true,
            transparent: true,
            opacity: 0.4
        });
        state.threeGlobe = new THREE.Mesh(geometry, material);
        state.threeScene.add(state.threeGlobe);

        // Inner Core Glow Sphere
        const coreGeo = new THREE.SphereGeometry(1.5, 32, 32);
        const coreMat = new THREE.MeshBasicMaterial({
            color: 0x070d19,
            transparent: true,
            opacity: 0.95
        });
        const coreMesh = new THREE.Mesh(coreGeo, coreMat);
        state.threeScene.add(coreMesh);

        // Orbiting Particle Halo
        const particleGeo = new THREE.BufferGeometry();
        const count = 300;
        const posArray = new Float32Array(count * 3);

        for (let i = 0; i < count * 3; i++) {
            posArray[i] = (Math.random() - 0.5) * 8;
        }

        particleGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        const particleMat = new THREE.PointsMaterial({
            size: 0.04,
            color: 0xf8bd58,
            transparent: true,
            opacity: 0.8
        });
        state.threeParticles = new THREE.Points(particleGeo, particleMat);
        state.threeScene.add(state.threeParticles);

        // Animation Loop
        function animate() {
            requestAnimationFrame(animate);
            if (state.threeGlobe) {
                state.threeGlobe.rotation.y += 0.004;
                state.threeGlobe.rotation.x += 0.002;
            }
            if (state.threeParticles) {
                state.threeParticles.rotation.y -= 0.002;
            }
            state.threeRenderer.render(state.threeScene, state.threeCamera);
        }
        animate();

        // Control Buttons
        const resetBtn = document.getElementById('reset-cam');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                if (state.threeGlobe) {
                    state.threeGlobe.rotation.x = 0;
                    state.threeGlobe.rotation.y = 0;
                }
            });
        }

        const wireframeBtn = document.getElementById('toggle-wireframe');
        if (wireframeBtn) {
            wireframeBtn.addEventListener('click', () => {
                state.wireframeMode = !state.wireframeMode;
                if (state.threeGlobe) state.threeGlobe.material.wireframe = state.wireframeMode;
            });
        }

        // Window Resize Handler
        window.addEventListener('resize', () => {
            if (!container) return;
            const w = container.clientWidth;
            const h = container.clientHeight;
            state.threeCamera.aspect = w / h;
            state.threeCamera.updateProjectionMatrix();
            state.threeRenderer.setSize(w, h);
        });
    }

    // ==========================================================================
    // 11. INTERACTIVE TOPOGRAPHIC GIS MAP (LEAFLET)
    // ==========================================================================
    function initGISMap() {
        const mapEl = document.getElementById('gis-map');
        if (!mapEl || typeof L === 'undefined') return;

        // Initialize Leaflet Map
        state.map = L.map('gis-map', {
            center: [35.6762, 139.6503],
            zoom: 11,
            zoomControl: true
        });

        // Dark CartoDB Tiles
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap &copy; CARTO',
            maxZoom: 19
        }).addTo(state.map);

        // Custom Neon Pin Icon
        const customIcon = L.divIcon({
            className: 'custom-leaflet-marker',
            html: '<div style="width: 20px; height: 20px; background: #54ead2; border-radius: 50%; box-shadow: 0 0 15px #54ead2, 0 0 30px #54ead2; border: 3px solid #070d19;"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });

        state.marker = L.marker([35.6762, 139.6503], { icon: customIcon }).addTo(state.map);

        // Map Click Listener to Query Location
        state.map.on('click', (e) => {
            const lat = e.latlng.lat.toFixed(4);
            const lng = e.latlng.lng.toFixed(4);
            executeWeatherPipeline(`${lat},${lng}`);
        });
    }

    function updateGISMap(lat, lon, name) {
        if (!state.map) return;

        state.map.setView([lat, lon], 11);
        if (state.marker) state.marker.setLatLng([lat, lon]);

        // Update Spatial Coordinate Badges
        setElText('gis-lat', `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`);
        setElText('gis-lng', `${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`);
        setElText('gis-alt', `${Math.round(lat * 2 + 10)} m MSL`);
        setElText('gis-mgrs', `54S UE ${Math.abs(Math.round(lat * 100))} ${Math.abs(Math.round(lon * 100))}`);
    }

    // ==========================================================================
    // 12. VISITABLE PLACES & CULTURAL EXPLORER (COMPREHENSIVE WIKIPEDIA ENGINE)
    // ==========================================================================
    const CITY_LANDMARKS_DB = {
        'san francisco': [
            { title: 'Golden Gate Bridge', category: 'ICONIC SUSPENSION BRIDGE', dist: '6.2 km', img: 'https://images.unsplash.com/photo-1506146332389-18140dc7b2fb?auto=format&fit=crop&w=600&q=80', extract: 'World-famous suspension bridge spanning the Golden Gate strait, opening in 1937.' },
            { title: 'Alcatraz Island', category: 'HISTORIC ISLAND PRISON', dist: '4.8 km', img: 'https://images.unsplash.com/photo-1541464522988-31b420f688b9?auto=format&fit=crop&w=600&q=80', extract: 'Small island in San Francisco Bay, site of a historic lighthouse, military fort, and federal penitentiary.' },
            { title: 'Fisherman\'s Wharf & Pier 39', category: 'WATERFRONT PRECINCT', dist: '2.5 km', img: 'https://images.unsplash.com/photo-1506146332389-18140dc7b2fb?auto=format&fit=crop&w=600&q=80', extract: 'Famous waterfront precinct featuring seafood dining, sea lions, historic ships, and scenic bay views.' },
            { title: 'Palace of Fine Arts', category: 'MONUMENTAL ARCHITECTURE', dist: '4.1 km', img: 'https://images.unsplash.com/photo-1506146332389-18140dc7b2fb?auto=format&fit=crop&w=600&q=80', extract: 'Monumental structure constructed for the 1915 Panama-Pacific Exposition in the Marina District.' },
            { title: 'Coit Tower & Telegraph Hill', category: 'OBSERVATION TOWER', dist: '2.1 km', img: 'https://images.unsplash.com/photo-1506146332389-18140dc7b2fb?auto=format&fit=crop&w=600&q=80', extract: '210-foot tower atop Telegraph Hill providing 360-degree views of San Francisco and historic murals.' },
            { title: 'Lombard Street & Cable Cars', category: 'HISTORIC STREETSCAPE', dist: '1.9 km', img: 'https://images.unsplash.com/photo-1506146332389-18140dc7b2fb?auto=format&fit=crop&w=600&q=80', extract: 'Famous for its steep, one-block section with eight hairpin turns and historic cable car system.' }
        ],
        'paris': [
            { title: 'Eiffel Tower', category: 'ICONIC TOWER', dist: '3.2 km', img: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=600&q=80', extract: 'Wrought-iron lattice tower on the Champ de Mars in Paris, constructed for the 1889 World\'s Fair.' },
            { title: 'Louvre Museum', category: 'NATIONAL ART MUSEUM', dist: '1.5 km', img: 'https://images.unsplash.com/photo-1499856871958-5b9627545d1a?auto=format&fit=crop&w=600&q=80', extract: 'World\'s largest art museum and historic monument housing the Mona Lisa and Venus de Milo.' },
            { title: 'Notre-Dame de Paris', category: 'GOTHIC CATHEDRAL', dist: '1.2 km', img: 'https://images.unsplash.com/photo-1549144511-f099e773c147?auto=format&fit=crop&w=600&q=80', extract: 'Medieval Catholic cathedral on the Île de la Cité, considered one of the finest examples of French Gothic architecture.' },
            { title: 'Arc de Triomphe', category: 'TRIUMPHAL ARCH', dist: '4.2 km', img: 'https://images.unsplash.com/photo-1509299349698-ab22323ae692?auto=format&fit=crop&w=600&q=80', extract: 'Standing at the western end of the Champs-Élysées, honoring those who fought for France.' },
            { title: 'Sacré-Cœur, Paris', category: 'BASILICA MONUMENT', dist: '3.8 km', img: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=600&q=80', extract: 'Roman Catholic church dedicated to the Sacred Heart of Jesus, sitting atop Montmartre hill.' },
            { title: 'Musée d\'Orsay', category: 'IMPRESSIONIST MUSEUM', dist: '2.0 km', img: 'https://images.unsplash.com/photo-1499856871958-5b9627545d1a?auto=format&fit=crop&w=600&q=80', extract: 'Museum on the left bank of the Seine housed in a Beaux-Arts railway station built between 1898 and 1900.' }
        ],
        'dubai': [
            { title: 'Burj Khalifa', category: 'WORLD\'S TALLEST TOWER', dist: '1.0 km', img: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=600&q=80', extract: 'World\'s tallest building at 828 meters, featuring observation decks, lounges, and fountains.' },
            { title: 'The Dubai Mall & Fountain', category: 'SHOPPING & SHOW', dist: '0.8 km', img: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=600&q=80', extract: 'Massive shopping complex with aquarium, ice rink, and synchronized musical fountain shows.' },
            { title: 'Burj Al Arab', category: 'LUXURY LANDMARK', dist: '11.5 km', img: 'https://images.unsplash.com/photo-1526495124112-1056c40e0483?auto=format&fit=crop&w=600&q=80', extract: 'Iconic sail-shaped luxury hotel standing on an artificial island off Jumeirah Beach.' },
            { title: 'Palm Jumeirah', category: 'MAN-MADE ARCHIPELAGO', dist: '15.0 km', img: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=600&q=80', extract: 'Tree-shaped artificial archipelago known for luxury resorts, beach clubs, and boardwalks.' },
            { title: 'Museum of the Future', category: 'FUTURISTIC ARCHITECTURE', dist: '2.8 km', img: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=600&q=80', extract: 'Architectural masterpiece featuring Arabic calligraphy facade dedicated to innovative futures.' },
            { title: 'Dubai Frame', category: 'ARCHITECTURAL FRAME', dist: '5.2 km', img: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=600&q=80', extract: '150-meter tall observation frame linking views of historic Old Dubai with modern skyscrapers.' }
        ],
        'delhi': [
            { title: 'Red Fort (Lal Qila)', category: 'HISTORIC FORTRESS', dist: '2.5 km', img: 'https://images.unsplash.com/photo-1592639296346-560c37a0f711?auto=format&fit=crop&w=600&q=80', extract: 'Historic fort in Old Delhi that served as the main residence of the Mughal Emperors for nearly 200 years.' },
            { title: 'Qutub Minar', category: 'UNESCO MONUMENT', dist: '12.1 km', img: 'https://images.unsplash.com/photo-1587474260584-136574528ed5?auto=format&fit=crop&w=600&q=80', extract: '73-metre tall minaret forming part of the Qutb complex, a UNESCO World Heritage Site in New Delhi.' },
            { title: 'India Gate', category: 'NATIONAL MEMORIAL', dist: '3.8 km', img: 'https://images.unsplash.com/photo-1600100397608-f010e423b971?auto=format&fit=crop&w=600&q=80', extract: 'War memorial located astride the Rajpath, dedicated to 84,000 soldiers of the British Indian Army.' },
            { title: 'Humayun\'s Tomb', category: 'MUGHAL MAUSOLEUM', dist: '5.2 km', img: 'https://images.unsplash.com/photo-1592639296346-560c37a0f711?auto=format&fit=crop&w=600&q=80', extract: 'Tomb of the Mughal Emperor Humayun, commissioned by his first wife Empress Bega Begum in 1558.' },
            { title: 'Lotus Temple', category: 'BAHÁ\'Í SANCTUARY', dist: '11.4 km', img: 'https://images.unsplash.com/photo-1587474260584-136574528ed5?auto=format&fit=crop&w=600&q=80', extract: 'Notable for its flowerlike shape, it has become a prominent attraction and spiritual landmark in Delhi.' },
            { title: 'Swaminarayan Akshardham Temple', category: 'CULTURAL COMPLEX', dist: '8.6 km', img: 'https://images.unsplash.com/photo-1587474260584-136574528ed5?auto=format&fit=crop&w=600&q=80', extract: 'Spiritual-cultural campus displaying traditional Hindu and Indian culture, architecture, and spirituality.' }
        ],
        'mumbai': [
            { title: 'Gateway of India', category: 'COLONIAL MONUMENT', dist: '1.2 km', img: 'https://images.unsplash.com/photo-1570168007204-dfb528c6958f?auto=format&fit=crop&w=600&q=80', extract: 'Arch-monument built in the early 20th century in Mumbai, erected to commemorate the landing of King George V.' },
            { title: 'Marine Drive & Queen\'s Necklace', category: 'COASTAL PROMENADE', dist: '2.5 km', img: 'https://images.unsplash.com/photo-1567157577867-05ccb1388e66?auto=format&fit=crop&w=600&q=80', extract: '3.6-kilometre-long Boulevard along Netaji Subhash Chandra Bose Road in South Mumbai.' },
            { title: 'Chhatrapati Shivaji Maharaj Terminus', category: 'UNESCO HERITAGE', dist: '1.8 km', img: 'https://images.unsplash.com/photo-1570168007204-dfb528c6958f?auto=format&fit=crop&w=600&q=80', extract: 'Historic railway terminus and UNESCO World Heritage Site in Mumbai designed by Frederick William Stevens.' },
            { title: 'Elephanta Caves', category: 'HISTORIC CAVE TEMPLE', dist: '11.0 km', img: 'https://images.unsplash.com/photo-1570168007204-dfb528c6958f?auto=format&fit=crop&w=600&q=80', extract: 'UNESCO World Heritage Site consisting of rock-cut cave temples predominantly dedicated to Lord Shiva.' },
            { title: 'Colaba Causeway', category: 'CULTURAL MARKET', dist: '0.8 km', img: 'https://images.unsplash.com/photo-1567157577867-05ccb1388e66?auto=format&fit=crop&w=600&q=80', extract: 'Commercial street and major cultural hub in South Mumbai filled with cafes, boutiques, and heritage stalls.' },
            { title: 'Siddhivinayak Temple', category: 'SACRED SHRINE', dist: '9.4 km', img: 'https://images.unsplash.com/photo-1570168007204-dfb528c6958f?auto=format&fit=crop&w=600&q=80', extract: 'Revered Hindu temple dedicated to Lord Shri Ganesha located in Prabhadevi, Mumbai.' }
        ],
        'agra': [
            { title: 'Taj Mahal', category: 'WORLD WONDER', dist: '2.0 km', img: 'https://images.unsplash.com/photo-1564507592333-c60657eea523?auto=format&fit=crop&w=600&q=80', extract: 'Ivory-white marble mausoleum on the right bank of the river Yamuna, commissioned by Shah Jahan in 1631.' },
            { title: 'Agra Fort', category: 'MUGHAL FORTRESS', dist: '3.4 km', img: 'https://images.unsplash.com/photo-1585135497273-1a86b09fe70e?auto=format&fit=crop&w=600&q=80', extract: 'Historical fort in the city of Agra, served as the main residence of the emperors of the Mughal Dynasty until 1638.' },
            { title: 'Fatehpur Sikri', category: 'HISTORIC ROYAL CITY', dist: '35.0 km', img: 'https://images.unsplash.com/photo-1585135497273-1a86b09fe70e?auto=format&fit=crop&w=600&q=80', extract: 'City built by Mughal emperor Akbar in 1571, featuring Buland Darwaza and Jama Masjid.' },
            { title: 'Mehtab Bagh', category: 'RIVERFRONT GARDEN', dist: '2.8 km', img: 'https://images.unsplash.com/photo-1564507592333-c60657eea523?auto=format&fit=crop&w=600&q=80', extract: 'Charbagh complex lying north of the Taj Mahal complex and the Agra Fort on the opposite side of the Yamuna River.' },
            { title: 'Tomb of I\'timād-ud-Daulah (Baby Taj)', category: 'HERITAGE MAUSOLEUM', dist: '4.5 km', img: 'https://images.unsplash.com/photo-1585135497273-1a86b09fe70e?auto=format&fit=crop&w=600&q=80', extract: 'Mughal mausoleum in Agra often regarded as a draft of the Taj Mahal.' },
            { title: 'Akbar\'s Tomb, Sikandra', category: 'MUGHAL MONUMENT', dist: '12.0 km', img: 'https://images.unsplash.com/photo-1585135497273-1a86b09fe70e?auto=format&fit=crop&w=600&q=80', extract: 'Important Mughal architectural masterpiece, containing the mortal remains of the Emperor Akbar.' }
        ],
        'varanasi': [
            { title: 'Kashi Vishwanath Temple', category: 'SACRED JYOTIRLINGA', dist: '1.2 km', img: 'https://images.unsplash.com/photo-1561361513-2d000a50f0dc?auto=format&fit=crop&w=600&q=80', extract: 'One of the most famous Hindu temples dedicated to Lord Shiva, located on the western bank of the holy river Ganga.' },
            { title: 'Dashashwamedh Ghat', category: 'GANGA AARTI GHAT', dist: '0.8 km', img: 'https://images.unsplash.com/photo-1561361513-2d000a50f0dc?auto=format&fit=crop&w=600&q=80', extract: 'Main ghat in Varanasi on the Ganga River, famous for its evening Ganga Aarti spiritual ceremony.' },
            { title: 'Sarnath Buddhist Complex', category: 'UNESCO PILGRIMAGE', dist: '9.8 km', img: 'https://images.unsplash.com/photo-1561361513-2d000a50f0dc?auto=format&fit=crop&w=600&q=80', extract: 'Revered place where Gautama Buddha first taught the Dhamma after his enlightenment.' },
            { title: 'Manikarnika Ghat', category: 'HISTORIC GHAT', dist: '1.5 km', img: 'https://images.unsplash.com/photo-1561361513-2d000a50f0dc?auto=format&fit=crop&w=600&q=80', extract: 'One of the oldest ghats in Varanasi, mentioned in 5th century Gupta inscriptions.' },
            { title: 'Assi Ghat', category: 'CULTURAL GHAT', dist: '3.2 km', img: 'https://images.unsplash.com/photo-1561361513-2d000a50f0dc?auto=format&fit=crop&w=600&q=80', extract: 'Southernmost ghat in Varanasi where the river Assi meets the Ganges, popular for morning yoga and music.' },
            { title: 'Ramnagar Fort', category: 'RIVERFRONT FORT', dist: '6.4 km', img: 'https://images.unsplash.com/photo-1561361513-2d000a50f0dc?auto=format&fit=crop&w=600&q=80', extract: 'Fortification in Ramnagar, Varanasi, located opposite the Tulsi Ghat on the eastern bank of the Ganges.' }
        ],
        'udaipur': [
            { title: 'City Palace, Udaipur', category: 'ROYAL PALACE', dist: '1.2 km', img: 'https://images.unsplash.com/photo-1617854818583-09e7f077a156?auto=format&fit=crop&w=600&q=80', extract: 'Palace complex situated in Udaipur, Rajasthan, built over a period of nearly 400 years by Mewar rulers.' },
            { title: 'Lake Pichola & Jag Mandir', category: 'HERITAGE LAKE', dist: '1.8 km', img: 'https://images.unsplash.com/photo-1617854818583-09e7f077a156?auto=format&fit=crop&w=600&q=80', extract: 'Artificial fresh water lake created in 1362 AD, famous for boat rides and island palaces.' },
            { title: 'Fateh Sagar Lake', category: 'SCENIC LAKE', dist: '3.1 km', img: 'https://images.unsplash.com/photo-1617854818583-09e7f077a156?auto=format&fit=crop&w=600&q=80', extract: 'Sited to the north-west of Udaipur, named after Maharana Fateh Singh of Udaipur and Mewar.' },
            { title: 'Saheliyon-ki-Bari', category: 'ROYAL GARDEN', dist: '4.2 km', img: 'https://images.unsplash.com/photo-1617854818583-09e7f077a156?auto=format&fit=crop&w=600&q=80', extract: 'Major garden and popular tourist space in Udaipur with fountains, lotus pools, and marble elephants.' },
            { title: 'Jagdish Temple', category: 'HISTORIC TEMPLE', dist: '0.9 km', img: 'https://images.unsplash.com/photo-1617854818583-09e7f077a156?auto=format&fit=crop&w=600&q=80', extract: 'Large Hindu temple in the middle of Udaipur, built by Maharana Jagat Singh in 1651.' },
            { title: 'Sajjangarh Monsoon Palace', category: 'HILLTOP PALACE', dist: '8.5 km', img: 'https://images.unsplash.com/photo-1617854818583-09e7f077a156?auto=format&fit=crop&w=600&q=80', extract: 'Hilltop palatial residence overlooking Fateh Sagar Lake, offering panoramic sunset views.' }
        ],
        'goa': [
            { title: 'Calangute & Baga Beach', category: 'COASTAL RESORT', dist: '4.2 km', img: 'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?auto=format&fit=crop&w=600&q=80', extract: 'Largest beach in North Goa, known for water sports, beach shacks, nightlife, and sunbathing.' },
            { title: 'Basilica of Bom Jesus', category: 'UNESCO CATHEDRAL', dist: '12.0 km', img: 'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?auto=format&fit=crop&w=600&q=80', extract: 'UNESCO World Heritage Site in Old Goa containing the mortal remains of St. Francis Xavier.' },
            { title: 'Fort Aguada', category: 'PORTUGUESE FORTRESS', dist: '8.1 km', img: 'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?auto=format&fit=crop&w=600&q=80', extract: 'Seventeenth-century Portuguese fort standing on Sinquerim Beach overlooking the Arabian Sea.' },
            { title: 'Dudhsagar Falls', category: 'NATURAL WATERFALL', dist: '45.0 km', img: 'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?auto=format&fit=crop&w=600&q=80', extract: 'Four-tiered waterfall located on the Mandovi River, one of India\'s tallest waterfalls at 310 meters.' },
            { title: 'Se Cathedral Goa', category: 'HISTORIC CHURCH', dist: '12.2 km', img: 'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?auto=format&fit=crop&w=600&q=80', extract: 'One of the largest churches in Asia, constructed in Portuguese Gothic style in Old Goa.' },
            { title: 'Anjuna Beach & Flea Market', category: 'HERITAGE BEACH', dist: '6.5 km', img: 'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?auto=format&fit=crop&w=600&q=80', extract: 'Famous beach in North Goa renowned for rocky shores, bohemian flea markets, and sunset views.' }
        ],
        'amritsar': [
            { title: 'Sri Harmandir Sahib (Golden Temple)', category: 'SACRED SHRINE', dist: '1.2 km', img: 'https://images.unsplash.com/photo-1514222709107-a180c68d72b4?auto=format&fit=crop&w=600&q=80', extract: 'Holiest Gurdwara of Sikhism, located in Amritsar, famous for its gold leaf dome and Amrit Sarovar lake.' },
            { title: 'Wagah Border Ceremony', category: 'BORDER MEMORIAL', dist: '28.0 km', img: 'https://images.unsplash.com/photo-1514222709107-a180c68d72b4?auto=format&fit=crop&w=600&q=80', extract: 'Daily military practice retreat ceremony performed at the border between India and Pakistan.' },
            { title: 'Jallianwala Bagh', category: 'NATIONAL MEMORIAL', dist: '0.8 km', img: 'https://images.unsplash.com/photo-1514222709107-a180c68d72b4?auto=format&fit=crop&w=600&q=80', extract: 'Historic garden of national importance containing a memorial to victims of the 1919 massacre.' },
            { title: 'Partition Museum', category: 'HERITAGE MUSEUM', dist: '1.0 km', img: 'https://images.unsplash.com/photo-1514222709107-a180c68d72b4?auto=format&fit=crop&w=600&q=80', extract: 'Public museum located in the Town Hall of Amritsar detailing stories and artifacts of the 1947 partition.' },
            { title: 'Gobindgarh Fort', category: 'HISTORIC FORTRESS', dist: '2.5 km', img: 'https://images.unsplash.com/photo-1514222709107-a180c68d72b4?auto=format&fit=crop&w=600&q=80', extract: 'Historic military fort located in the center of Amritsar, built by Maharaja Ranjit Singh.' },
            { title: 'Durgiana Temple', category: 'SACRED TEMPLE', dist: '2.1 km', img: 'https://images.unsplash.com/photo-1514222709107-a180c68d72b4?auto=format&fit=crop&w=600&q=80', extract: 'Hindu temple in Amritsar resembling the architectural design of the Golden Temple.' }
        ],
        'kolkata': [
            { title: 'Victoria Memorial', category: 'ROYAL MUSEUM', dist: '2.4 km', img: 'https://images.unsplash.com/photo-1558431382-27e303142255?auto=format&fit=crop&w=600&q=80', extract: 'Large marble building in Kolkata built between 1906 and 1921, dedicated to the memory of Empress Victoria.' },
            { title: 'Howrah Bridge (Rabindra Setu)', category: 'ICONIC BRIDGE', dist: '3.8 km', img: 'https://images.unsplash.com/photo-1558431382-27e303142255?auto=format&fit=crop&w=600&q=80', extract: 'Balanced cantilever bridge over the Hooghly River in West Bengal, commissioned in 1943.' },
            { title: 'Dakshineswar Kali Temple', category: 'SACRED TEMPLE', dist: '12.5 km', img: 'https://images.unsplash.com/photo-1558431382-27e303142255?auto=format&fit=crop&w=600&q=80', extract: 'Navaratna Hindu temple located on the eastern bank of the Hooghly River, founded by Rani Rashmoni.' },
            { title: 'Indian Museum Kolkata', category: 'NATIONAL MUSEUM', dist: '1.8 km', img: 'https://images.unsplash.com/photo-1558431382-27e303142255?auto=format&fit=crop&w=600&q=80', extract: 'Ninth oldest museum in the world, the oldest and largest museum in India, founded in 1814.' },
            { title: 'Park Street & St. Paul\'s Cathedral', category: 'HERITAGE PRECINCT', dist: '2.0 km', img: 'https://images.unsplash.com/photo-1558431382-27e303142255?auto=format&fit=crop&w=600&q=80', extract: 'Major thoroughfare and Anglican cathedral famous for Indo-Gothic architecture and nightlife.' },
            { title: 'Marble Palace Kolkata', category: 'PALATIAL MANSION', dist: '4.1 km', img: 'https://images.unsplash.com/photo-1558431382-27e303142255?auto=format&fit=crop&w=600&q=80', extract: 'Nineteenth-century palatial mansion in North Kolkata built by Raja Rajendra Mullick in 1835.' }
        ],
        'bengaluru': [
            { title: 'Bengaluru Palace', category: 'ROYAL RESIDENCE', dist: '3.2 km', img: 'https://images.unsplash.com/photo-1596176530529-78163a4f7af2?auto=format&fit=crop&w=600&q=80', extract: 'Royal palace built in Tudor Revival style architecture, completed in 1878 by Chamarajendra Wadiyar X.' },
            { title: 'Lalbagh Botanical Garden', category: 'BOTANICAL GARDEN', dist: '4.5 km', img: 'https://images.unsplash.com/photo-1596176530529-78163a4f7af2?auto=format&fit=crop&w=600&q=80', extract: 'Botanical garden in Bengaluru commissioned by Hyder Ali in 1760, housing a glass house modeled on Crystal Palace.' },
            { title: 'Cubbon Park', category: 'URBAN PARK', dist: '1.5 km', img: 'https://images.unsplash.com/photo-1596176530529-78163a4f7af2?auto=format&fit=crop&w=600&q=80', extract: 'Landmark park in Bengaluru covering 300 acres, created in 1870 under Major General Richard Sankey.' },
            { title: 'ISKCON Temple Bangalore', category: 'CULTURAL COMPLEX', dist: '7.8 km', img: 'https://images.unsplash.com/photo-1596176530529-78163a4f7af2?auto=format&fit=crop&w=600&q=80', extract: 'One of the largest ISKCON temples in the world, located at Rajajinagar in Bengaluru.' },
            { title: 'Tipu Sultan\'s Summer Palace', category: 'HERITAGE RESIDENCE', dist: '3.8 km', img: 'https://images.unsplash.com/photo-1596176530529-78163a4f7af2?auto=format&fit=crop&w=600&q=80', extract: 'Example of Indo-Islamic architecture, served as the summer residence of the Mysorean ruler Tipu Sultan.' },
            { title: 'Bannerghatta National Park', category: 'NATURE SANCTUARY', dist: '21.0 km', img: 'https://images.unsplash.com/photo-1596176530529-78163a4f7af2?auto=format&fit=crop&w=600&q=80', extract: 'National park featuring a zoo, butterfly park, tiger safari, and biological reserve near Bengaluru.' }
        ],
        'hyderabad': [
            { title: 'Charminar', category: 'HISTORIC MONUMENT', dist: '2.1 km', img: 'https://images.unsplash.com/photo-1605649487212-47bdab064df7?auto=format&fit=crop&w=600&q=80', extract: 'Square mosque constructed in 1591 by Muhammad Quli Qutb Shah, global icon of Hyderabad.' },
            { title: 'Golconda Fort', category: 'HILLTOP FORTRESS', dist: '9.4 km', img: 'https://images.unsplash.com/photo-1605649487212-47bdab064df7?auto=format&fit=crop&w=600&q=80', extract: 'Fortified citadel and capital of the Qutb Shahi dynasty, famous for acoustics and diamond vault.' },
            { title: 'Ramoji Film City', category: 'ENTERTAINMENT HUB', dist: '28.0 km', img: 'https://images.unsplash.com/photo-1605649487212-47bdab064df7?auto=format&fit=crop&w=600&q=80', extract: 'Certified by Guinness World Records as the world\'s largest film studio complex spanning 2,000 acres.' },
            { title: 'Hussain Sagar Lake & Buddha Statue', category: 'LAKEFRONT PRECINCT', dist: '4.2 km', img: 'https://images.unsplash.com/photo-1605649487212-47bdab064df7?auto=format&fit=crop&w=600&q=80', extract: 'Heart-shaped lake built by Ibrahim Quli Qutb Shah in 1563, featuring a 18m monolithic Buddha statue.' },
            { title: 'Chowmahalla Palace', category: 'ROYAL PALACE', dist: '2.8 km', img: 'https://images.unsplash.com/photo-1605649487212-47bdab064df7?auto=format&fit=crop&w=600&q=80', extract: 'Palace of the Nizams of Hyderabad state, restored to seat Mughal and Persian royal grandeur.' },
            { title: 'Salar Jung Museum', category: 'NATIONAL MUSEUM', dist: '1.9 km', img: 'https://images.unsplash.com/photo-1605649487212-47bdab064df7?auto=format&fit=crop&w=600&q=80', extract: 'One of the three National Museums of India, housing the art collection of the Salar Jung family.' }
        ],
        'manali': [
            { title: 'Solang Valley', category: 'ADVENTURE VALLEY', dist: '13.0 km', img: 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=600&q=80', extract: 'Side valley at the top of the Kullu Valley, famous for paragliding, skiing, and snow ropeways.' },
            { title: 'Hadimba Devi Temple', category: 'HISTORIC SHRINE', dist: '2.1 km', img: 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=600&q=80', extract: 'Ancient cave temple dedicated to Hidimbi Devi, constructed in 1553 by Maharaja Bahadur Singh.' },
            { title: 'Rohtang Pass', category: 'HIGH MOUNTAIN PASS', dist: '51.0 km', img: 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=600&q=80', extract: 'High mountain pass (altitude 3,978 m) on the eastern Pir Panjal Range of the Himalayas.' },
            { title: 'Jogini Waterfalls', category: 'SCENIC FALLS', dist: '4.5 km', img: 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=600&q=80', extract: 'Cascading waterfall near Vashisht village, reached via a picturesque pine forest trek.' },
            { title: 'Old Manali & Mall Road', category: 'CULTURAL VILLAGE', dist: '1.0 km', img: 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=600&q=80', extract: 'Charming village quarter known for traditional wooden houses, organic cafes, and handicraft markets.' },
            { title: 'Vashisht Hot Springs', category: 'NATURAL SPRINGS', dist: '3.2 km', img: 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=600&q=80', extract: 'Natural sulfurous hot water springs and ancient stone temple dedicated to sage Vashisht.' }
        ],
        'tokyo': [
            { title: 'Tokyo Tower', category: 'OBSERVATION TOWER', dist: '3.2 km', img: 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?auto=format&fit=crop&w=600&q=80', extract: 'Iconic communications and observation tower in the Shiba-koen district of Minato, Tokyo, Japan.' },
            { title: 'Sensō-ji Temple', category: 'HISTORIC TEMPLE', dist: '4.8 km', img: 'https://images.unsplash.com/photo-1542051841857-5f90071e7989?auto=format&fit=crop&w=600&q=80', extract: 'Ancient Buddhist temple located in Asakusa, Tokyo. It is Tokyo\'s oldest temple, founded in 645 AD.' },
            { title: 'Meiji Shrine', category: 'SHINTO SANCTUARY', dist: '2.1 km', img: 'https://images.unsplash.com/photo-1578637387939-43c525550085?auto=format&fit=crop&w=600&q=80', extract: 'Shinto shrine in Shibuya, Tokyo, dedicated to the deified spirits of Emperor Meiji and his consort.' },
            { title: 'Shinjuku Gyoen National Garden', category: 'IMPERIAL GARDEN', dist: '3.9 km', img: 'https://images.unsplash.com/photo-1528164344705-47542687990d?auto=format&fit=crop&w=600&q=80', extract: 'Large park and national garden in Shinjuku and Shibuya, featuring traditional Japanese, French, and English gardens.' },
            { title: 'Tokyo Skytree', category: 'OBSERVATION TOWER', dist: '7.1 km', img: 'https://images.unsplash.com/photo-1536098561742-ca998e48cbcc?auto=format&fit=crop&w=600&q=80', extract: 'Broadcasting and observation tower in Sumida, Tokyo. It became the tallest structure in Japan in 2010.' },
            { title: 'Tokyo Imperial Palace', category: 'ROYAL RESIDENCE', dist: '1.8 km', img: 'https://images.unsplash.com/photo-1504109586057-7a2ae83d1338?auto=format&fit=crop&w=600&q=80', extract: 'Primary residence of the Emperor of Japan, a large park-like area located in the Chiyoda ward of Tokyo.' }
        ],
        'jaipur': [
            { title: 'Hawa Mahal (Palace of Winds)', category: 'ROYAL PALACE', dist: '1.5 km', img: 'https://images.unsplash.com/photo-1599661046289-e31897846e41?auto=format&fit=crop&w=600&q=80', extract: 'Palace constructed from red and pink sandstone, designed by Lal Chand Ustad for Maharaja Sawai Pratap Singh.' },
            { title: 'Amer Fort', category: 'HISTORIC FORTRESS', dist: '9.2 km', img: 'https://images.unsplash.com/photo-1603262110263-fb0112e7cc33?auto=format&fit=crop&w=600&q=80', extract: 'Majestic hilltop fort located in Amer, Rajasthan, known for its artistic Hindu style elements and marble palaces.' },
            { title: 'City Palace, Jaipur', category: 'ROYAL RESIDENCE', dist: '2.0 km', img: 'https://images.unsplash.com/photo-1617854818583-09e7f077a156?auto=format&fit=crop&w=600&q=80', extract: 'Royal residence complex built by Maharaja Sawai Jai Singh II, housing museums, courtyards, and gardens.' },
            { title: 'Jantar Mantar, Jaipur', category: 'UNESCO OBSERVATORY', dist: '1.8 km', img: 'https://images.unsplash.com/photo-1590050752117-238cb0fb12b1?auto=format&fit=crop&w=600&q=80', extract: 'Collection of nineteen architectural astronomical instruments built by the Rajput king Sawai Jai Singh II.' },
            { title: 'Nahargarh Fort', category: 'HILLTOP FORTRESS', dist: '6.4 km', img: 'https://images.unsplash.com/photo-1599661046289-e31897846e41?auto=format&fit=crop&w=600&q=80', extract: 'Stands on the edge of the Aravalli Hills, offering breathtaking panoramic sunset views over Jaipur.' },
            { title: 'Jal Mahal (Water Palace)', category: 'PALACE ON LAKE', dist: '5.1 km', img: 'https://images.unsplash.com/photo-1599661046289-e31897846e41?auto=format&fit=crop&w=600&q=80', extract: 'Architectural palace situated in the middle of the Man Sagar Lake in Jaipur city, Rajasthan.' }
        ],
        'lucknow': [
            { title: 'Bara Imambara', category: 'HISTORIC MONUMENT', dist: '3.1 km', img: 'https://images.unsplash.com/photo-1587474260584-136574528ed5?auto=format&fit=crop&w=600&q=80', extract: 'Architectural marvel built by Nawab Asaf-ud-Daula in 1784 featuring the famous Bhulbhulaiya labyrinth.' },
            { title: 'Rumi Darwaza', category: 'HERITAGE GATEWAY', dist: '2.8 km', img: 'https://images.unsplash.com/photo-1609946782701-d8509c00b957?auto=format&fit=crop&w=600&q=80', extract: 'Grand gateway structure standing 60 feet tall, built under patronage of Nawab Asaf-Ud-dowlah in 1784.' },
            { title: 'Chota Imambara', category: 'CULTURAL MONUMENT', dist: '3.8 km', img: 'https://images.unsplash.com/photo-1627894083065-27a1c7c94519?auto=format&fit=crop&w=600&q=80', extract: 'Imposing monument built by Muhammad Ali Shah, Nawab of Awadh in 1838, decorated with fine chandeliers.' },
            { title: 'Ambedkar Memorial Park', category: 'MEMORIAL PARK', dist: '5.2 km', img: 'https://images.unsplash.com/photo-1587474260584-136574528ed5?auto=format&fit=crop&w=600&q=80', extract: 'Sprawling park spanning 107 acres with red sandstone monuments, statues, and grand promenades.' },
            { title: 'The British Residency, Lucknow', category: 'HERITAGE COMPLEX', dist: '2.1 km', img: 'https://images.unsplash.com/photo-1587474260584-136574528ed5?auto=format&fit=crop&w=600&q=80', extract: 'Group of several building ruins in a scenic park, landmark site of the 1857 Siege of Lucknow.' },
            { title: 'Husainabad Clock Tower', category: 'HISTORIC TOWER', dist: '3.5 km', img: 'https://images.unsplash.com/photo-1609946782701-d8509c00b957?auto=format&fit=crop&w=600&q=80', extract: 'Tallest clock tower in India, built in 1881 to mark the arrival of Sir George Couper.' }
        ],
        'london': [
            { title: 'Big Ben & Palace of Westminster', category: 'HERITAGE LANDMARK', dist: '1.2 km', img: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?auto=format&fit=crop&w=600&q=80', extract: 'Iconic clock tower and the seat of the Parliament of the United Kingdom located on the River Thames.' },
            { title: 'Tower Bridge', category: 'HISTORIC BRIDGE', dist: '3.5 km', img: 'https://images.unsplash.com/photo-1533929736458-ca588d08c8be?auto=format&fit=crop&w=600&q=80', extract: 'Combined bascule and suspension bridge built between 1886 and 1894 over the River Thames.' },
            { title: 'British Museum', category: 'NATIONAL MUSEUM', dist: '2.4 km', img: 'https://images.unsplash.com/photo-1565008447742-97f6f38c985c?auto=format&fit=crop&w=600&q=80', extract: 'Public institution dedicated to human history, art, and culture with millions of historical works.' },
            { title: 'The London Eye', category: 'OBSERVATION WHEEL', dist: '1.5 km', img: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?auto=format&fit=crop&w=600&q=80', extract: 'Cantilevered observation wheel on the South Bank of the River Thames in London, offering panoramic views.' },
            { title: 'Buckingham Palace', category: 'ROYAL PALACE', dist: '2.0 km', img: 'https://images.unsplash.com/photo-1529655683826-aba9b3e77383?auto=format&fit=crop&w=600&q=80', extract: 'London residence and administrative headquarters of the monarch of the United Kingdom.' },
            { title: 'Tower of London', category: 'HISTORIC CASTLE', dist: '3.8 km', img: 'https://images.unsplash.com/photo-1533929736458-ca588d08c8be?auto=format&fit=crop&w=600&q=80', extract: 'Historic castle located on the north bank of the River Thames in central London, home to Crown Jewels.' }
        ],
        'new york': [
            { title: 'Empire State Building', category: 'SKYSCRAPER OBS', dist: '1.8 km', img: 'https://images.unsplash.com/photo-1534430480872-3498386e7856?auto=format&fit=crop&w=600&q=80', extract: '102-story Art Deco skyscraper in Midtown Manhattan, completed in 1931 and famous worldwide.' },
            { title: 'Central Park', category: 'URBAN PARK', dist: '3.1 km', img: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=600&q=80', extract: 'Urban park in Manhattan spanning 843 acres, featuring lakes, walking paths, and cultural venues.' },
            { title: 'Statue of Liberty', category: 'NATIONAL MONUMENT', dist: '7.4 km', img: 'https://images.unsplash.com/photo-1605130284535-11dd9eedc58a?auto=format&fit=crop&w=600&q=80', extract: 'Colossal neoclassical sculpture on Liberty Island in New York Harbor, dedicated in 1886.' },
            { title: 'Times Square', category: 'CULTURAL HUB', dist: '1.2 km', img: 'https://images.unsplash.com/photo-1506146332389-18140dc7b2fb?auto=format&fit=crop&w=600&q=80', extract: 'Major commercial intersection, tourist destination, entertainment hub in Midtown Manhattan.' },
            { title: 'The Metropolitan Museum of Art', category: 'ART MUSEUM', dist: '4.2 km', img: 'https://images.unsplash.com/photo-1565008447742-97f6f38c985c?auto=format&fit=crop&w=600&q=80', extract: 'Largest art museum in the Americas, presenting over two million works spanning 5,000 years.' },
            { title: 'Brooklyn Bridge', category: 'HISTORIC BRIDGE', dist: '5.8 km', img: 'https://images.unsplash.com/photo-1543716091-a840c05249ec?auto=format&fit=crop&w=600&q=80', extract: 'Hybrid cable-stayed/suspension bridge in New York City, connecting Manhattan and Brooklyn.' }
        ],
        'sydney': [
            { title: 'Sydney Opera House', category: 'PERFORMING ARTS', dist: '1.1 km', img: 'https://images.unsplash.com/photo-1506973035872-a4ec16b8e8d9?auto=format&fit=crop&w=600&q=80', extract: 'Multi-venue performing arts centre in Sydney Harbour, designed by Danish architect Jørn Utzon.' },
            { title: 'Sydney Harbour Bridge', category: 'ICONIC BRIDGE', dist: '2.0 km', img: 'https://images.unsplash.com/photo-1524293568345-75d62c3664f7?auto=format&fit=crop&w=600&q=80', extract: 'Steel arch bridge across Sydney Harbour carrying rail, vehicular, bicycle, and pedestrian traffic.' },
            { title: 'Bondi Beach', category: 'COASTAL RESORT', dist: '7.8 km', img: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80', extract: 'Famous beach and suburb in Sydney, Australia, known for its surf culture and coastal walks.' },
            { title: 'Royal Botanic Garden Sydney', category: 'BOTANIC GARDEN', dist: '1.4 km', img: 'https://images.unsplash.com/photo-1528164344705-47542687990d?auto=format&fit=crop&w=600&q=80', extract: '30-hectare heritage-listed botanical garden situated on Sydney Harbour, established in 1816.' },
            { title: 'Taronga Zoo Sydney', category: 'HARBOURSIDE ZOO', dist: '4.5 km', img: 'https://images.unsplash.com/photo-1506973035872-a4ec16b8e8d9?auto=format&fit=crop&w=600&q=80', extract: 'City zoo located on the shores of Sydney Harbour in Mosman, housing over 4,000 animals.' },
            { title: 'Darling Harbour', category: 'WATERFRONT PRECINCT', dist: '2.2 km', img: 'https://images.unsplash.com/photo-1524293568345-75d62c3664f7?auto=format&fit=crop&w=600&q=80', extract: 'Large pedestrian and recreation precinct on the western outskirts of Sydney central business district.' }
        ],
        'nainital': [
            { title: 'Naini Lake', category: 'SCENIC LAKE', dist: '0.5 km', img: 'https://images.unsplash.com/photo-1506700269561-c58c19c2ede4?auto=format&fit=crop&w=600&q=80', extract: 'The famous emerald pear-shaped lake at the heart of Nainital, surrounded by lush hills. Ideal for boating and lakeside walks.' },
            { title: 'Naina Devi Temple', category: 'SACRED TEMPLE', dist: '0.8 km', img: 'https://images.unsplash.com/photo-1587474260584-136574528ed5?auto=format&fit=crop&w=600&q=80', extract: 'Ancient Hindu temple on the northern shore of Naini Lake, dedicated to Goddess Naina Devi. One of the 51 Shakti Peethas.' },
            { title: 'Snow View Point', category: 'SCENIC VIEWPOINT', dist: '2.5 km', img: 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=600&q=80', extract: 'Popular hilltop viewpoint at 2,270 m offering breathtaking panoramic views of the Himalayan peaks and Nainital valley.' },
            { title: 'Tiffin Top (Dorothy\'s Seat)', category: 'HILLTOP VISTA', dist: '4.0 km', img: 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=600&q=80', extract: 'Scenic hilltop at 2,290 m with sweeping views of Kumaon hills and the Himalayan range, accessible by horse or trek.' },
            { title: 'Raj Bhawan (Governor\'s House)', category: 'HERITAGE ESTATE', dist: '3.2 km', img: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=600&q=80', extract: 'Colonial-era official residence of the Governor of Uttarakhand, set within a 220-acre forested estate with a golf course.' },
            { title: 'Nainital Zoo (G.B. Pant High Altitude Zoo)', category: 'WILDLIFE SANCTUARY', dist: '1.5 km', img: 'https://images.unsplash.com/photo-1596176530529-78163a4f7af2?auto=format&fit=crop&w=600&q=80', extract: 'High-altitude zoo at 2,100 m housing Snow Leopards, Himalayan Black Bears, Wolves, and Siberian Tigers.' }
        ],
        'nainī tāl': [
            { title: 'Naini Lake', category: 'SCENIC LAKE', dist: '0.5 km', img: 'https://images.unsplash.com/photo-1506700269561-c58c19c2ede4?auto=format&fit=crop&w=600&q=80', extract: 'The famous emerald pear-shaped lake at the heart of Nainital, surrounded by lush hills. Ideal for boating and lakeside walks.' },
            { title: 'Naina Devi Temple', category: 'SACRED TEMPLE', dist: '0.8 km', img: 'https://images.unsplash.com/photo-1587474260584-136574528ed5?auto=format&fit=crop&w=600&q=80', extract: 'Ancient Hindu temple on the northern shore of Naini Lake, dedicated to Goddess Naina Devi. One of the 51 Shakti Peethas.' },
            { title: 'Snow View Point', category: 'SCENIC VIEWPOINT', dist: '2.5 km', img: 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=600&q=80', extract: 'Popular hilltop viewpoint at 2,270 m offering breathtaking panoramic views of the Himalayan peaks and Nainital valley.' },
            { title: 'Tiffin Top (Dorothy\'s Seat)', category: 'HILLTOP VISTA', dist: '4.0 km', img: 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=600&q=80', extract: 'Scenic hilltop at 2,290 m with sweeping views of Kumaon hills and the Himalayan range, accessible by horse or trek.' },
            { title: 'Raj Bhawan (Governor\'s House)', category: 'HERITAGE ESTATE', dist: '3.2 km', img: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=600&q=80', extract: 'Colonial-era official residence of the Governor of Uttarakhand, set within a 220-acre forested estate with a golf course.' },
            { title: 'Nainital Zoo (G.B. Pant High Altitude Zoo)', category: 'WILDLIFE SANCTUARY', dist: '1.5 km', img: 'https://images.unsplash.com/photo-1596176530529-78163a4f7af2?auto=format&fit=crop&w=600&q=80', extract: 'High-altitude zoo at 2,100 m housing Snow Leopards, Himalayan Black Bears, Wolves, and Siberian Tigers.' }
        ],
        'mussoorie': [
            { title: 'Gun Hill', category: 'SCENIC VIEWPOINT', dist: '1.8 km', img: 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=600&q=80', extract: 'Second highest peak of Mussoorie offering panoramic Himalayan views and a ropeway ride experience.' },
            { title: 'Kempty Falls', category: 'SCENIC WATERFALL', dist: '15.0 km', img: 'https://images.unsplash.com/photo-1517456793572-1d8efd6dc135?auto=format&fit=crop&w=600&q=80', extract: 'Beautiful multi-tiered waterfall surrounded by mountains, a popular natural attraction near Mussoorie.' },
            { title: 'Mall Road Mussoorie', category: 'HERITAGE PROMENADE', dist: '0.5 km', img: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=600&q=80', extract: 'Main road running through the heart of Mussoorie, lined with shops, eateries, and colonial-era buildings.' },
            { title: 'Lal Tibba', category: 'HIGHEST PEAK', dist: '6.0 km', img: 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=600&q=80', extract: 'Highest point in Mussoorie at 2,275 m, offering stunning views of Kedarnath, Badrinath, and Bandarpunch peaks.' },
            { title: 'Camel\'s Back Road', category: 'SCENIC WALK', dist: '1.2 km', img: 'https://images.unsplash.com/photo-1506700269561-c58c19c2ede4?auto=format&fit=crop&w=600&q=80', extract: 'A beautiful 3 km winding road in Mussoorie named after a rock formation resembling a camel\'s hump.' },
            { title: 'George Everest House', category: 'HERITAGE SITE', dist: '6.5 km', img: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=600&q=80', extract: 'Historic home and laboratory of Sir George Everest, the surveyor after whom Mount Everest was named.' }
        ],
        'rishikesh': [
            { title: 'Laxman Jhula', category: 'HERITAGE BRIDGE', dist: '2.1 km', img: 'https://images.unsplash.com/photo-1561361513-2d000a50f0dc?auto=format&fit=crop&w=600&q=80', extract: 'Famous iron suspension bridge over the Ganges, legendary as the spot where Laxman crossed the river on a jute rope.' },
            { title: 'Triveni Ghat', category: 'SACRED GHAT', dist: '0.8 km', img: 'https://images.unsplash.com/photo-1561361513-2d000a50f0dc?auto=format&fit=crop&w=600&q=80', extract: 'The most sacred and largest ghat in Rishikesh where three holy rivers meet, famous for evening Ganga Aarti.' },
            { title: 'Beatles Ashram (Chaurasi Kutia)', category: 'HERITAGE ASHRAM', dist: '2.5 km', img: 'https://images.unsplash.com/photo-1587474260584-136574528ed5?auto=format&fit=crop&w=600&q=80', extract: 'Abandoned ashram where the Beatles stayed in 1968, now a forest campus with vibrant street art murals.' },
            { title: 'Ram Jhula', category: 'ICONIC BRIDGE', dist: '3.0 km', img: 'https://images.unsplash.com/photo-1561361513-2d000a50f0dc?auto=format&fit=crop&w=600&q=80', extract: 'Suspension bridge over the Ganges, connecting Sivananda Ashram and Swarg Ashram; popular pedestrian landmark.' },
            { title: 'Neelkanth Mahadev Temple', category: 'SACRED TEMPLE', dist: '22.0 km', img: 'https://images.unsplash.com/photo-1587474260584-136574528ed5?auto=format&fit=crop&w=600&q=80', extract: 'Ancient Hindu temple dedicated to Lord Shiva at 1,330 m, amidst dense forests in the Pauri Garhwal region.' },
            { title: 'Shivpuri Rafting Camp', category: 'ADVENTURE CAMP', dist: '15.0 km', img: 'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?auto=format&fit=crop&w=600&q=80', extract: 'Premier whitewater river rafting starting point on the Ganges, offering Grade 3-4 rapids through lush forest gorges.' }
        ],
        'dehradun': [
            { title: 'Robber\'s Cave (Guchhupani)', category: 'NATURAL CAVE', dist: '8.0 km', img: 'https://images.unsplash.com/photo-1517456793572-1d8efd6dc135?auto=format&fit=crop&w=600&q=80', extract: 'A natural river cave formation with a stream running through it, a popular picnic and trekking spot near Dehradun.' },
            { title: 'Sahastradhara', category: 'SCENIC WATERFALL', dist: '11.0 km', img: 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=600&q=80', extract: 'Sulphur spring waterfall area known for its therapeutic properties and lush natural surroundings.' },
            { title: 'Mindrolling Monastery', category: 'BUDDHIST MONASTERY', dist: '6.0 km', img: 'https://images.unsplash.com/photo-1542651048-52d3f98af9c4?auto=format&fit=crop&w=600&q=80', extract: 'One of the largest Buddhist centers in India, featuring a 185-feet high stupa decorated with murals and scriptures.' },
            { title: 'Clock Tower (Ghanta Ghar)', category: 'HERITAGE LANDMARK', dist: '1.0 km', img: 'https://images.unsplash.com/photo-1600100397608-f010e423b971?auto=format&fit=crop&w=600&q=80', extract: 'Six-faced clock tower built during the British era, located at the central hub of Dehradun city.' },
            { title: 'Survey of India Museum', category: 'HERITAGE MUSEUM', dist: '2.5 km', img: 'https://images.unsplash.com/photo-1565008447742-97f6f38c985c?auto=format&fit=crop&w=600&q=80', extract: 'Museum at the headquarters of the Survey of India showcasing historic maps, instruments, and geographical artifacts.' },
            { title: 'Forest Research Institute', category: 'COLONIAL HERITAGE', dist: '3.5 km', img: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=600&q=80', extract: 'Magnificent Greco-Roman architectural campus built in 1929, housing museums dedicated to timber and forest ecology.' }
        ],
        'dharamsala': [
            { title: 'Namgyal Monastery (Dalai Lama Temple)', category: 'TIBETAN MONASTERY', dist: '1.0 km', img: 'https://images.unsplash.com/photo-1542651048-52d3f98af9c4?auto=format&fit=crop&w=600&q=80', extract: 'Official monastery of the Dalai Lama and the largest Tibetan Buddhist institution outside Tibet.' },
            { title: 'Dal Lake Dharamsala', category: 'SCENIC LAKE', dist: '2.5 km', img: 'https://images.unsplash.com/photo-1506700269561-c58c19c2ede4?auto=format&fit=crop&w=600&q=80', extract: 'Serene lake surrounded by cedar and oak trees offering beautiful reflections of the Dhauladhar mountains.' },
            { title: 'Bhagsu Waterfall', category: 'NATURAL WATERFALL', dist: '4.0 km', img: 'https://images.unsplash.com/photo-1517456793572-1d8efd6dc135?auto=format&fit=crop&w=600&q=80', extract: 'Popular waterfall near McLeod Ganj, accessible via a scenic trek through the Bhagsu Nag village.' },
            { title: 'Triund Trek', category: 'MOUNTAIN TREK', dist: '12.0 km', img: 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=600&q=80', extract: 'One of the most popular day treks in Himachal Pradesh, leading to a ridge at 2,875 m with panoramic Dhauladhar views.' },
            { title: 'Tibet Museum', category: 'CULTURAL MUSEUM', dist: '1.2 km', img: 'https://images.unsplash.com/photo-1565008447742-97f6f38c985c?auto=format&fit=crop&w=600&q=80', extract: 'Museum documenting the history of Tibet and the life of Tibetan refugees since 1959.' },
            { title: 'Kangra Fort', category: 'ANCIENT FORTRESS', dist: '20.0 km', img: 'https://images.unsplash.com/photo-1599661046289-e31897846e41?auto=format&fit=crop&w=600&q=80', extract: 'One of the largest forts in the Himalayas, dating back to the 4th century AD, featuring ancient temples and ruins.' }
        ],
        'darjeeling': [
            { title: 'Tiger Hill Sunrise Point', category: 'SCENIC SUMMIT', dist: '11.0 km', img: 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=600&q=80', extract: 'Highest peak near Darjeeling at 2,590 m, famous for spectacular sunrise views over Kanchenjunga and Mount Everest.' },
            { title: 'Darjeeling Himalayan Railway (Toy Train)', category: 'UNESCO RAILWAY', dist: '1.0 km', img: 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=600&q=80', extract: 'UNESCO World Heritage mountain railway built in 1881, winding through tea gardens and misty hillsides.' },
            { title: 'Padmaja Naidu Himalayan Zoological Park', category: 'HIGHLAND ZOO', dist: '3.0 km', img: 'https://images.unsplash.com/photo-1596176530529-78163a4f7af2?auto=format&fit=crop&w=600&q=80', extract: 'High-altitude zoo famous for its Snow Leopard and Red Panda conservation breeding programs.' },
            { title: 'Batasia Loop', category: 'ENGINEERING WONDER', dist: '5.0 km', img: 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?auto=format&fit=crop&w=600&q=80', extract: 'Spiral railway loop built in 1919 to reduce the gradient of the Darjeeling Himalayan Railway, with a war memorial garden.' },
            { title: 'Rock Garden & Ganga Maya Park', category: 'TERRACED GARDEN', dist: '10.0 km', img: 'https://images.unsplash.com/photo-1528164344705-47542687990d?auto=format&fit=crop&w=600&q=80', extract: 'Beautiful terraced garden with waterfalls cascading over rocks, surrounded by tea gardens and forest.' },
            { title: 'Happy Valley Tea Estate', category: 'HERITAGE TEA GARDEN', dist: '2.5 km', img: 'https://images.unsplash.com/photo-1528164344705-47542687990d?auto=format&fit=crop&w=600&q=80', extract: 'One of the oldest tea estates in Darjeeling established in 1854, offering factory tours and tea tasting sessions.' }
        ],
        'shimla': [
            { title: 'The Ridge & Mall Road Shimla', category: 'HERITAGE PROMENADE', dist: '0.5 km', img: 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=600&q=80', extract: 'Large open space in the heart of Shimla, center of cultural activities and colonial architecture.' },
            { title: 'Jakhu Temple & Statue', category: 'HILLTOP TEMPLE', dist: '1.8 km', img: 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=600&q=80', extract: 'Ancient temple dedicated to Lord Hanuman at Jakhu Hill, Shimla\'s highest peak at 2,455 meters.' },
            { title: 'Kalka-Shimla Toy Train', category: 'UNESCO RAILWAY', dist: '1.2 km', img: 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=600&q=80', extract: 'Mountain railway in North-Western India built in 1903, a UNESCO World Heritage Site.' },
            { title: 'Christ Church Shimla', category: 'HISTORIC CHURCH', dist: '0.6 km', img: 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=600&q=80', extract: 'Second oldest church in North India, built in Neo-Gothic style in 1857 on The Ridge.' },
            { title: 'Green Valley Shimla', category: 'SCENIC VISTA', dist: '7.5 km', img: 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=600&q=80', extract: 'Mountain valley surrounded by dense pine and deodar forests along National Highway 22.' },
            { title: 'Kufri Adventure Park', category: 'ALPINE RESORT', dist: '14.0 km', img: 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=600&q=80', extract: 'Tiny hill station near Shimla famous for winter sports, trekking trails, and Himalayan wildlife.' }
        ]
    };

    // Alias Lookup Map for Cities
    const CITY_ALIASES = {
        'sf': 'san francisco',
        'frisco': 'san francisco',
        'nyc': 'new york',
        'la': 'los angeles',
        'new delhi': 'delhi',
        'old delhi': 'delhi',
        'bombay': 'mumbai',
        'calcutta': 'kolkata',
        'bangalore': 'bengaluru',
        'cochin': 'kochi',
        'mysuru': 'mysore',
        'banaras': 'varanasi',
        'kashi': 'varanasi',
        'madras': 'chennai',
        'pondicherry': 'puducherry',
        'vizag': 'visakhapatnam',
        'naini tal': 'nainital',
        'naini taal': 'nainital',
        'nainī tāl': 'nainital',
        'nainitaal': 'nainital',
        'mcleod ganj': 'dharamsala',
        'mcleodganj': 'dharamsala',
        'dharamshala': 'dharamsala',
        'doon': 'dehradun',
        'dehra dun': 'dehradun',
        'hardwar': 'haridwar',
        'hrishikesh': 'rishikesh'
    };

    async function fetchWikipediaPlaces(cityName, lat, lon) {
        const grid = document.getElementById('bento-places-grid');
        if (!grid) return;

        grid.innerHTML = `
            <div class="bento-loading-state glass-card">
                <i class="fa-solid fa-atom fa-spin loading-spin"></i>
                <p>Retrieving authentic visitable places...<p>
            </div>
        `;

        let rawCity = (cityName || '').trim().split(',')[0].toLowerCase();

        // If cityName is coordinates or numeric, attempt reverse geocoding to resolve city name
        if (!rawCity || /^[\d\.\,\-\s]+$/.test(rawCity)) {
            const rev = await reverseGeocodeCoords(lat, lon);
            if (rev && rev.name) {
                cityName = rev.name;
                rawCity = rev.name.trim().split(',')[0].toLowerCase();
            }
        }

        const cleanCity = CITY_ALIASES[rawCity] || rawCity;

        // 1. Check Curated High-Precision Database (Direct or Exact Match)
        if (CITY_LANDMARKS_DB[cleanCity]) {
            renderCuratedBentoCards(CITY_LANDMARKS_DB[cleanCity], cityName, lat, lon);
            return;
        }

        // Check exact prefix match for multi-word city names (e.g. "san francisco, california" -> "san francisco")
        for (const dbKey in CITY_LANDMARKS_DB) {
            if (cleanCity === dbKey || cleanCity.startsWith(dbKey)) {
                renderCuratedBentoCards(CITY_LANDMARKS_DB[dbKey], cityName, lat, lon);
                return;
            }
        }

        // 2. High-Precision Wikipedia Geosearch + City Landmarks API Engine
        try {
            // Geosearch anchored to Lat/Lon (20km radius)
            const geoUrl = `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}|${lon}&gsradius=20000&gslimit=35&format=json&origin=*`;
            const geoRes = await fetch(geoUrl);
            let geoHits = [];
            if (geoRes.ok) {
                const geoData = await geoRes.json();
                geoHits = geoData.query?.geosearch || [];
            }

            const skipRegex = /station|district|suburb|constituency|school|college|university|hospital|department|line|airport|subdivision|railway|football|basketball|county|ward|road|street|avenue/i;
            const validGeoTitles = geoHits.filter(g => !skipRegex.test(g.title)).map(g => g.title);

            // Targeted Landmark Search Query for the City
            const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanCity + ' landmarks tourist attractions')}&srlimit=15&format=json&origin=*`;
            const searchRes = await fetch(searchUrl);
            let searchTitles = [];
            if (searchRes.ok) {
                const searchData = await searchRes.json();
                searchTitles = (searchData.query?.search || []).map(s => s.title);
            }

            const combinedTitles = Array.from(new Set([...validGeoTitles, ...searchTitles]));
            const metaFilter = /^(list of|history of|culture of|geography of|economy of|demographics of|timeline of|politics of|outline of|climate of|transport in|geology of)/i;
            
            // Split city name into words for partial matching (e.g. "naini tal" -> ["naini", "tal"])
            const cityWords = cleanCity.split(/\s+/).filter(w => w.length > 2);

            const finalTitles = [];
            for (const t of combinedTitles) {
                const tl = t.toLowerCase();
                if (tl === cleanCity) continue;
                if (metaFilter.test(t)) continue;
                // Accept if it's a geo hit, contains full city name, or contains any meaningful city word
                const isGeoHit = validGeoTitles.includes(t);
                const containsCity = tl.includes(cleanCity) || cityWords.some(w => tl.includes(w));
                if (isGeoHit || containsCity) {
                    finalTitles.push(t);
                }
            }

            const selectedTitles = finalTitles.slice(0, 8);

            if (selectedTitles.length > 0) {
                const wikiCardsData = [];
                for (const title of selectedTitles) {
                    try {
                        const sumRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
                        if (sumRes.ok) {
                            const sum = await sumRes.json();
                            if (sum.extract && sum.extract.length > 30 && sum.title) {
                                wikiCardsData.push({
                                    title: sum.title,
                                    extract: sum.extract,
                                    img: sum.thumbnail?.source || 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?auto=format&fit=crop&w=600&q=80',
                                    category: sum.description ? sum.description.toUpperCase() : 'CULTURAL LANDMARK',
                                    dist: 'Local Area'
                                });
                            }
                        }
                    } catch (e) {
                        // ignore single fetch error
                    }
                }

                if (wikiCardsData.length > 0) {
                    renderCustomBentoCards(wikiCardsData, cityName, lat, lon);
                    return;
                }
            }
        } catch (err) {
            console.warn('Wikipedia Places API error:', err);
        }

        // 3. Fallback to Dynamic City Bento Cards if no specific landmarks found
        renderFallbackBentoCards(cityName, lat, lon);
    }

    function renderCuratedBentoCards(items, cityName, lat, lon) {
        const grid = document.getElementById('bento-places-grid');
        if (!grid) return;
        grid.innerHTML = '';

        items.forEach(p => {
            const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p.title + ', ' + cityName)}`;
            const card = document.createElement('div');
            card.className = 'glass-card tilt-card bento-card';
            card.innerHTML = `
                <div>
                    <div class="bento-img-wrapper">
                        <img src="${p.img}" alt="${p.title}" class="bento-img" loading="lazy" />
                        <span class="bento-cat-tag"><i class="fa-solid fa-landmark"></i> ${p.category}</span>
                    </div>
                    <h3 class="bento-title">${p.title}</h3>
                    <p class="bento-extract">${p.extract}</p>
                </div>
                <div class="bento-footer-row">
                    <span class="bento-dist"><i class="fa-solid fa-location-arrow"></i> ${p.dist} away</span>
                    <a href="${dirUrl}" target="_blank" rel="noopener noreferrer" class="btn-directions">
                        🗺️ Directions
                    </a>
                </div>
            `;
            grid.appendChild(card);
        });

        initTiltEffect();
    }

    function renderCustomBentoCards(items, cityName, lat, lon) {
        const grid = document.getElementById('bento-places-grid');
        if (!grid) return;
        grid.innerHTML = '';

        items.forEach(p => {
            const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p.title + ', ' + cityName)}`;
            const card = document.createElement('div');
            card.className = 'glass-card tilt-card bento-card';
            card.innerHTML = `
                <div>
                    <div class="bento-img-wrapper">
                        <img src="${p.img}" alt="${p.title}" class="bento-img" loading="lazy" />
                        <span class="bento-cat-tag"><i class="fa-solid fa-compass"></i> ${p.category.toUpperCase()}</span>
                    </div>
                    <h3 class="bento-title">${p.title}</h3>
                    <p class="bento-extract">${p.extract}</p>
                </div>
                <div class="bento-footer-row">
                    <span class="bento-dist"><i class="fa-solid fa-location-arrow"></i> ${p.dist}</span>
                    <a href="${dirUrl}" target="_blank" rel="noopener noreferrer" class="btn-directions">
                        🗺️ Directions
                    </a>
                </div>
            `;
            grid.appendChild(card);
        });

        initTiltEffect();
    }

    function renderFallbackBentoCards(cityName, lat, lon) {
        const grid = document.getElementById('bento-places-grid');
        if (!grid) return;
        grid.innerHTML = '';

        let rawCity = (cityName || '').split(',')[0].trim();
        if (!rawCity || /^[\d\.\,\-\s]+$/.test(rawCity)) {
            rawCity = 'this region';
        }

        // Show a helpful message instead of fake places
        const mapsUrl = `https://www.google.com/maps/search/tourist+attractions+near+${encodeURIComponent(rawCity)}`;
        grid.innerHTML = `
            <div class="bento-no-data glass-card" style="grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; padding: 2.5rem 2rem; text-align: center; border-radius: 1rem;">
                <i class="fa-solid fa-map-location-dot" style="font-size: 2.5rem; color: var(--accent, #54ead2); opacity: 0.8;"></i>
                <h3 style="font-size: 1.2rem; margin: 0; color: #e0e6f0;">Discovering Places in <span style="color: var(--accent, #54ead2);">${rawCity}</span></h3>
                <p style="font-size: 0.92rem; color: #8fa3b8; max-width: 480px; margin: 0; line-height: 1.6;">Real landmark data for this location is not yet available in our curated database, and the live Wikipedia engine did not return verified results. Explore attractions on Google Maps instead.</p>
                <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="btn-directions" style="margin-top: 0.5rem; padding: 0.7rem 1.5rem; font-size: 0.9rem;">🗺️ Explore on Google Maps</a>
            </div>
        `;
    }

    // ==========================================================================
    // 13. HIGH-PERFORMANCE 3D TILT EFFECT (ZERO-THRASHTHROTTLED)
    // ==========================================================================
    function initTiltEffect() {
        const tiltCards = document.querySelectorAll('.tilt-card:not([data-tilt-bound]), .mockup-header-nav:not([data-tilt-bound])');
        tiltCards.forEach(card => {
            card.setAttribute('data-tilt-bound', 'true');
            let rect = null;
            let ticking = false;

            card.addEventListener('mouseenter', () => {
                rect = card.getBoundingClientRect();
            });

            card.addEventListener('mousemove', (e) => {
                if (!rect) rect = card.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const centerX = rect.width / 2;
                const centerY = rect.height / 2;
                const rotateX = ((y - centerY) / centerY) * -5;
                const rotateY = ((x - centerX) / centerX) * 5;

                if (!ticking) {
                    ticking = true;
                    requestAnimationFrame(() => {
                        card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(4px)`;
                        ticking = false;
                    });
                }
            });

            card.addEventListener('mouseleave', () => {
                rect = null;
                requestAnimationFrame(() => {
                    card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateZ(0)';
                });
            });
        });
    }

    // ==========================================================================
    // 14. NAVBAR NAVIGATION, SMOOTH SCROLL & SCROLL-SPY
    // ==========================================================================
    function initNavbarNavigation() {
        const navLinks = document.querySelectorAll('.nav-link');
        const mobileToggle = document.getElementById('mobile-menu-toggle');
        const navMenu = document.getElementById('main-nav-links');

        // Mobile Menu Toggle
        if (mobileToggle && navMenu) {
            mobileToggle.addEventListener('click', () => {
                navMenu.classList.toggle('open');
                const icon = mobileToggle.querySelector('i');
                if (icon) {
                    icon.classList.toggle('fa-bars');
                    icon.classList.toggle('fa-xmark');
                }
            });
        }

        // Smooth Scroll & Link Activation
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                const targetId = link.getAttribute('href');
                if (targetId && targetId.startsWith('#')) {
                    e.preventDefault();
                    const targetEl = document.querySelector(targetId);
                    if (targetEl) {
                        if (navMenu) navMenu.classList.remove('open');
                        if (mobileToggle) {
                            const icon = mobileToggle.querySelector('i');
                            if (icon) {
                                icon.classList.add('fa-bars');
                                icon.classList.remove('fa-xmark');
                            }
                        }
                        navLinks.forEach(l => l.classList.remove('active'));
                        link.classList.add('active');
                        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                }
            });
        });

        // Intersection Observer Scroll-Spy for Active Nav Highlight on Scroll
        const sections = document.querySelectorAll('section[id]');
        if (sections.length > 0 && 'IntersectionObserver' in window) {
            const observerOptions = {
                root: null,
                rootMargin: '-20% 0px -55% 0px',
                threshold: 0.1
            };

            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const activeId = entry.target.getAttribute('id');
                        navLinks.forEach(l => {
                            l.classList.remove('active');
                            if (l.getAttribute('href') === `#${activeId}`) {
                                l.classList.add('active');
                            }
                        });
                    }
                });
            }, observerOptions);

            sections.forEach(sec => observer.observe(sec));
        }
    }

})();
