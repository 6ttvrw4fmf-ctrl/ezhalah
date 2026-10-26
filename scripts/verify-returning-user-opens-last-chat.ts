// «Show the last thing he did» (owner 2026-10-26): a signed-in user who comes back lands in the chat they had
// open last. EXECUTES src/lib/lastChat.ts against stub storages: once per tab, only in the first seconds of the
// tab's first home view, only a chat still in the history, per account; and the home page + store are wired to it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rememberLastChat, takeLastChatToResume, markFirstHomeView, RESUME_WINDOW_MS } from '../src/lib/lastChat.ts';

const root = join(import.meta.dirname, '..');
let fail = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`  PASS  ${label}`); return; }
  fail++;
  console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };

console.log('\nA returning signed-in user opens the chat they had open last\n');
const T0 = 1_000_000;
{
  const local = mem(), tab = mem();
  rememberLastChat('a@b.c', 'h1', local);
  markFirstHomeView(T0, tab);
  check('first home view, chat still in history → reopen it', takeLastChatToResume('a@b.c', ['h0', 'h1'], T0 + 800, local, tab) === 'h1');
  check('…only once per tab (pressing home later stays home)', takeLastChatToResume('a@b.c', ['h0', 'h1'], T0 + 900, local, tab) === null);
}
{
  const local = mem(), tab = mem();
  rememberLastChat('a@b.c', 'h1', local);
  markFirstHomeView(T0, tab);
  check('history that loads after the window → no jump', takeLastChatToResume('a@b.c', ['h1'], T0 + RESUME_WINDOW_MS + 1, local, tab) === null);
  markFirstHomeView(T0 + 60_000, tab);
  check('a later home view in the same tab does not restart the window', takeLastChatToResume('a@b.c', ['h1'], T0 + 60_500, local, tab) === null);
}
{
  const local = mem(), tab = mem();
  markFirstHomeView(T0, tab);
  rememberLastChat('a@b.c', 'gone', local);
  check('a chat deleted since → home, no jump', takeLastChatToResume('a@b.c', ['h1'], T0 + 100, local, tab) === null);
  rememberLastChat('x@y.z', 'h1', local);
  check('another account\'s chat is never opened', takeLastChatToResume('a@b.c', ['h1'], T0 + 100, local, tab) === null);
  check('a guest → never', takeLastChatToResume(null, ['h1'], T0 + 100, local, tab) === null);
  check('no first-home stamp → never', takeLastChatToResume('x@y.z', ['h1'], T0 + 100, local, mem()) === null);
  check('no storage at all → never, never a throw', takeLastChatToResume('a@b.c', ['h1'], T0, null, null) === null);
}
const store = readFileSync(join(root, 'src/store.tsx'), 'utf8');
const home = readFileSync(join(root, 'src/app/index.tsx'), 'utf8');
check('the store remembers every chat the user opens', /useEffect\(\(\) => \{ if \(activeChatId\) rememberLastChat\(user\?\.sub, activeChatId\); \}, \[activeChatId, user\?\.sub\]\);/.test(store));
check('the home page stamps its first view and reopens through the sidebar\'s own open path',
  /useEffect\(\(\) => \{ markFirstHomeView\(\); \}, \[\]\);/.test(home)
  && /const id = takeLastChatToResume\(user\.sub, history\.map\(\(h\) => h\.id\)\);/.test(home)
  && /router\.push\(\{ pathname: '\/agent', params: \{ filter: JSON\.stringify\(c\.query\), replay: '0', hid: c\.id \} \}\);/.test(home));

if (fail) { console.error(`\n❌ ${fail} check(s) failed`); process.exit(1); }
console.log('\n✅ returning-user-opens-last-chat: once per tab, first seconds only, own account, still in history');
