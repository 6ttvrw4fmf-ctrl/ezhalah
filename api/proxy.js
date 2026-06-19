// Reverse proxy so the in-app browser can show Aqar's REAL page INSIDE Ezhalah. Aqar sends
// `x-frame-options: SAMEORIGIN`, which makes browsers refuse to display it in an iframe directly.
// This Vercel serverless function fetches the page server-side, STRIPS the anti-framing + CSP
// headers, injects a <base> so the page's assets still resolve to Aqar's origin, and re-serves the
// HTML from OUR domain — so the iframe (same-origin) can render it. A top-left button in the UI lets
// the user jump out to the real Aqar tab. (user request: open inside the platform, button to leave.)
//
// Security: ONLY proxies whitelisted partner hosts (not an open proxy); GET only.

const ALLOWED_HOSTS = new Set(['sa.aqar.fm', 'www.sa.aqar.fm']);

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ar,en-US;q=0.7,en;q=0.6',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
};

export default async function handler(req, res) {
  try {
    const q = req.query || {};
    // Two modes:
    //  • ?url=<full partner URL>   → proxy a PAGE (HTML) and rewrite it for framing.
    //  • ?asset=/_next/...         → proxy an ASSET (JS/CSS/img/font) for the framed page. Vercel
    //    rewrites /_next/* here so the partner's Next.js runtime (which requests /_next/* from OUR
    //    origin) gets the real files. We rebuild the asset URL on sa.aqar.fm, preserving the rest of
    //    the original query (e.g. /_next/image?url=&w=).
    let target;
    if (typeof q.asset === 'string' && q.asset.startsWith('/')) {
      const extra = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) {
        if (k === 'asset') continue;
        if (Array.isArray(v)) v.forEach((vv) => extra.append(k, vv));
        else extra.append(k, String(v));
      }
      const qs = extra.toString();
      try { target = new URL(`https://sa.aqar.fm${q.asset}${qs ? '?' + qs : ''}`); } catch { res.status(400).send('Bad asset'); return; }
    } else {
      const raw = q.url;
      if (!raw || typeof raw !== 'string') { res.status(400).send('Missing url'); return; }
      try { target = new URL(raw); } catch { res.status(400).send('Bad url'); return; }
    }
    if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
      res.status(403).send('Host not allowed'); return;
    }

    const upstream = await fetch(target.toString(), {
      method: 'GET',
      headers: { ...BROWSER_HEADERS, Referer: `${target.protocol}//${target.hostname}/` },
      redirect: 'follow',
    });

    const contentType = upstream.headers.get('content-type') || 'text/html; charset=utf-8';
    if (!contentType.includes('text/html')) {
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.setHeader('content-type', contentType);
      res.status(upstream.status).send(buf);
      return;
    }

    let html = await upstream.text();
    const baseTag = `<base href="${target.protocol}//${target.hostname}/">`;
    if (/<head[^>]*>/i.test(html)) html = html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
    else html = baseTag + html;

    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'public, max-age=300');
    // Deliberately omit x-frame-options / CSP frame-ancestors so the iframe can show it.
    res.status(upstream.status).send(html);
  } catch (e) {
    res.status(502).send('Proxy error: ' + (e && e.message ? e.message : String(e)));
  }
}
