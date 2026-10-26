// POST /api/human {token}: the browser's invisible Cloudflare Turnstile token (src/lib/supabase.ts) is checked with
// Cloudflare once; a pass sets the one-hour ez_human cookie the front door reads (api/_humanPass.ts). Owner 2026-10-21:
// Turnstile in Invisible mode, so real visitors never see or click anything.
import { HUMAN_COOKIE, HUMAN_PASS_SECONDS, humanPassValid, mintHumanPass, readCookie } from './_humanPass';
import { visitorIp } from './sb';

const SECRET = process.env.TURNSTILE_SECRET_KEY || '';

export async function POST(request: Request): Promise<Response> {
  if (!SECRET) return Response.json({ ok: false, reason: 'not configured' }, { status: 503 });
  const body = await request.json().catch(() => null) as { token?: unknown } | null;
  const token = body?.token;
  if (typeof token !== 'string' || token.length < 10 || token.length > 4096) {
    return Response.json({ ok: false, reason: 'bad token' }, { status: 400 });
  }
  const form = new URLSearchParams({ secret: SECRET, response: token });
  const ip = visitorIp(request.headers);
  if (ip) form.set('remoteip', ip);
  let verdict: { success?: boolean; hostname?: string } = {};
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: form, signal: AbortSignal.timeout(8000),
    });
    verdict = await r.json();
  } catch {
    // Cloudflare unreachable: no pass, but never an error the visitor sees (the app does not wait on this call).
    return Response.json({ ok: false, reason: 'verify unreachable' }, { status: 502 });
  }
  if (!verdict.success) return Response.json({ ok: false }, { status: 403 });
  const pass = await mintHumanPass(Date.now() / 1000, SECRET);
  return Response.json({ ok: true }, {
    headers: {
      'set-cookie': `${HUMAN_COOKIE}=${pass}; Path=/; Max-Age=${HUMAN_PASS_SECONDS}; HttpOnly; Secure; SameSite=Strict`,
      'cache-control': 'no-store',
    },
  });
}

// GET /api/human: a plain page anyone can open to see whether THIS browser holds a valid human pass (owner 2026-10-21:
// a remote-controlled test browser is, correctly, never given one, so a real person checks on their own phone). Says
// yes/no only; never shows the cookie.
export async function GET(request: Request): Promise<Response> {
  const ok = !!SECRET && await humanPassValid(readCookie(request.headers.get('cookie'), HUMAN_COOKIE), Date.now() / 1000, SECRET);
  const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Ezhalah human check</title><body style="font:20px/1.5 system-ui;text-align:center;padding:40px 16px">'
    + (ok ? '<div style="font-size:64px">✅</div><b>Cloudflare: real person</b><br>إزهله يشوفك شخص حقيقي'
          : '<div style="font-size:64px">⏳</div><b>No pass yet</b><br>Open ezhalah.com, wait 10 seconds, then open this page again.'
            + '<br>افتح إزهله وانتظر ١٠ ثواني ثم افتح هذه الصفحة مرة ثانية')
    + '</body>';
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
