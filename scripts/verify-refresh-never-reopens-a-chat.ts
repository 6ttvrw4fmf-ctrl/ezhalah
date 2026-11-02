// A REFRESH ALWAYS LANDS ON THE FILTER HOME, LOGGED IN OR NOT — NEVER BACK IN THE LAST CHAT (owner 2026-10-26:
// «whenever I refresh and I am logged in, not logged, take me to the home page … the filter, always, not in the
// last chat»). Replaces verify-returning-user-opens-last-chat.ts: the «reopen last chat» resume (PR 8778) bounced a
// refreshed, signed-in user straight back into their chat after the 2026-08-16 rule had sent them home.
//
// Two halves, both executed or read from the real sources:
//   1. the home-bound decision itself (src/lib/webRefreshRoute.ts) still sends a refreshed chat page home;
//   2. nothing in src/ remembers a «last chat» for a later visit, and the home page never navigates into a saved
//      chat by itself — the only way into a saved chat is the user tapping it.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { shouldSendRefreshHome } from '../src/lib/webRefreshRoute.ts';

const root = join(import.meta.dirname, '..');
let fail = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`  PASS  ${label}`); return; }
  fail++;
  console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const walk = (d: string, out: Record<string, string> = {}): Record<string, string> => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out[p.replace(/\\/g, '/').replace(`${root.replace(/\\/g, '/')}/`, '')] = readFileSync(p, 'utf8');
  }
  return out;
};
const src = walk(join(root, 'src'));
const code = (t: string) => t.split('\n').filter((l) => !/^\s*(\/\/|\*|\{\/\*)/.test(l)).join('\n');

console.log('\nA refresh always lands on the Filter home — never back in the last chat\n');

// ── 1. the home-bound decision ───────────────────────────────────────────────────────────────────────────
check('a refreshed chat page (/agent) is sent home', shouldSendRefreshHome('/agent', '') === true);
check('…even with a saved-chat id in the address', shouldSendRefreshHome('/agent', '?hid=h123&replay=0') === true);
check('…and with a search in the address', shouldSendRefreshHome('/agent', '?filter=%7B%7D') === true);
check('the home page itself is left alone', shouldSendRefreshHome('/', '') === false);
check('a sign-in landing (/auth) is left alone so it can finish', shouldSendRefreshHome('/auth', '') === false);
const layout = readFileSync(join(root, 'src/app/_layout.tsx'), 'utf8');
const layoutOk = (t: string) => /if \(shouldSendRefreshHome\(pathname, search\)\) router\.replace\('\/'\);/.test(code(t));
check('the root layout applies that decision on load', layoutOk(layout));

// ── 2. nothing remembers or reopens a chat ───────────────────────────────────────────────────────────────
// A remembered chat is a stored key naming a last / active / resumed chat, or the active chat id written to storage.
const remembers = (t: string) => (/['"`][^'"`\n]*(last[_-]?chat|chat[_-]?resume|resume[_-]?chat)[^'"`\n]*['"`]/i.test(t)
  && /(localStorage|sessionStorage|AsyncStorage)/.test(t))
  || /setItem\([^)]*activeChatId/.test(t);
const rememberers = Object.entries(src).filter(([, t]) => remembers(code(t))).map(([f]) => f);
check('no file stores a «last chat» for a later visit', rememberers.length === 0, rememberers.join(', '));
const importers = Object.entries(src).filter(([, t]) => /from '@\/lib\/lastChat'/.test(t)).map(([f]) => f);
check('the removed resume helper is imported nowhere', importers.length === 0, importers.join(', '));
check('the removed resume helper is gone', !('src/lib/lastChat.ts' in src));

// The home page may open a chat only from an explicit action (a shared link, a tap) — never from a mount effect
// that walks the user's own history.
const home = src['src/app/index.tsx'] ?? '';
const effects = (t: string) => code(t).split(/useEffect\(/).slice(1).map((b) => b.slice(0, b.indexOf('}, [') + 1 || undefined));
const homeReopens = (t: string) => effects(t).some((b) => /\bhistory\b/.test(b) && /pathname: '\/agent'/.test(b) && !/share/i.test(b));
check('no home-page effect walks the history into a saved chat', !homeReopens(home));
const store = src['src/store.tsx'] ?? '';
const storeRemembers = (t: string) => /useEffect\([^;]*activeChatId[^;]*(setItem|remember)/.test(code(t));
check('the store does not persist the open chat', !storeRemembers(store));

// ── mutation proofs: each guard must fail on its own defect ──────────────────────────────────────────────
mustCatch('the layout no longer sending a refresh home', !layoutOk(layout.replace("router.replace('/');", 'void 0;')));
mustCatch('a «last chat» key written to storage',
  remembers("localStorage.setItem('ez:lastChat:v1:' + sub, id)"));
mustCatch('the open chat id written to storage', remembers('localStorage.setItem(KEY, activeChatId)'));
mustCatch('a home effect that reopens the last chat from history', homeReopens(
  "useEffect(() => {\n  const c = history.find((h) => h.id === saved);\n  router.push({ pathname: '/agent', params: { hid: c.id } });\n}, [history.length]);"));
mustCatch('the store remembering the open chat', storeRemembers('useEffect(() => { if (activeChatId) rememberLastChat(user?.sub, activeChatId); }, [activeChatId]);'));
mustCatch('a shared link NOT being mistaken for a reopen (the guard is not over-broad)',
  !homeReopens("useEffect(() => {\n  const share = readShare(); if (share) router.push({ pathname: '/agent', params: { hid: history[0]?.id } });\n}, [history.length]);"));

if (fail) { console.error(`\n❌ ${fail} check(s) failed`); process.exit(1); }
console.log('\n✅ refresh-never-reopens-a-chat: a refresh lands on the Filter home; nothing reopens the last chat');
