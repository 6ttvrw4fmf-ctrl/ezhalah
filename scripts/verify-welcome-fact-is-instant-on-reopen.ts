// A SIGNED-IN REOPEN SHOWS A FACT AT ONCE (owner 2026-11-01: «whenever I close Ezhalah while I'm signed in and then I open
// it, I don't see any text … then a random [line] says my name and that we have small places … I wanted it to always show
// this fact»). After a fact's 2 hours the hook asked the server while the headline stayed hidden; a reopened iPhone (session
// refresh first) often missed the 2.5 s wait, and the plain «even small cities…» line showed. Today's pack is now kept on the
// device and a new fact is chosen from it synchronously, at mount.
//
// EXECUTED: readPack/writePack/sameRiyadhDay are lifted from the real sources and run against a stub localStorage; the
// wiring (pack picked BEFORE the hidden wait, every read stores the pack, a slow read falls back to today's fact) is checked
// on the hook's source with a mutation for each piece.
import { readFileSync } from 'node:fs';
import { liftSymbols } from './lib/liftSymbols.ts';

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++; };
const mustCatch = (name: string, caught: boolean) => { console.log(`${caught ? '✓' : '✗'} mutation caught: ${name}`); if (!caught) failed++; };

const HOOK = 'src/lib/useFilterWelcome.ts';
const src = readFileSync(new URL(`../${HOOK}`, import.meta.url), 'utf8');
const fw = readFileSync(new URL('../src/lib/filterWelcome.ts', import.meta.url), 'utf8');
const line = (s: string, h: string) => s.split('\n').find((l) => l.startsWith(h)) ?? '';
const prelude = [
  line(fw, 'export const riyadhDay =').replace(/^export /, ''),
  line(fw, 'export const sameRiyadhDay =').replace(/^export /, ''),
  'type InsightPack = any;',
  'const store = new Map<string, string>();',
  '(globalThis as any).localStorage = { getItem: (k: string) => store.has(k) ? store.get(k)! : null, setItem: (k: string, v: string) => { store.set(k, String(v)); }, removeItem: (k: string) => { store.delete(k); } };',
].join('\n');
const lift = async (s: string) => {
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const file = { pathname: join(mkdtempSync(join(tmpdir(), 'ezhalah-welcome-')), 'hook.ts') };
  writeFileSync(file.pathname, s);
  return liftSymbols(file.pathname, [
    { header: 'export const PACK_KEY =', endsWith: /;$/ },
    { header: 'export const readPack =' },
    { header: 'const writePack =', endsWith: /;$/ },
  ], ['PACK_KEY', 'readPack', 'writePack'], prelude) as Promise<any>;
};

const PACK = { day: '2026-11-02', templates: [{ id: 1, kind: 'k' }], insights: [{ kind: 'k' }] };
const NOON = Date.UTC(2026, 10, 2, 9, 0); // 12:00 Riyadh
const behaves = async (s: string) => {
  const m = await lift(s);
  (globalThis as any).localStorage.removeItem(m.PACK_KEY);
  const none = m.readPack(NOON) === null;
  m.writePack(PACK, NOON - 3 * 3600_000); // stored 09:00 Riyadh, same day, 3 h ago (past the 2 h hold)
  const later = m.readPack(NOON);
  const tomorrow = m.readPack(NOON + 24 * 3600_000);
  (globalThis as any).localStorage.setItem(m.PACK_KEY, '{broken');
  const broken = m.readPack(NOON);
  return none && !!later && later.insights.length === 1 && tomorrow === null && broken === null;
};
check('a pack stored earlier today is read back hours later; never tomorrow; nothing or garbage reads as none', await behaves(src));
mustCatch('the day check dropped (yesterday\'s facts as today\'s)', !(await behaves(src.replace('sameRiyadhDay(Number(v.at), now) && ', ''))));
mustCatch('a pack that is never written', !(await behaves(src.replace("globalThis.localStorage?.setItem(PACK_KEY, JSON.stringify({ at, pack }))", 'void 0'))));

// wiring
const wired = (s: string) => {
  const mount = s.indexOf('let inst = greet ?');
  const pick = s.indexOf('readPack(now.getTime())', mount);
  const wait = s.indexOf('const slow = new Promise<null>', mount);
  return mount > 0 && pick > mount && wait > pick
    && /if \(c0 && seen0\) \{\s*writeSeen\(\{ \.\.\.seen0, \[c0\.key\]: now\.getTime\(\) \}\);\s*inst = \{ id: INSIGHT_ID_BASE \+ c0\.templateId/.test(s)
    && (s.match(/fetchWelcomeInsights\(/g) ?? []).length === 1 && s.includes('fetchWelcomeInsights(city, district).then((pack) => { if (pack) writePack(pack, Date.now()); return pack; })')
    && s.includes('const pack = readPack(start) ?? await fetchPack(lastLocation, lastDistrict);')
    && s.includes(': today ? { id: today.id, at: t, ar: today.ar, en: today.en } :');
};
check('the stored pack is picked from BEFORE the hidden wait, every read stores the pack, the sign-in fact uses it, a slow read shows today\'s fact', wired(src));
mustCatch('no instant pick (back to the hidden wait every reopen)', !wired(src.replace('if (c0 && seen0) {', 'if (false) {')));
mustCatch('a read that bypasses the stash', !wired(src.replace('const fact = fetchPack(lastLocation, lastDistrict)', 'const fact = fetchWelcomeInsights(lastLocation, lastDistrict)')));
mustCatch('the sign-in fact back to network only', !wired(src.replace('readPack(start) ?? await fetchPack', 'await fetchPack')));
mustCatch('a slow read back to the plain line', !wired(src.replace(': today ? { id: today.id, at: t, ar: today.ar, en: today.en } :', ':')));

if (failed) { console.error(`\n❌ verify-welcome-fact-is-instant-on-reopen: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-welcome-fact-is-instant-on-reopen: a signed-in reopen picks today\'s fact on the spot.');
