// Every independent oracle spells the rent pools ONE way — scripts/lib/rentPoolOracle.mjs (2026-11-13).
//
// What happened: migration 20261111141500 kept Haraj's unpriced daily/weekly stays (rent_period_ar «شهري», no
// price by owner order, backlog 1744) OUT of the yearly pool. scripts/lib/afOracleFilter.ts learned the new arm;
// four hand-copied oracles kept the old bare `price_annual.is.null` and counted ~740 short stays as yearly, so
// af-live-truth-check went red on a correct product (run 43424461595: top_cities 16109 vs «independent» 16110,
// district 4382 vs 4383, strict parity 139127 vs 139858). A copy cannot learn a rule; one spelling can.
//
// This check (1) EXECUTES the shared pool bodies against synthetic rows with a small PostgREST `or=` evaluator and
// compares them with the RPC clause's own predicate (top_cities_by_deal_ar / af_eligibility_clause, 20261111141500),
// and (2) fails on any hand-written yearly pool left in scripts/ or e2e/.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { annualPoolOr, monthlyPoolOr, bothPoolOr } from './lib/rentPoolOracle.mjs';

let failed = 0;
const check = (ok: boolean, what: string, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

type Row = { rent_period_ar: string | null; price_annual: number | null; rent_now_pay_later: boolean | null;
  payment_monthly: boolean | null; platform: string };

// ── a tiny PostgREST logic-tree evaluator: or(...), and(...), col.op.val with eq/neq/is/not.is/in ──────────
function splitTop(s: string): string[] {
  const out: string[] = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function evalExpr(expr: string, row: Row): boolean {
  const m = /^(and|or)\((.*)\)$/s.exec(expr);
  if (m) {
    const parts = splitTop(m[2]).map((p) => evalExpr(p, row));
    return m[1] === 'and' ? parts.every(Boolean) : parts.some(Boolean);
  }
  const [col, ...rest] = expr.split('.');
  const v = (row as Record<string, unknown>)[col];
  const op = rest.join('.');
  const is = (x: string) => (x === 'null' ? v == null : x === 'true' ? v === true : x === 'false' ? v === false : false);
  if (op.startsWith('eq.')) return v != null && String(v) === op.slice(3);
  if (op.startsWith('neq.')) return v != null && String(v) !== op.slice(4); // SQL: NULL <> x is not true
  if (op.startsWith('is.')) return is(op.slice(3));
  if (op.startsWith('not.is.')) return !is(op.slice(7));
  if (op.startsWith('in.(')) return v != null && op.slice(4, -1).split(',').includes(String(v));
  throw new Error(`evaluator: unknown operator in ${expr}`);
}
const evalOr = (body: string, row: Row) => evalExpr(`or${body}`, row);

// The RPC clause's own arms (top_cities_by_deal_ar, live body read 2026-11-13), price-on-request scoped by 20261111141500.
const rpcAnnual = (r: Row) => (r.price_annual == null && r.rent_period_ar !== 'شهري')
  || r.rent_period_ar === 'سنوي' || (r.rent_period_ar === 'شهري' && !!r.rent_now_pay_later);
const rpcMonthly = (r: Row) => (r.price_annual == null && ['gathern', 'aqarmonthly'].includes(r.platform))
  || (r.payment_monthly === true && !r.rent_now_pay_later);
const rpcBoth = (r: Row) => (r.price_annual == null && r.rent_period_ar !== 'شهري')
  || r.payment_monthly === true || r.rent_period_ar === 'سنوي' || (r.rent_period_ar === 'شهري' && !!r.rent_now_pay_later);

const rows: Row[] = [];
for (const rent_period_ar of ['سنوي', 'شهري', null])
  for (const price_annual of [36000, null])
    for (const rent_now_pay_later of [true, false, null])
      for (const payment_monthly of [true, null])
        for (const platform of ['haraj', 'gathern', 'aqar'])
          rows.push({ rent_period_ar, price_annual, rent_now_pay_later, payment_monthly, platform });

const agree = (body: string, model: (r: Row) => boolean) => rows.filter((r) => evalOr(body, r) !== model(r));
for (const [name, body, model] of [
  ['«سنوي» (raw Arabic)', annualPoolOr(false), rpcAnnual],
  ['«شهري»', monthlyPoolOr(), rpcMonthly],
  ['«كلاهما» (raw Arabic)', bothPoolOr(false), rpcBoth],
] as const) {
  const bad = agree(body, model);
  check(bad.length === 0, `${name} pool == the RPC clause on ${rows.length} synthetic rows`, JSON.stringify(bad.slice(0, 2)));
}
check(annualPoolOr() === annualPoolOr(false).replace(/سنوي/g, encodeURIComponent('سنوي')).replace(/شهري/g, encodeURIComponent('شهري')),
  'the encoded and raw yearly pools are the same predicate');
const harajDaily: Row = { rent_period_ar: 'شهري', price_annual: null, rent_now_pay_later: null, payment_monthly: null, platform: 'haraj' };
check(!evalOr(annualPoolOr(false), harajDaily), 'a Haraj unpriced daily stay is NOT in the yearly pool (backlog 1744)');

// ── no hand-written yearly pool anywhere else ─────────────────────────────────────────────────────────────
const root = process.cwd();
const STALE = [
  /rent_now_pay_later\.is\.true\)\s*,\s*price_annual\.is\.null\)/,            // the bare price-on-request arm
  /price_annual=is\.null&or=\(rent_period_ar\.is\.null,and\(rent_period_ar\.eq/, // strict-parity's old ground
  /or=\(rent_period_ar\.eq\.\$\{[^}]*\}\s*,\s*price_annual\.is\.null\)/,        // redteam's «every period» arm
];
const SELF = new Set(['scripts/verify-oracle-rent-pool-is-one-spelling.ts', 'scripts/lib/rentPoolOracle.mjs']);
const files: string[] = [];
const walk = (d: string) => {
  for (const n of readdirSync(d)) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|mjs|js)$/.test(n)) files.push(p);
  }
};
walk(join(root, 'scripts')); walk(join(root, 'e2e'));
const stale = (text: string) => STALE.some((re) => re.test(text));
const offenders = files.map((f) => relative(root, f)).filter((f) => !SELF.has(f) && stale(readFileSync(join(root, f), 'utf8')));
check(offenders.length === 0, `no hand-written yearly pool in scripts/ or e2e/ (${files.length} files read)`, offenders.join(', '));

// ── MUTATION PROOF ────────────────────────────────────────────────────────────────────────────────────────
const mustCatch = (what: string, caught: boolean) =>
  check(caught, `(mutation) catches ${what}`, 'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');
const OLD_TRENDING = '(rent_period_ar.eq.سنوي,and(rent_period_ar.eq.شهري,rent_now_pay_later.is.true),price_annual.is.null)';
mustCatch('the pre-2026-11-13 trending oracle (bare price_annual.is.null) disagreeing with the RPC', agree(OLD_TRENDING, rpcAnnual).length > 0);
mustCatch('the pre-2026-11-13 trending oracle text in a file', stale(`+ \`&or=${OLD_TRENDING}\${extra}\`;`));
mustCatch('strict parity\'s old price-on-request ground',
  stale("tableCount(`deal_ar=eq.${enc(RENT)}&price_annual=is.null&or=(rent_period_ar.is.null,and(rent_period_ar.eq.${enc('شهري')},rent_now_pay_later.not.is.true))`)"));
mustCatch('redteam\'s «price on request under every period» arm',
  stale("parts.push(`or=(rent_period_ar.eq.${encodeURIComponent(p.p_rent_period)},price_annual.is.null)`);"));
mustCatch('a shared yearly pool that drops the monthly-RNPL arm',
  agree('(rent_period_ar.eq.سنوي,and(price_annual.is.null,or(rent_period_ar.is.null,rent_period_ar.neq.شهري)))', rpcAnnual).length > 0);
mustCatch('a «شهري» pool that admits every unpriced row', agree('(and(payment_monthly.is.true,rent_now_pay_later.not.is.true),price_annual.is.null)', rpcMonthly).length > 0);

console.log(failed === 0
  ? '\n✅ verify-oracle-rent-pool-is-one-spelling: every oracle builds the rent pools from scripts/lib/rentPoolOracle.mjs, and it equals the RPC clause.'
  : `\n❌ verify-oracle-rent-pool-is-one-spelling: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
