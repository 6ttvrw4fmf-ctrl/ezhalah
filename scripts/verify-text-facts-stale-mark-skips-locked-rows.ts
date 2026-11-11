// THE STALE-TEXT STAMP NEVER WAITS ON A ROW THE FACTS READER HOLDS (🔧 2026-11-11, repair backlog 1769).
//
// 2026-11-11 08:22 UTC the hourly search sync died on a deadlock inside text_facts_mark_stale(): its UPDATE of
// listing_text_facts met the facts reader's bulk upsert on the same rows in the opposite order, the pass rolled
// back, and the served index aged an hour. Migration 20261111143000 rewrote the UPDATE to lock its candidate rows
// with «for update of f2 skip locked», so a row the reader is rewriting is left to the next pass instead of waited
// on. This check reads the NEWEST committed definition of the function (a later migration that redefines it is the
// one production runs — the 2026-11-10 lesson) and fails if that spelling is gone or if the lock reaches a listing
// table. Offline, deterministic; the mutation proofs feed the predicate a body with the clause removed (everywhere, header comment included).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIG = join(ROOT, 'supabase', 'migrations');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failed++;
};
const mustCatch = (label: string, caught: boolean) => check(`MUTATION — ${label}`, caught);

const DEFINES = /create\s+or\s+replace\s+function\s+public\.text_facts_mark_stale\s*\(/i;
const files = readdirSync(MIG).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort();
const defining = files.filter((f) => DEFINES.test(readFileSync(join(MIG, f), 'utf8')));
const newest = defining.at(-1);
check('a committed migration defines text_facts_mark_stale()', Boolean(newest), 'none found');
const body = newest ? readFileSync(join(MIG, newest), 'utf8') : '';

/** The predicate: the stale-marking UPDATE selects its rows with «for update of <facts alias> skip locked», and that
 *  lock names only the listing_text_facts alias (a lock on the listing table would block every crawl's upsert). */
export function skipsLockedRows(sql: string): { ok: boolean; why: string } {
  const update = sql.match(/update\s+public\.listing_text_facts\s+f\s+set\s+stale_at[\s\S]*?skip\s+locked\)?/i)?.[0] ?? '';
  if (!update) return { ok: false, why: 'the UPDATE of listing_text_facts carries no «skip locked» clause' };
  const lock = update.match(/for\s+update\s+of\s+(\w+)\s+skip\s+locked/i);
  if (!lock) return { ok: false, why: '«skip locked» is present but not as «for update of <alias> skip locked»' };
  const alias = lock[1];
  const facts = new RegExp(`public\\.listing_text_facts\\s+${alias}\\b`, 'i');
  if (!facts.test(update)) return { ok: false, why: `the lock names «${alias}», which is not the listing_text_facts alias` };
  return { ok: true, why: '' };
}

const live = skipsLockedRows(body);
check(`${newest ?? '(none)'}: the stale-marking UPDATE locks only its own candidate rows and skips the ones the reader holds`, live.ok, live.why);
check('the pass still records its count in mon_mv_refresh_log', /mon_mv_refresh_log/.test(body) && /text_facts_mark_stale'/.test(body));

// ── mutation proofs ───────────────────────────────────────────────────────────────────────────────────────────────
mustCatch('the clause deleted (the 2026-11-11 08:22 body) is caught', !skipsLockedRows(body.replace(/\s*for\s+update\s+of\s+f2\s+skip\s+locked/gi, '')).ok);
mustCatch('a lock that names the LISTING table alias instead of the facts alias is caught',
  !skipsLockedRows(body.replace(/for\s+update\s+of\s+f2\s+skip\s+locked/gi, 'for update of x skip locked')).ok);
mustCatch('a plain «for update» without skip locked (waits again) is caught',
  !skipsLockedRows(body.replace(/\s+skip\s+locked/gi, '')).ok);
check('SELF-CHECK — the real body passes the same predicate the mutants fail', skipsLockedRows(body).ok);

console.log(failed === 0 ? 'OK: text_facts_mark_stale() skips the rows the facts reader holds' : `${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
