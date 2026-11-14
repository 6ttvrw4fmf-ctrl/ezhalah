// A POOLED SHORT STAY IS NEVER A YEARLY RENT (🔧 2026-11-11, migration 20261111141500; owner rules 2026-10-25/26 and
// backlog 1744). 20261111070829 moved Haraj's seller-stated daily/weekly rents into «إقامات قصيرة» with NO price, and the
// eligibility clause's price-on-request arm («price_annual IS NULL → shown under سنوي and كلاهما») then served the same
// 712 chalets in yearly-rent searches too — the app's own RPC answered جدة/haraj/سنوي with 142 daily rows (14:05 UTC).
// The arm now admits a no-price row under سنوي/كلاهما only when it is NOT in the short-stays pool
// (rent_period_ar is distinct from 'شهري'); the شهري half (gathern + aqarmonthly by name) is unchanged.
//
// This reads sql/mirrors/af_eligibility_clause.sql — the byte-exact mirror of the ONE builder every count/results RPC is
// generated from (verify-sql-mirrors-not-stale pins it to production) — so a hand edit, a stale mirror or a refreshed
// mirror that lost the scope is red on the PR. Offline, deterministic; the 2026-10-26 arm is the mutant.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failed++;
};
const mustCatch = (label: string, caught: boolean) => check(`MUTATION — ${label}`, caught);

export const NEW_ARM =
  "(s.price_annual is null and ((p_rent_period in ('سنوي','كلاهما') and s.rent_period_ar is distinct from 'شهري') or (p_rent_period = 'شهري' and s.platform in ('gathern','aqarmonthly'))))";
export const OLD_ARM =
  "(s.price_annual is null and (p_rent_period in ('سنوي','كلاهما') or (p_rent_period = 'شهري' and s.platform in ('gathern','aqarmonthly'))))";

/** The clause text as the builder emits it: the mirror holds pg_get_functiondef, where the literal doubles every quote. */
export function clauseFromMirror(mirror: string): string {
  const i = mirror.search(/CREATE OR REPLACE FUNCTION public\.af_eligibility_clause\(\)/);
  if (i < 0) return '';
  return mirror.slice(i).replace(/''/g, "'");
}

/** The predicate: the no-price arm scopes سنوي/كلاهما to rows outside the short-stays pool, and the old arm is gone. */
export function poolNeverUnderYearly(clause: string): { ok: boolean; why: string } {
  if (!clause) return { ok: false, why: 'no af_eligibility_clause definition found' };
  const n = clause.split(NEW_ARM).length - 1;
  const o = clause.split(OLD_ARM).length - 1;
  if (o > 0) return { ok: false, why: `the 2026-10-26 arm is still there (${o}×): a pooled no-price row is served under سنوي` };
  if (n !== 1) return { ok: false, why: `the pooled-short-stays arm occurs ${n}× (want exactly 1)` };
  return { ok: true, why: '' };
}

const mirror = readFileSync(join(ROOT, 'sql', 'mirrors', 'af_eligibility_clause.sql'), 'utf8');
const clause = clauseFromMirror(mirror);
const live = poolNeverUnderYearly(clause);
check('sql/mirrors/af_eligibility_clause.sql: the no-price arm keeps pooled short stays out of «سنوي» / «كلاهما»', live.ok, live.why);
check('the شهري half of the arm still names gathern + aqarmonthly only', clause.includes("(p_rent_period = 'شهري' and s.platform in ('gathern','aqarmonthly'))"));

// ── mutation proofs ───────────────────────────────────────────────────────────────────────────────────────────────
mustCatch('the 2026-10-26 arm (the 14:05 UTC leak) is caught', !poolNeverUnderYearly(clause.replace(NEW_ARM, OLD_ARM)).ok);
mustCatch('an arm that drops the pool test but keeps the shape is caught',
  !poolNeverUnderYearly(clause.replace(" and s.rent_period_ar is distinct from 'شهري')", ')')).ok);
mustCatch('a mirror without the builder is caught', !poolNeverUnderYearly(clauseFromMirror('-- header only\n')).ok);
check('SELF-CHECK — the real mirror passes the same predicate the mutants fail', poolNeverUnderYearly(clause).ok);

console.log(failed === 0 ? 'OK: a pooled short stay is never served as a yearly rent' : `${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
