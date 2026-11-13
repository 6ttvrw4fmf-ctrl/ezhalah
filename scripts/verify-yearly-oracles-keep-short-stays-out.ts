// EVERY hand-written «سنوي» oracle keeps the pooled short stays out, the way the clause does (🦅 2026-11-13).
//
// af_eligibility_clause() admits a price-on-request rent under «سنوي» only when it is NOT a pooled short stay
// (`s.price_annual is null and s.rent_period_ar is distinct from 'شهري'`, migration 20261111141500, owner 2026-10-25/26 and
// backlog 1744). 🔧 fixed the shared translator (scripts/lib/afOracleFilter.ts) the same day, but six hand-copied
// PostgREST oracles still admitted `price_annual.is.null` as a BARE disjunct, so on 2026-11-13 af-live-truth-check run
// 43424461595 went red on a correct product twice (strict parity +731 Haraj daily/weekly rows, Trending +12 / Narjis +1),
// and the live sweep / journeys / redteam oracles carried the same term. A robot that is red on a right answer hides
// the next wrong one.
//
// This guard DISCOVERS the shape — it is not a list: any line under scripts/ or e2e/ that builds a «سنوي» filter
// (`rent_period_ar.eq.` + سنوي) and admits `,price_annual.is.null)` without the pool test is RED.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SELF = 'scripts/verify-yearly-oracles-keep-short-stays-out.ts';
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
  if (!ok) failed++;
};
const mutation = (label: string, caught: boolean, detail = '') => check(`MUTATION — ${label}`, caught, detail);

/** A line that builds a yearly-rent filter and lets every no-price row in, pooled short stays included. */
export const leaksPooledShortStays = (line: string): boolean => {
  const yearly = /rent_period_ar\.eq\.(سنوي|\$\{(enc|e|encodeURIComponent)\('سنوي'\)\})/.test(line);
  return yearly && /,price_annual\.is\.null\)/.test(line);
};

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
};

const files = [...walk(join(ROOT, 'scripts')), ...walk(join(ROOT, 'e2e'))].filter((f) => relative(ROOT, f) !== SELF);
const offenders: string[] = [];
let yearlyLines = 0;
for (const f of files) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (/rent_period_ar\.eq\.(سنوي|\$\{(enc|e|encodeURIComponent)\('سنوي'\)\})/.test(line)) yearlyLines++;
    if (leaksPooledShortStays(line)) offenders.push(`${relative(ROOT, f)}:${i + 1}`);
  });
}
check(`no «سنوي» oracle in scripts/ or e2e/ admits a pooled short stay (${files.length} files, ${yearlyLines} yearly filter lines)`,
  offenders.length === 0, offenders.join(' · '));
check('the scan bites: it found the yearly filters it judges (a scan that sees none proves nothing)', yearlyLines >= 6, `yearly lines=${yearlyLines}`);

// MUTATIONS: the exact shapes that were live until today must be caught; the corrected shapes must pass.
const OLD = [
  "+ `&or=(rent_period_ar.eq.سنوي,and(rent_period_ar.eq.شهري,rent_now_pay_later.is.true),price_annual.is.null)${extra}`;",
  "f += `&or=(rent_period_ar.eq.${enc('سنوي')},and(rent_period_ar.eq.${enc('شهري')},rent_now_pay_later.is.true),price_annual.is.null)`;",
];
const NEW = [
  "+ `&or=(rent_period_ar.eq.سنوي,and(rent_period_ar.eq.شهري,rent_now_pay_later.is.true),and(price_annual.is.null,or(rent_period_ar.is.null,rent_period_ar.neq.شهري)))${extra}`;",
  "f += `&or=(rent_period_ar.eq.${enc('سنوي')},and(rent_period_ar.eq.${enc('شهري')},rent_now_pay_later.is.true),and(price_annual.is.null,or(rent_period_ar.is.null,rent_period_ar.neq.${enc('شهري')})))`;",
];
OLD.forEach((l, i) => mutation(`the pre-2026-11-13 oracle term #${i + 1} is caught`, leaksPooledShortStays(l)));
NEW.forEach((l, i) => mutation(`the corrected oracle term #${i + 1} passes (a rule red for everything guards nothing)`, !leaksPooledShortStays(l)));
mutation('a «شهري»-only filter with the gathern/aqarmonthly arm is not judged as yearly',
  !leaksPooledShortStays("'&or=(and(payment_monthly.is.true,rent_now_pay_later.not.is.true),and(price_annual.is.null,platform.in.(gathern,aqarmonthly)))'"));

console.log(failed === 0 ? '\n✓ every yearly-rent oracle keeps the short-stays pool out, as the clause does' : `\n✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
