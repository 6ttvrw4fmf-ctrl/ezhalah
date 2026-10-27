// NEAR-TWIN DISTRICT NAMES MERGE BY THEMSELVES WHEN THE HOMES SIT IN THE SAME PLACE (owner 2026-10-26): < 3 km apart,
// names differ only by spelling, the listed name wins, the other spelling becomes an alias. The card still prints what
// the site wrote. Canonical text: docs/ARCHITECTURE.md §20. The rule lives in SQL (district_twin_auto_merge, migration
// district_twin_auto_merge); this pins the pieces that must travel together — the name guard (numbers / ordinals /
// sector letters never merge), the 3 km line, the one-side-listed requirement, the log, the flag, the nightly job and
// the rostered watchdog — and EXECUTES a TS copy of the name guard's regex against the owner's cases so the guard's
// shape cannot drift silently. Production is watched by mon_detect_district_twin_auto_merge_suspect().
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok || !detail ? '' : ` — ${detail}`}`); if (!ok) failed++; };
const mutantCaught = (name: string, caught: boolean) => check(`(mutation) ${name}`, caught);

console.log('verify-district-twin-auto-merge: twins < 3 km apart that differ only by spelling are one district; numbers and sector letters never merge.');

const migDir = join(root, 'supabase/migrations');
const migs = readdirSync(migDir).filter((f) => /district_twin_auto_merge/.test(f)).sort();
const sql = migs.map((f) => readFileSync(join(migDir, f), 'utf8')).join('\n');
check('the migration exists', migs.length >= 1, migs.join(', '));

// The name guard's regex, lifted from the SQL and executed here against the owner's cases.
const guardRe = /regexp_matches\(public\.norm_district_tok\(p_a\), '\(([^']+)\)', 'g'\)/.exec(sql)?.[1] ?? '';
check('the name guard lists ordinals, digits and a trailing sector letter', /الرابع/.test(guardRe) && /\[0-9\]\+/.test(guardRe) && /\[أاإبجدهوز\]/.test(guardRe));
const counts = (s: string) => [...s.matchAll(new RegExp(`(${guardRe})`, 'g'))].map((m) => m[1].trim()).sort().join('|');
const differ = (a: string, b: string) => counts(a) !== counts(b);
check('الضاحية الرابع / السابع → different', differ('الضاحية الرابع', 'الضاحية السابع'));
check('حي شرق المطار أ / ب → different (sector letter)', differ('حي شرق المطار أ', 'حي شرق المطار ب'));
check('مخطط ا / ب → different', differ('مخطط ا', 'مخطط ب'));
check('جنوب منسوب التعليم / حي جنوب منسوبي التعليم → spelling only', !differ('جنوب منسوب التعليم', 'حي جنوب منسوبي التعليم'));
check('البغددية الشرقية / حي البغدادية الشرقية → spelling only (typo)', !differ('البغددية الشرقية', 'حي البغدادية الشرقية'));
mutantCaught('a guard without the sector letter lets شرق المطار أ/ب merge', (() => { const re = guardRe.replace(/\|\(\?:\^\|\\s\)\[أاإبجدهوز\]\(\?:\\s\|\$\)/, ''); const c = (s: string) => [...s.matchAll(new RegExp(`(${re})`, 'g'))].map((m) => m[1].trim()).sort().join('|'); return c('حي شرق المطار أ') === c('حي شرق المطار ب'); })());

// The rule's shape in SQL.
check('merge only when < 3,000 m, 3+ pins each side, exactly one side listed, names not differing by count',
  /where not counts_differ and dist_m is not null and dist_m < 3000 and a_pins >= 3 and b_pins >= 3 and \(a_listed <> b_listed\)/.test(sql));
check('the listed side is the target; the alias is written as from(unlisted) → to(listed) and logged',
  /if p\.a_listed then v_to := p\.a_ar; v_from := p\.b_ar;/.test(sql) && /insert into public\.loc_district_alias \(city_id, from_norm, to_norm, why, decided_by\)/.test(sql)
  && /insert into public\.ops_district_twin_merges/.test(sql) && /'auto-twin-rule'/.test(sql));
check('behind the district_twin_auto_merge flag, nightly cron, rostered watchdog',
  /ops_feature_flags k where k\.name = 'district_twin_auto_merge' and k\.enabled/.test(sql)
  && /cron\.schedule\('district-twin-auto-merge', '5 3 \* \* \*'/.test(sql)
  && /'mon_detect_district_twin_auto_merge_suspect'/.test(sql) && /mon_run_all_detectors/.test(sql));
check('the watchdog re-measures: 3 km+ apart or counts differ → P1 naming the alias',
  /where counts_differ or dist_now >= 3000/.test(sql) && /'district_twin_auto_merge_suspect'/.test(sql));
mutantCaught('a rule that also merges both-listed pairs', !/\(a_listed = b_listed\)/.test(sql));
mutantCaught('a rule without the 3 km line', /dist_m < 3000/.test(sql));

if (failed) { console.log(`\n❌ verify-district-twin-auto-merge: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-district-twin-auto-merge: the rule, its guard, its log, its flag and its watchdog travel together.');
