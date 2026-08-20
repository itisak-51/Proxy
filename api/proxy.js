// api/proxy.js
// Streaming video proxy for Vercel
// Supports Range requests (seeking), follows redirects, sets proper headers

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
};

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD, OPTIONS');
    return res.status(405).send('Method Not Allowed');
  }

  const rawUrl = req.query.url;
  if (!rawUrl || typeof rawUrl !== 'string') {
    return res.status(400).send('Missing ?url= parameter');
  }

  let target;
  try {
    target = decodeURIComponent(rawUrl);
    const parsed = new URL(target);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).send('Only http and https URLs are allowed');
    }
  } catch {
    return res.status(400).send('Invalid URL');
  }

  const ua =
    req.headers['user-agent'] ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  // Good default Referer for many video CDNs (xhcdn, ahcdn, etc.)
  let referer = 'https://xhamster.com/';
  try {
    const host = new URL(target).hostname;
    if (!host.includes('xhcdn') && !host.includes('ahcdn') && !host.includes('xhamster')) {
      referer = new URL(target).origin + '/';
    }
  } catch {}

  try {
    let currentUrl = target;
    let response = null;
    const maxRedirects = 6;

    for (let i = 0; i <= maxRedirects; i++) {
      const headers = {
        'User-Agent': ua,
        Accept: '*/*',
        'Accept-Encoding': 'identity',
        Referer: referer,
        Origin: new URL(referer).origin,
      };

      if (req.headers.range) headers['Range'] = req.headers.range;
      if (req.headers['if-range']) headers['If-Range'] = req.headers['if-range'];
      if (req.headers['if-none-match']) headers['If-None-Match'] = req.headers['if-none-match'];
      if (req.headers['if-modified-since']) headers['If-Modified-Since'] = req.headers['if-modified-since'];

      response = await fetch(currentUrl, {
        method: req.method,
        headers,
        redirect: 'manual',
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) break;
        currentUrl = new URL(location, currentUrl).href;
        try {
          referer = new URL(currentUrl).origin + '/';
        } catch {}
        continue;
      }
      break;
    }

    if (!response) {
      return res.status(502).send('No response from upstream');
    }

    // Status (200 or 206)
    res.status(response.status);

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Length, Content-Range, Accept-Ranges, Content-Type, ETag, Last-Modified'
    );

    // Copy important headers
    const toCopy = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'etag',
      'last-modified',
      'cache-control',
      'expires',
    ];
    for (const name of toCopy) {
      const value = response.headers.get(name);
      if (value) res.setHeader(name, value);
    }

    // Force correct Content-Type when missing or wrong
    const ct = (response.headers.get('content-type') || '').toLowerCase();
    if (
      !ct ||
      ct === 'application/octet-stream' ||
      ct === 'binary/octet-stream' ||
      ct.startsWith('text/')
    ) {
      if (/\.(mp4|m4v)|h264|avc/i.test(currentUrl + target)) {
        res.setHeader('Content-Type', 'video/mp4');
      } else if (/\.webm/i.test(currentUrl + target)) {
        res.setHeader('Content-Type', 'video/webm');
      } else if (/\.m3u8/i.test(currentUrl + target)) {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      } else {
        res.setHeader('Content-Type', 'video/mp4');
      }
    }

    if (!res.getHeader('Accept-Ranges')) {
      res.setHeader('Accept-Ranges', 'bytes');
    }

    // HEAD → only headers
    if (req.method === 'HEAD') {
      return res.end();
    }

    if (!response.body) {
      return res.status(502).send('Upstream returned empty body');
    }

    // Stream – never load the whole video into memory
    const { Readable } = await import('node:stream');
    const nodeStream = Readable.fromWeb(response.body);

    nodeStream.on('error', (err) => {
      console.error('Stream error:', err.message);
      if (!res.headersSent) res.status(500).end('Stream error');
      else res.destroy(err);
    });

    nodeStream.pipe(res);
  } catch (err) {
    console.error('Proxy error:', err);
    if (!res.headersSent) {
      res.status(500).send('Proxy error: ' + (err.message || 'Unknown'));
    }
  }
    }
      
