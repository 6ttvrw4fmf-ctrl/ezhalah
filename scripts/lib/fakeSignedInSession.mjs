// A SIGNED-IN VISITOR WHO DOES NOT EXIST — so a robot can test what only a logged-in person sees (saved chats, the
// history sidebar, the chat sync) without a real account and without touching a real saved chat.
//
// Sign-in here is Google or Apple only, so no robot can log in for real. The app only checks two things at start-up:
// a Supabase session in the browser's storage, and (later) the server. So the robot gives the page a session that never
// expires, answers the auth endpoints itself, and answers the `user_chats` table (the saved-chat store) from an
// in-memory Map — it saves, lists and fetches exactly like the server. Every OTHER database call (the real searches)
// goes through to the real database, but with the public key instead of the fake token (the real database refuses a
// token it did not sign). Nothing here can read or write a real account, a real chat, or anything of a real person.
//
// Used by scripts/verify-web-chat-typing-smooth.mjs. `ctx` is a Playwright BrowserContext, `page` one of its pages.
export const SUPABASE_REF = 'aannarbkwcymrotzwdbo';
export const FAKE_EMAIL = 'robot@example.test'; // the app keys a person's saved chats by their email: `history:<email>`
export const fakeHistoryKey = () => `history:${FAKE_EMAIL}`;

export async function installFakeSignedIn(ctx, page) {
  const now = Math.floor(Date.now() / 1000), YEAR = 31536000;
  const user = {
    id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: FAKE_EMAIL,
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: 'روبوت الاختبار', name: 'روبوت الاختبار', name_prompt_seen: true },
    created_at: '2026-01-01T00:00:00Z', last_sign_in_at: '2026-10-01T00:00:00Z',
  };
  const token = 'fake.' + Buffer.from(JSON.stringify({ exp: now + YEAR, sub: user.id, role: 'authenticated' })).toString('base64url') + '.sig';
  const session = { access_token: token, refresh_token: 'fake-refresh', token_type: 'bearer', expires_in: YEAR, expires_at: now + YEAR, user };
  await ctx.addInitScript(([key, val]) => { try { if (!localStorage.getItem(key)) localStorage.setItem(key, val); } catch { /* storage blocked: the robot will notice nobody is signed in */ } },
    [`sb-${SUPABASE_REF}-auth-token`, JSON.stringify(session)]);

  const server = new Map(); // the fake `user_chats` table: id → { id, meta, transcript, updated_at }
  const log = { calls: [], errors: [] };
  await page.route(/\/auth\/v1\//, (r) => {
    const u = r.request().url();
    if (/\/user/.test(u)) return r.fulfill({ json: user });
    if (/token/.test(u)) return r.fulfill({ json: session });
    return r.fulfill({ json: {} });
  });
  await page.route(/\/rest\/v1\/user_chats/, async (r) => {
    const req = r.request(), method = req.method(), url = req.url();
    if (method === 'GET') {
      const wantsTranscript = /select=transcript/.test(url);
      log.calls.push(`GET ${wantsTranscript ? 'transcript' : 'list'}`);
      if (wantsTranscript) {
        const id = decodeURIComponent((url.match(/id=eq\.([^&]+)/) || [])[1] || '');
        const row = server.get(id);
        return r.fulfill({ status: row ? 200 : 406, json: row ? { transcript: row.transcript } : {} });
      }
      return r.fulfill({ json: [...server.values()].map((x) => ({ id: x.id, meta: x.meta, updated_at: x.updated_at })) });
    }
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const rows = Array.isArray(body) ? body : [body];
      log.calls.push('POST ' + rows.map((x) => `${x.id}:${Math.round(JSON.stringify(x).length / 1024)}KB`).join(','));
      for (const row of rows) server.set(row.id, { ...server.get(row.id), ...row, updated_at: new Date().toISOString() });
      return r.fulfill({ status: 201, body: '' });
    }
    if (method === 'DELETE') { log.calls.push('DELETE'); server.clear(); return r.fulfill({ status: 204, body: '' }); }
    return r.fulfill({ json: [] });
  });
  await page.route(/\/(rest|rpc)\/v1\/(?!user_chats)/, (r) => {
    const h = { ...r.request().headers() };
    if (h.apikey) h.authorization = 'Bearer ' + h.apikey; // the public key, never the fake token
    return r.continue({ headers: h });
  });
  page.on('pageerror', (e) => log.errors.push(String(e).slice(0, 160)));
  return { user, server, log };
}
