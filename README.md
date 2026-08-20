# Video Proxy Player (Fixed)

A simple, improved video proxy + HTML5 player that runs on Vercel.

**Original repo:** https://github.com/itisak-51/Proxy  
**This version fixes the main problems** that caused “FORMAT not supported” and failed playback.

## What was wrong in the original

1. **Full buffering** – the proxy loaded the entire video into memory with `arrayBuffer()`.  
   Large files → timeouts, memory errors, or truncated responses → browser reports “FORMAT not supported”.
2. **Poor Range support** – seeking in the video player was broken or unreliable.
3. **Missing headers** – many CDNs (especially xhcdn / adult sites) check `Referer`, `User-Agent`, etc.
4. **Capital `API/` folder** – Vercel convention is lowercase `/api`.

## What this fixed version does

- **Streams** the response (pipes the body) – no full in-memory buffering
- Properly forwards **HTTP Range** requests → seeking works
- Sets sensible `Referer`, `User-Agent`, and `Accept-Encoding: identity`
- Forces a correct `Content-Type` when the upstream is missing/wrong
- Adds basic SSRF protection (only `http`/`https`)
- Cleaner frontend with better error messages and an “Open Proxy URL” button
- Uses Node.js runtime + longer `maxDuration`

## Project structure

```
Proxy-fixed/
├── api/
│   └── proxy.js          # Streaming proxy (the important fix)
├── public/
│   └── index.html        # Player UI
├── vercel.json
└── README.md
```

## Deploy to Vercel

1. Push this folder to a new GitHub repository (or replace the files in the original).
2. Import the repo in the [Vercel dashboard](https://vercel.com/new).
3. Deploy – no extra configuration needed.

Or use the CLI:

```bash
npm i -g vercel
vercel
```

## Local testing (optional)

```bash
# Install Vercel CLI
npm i -g vercel

# Run locally
vercel dev
```

Then open http://localhost:3000

## Usage

1. Paste any direct video URL (`.mp4`, `.webm`, etc.).
2. Click **Load & Play**.
3. The player requests `/api/proxy?url=...` which streams the video through your Vercel function.

### Tips for stubborn sites (xhcdn, etc.)

- Some CDNs require a specific `Referer`. The proxy already sets a reasonable default (`origin/`).
- If it still fails, open the browser Network tab, look at the original request headers on the site, and you can hard-code a better `Referer` inside `api/proxy.js`.
- Very long videos may hit Vercel’s free-tier duration limits. Streaming helps a lot, but for heavy use consider a dedicated server or Cloudflare Worker.

## Limitations

- Vercel serverless functions still have execution-time and bandwidth limits (especially on the free plan).
- This is an **open proxy** – anyone who knows the URL can use it. For production you should add authentication or rate limiting.
- Does not rewrite HLS (`.m3u8`) playlists. For HLS you need a more advanced proxy that rewrites segment URLs.

## License

MIT (same spirit as the original).
