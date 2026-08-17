const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const DEFAULT_PORT = Number(process.env.PORT || 8080);
const root = __dirname;
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

// Text types eligible for gzip compression
const GZIP_TYPES = new Set([
  'text/html; charset=utf-8',
  'application/javascript; charset=utf-8',
  'text/css; charset=utf-8',
  'application/json; charset=utf-8',
  'text/plain; charset=utf-8',
  'image/svg+xml'
]);

// Cache durations: HTML = 0 (revalidate always), static assets = 1 hour
function getCacheControl(ext) {
  if (ext === '.html') return 'no-cache';
  return 'public, max-age=3600, stale-while-revalidate=86400';
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(payload));
}

function handleApiWeather(req, res, url) {
  const q = url.searchParams.get('q') || 'San Francisco';
  const days = url.searchParams.get('days') || '3';
  const aqi = url.searchParams.get('aqi') === 'no' ? 'no' : 'yes';

  const apiKey = process.env.WEATHERAPI_KEY;
  if (!apiKey) {
    // No API key configured — return 503 so the client falls through to
    // Tier 3 (Open-Meteo zero-key engine) which provides real live data.
    sendJson(res, 503, { error: { message: 'WEATHERAPI_KEY not configured on this server. Client should use Open-Meteo fallback.' } });
    return;
  }

  const upstreamUrl = `https://api.weatherapi.com/v1/forecast.json?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(q)}&days=${encodeURIComponent(days)}&aqi=${encodeURIComponent(aqi)}&alerts=yes`;

  fetch(upstreamUrl)
    .then((upstreamRes) => upstreamRes.json())
    .then((data) => {
      if (data && data.location && data.current) {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        });
        res.end(JSON.stringify(data));
      } else {
        sendJson(res, 502, { error: { message: 'Weather provider returned an unexpected payload.' } });
      }
    })
    .catch(() => {
      sendJson(res, 502, { error: { message: 'Weather provider is unreachable.' } });
    });
}

function handleApiSearch(req, res, url) {
  const q = (url.searchParams.get('q') || '').trim();
  if (!q || q.length < 2) {
    sendJson(res, 200, []);
    return;
  }

  const apiKey = process.env.WEATHERAPI_KEY;
  if (!apiKey) {
    // No key — return empty so client falls back to Open-Meteo geocoding autocomplete
    sendJson(res, 200, []);
    return;
  }

  const upstreamUrl = `https://api.weatherapi.com/v1/search.json?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(q)}`;

  fetch(upstreamUrl)
    .then((upstreamRes) => upstreamRes.json())
    .then((data) => {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify(Array.isArray(data) ? data : []));
    })
    .catch(() => {
      sendJson(res, 200, [{ name: q, country: 'Local Search', region: 'Fallback' }]);
    });
}

function serveStaticFile(req, res, pathname) {
  let safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(root, safePath));
  if (!filePath.startsWith(root)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[extension] || 'application/octet-stream';
    const cacheControl = getCacheControl(extension);

    // Generate ETag from content hash for conditional GET support
    const etag = `"${crypto.createHash('md5').update(data).digest('hex')}"`;

    // If client sent If-None-Match and it matches, return 304 Not Modified
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch && ifNoneMatch === etag) {
      res.writeHead(304, {
        'ETag': etag,
        'Cache-Control': cacheControl,
        'Access-Control-Allow-Origin': '*'
      });
      res.end();
      return;
    }

    const headers = {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      'ETag': etag,
      'Access-Control-Allow-Origin': '*',
      'Vary': 'Accept-Encoding'
    };

    // Apply gzip compression for supported text types
    const acceptEncoding = req.headers['accept-encoding'] || '';
    if (GZIP_TYPES.has(contentType) && acceptEncoding.includes('gzip')) {
      zlib.gzip(data, (gzipErr, compressed) => {
        if (gzipErr) {
          // Fallback to uncompressed
          res.writeHead(200, headers);
          res.end(data);
          return;
        }
        headers['Content-Encoding'] = 'gzip';
        headers['Content-Length'] = compressed.length;
        res.writeHead(200, headers);
        res.end(compressed);
      });
    } else {
      res.writeHead(200, headers);
      res.end(data);
    }
  });
}

function startServer(port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end();
      return;
    }

    if (pathname === '/api/weather') {
      handleApiWeather(req, res, url);
      return;
    }

    if (pathname === '/api/search') {
      handleApiSearch(req, res, url);
      return;
    }

    serveStaticFile(req, res, pathname);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      const fallbackPort = port + 1;
      console.warn(`Port ${port} is in use; retrying on ${fallbackPort}...`);
      startServer(fallbackPort);
      return;
    }
    throw err;
  });

  server.listen(port, () => {
    console.log(`✅ Atmos app running at http://127.0.0.1:${port}`);
    console.log(`   Gzip compression: ENABLED`);
    console.log(`   ETag caching:     ENABLED`);
    console.log(`   Static cache:     1 hour (max-age=3600)`);
  });
}

startServer(DEFAULT_PORT);
