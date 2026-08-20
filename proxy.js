// api/proxy.js
// Fixed video proxy for Vercel – streams response, supports Range requests,
// forwards useful headers, and avoids loading the entire video into memory.

export const config = {
  runtime: 'nodejs',          // Node.js runtime for better streaming & longer timeouts
  maxDuration: 60,            // allow longer streams (Pro plan can go higher)
};

export default async function handler(req, res) {
  // Only allow GET / HEAD
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).send('Method Not Allowed');
  }

  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).send('Missing or invalid ?url= parameter');
  }

  let target;
  try {
    target = decodeURIComponent(url);
    // Basic SSRF protection – only allow http/https
    const parsed = new URL(target);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).send('Only http/https URLs are allowed');
    }
  } catch {
    return res.status(400).send('Invalid URL');
  }

  try {
    // Build headers to send upstream
    const upstreamHeaders = {
      'User-Agent':
        req.headers['user-agent'] ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: '*/*',
      'Accept-Encoding': 'identity', // avoid compressed video streams that browsers struggle with
    };

    // Forward Range so seeking works
    if (req.headers.range) {
      upstreamHeaders['Range'] = req.headers.range;
    }

    // Many CDNs (xhcdn, etc.) check Referer / Origin
    // You can hard-code a sensible default or forward from the client
    if (req.headers.referer) {
      upstreamHeaders['Referer'] = req.headers.referer;
    } else {
      // Fallback that works for a lot of adult / video CDNs
      try {
        const u = new URL(target);
        upstreamHeaders['Referer'] = u.origin + '/';
      } catch {
        // ignore
      }
    }

    // Optional: forward other useful headers
    if (req.headers['if-range']) upstreamHeaders['If-Range'] = req.headers['if-range'];
    if (req.headers['if-none-match']) upstreamHeaders['If-None-Match'] = req.headers['if-none-match'];
    if (req.headers['if-modified-since'])
      upstreamHeaders['If-Modified-Since'] = req.headers['if-modified-since'];

    const response = await fetch(target, {
      method: req.method,
      headers: upstreamHeaders,
      // Important for streaming
      redirect: 'follow',
    });

    // Pass through status (200 or 206)
    res.status(response.status);

    // CORS – allow the player to load the proxied video
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');

    // Copy important headers from upstream
    const headersToCopy = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'etag',
      'last-modified',
      'cache-control',
    ];

    for (const name of headersToCopy) {
      const value = response.headers.get(name);
      if (value) res.setHeader(name, value);
    }

    // Force a sensible content-type if upstream is missing/wrong
    if (!response.headers.get('content-type')) {
      if (target.includes('.mp4') || target.includes('h264')) {
        res.setHeader('Content-Type', 'video/mp4');
      } else if (target.includes('.webm')) {
        res.setHeader('Content-Type', 'video/webm');
      }
    }

    // Always advertise that we support ranges
    if (!res.getHeader('Accept-Ranges')) {
      res.setHeader('Accept-Ranges', 'bytes');
    }

    // HEAD request → headers only
    if (req.method === 'HEAD') {
      return res.end();
    }

    // Stream the body – do NOT buffer the whole video
    if (!response.body) {
      return res.status(502).send('Upstream returned no body');
    }

    // Convert Web ReadableStream → Node.js Readable and pipe
    const { Readable } = await import('stream');
    const nodeStream = Readable.fromWeb(response.body);

    nodeStream.on('error', (err) => {
      console.error('Stream error:', err);
      if (!res.headersSent) {
        res.status(500).end('Stream error');
      } else {
        res.destroy(err);
      }
    });

    // Pipe directly to the client
    nodeStream.pipe(res);
  } catch (error) {
    console.error('Proxy error:', error);
    if (!res.headersSent) {
      res.status(500).send('Proxy error: ' + (error.message || 'Unknown error'));
    }
  }
}
