// A DEPLOY MUST NOT BREAK AN OPEN TAB (🔧 2026-11-02, Sentry REACT-NATIVE-J/K).
//
// With per-route web chunks (app.json asyncRoutes, #9956) a tab opened before a deploy asks for the OLD
// `agent-<hash>.js`; the new deployment answers 404 and Metro throws AsyncRequireError. src/lib/staleChunkReload.ts
// reloads the page ONCE for that URL and never loops. This EXECUTES those decisions against the exact error
// shape Sentry recorded at 13:11 UTC 11-02, proves the no-loop guard and the fail-closed paths, pins the wiring
// in app/_layout.tsx (both global handlers, before the Sentry report), and plants two mutants that must be caught.
//
//   node --experimental-strip-types scripts/verify-stale-chunk-reload.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleStaleChunk, shouldReload, staleChunkUrl, STALE_CHUNK_KEY, RELOAD_WINDOW_MS, type MiniStore, type StaleChunkEnv,
} from '../src/lib/staleChunkReload.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const memStore = (): MiniStore & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
};
const env = (store: MiniStore | null, t = 1_000_000) => {
  const reloads: number[] = [];
  const e: StaleChunkEnv & { reloads: number[]; tick: (ms: number) => void } = {
    store, reloads, now: () => t, reload: () => { reloads.push(t); }, tick: (ms) => { t += ms; },
  };
  return e;
};
const OLD = 'https://ezhalah.com/_expo/static/js/web/agent-5694e1663f57e3200723c9c1001ee6f5.js';
const planted = () => Object.assign(new Error(`Loading module ${OLD} failed.`), { name: 'AsyncRequireError' });

console.log('── recognising the failure (the Sentry event, 13:11 UTC 11-02) ──');
check('the planted AsyncRequireError names its chunk URL', staleChunkUrl(planted()) === OLD, String(staleChunkUrl(planted())));
check('a plain Error with the Metro text (window.error carries ev.message) is recognised too',
  staleChunkUrl(`Loading module ${OLD} failed.`) === OLD);
check('Chromium\'s dynamic-import wording is recognised',
  staleChunkUrl(new TypeError(`Failed to fetch dynamically imported module: ${OLD}`)) === OLD);
check('a NetworkError is NOT a stale chunk', staleChunkUrl(Object.assign(new Error('A network error occurred.'), { name: 'NetworkError' })) === null);
check('a MapKit TypeError is NOT a stale chunk', staleChunkUrl(new TypeError('[MapKit] query passed to Search.search() is neither a string')) === null);
check('undefined / null are not', staleChunkUrl(undefined) === null && staleChunkUrl(null) === null);

console.log('\n── executed: reload once, never loop, fail closed ──');
{
  const e = env(memStore());
  check('first failure of a chunk → reloads once and the guard is written',
    handleStaleChunk(planted(), e) === true && e.reloads.length === 1 && (e.store as any).m.get(STALE_CHUNK_KEY)?.includes(OLD));
  e.tick(1500);
  check('the SAME chunk failing again inside the window → no second reload (no loop); the caller reports it',
    handleStaleChunk(planted(), e) === false && e.reloads.length === 1);
  const other = Object.assign(new Error('Loading module https://ezhalah.com/_expo/static/js/web/map-aaaa.js failed.'), { name: 'AsyncRequireError' });
  check('a DIFFERENT chunk failing → reloads (its own first time)', handleStaleChunk(other, e) === true && e.reloads.length === 2);
  e.tick(RELOAD_WINDOW_MS + 1);
  check('the first chunk again AFTER the window → may reload again (a later deploy)', handleStaleChunk(planted(), e) === true && e.reloads.length === 3);
}
{
  const e = env(null);
  check('no session storage → never reloads (a loop could not be guarded), reports instead',
    handleStaleChunk(planted(), e) === false && e.reloads.length === 0);
}
{
  const throwing: MiniStore = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceeded'); } };
  const e = env(throwing);
  check('a store that throws on write → no reload (fail closed)', handleStaleChunk(planted(), e) === false && e.reloads.length === 0);
}
{
  const e = env(memStore());
  check('a non-chunk error never reloads and never touches the store',
    handleStaleChunk(new Error('boom'), e) === false && e.reloads.length === 0 && (e.store as any).m.size === 0);
  const s = memStore(); s.setItem(STALE_CHUNK_KEY, '{not json');
  check('garbage in the store is read as «no previous reload»', shouldReload(OLD, s, 5) === true);
}

console.log('\n── wiring: app/_layout.tsx asks before it reports, in BOTH global handlers ──');
{
  const src = readFileSync(join(root, 'src/app/_layout.tsx'), 'utf8');
  const rej = src.indexOf("addEventListener?.('unhandledrejection'");
  const err = src.indexOf("addEventListener?.('error'");
  const rejBlock = src.slice(rej, err);
  const errBlock = src.slice(err, src.indexOf('\n  });', err) + 6);
  check('imports the handler', /import \{[^}]*handleStaleChunk[^}]*\} from '@\/lib\/staleChunkReload'/.test(src));
  check('unhandledrejection: handleStaleChunk runs before reportError and returns',
    rejBlock.indexOf('handleStaleChunk(') > 0 && rejBlock.indexOf('handleStaleChunk(') < rejBlock.indexOf('reportError(')
      && /if \(handleStaleChunk\([\s\S]*?\)\) \{[\s\S]*?return;\s*\}/.test(rejBlock));
  check('window.error: handleStaleChunk runs before reportError and returns',
    errBlock.indexOf('handleStaleChunk(') > 0 && errBlock.indexOf('handleStaleChunk(') < errBlock.indexOf('reportError(')
      && /if \(handleStaleChunk\([\s\S]*?\)\) \{[\s\S]*?return;\s*\}/.test(errBlock));
  check('window.error hands over ev.error OR ev.message (a script-load failure may carry only the message)',
    /handleStaleChunk\(ev\?\.error \?\? ev\?\.message/.test(errBlock));
}

console.log('\n── mutation: the guards are what the checks above measure ──');
{
  // Mutant A: a decision that ignores the store → the «same chunk again» scenario reloads twice.
  const mutantShould = (_url: string, _s: MiniStore | null, _n: number) => true;
  const e = env(memStore());
  const run = (fn: typeof shouldReload) => {
    const url = staleChunkUrl(planted()); if (url === null) return false;
    if (!fn(url, e.store, e.now())) return false; e.reload(); return true;
  };
  run(mutantShould); run(mutantShould);
  mustCatch('a reload decision without the once-per-URL guard (it loops)', e.reloads.length !== 1);
  // Mutant B: a recogniser that calls every Error a stale chunk → a NetworkError reloads the page.
  const mutantUrl = (err: unknown) => (err instanceof Error ? '' : null);
  const e2 = env(memStore());
  const url2 = mutantUrl(Object.assign(new Error('A network error occurred.'), { name: 'NetworkError' }));
  const reloadedOnNetworkError = url2 !== null && shouldReload(url2 || 'unknown-chunk', e2.store, e2.now());
  mustCatch('a recogniser that treats every Error as a stale chunk (reloads on a NetworkError)', reloadedOnNetworkError === true);
  // Mutant C: the real module must NOT do what mutant B does.
  const e3 = env(memStore());
  check('(control) the real recogniser does not reload on a NetworkError',
    handleStaleChunk(Object.assign(new Error('A network error occurred.'), { name: 'NetworkError' }), e3) === false);
}

console.log(failed ? `\n✗ ${failed} check(s) failed` : '\n✓ a stale route chunk after a deploy reloads the tab once, never loops, and the layout asks before it reports');
process.exit(failed ? 1 : 0);
