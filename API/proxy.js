// api/proxy.js
export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send('Missing ?url= parameter');
  }

  const target = decodeURIComponent(url);

  try {
    const fetchOptions = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    };

    if (req.headers.range) {
      fetchOptions.headers['Range'] = req.headers.range;
    }

    const response = await fetch(target, fetchOptions);

    if (!response.ok) {
      return res.status(response.status).send(`Failed: ${response.statusText}`);
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

    const contentType = response.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);

    const contentLength = response.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    const acceptRanges = response.headers.get('accept-ranges');
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);

    const contentRange = response.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);

    if (response.status === 206) res.status(206);

    const reader = response.body.getReader();
    const stream = new ReadableStream({
      start(controller) {
        function push() {
          reader.read().then(({ done, value }) => {
            if (done) { controller.close(); return; }
            controller.enqueue(value);
            push();
          });
        }
        push();
      },
    });

    const webStream = new Response(stream);
    const buffer = await webStream.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error(error);
    res.status(500).send('Proxy error: ' + error.message);
  }
}
