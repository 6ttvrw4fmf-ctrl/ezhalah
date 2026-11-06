// A SIGNED-IN REOPEN SHOWS A FACT AT ONCE (owner 2026-11-01: «whenever I close Ezhalah while I'm signed in and then I open
// it, I don't see any text … then a random [line] says my name and that we have small places … I wanted it to always show
// this fact»). After a fact's 2 hours the hook asked the server while the headline stayed hidden; a reopened iPhone (session
// refresh first) often missed the 2.5 s wait, and the plain «even small cities…» line showed. Today's pack is now kept on the
// device and a new fact is chosen from it synchronously, at mount.
//
// EXECUTED: readPack/writePack/sameRiyadhDay are lifted from the real sources and run against a stub localStorage; the
// wiring (pack picked at mount, the headline settles at once — owner 2026-11-06 «never pop up late» — every read stores
// the pack, today's last fact beats the plain line) is checked
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
    { header: 'export const RECENT_PACK_MS =', endsWith: /;$/ },
    { header: 'export const readRecentPack =' },
  ], ['PACK_KEY', 'readPack', 'writePack', 'RECENT_PACK_MS', 'readRecentPack'], prelude) as Promise<any>;
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

// the first open of a new day: a pack from the last 36 h is a fallback (owner 2026-11-06 never late + facts always)
const recent = async (s: string) => {
  const m = await lift(s);
  m.writePack(PACK, NOON - 20 * 3600_000);                 // read yesterday afternoon
  const yday = m.readPack(NOON) === null && !!m.readRecentPack(NOON);
  m.writePack(PACK, NOON - 40 * 3600_000);                 // two days ago
  const old = m.readRecentPack(NOON) === null;
  m.writePack(PACK, NOON + 3600_000);                      // a clock in the future
  const future = m.readRecentPack(NOON) === null;
  return yday && old && future;
};
check('a pack from the last 36 h is the first-open fallback (never today\'s readPack, never older, never from the future)', await recent(src));
mustCatch('the 36 h limit dropped (any old pack)', !(await recent(src.replace('now - Number(v.at) <= RECENT_PACK_MS && ', ''))));

// wiring
const wired = (s: string) => {
  const mount = s.indexOf('let inst = greet ?');
  const pick = s.indexOf('readPack(now.getTime())', mount);
  const settle = s.indexOf('setShown(inst ? { settled: true', mount);
  return mount > 0 && pick > mount && settle > pick && !s.includes('const slow = new Promise<null>')
    && s.includes('(readPack(now.getTime()) ?? readRecentPack(now.getTime()))')
    && /if \(c0 && seen0\) \{\s*writeSeen\(\{ \.\.\.seen0, \[c0\.key\]: now\.getTime\(\) \}\);\s*inst = \{ id: INSIGHT_ID_BASE \+ c0\.templateId/.test(s)
    && (s.match(/fetchWelcomeInsights\(/g) ?? []).length === 1 && s.includes('fetchWelcomeInsights(city, district).then((pack) => { if (pack) writePack(pack, Date.now()); return pack; })')
    && s.includes('const pack = readPack(start) ?? await fetchPack(lastLocation, lastDistrict);')
    && s.includes('if (today) inst = { id: today.id, ar: today.ar, en: today.en, fromCache: true, promoted: false };');
};
check('the stored pack is picked at mount and the headline settles right after (no hidden wait), every read stores the pack, the sign-in fact uses it, today\'s last fact beats the plain line', wired(src));
mustCatch('no instant pick (back to the hidden wait every reopen)', !wired(src.replace('if (c0 && seen0) {', 'if (false) {')));
mustCatch('no yesterday fallback at mount (the first open of a day shows the plain line)', !wired(src.replace('(readPack(now.getTime()) ?? readRecentPack(now.getTime()))', 'readPack(now.getTime())')));
mustCatch('a read that bypasses the stash', !wired(src.replace('fetchPack(lastLocation, lastDistrict).then((pack) => {\n        if (!live || !pack) return;', 'fetchWelcomeInsights(lastLocation, lastDistrict).then((pack) => {\n        if (!live || !pack) return;')));
mustCatch('the sign-in fact back to network only', !wired(src.replace('readPack(start) ?? await fetchPack', 'await fetchPack')));
mustCatch('today\'s last fact dropped (back to the plain line)', !wired(src.replace('if (today) inst = {', 'if (false) inst = {')));

if (failed) { console.error(`\n❌ verify-welcome-fact-is-instant-on-reopen: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-welcome-fact-is-instant-on-reopen: a signed-in reopen picks today\'s fact on the spot.');
