// THE TAB ICON LIGHTS UP WHILE SIGNED IN (owner 2026-10-27: «can u do that swap»; «use the one we have with clouds»).
// EXECUTES the real applyTabIcon() from src/lib/litTabIcon.ts against fake <link rel="icon"> elements: signing in
// points every icon link at the lit cloud eagle, signing out restores exactly what the page declared, and the
// home-screen icon is never touched. Also: the lit files exist, are opaque, and the layout really calls the hook.
//   node --experimental-strip-types scripts/verify-lit-tab-icon.ts   (discovered by `npm test`)
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { liftSymbols } from './lib/liftSymbols.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const MOD = 'src/lib/litTabIcon.ts';
const SRC = readFileSync(join(root, MOD), 'utf8');
type Lib = { applyTabIcon: (links: any[], signedIn: boolean) => void; LIT_ICON_32: string; LIT_ICON_192: string };
const lift = async (code: string): Promise<Lib> => {
  const tmp = join(mkdtempSync(join(tmpdir(), 'ezh-lit-')), 'litTabIcon.ts');
  writeFileSync(tmp, code);
  return liftSymbols(tmp, [
    { header: 'export const LIT_ICON_32', endsWith: /;$/ },
    { header: 'export const LIT_ICON_192', endsWith: /;$/ },
    { header: 'const ORIGINAL', endsWith: /;$/ },
    { header: 'export function litHrefFor(' },
    { header: 'export function applyTabIcon(' },
  ], ['applyTabIcon', 'LIT_ICON_32', 'LIT_ICON_192'], 'type IconLink = any;\n') as Promise<Lib>;
};
// the page's declared icons, as +html.tsx declares them
const page = () => [
  { sizes: 'any', href: '/favicon.ico?v=6' }, { sizes: '32x32', href: '/icon-32.png?v=6' }, { sizes: '192x192', href: '/icon-192.png?v=6' },
].map(({ sizes, href }) => { const a: Record<string, string> = { sizes, href };
  return { a, getAttribute: (n: string) => (n in a ? a[n] : null), setAttribute: (n: string, v: string) => { a[n] = v; } }; });
const run = async (code: string, steps: boolean[]) => { const L = await lift(code); const links = page();
  const seen = steps.map((on) => { L.applyTabIcon(links, on); return links.map((l) => l.a.href); }); return { L, seen }; };

const DECLARED = ['/favicon.ico?v=6', '/icon-32.png?v=6', '/icon-192.png?v=6'];
const r = await run(SRC, [true, false, true, false]);
check('signed in → every tab icon is the lit cloud eagle (192 link gets the 192 picture)',
  JSON.stringify(r.seen[0]) === JSON.stringify([r.L.LIT_ICON_32, r.L.LIT_ICON_32, r.L.LIT_ICON_192]), JSON.stringify(r.seen[0]));
check('signed out → exactly the icons the page declared, back', JSON.stringify(r.seen[1]) === JSON.stringify(DECLARED), JSON.stringify(r.seen[1]));
check('in and out again → still exact (the declared href is remembered, never the lit one)',
  JSON.stringify(r.seen[2]) === JSON.stringify(r.seen[0]) && JSON.stringify(r.seen[3]) === JSON.stringify(DECLARED));
check('the lit icons carry their own ?v= token (an icon store is keyed by URL)', /\?v=\d+$/.test(r.L.LIT_ICON_32) && /\?v=\d+$/.test(r.L.LIT_ICON_192));
const opaque = (f: string) => { if (!existsSync(join(root, f))) return false; const b = readFileSync(join(root, f)); return b.subarray(1, 4).toString() === 'PNG' && b[25] === 2; };
check('the lit files exist and are opaque PNGs', opaque('public/icon-32-lit.png') && opaque('public/icon-192-lit.png'));
const layout = readFileSync(join(root, 'src/app/_layout.tsx'), 'utf8');
const wired = (l: string) => /const \{ user: tabUser, authChecked: tabAuthChecked \} = useApp\(\);\s*useLitTabIcon\(!!tabUser, tabAuthChecked\);/.test(l) && /import \{ useLitTabIcon \} from '@\/lib\/litTabIcon';/.test(l);
check('the layout lights the tab from the real signed-in user', wired(layout));
const homeScreen = (code: string) => /querySelectorAll\('link\[rel="icon"\]'\)/.test(code) && !/apple-touch-icon/.test(code.replace(/\/\/.*$/gm, ''));
check('only rel="icon" links change — the home-screen icon (apple-touch-icon) keeps the regular one', homeScreen(SRC));

mustCatch('signing out that never restores (stuck lit)',
  JSON.stringify((await run(SRC.replace("signedIn ? litHrefFor(el.getAttribute('sizes')) : declared", 'litHrefFor(el.getAttribute(\'sizes\'))'), [true, false])).seen[1]) !== JSON.stringify(DECLARED));
mustCatch('a restore that forgets the declared href (lit icon «remembered» as the original)',
  JSON.stringify((await run(SRC.replace('if (el.getAttribute(ORIGINAL) == null) el.setAttribute(ORIGINAL, declared);', 'el.setAttribute(ORIGINAL, el.getAttribute(\'href\')!);'), [true, true, false])).seen[2]) !== JSON.stringify(DECLARED));
mustCatch('the 192 link given the blurry 32 picture', (await run(SRC.replace("sizes === '192x192' ? LIT_ICON_192 : LIT_ICON_32", 'LIT_ICON_32'), [true])).seen[0][2] !== '/icon-192-lit.png?v=1');
mustCatch('the hook no longer wired to the user', !wired(layout.replace('useLitTabIcon(!!tabUser, tabAuthChecked);', 'useLitTabIcon(false, tabAuthChecked);')));
mustCatch('the home-screen icon swapped too', !homeScreen(SRC.replace(`'link[rel="icon"]'`, `'link[rel="icon"], link[rel="apple-touch-icon"]'`)));

// ── the fade (owner 2026-10-27: «let it feel smooth») — EXECUTED ─────────────────────────────────────────────
type Fade = { fadeAlphas: (n?: number) => number[]; shouldFade: (settled: boolean, reduced: boolean) => boolean; FADE_MS: number; FADE_FRAMES: number };
const liftFade = async (code: string): Promise<Fade> => {
  const tmp = join(mkdtempSync(join(tmpdir(), 'ezh-fade-')), 'litTabIcon.ts');
  writeFileSync(tmp, code);
  return liftSymbols(tmp, [
    { header: 'export const FADE_MS', endsWith: /;$/ }, { header: 'export const FADE_FRAMES', endsWith: /;$/ },
    { header: 'export function fadeAlphas(' }, { header: 'export function shouldFade(' },
  ], ['fadeAlphas', 'shouldFade', 'FADE_MS', 'FADE_FRAMES'], '') as Promise<Fade>;
};
const eased = (F: Fade) => { const a = F.fadeAlphas(); const lin = a.map((_, i) => (i + 1) / (a.length + 1));
  return a.length === F.FADE_FRAMES && a.length >= 8 && a.every((v, i) => v > 0 && v < 1 && (i === 0 || v > a[i - 1]))
    && a[0] < lin[0] && a[a.length - 1] > lin[lin.length - 1]; };
const F = await liftFade(SRC);
check('the sign-in fade has enough in-between frames, rising smoothly and eased in and out', eased(F), JSON.stringify(F.fadeAlphas().map((v) => +v.toFixed(2))));
check('…over about half a second (smooth, never sluggish)', F.FADE_MS >= 300 && F.FADE_MS <= 900, `${F.FADE_MS} ms`);
const rules = (G: Fade) => G.shouldFade(true, false) && !G.shouldFade(false, false) && !G.shouldFade(true, true);
check('only a REAL sign-in/out fades — never the session restore on a refresh, never under reduced motion', rules(F));
const asks = (code: string) => /typeof document === 'undefined' \|\| !authChecked\) return;/.test(code) && /const fade = shouldFade\(settled\.current, reduced\);/.test(code);
check('the hook waits for the session to be known and asks shouldFade before drawing', asks(SRC));
mustCatch('a linear (unsmoothed) fade', !eased(await liftFade(SRC.replace('return t * t * (3 - 2 * t);', 'return t;'))));
mustCatch('the fade playing on every refresh (restore treated as a sign-in)', !rules(await liftFade(SRC.replace('return settledBefore && !reduced;', 'return !reduced;'))));
mustCatch('the fade playing under reduced motion', !rules(await liftFade(SRC.replace('return settledBefore && !reduced;', 'return settledBefore;'))));
mustCatch('the hook fading before the session is known', !asks(SRC.replace(" || !authChecked) return;", ') return;')));

if (failed) { console.error(`\n❌ verify-lit-tab-icon: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-lit-tab-icon: the tab lights up while signed in and goes back exactly when signed out.');
