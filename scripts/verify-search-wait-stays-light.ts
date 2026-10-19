// THE SEARCH WAIT STAYS LIGHT — three per-search round trips that competed with the query the user
// was waiting on, each removed on 2026-09-21 after measuring a live الرياض search on production.
//
//   1. withTimeout() stopped WAITING but never CANCELLED: the abandoned count kept running on the
//      database and every caller then retried once on top of it. It now aborts the request.
//   2. primeResultsFound() promised "only the very first call starts a request" but cleared its
//      in-flight slot on settle, so every render started another: ~12 calls per search.
//   3. The loader fetched loader_active_platforms_ar on every mount (0.4-3.7 s) only to SHRINK the
//      strip — which the owner reversed on 2026-09-20 ("show 59 … stays stable … even if it's dead").
//      The one exception since 2026-09-26 (a website down on its side leaves the strip) is read ONCE
//      per session from a ~2 ms registry read, never per search — see verify-loader-hides-down-sites.ts.
//
// Each is a regression that would add load back silently: correct-looking UI, slower database.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './lib/stripComments.ts';
import { windowBetween } from './lib/sourceWindow.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught, 'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');
const root = join(import.meta.dirname, '..');
const read = (f: string) => stripComments(readFileSync(join(root, f), 'utf8'));
console.log('\nThe search wait carries no avoidable round trips (2026-09-21)\n');

// 1. withTimeout aborts what it abandons
const remote = read('src/data/remote.ts');
const wt = windowBetween(remote, 'function withTimeout<T>', '\n}', 'src/data/remote.ts');
const aborts = (src: string) => /\.abortSignal\(ctrl\.signal\)/.test(src) && /setTimeout\(\(\) => \{ ctrl\?\.abort\(\);/.test(src);
check('withTimeout attaches an AbortSignal and aborts the request when it gives up', aborts(wt),
  'without it every timed-out count keeps running on the database while the caller retries on top');
mustCatch('a timer that only resolves, like the pre-2026-09-21 body', !aborts(wt.replace('ctrl?.abort(); ', '')));

// 2. primeResultsFound runs once per session on success, and retries after a failure
const rf = read('src/data/loaderResultsFound.ts');
const once = (src: string) => /if \(loaded \|\| inFlight\) return;/.test(src)
  && /setResultsFoundCache\(rows\);\s*loaded = true;/.test(src)
  && (src.match(/loaded = true/g) ?? []).length === 1;
check('primeResultsFound stops after the first SUCCESSFUL load', once(rf),
  'called from render, it otherwise re-fetches the same pool on every re-render of a search');
check('a failed load is never marked loaded (the next call still retries)',
  !/catch \{[^}]*loaded = true/.test(rf) && !/setResultsFoundCache\(\[\]\);\s*loaded = true/.test(rf));
mustCatch('the guard reverting to in-flight only', !once(rf.replace('if (loaded || inFlight) return;', 'if (inFlight) return;')));

// 3. the loader strip is the full roster minus down websites; no per-search round trip
const loader = read('src/components/SearchLoader.tsx');
check('SearchLoader does not call the per-search active-platform fetch',
  !/fetchActivePlatformNames\(|loader_active_platforms_ar|loader_strip_platforms_ar/.test(loader),
  'the owner wants the full roster shown, stable; the fetch only ever shrank it, at 0.4-3.7 s per search');
check('the roster is picked with the session-cached down set, a synchronous read (no await per search)',
  /pickLoaderPlatforms\(resultSources, offsetRef\.current \?\? 0, hiddenPlatformNames\(\)\)/.test(loader));
const statusRead = read('src/data/loaderActivePlatforms.ts');
const oncePerSession = (src: string) => /if \(hidden \|\| inFlight\) return/.test(src);
check('the down-site statuses are read once per session, not once per search', oncePerSession(statusRead),
  'without the guard every search mount would call the RPC again');
mustCatch('the active-names fetch coming back', /fetchActivePlatformNames\(/.test(loader + '\nfetchActivePlatformNames().then(setActiveNames);'));
mustCatch('the once-per-session guard removed', !oncePerSession(statusRead.replace('if (hidden || inFlight) return', 'if (inFlight) return')));
const roster = (readFileSync(join(root, 'src/data/loaderPlatforms.ts'), 'utf8').match(/^  \{ name:/gm) ?? []).length;
check(`the catalog the strip shows is the owner's roster (${roster})`, roster >= 59,
  'the strip is PLATFORM_META minus websites down on their side — its size is the number the user sees');

console.log(failed ? `\n✗ ${failed} check(s) FAILED — a per-search round trip is back\n`
  : '\n✓ abandoned counts are cancelled, the results-found pool loads once, the strip reads its down set once per session\n');
process.exit(failed ? 1 : 0);
