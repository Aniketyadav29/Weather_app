# Atmos — Field Weather Instrument

## What changed in this update

1. **API key security fix + caching** — the WeatherAPI key is no longer in
   `script.js`. It now lives server-side in two small proxy functions
   (`api/weather.js`, `api/search.js`) that read it from an environment
   variable and cache responses (5 min for forecasts, 10 min for
   autocomplete) so repeat searches don't re-hit WeatherAPI.
2. **Autocomplete + recent searches** — typing 2+ characters into any search
   box now queries `/api/search` and shows a dropdown of matching places.
   Successful searches are also saved to `localStorage` and shown as
   tappable chips under each search box.
3. **Hourly strip + weather alerts** — the Weather panel now shows the next
   12 hours (temp + precipitation chance) and any active alerts for the
   searched location, pulled from WeatherAPI's `alerts=yes` response. If
   there are no alerts, a calm confirmation banner is shown instead of
   nothing.

## Important: this is no longer a pure static site

Because the API key moved server-side, the app now needs a host that can run
the two functions in `/api`. Plain static hosting (GitHub Pages, a bare S3
bucket, opening `index.html` directly) will **not** work anymore — the
search box will fail because there's nothing to answer `/api/weather`.

The `/api` folder uses Vercel's zero-config serverless function convention
(any file in `/api` becomes an endpoint at `/api/<filename>`), so Vercel is
the path of least resistance. Netlify, Cloudflare Pages, etc. work too, but
need the same two functions rewritten to their function signature.

## Deploy on Vercel (recommended)

1. Install the CLI once: `npm install -g vercel`
2. From the project folder: `vercel` (first deploy) or `vercel --prod`
3. Set your key as an environment variable — either:
   - `vercel env add WEATHERAPI_KEY` and paste your key, or
   - in the Vercel dashboard: Project → Settings → Environment Variables
4. Redeploy after adding the env var so it's picked up: `vercel --prod`

### Local development

`vercel dev` runs both the static site and the `/api` functions together on
localhost, so autocomplete and weather search work exactly like production.
Opening `index.html` directly in a browser will not run the API functions.

Copy `.env.example` to `.env` and fill in your key for local dev:

```
cp .env.example .env
```

## Get a WeatherAPI key

Free tier keys are available at https://www.weatherapi.com/ — the same key
that was previously hardcoded in `script.js` still works, just move it into
the environment variable instead.

## File overview

```
index.html         Markup + styles (unchanged design language, new UI added)
script.js           All client logic — no key, calls /api/* instead of WeatherAPI directly
api/weather.js       Proxies + caches forecast.json (current + 3-day + hourly + alerts)
api/search.js        Proxies + caches search.json (autocomplete)
package.json         Marks the project as a Node app for Vercel
.env.example          Template for the WEATHERAPI_KEY env var
```
