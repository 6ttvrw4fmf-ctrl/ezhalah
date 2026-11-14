// A district named only «(حي) رقم» + a number is no place, so the Filter list never offers it (🦅 2026-11-13, backlog 606).
//
// Al-Lith offered «رقم» (haraj, 7 ads) while Wasalt's «(حي رقم (7» (9 ads) for the same place was offered nowhere.
// Rule 11 of district_ar_looks_bogus() is EXECUTED here: the regex is read from the NEWEST migration that defines the
// function (never a copy) and run against real served spellings and real numbered districts.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '..', 'supabase', 'migrations');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`); if (!ok) failed++; };

const newest = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort().reverse()
  .find((f) => /CREATE OR REPLACE FUNCTION public\.district_ar_looks_bogus\(/i.test(readFileSync(join(DIR, f), 'utf8')));
check('a migration defines district_ar_looks_bogus', !!newest, newest ?? 'none');
const body = newest ? readFileSync(join(DIR, newest), 'utf8') : '';

/** Rule 11's own regex, as Postgres will run it (POSIX ERE subset that JS reads the same way for this pattern). */
export const raqmRule = (sql: string): RegExp | null => {
  const m = /or t ~ '(\^\[\\s\\\(\\\)\\-\]\*\(حي\\s\*\)\?رقم[^']*)'/.exec(sql);
  return m ? new RegExp(m[1]) : null;
};
const re = raqmRule(body);
check('rule 11 («(حي) رقم» + number only) is in the newest definition', !!re);
if (re) {
  for (const s of ['رقم', '(حي رقم (7', 'حي رقم 7', ' رقم 12 ']) check(`«${s}» is refused as a district`, re.test(s));
  for (const s of ['حي المصيف 1', 'الناصرية 4', 'حي الرقمية', 'حي الرقم الذهبي', 'الشفا']) check(`«${s}» is kept`, !re.test(s));
}
const mutation = (label: string, caught: boolean) => check(`MUTATION — ${label}`, caught);
mutation('a definition without rule 11 is caught', raqmRule(body.replace(/\n\s*or t ~ '\^\[\\s[^\n]*رقم[^\n]*/, '')) === null);
const KEPT = ['حي المصيف 1', 'الناصرية 4', 'حي الرقمية', 'حي الرقم الذهبي', 'الشفا'];
mutation('an over-broad rule («رقم» anywhere) is caught by the kept names', KEPT.some((x) => /رقم/.test(x)));

console.log(failed === 0 ? '\n✓ a district named only «رقم» is never offered as a place' : `\n✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
