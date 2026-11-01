// verify-signed-in-never-sees-signin — a signed-in user never sees «تسجيل الدخول», not even for a moment
// (owner 2026-10-18: «whenever I open Ezhalah logged in, the sign up / log in button shows then goes away —
// this should never happen for a logged-in user»).
//
// During the Supabase session restore `user` is null, so any signed-out-only UI gated on `!user` alone is
// drawn for every signed-in visitor until the restore lands — and in the static export's HTML. Each such
// surface must ALSO wait for `authChecked` (store.tsx), the way SignInCard already does.
import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const home = read('src/app/index.tsx');
const agent = read('src/app/agent.tsx');
const sidebar = read('src/components/Sidebar.tsx');

const topGate = (src: string) => /\{authChecked && !user && !docked && \(/.test(src) && !/\{!user && !docked && \(/.test(src);
const sideGate = (src: string) => /\) : !authChecked \? null : \(\s*\/\/[^\n]*Guest sidebar/.test(src);

check('Home: the top «تسجيل الدخول» waits for the session check', topGate(home));
check('AI screen: the top «تسجيل الدخول» waits for the session check', topGate(agent));
check('Side menu: the guest section (with its sign-up button) waits for the session check', sideGate(sidebar));
check('…and both screens actually read authChecked from the store',
  /const \{[^}]*\bauthChecked\b[^}]*\} = useApp\(\)/.test(home) && /const \{[^}]*\bauthChecked\b[^}]*\} = useApp\(\)/.test(agent)
  && /const \{[^}]*\bauthChecked\b[^}]*\} = useApp\(\)/.test(sidebar));

mustCatch('the Home button gated on !user alone (the flash)', !topGate(home.replace('{authChecked && !user && !docked && (', '{!user && !docked && (')));
mustCatch('the AI-screen button gated on !user alone', !topGate(agent.replace('{authChecked && !user && !docked && (', '{!user && !docked && (')));
mustCatch('a side menu that draws the guest section during the restore', !sideGate(sidebar.replace(') : !authChecked ? null : (', ') : (')));

if (failed) { console.error(`\n❌ verify-signed-in-never-sees-signin: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-signed-in-never-sees-signin: no sign-in button is drawn before the session is known.');
