// mon_detect_price_eq_area_waiver_stale must close a key once its waiver is DELETED (2026-11-04,
// migration *_price_eq_area_waiver_stale_closes_on_delete.sql).
//
// THE DEFECT. The detector's own fix text says «parser artifact → DELETE the waiver row». But it only ever resolved a
// key inside its loop over EXISTING waivers on SERVED rows, so the instructed repair left the alert open forever
// (amlakalahsa 11622340/11622372/11622913, open since 2026-10-18 after their writer was already fixed). An alarm the
// correct repair cannot close teaches the next engineer to «refresh the number» instead — the mute button.
//
// THE RULE. After the loop, every OPEN key with no matching (waiver, served row) pair is resolved. The raise path is
// untouched: a waiver still standing on a served row whose price moved still raises.
//
// This barrier LIFTS the two loops from the committed SQL and EXECUTES their logic on a fixture; each mutation below
// must turn it red.   node --experimental-strip-types scripts/verify-price-eq-area-waiver-stale-closes-on-delete.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const file = readdirSync(dir).filter((f) => /^\d{14}_price_eq_area_waiver_stale_closes_on_delete\.sql$/.test(f)).sort().at(-1);
if (!file) { console.log('FAIL  migration *_price_eq_area_waiver_stale_closes_on_delete.sql is missing'); process.exit(1); }
const sql = readFileSync(join(dir, file), 'utf8');

type Waiver = { key: string; verified: number | null };
type Served = { key: string; ready: boolean; price: number | null };
type World = { waivers: Waiver[]; served: Served[]; open: string[] };

function shape(s: string) {
  const raiseLoop = /from public\.ops_price_eq_area_verified v\s+join public\.search_listings_ar s\s+on s\.source_table = v\.source_table and s\.listing_id = v\.listing_id\s+where s\.production_ready\s+and v\.verified_price_total is not null\s+loop\s+if r\.current_price_total is distinct from r\.verified_price_total then\s+v_n := v_n \+ public\.mon_raise\('P2', 'price_eq_area_waiver_stale'/.test(s);
  const close = s.match(/from public\.alert_event a\s+where a\.kind = 'price_eq_area_waiver_stale' and a\.resolved_at is null\s+and not exists \(\s+select 1\s+from public\.ops_price_eq_area_verified v\s+join public\.search_listings_ar s\s+on s\.source_table = v\.source_table and s\.listing_id = v\.listing_id\s+where (s\.production_ready and )?v\.verified_price_total is not null\s+and a\.dedup_key = 'price_eq_area_waiver_stale:' \|\| v\.source_table \|\| ':' \|\| v\.listing_id\)\s+loop\s+perform public\.mon_resolve_key\('price_eq_area_waiver_stale', r\.dedup_key\);/);
  return { raiseLoop, close: !!close, closeNeedsReady: !!close?.[1] };
}

function run(s: string, w: World): { raised: string[]; open: string[] } | null {
  const sh = shape(s);
  if (!sh.raiseLoop) return null;
  const open = new Set(w.open); const raised: string[] = [];
  for (const v of w.waivers) {
    const r = w.served.find((x) => x.key === v.key && x.ready);
    if (!r || v.verified === null) continue;
    if (r.price !== v.verified) { raised.push(v.key); open.add(v.key); } else open.delete(v.key);
  }
  if (sh.close) {
    for (const k of [...open]) {
      const stands = w.waivers.some((v) => v.key === k && v.verified !== null
        && w.served.some((x) => x.key === k && (!sh.closeNeedsReady || x.ready)));
      if (!stands) open.delete(k);
    }
  }
  return { raised, open: [...open].sort() };
}

function problems(s: string): string[] {
  const fail: string[] = [];
  const cases: Array<[string, World, string[]]> = [
    ['amlakalahsa 11622340: waiver deleted after the writer was fixed → key closes',
      { waivers: [], served: [{ key: 'A', ready: true, price: null }], open: ['A'] }, []],
    ['row no longer served → key closes', { waivers: [{ key: 'B', verified: 1700 }], served: [{ key: 'B', ready: false, price: 1700 }], open: ['B'] }, []],
    ['waiver stands, served price moved → stays open (raise path intact)',
      { waivers: [{ key: 'C', verified: 1700 }], served: [{ key: 'C', ready: true, price: null }], open: [] }, ['C']],
    ['waiver stands, price matches → resolved', { waivers: [{ key: 'D', verified: 630 }], served: [{ key: 'D', ready: true, price: 630 }], open: ['D'] }, []],
  ];
  for (const [label, w, want] of cases) {
    const got = run(s, w);
    if (!got) { fail.push('the raise loop over standing waivers is missing or reshaped'); break; }
    if (got.open.join(',') !== want.join(',')) fail.push(`${label}: open=[${got.open}] want [${want}]`);
  }
  return fail;
}

let failed = 0;
const check = (label: string, ok: boolean, why = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : ` — ${why}`}`); };
const mustCatch = (label: string, caught: boolean, why = '') => check(`mutant caught: ${label}`, caught, why);
const live = problems(sql);
check(`${file} closes a key whose waiver is gone, and still raises a stale standing one`, live.length === 0, live.join('; '));
const mutants: Array<[string, (s: string) => string]> = [
  ['the close loop removed (the old detector)', (s) => s.replace(/\n  for r in\n    select a\.dedup_key[\s\S]*?end loop;\n/, '\n')],
  ['close loop ignores production_ready (an unserved row keeps its key open)', (s) => s.replace(/where s\.production_ready and v\.verified_price_total is not null\n\s+and a\.dedup_key/, 'where v.verified_price_total is not null\n            and a.dedup_key')],
  ['raise path dropped', (s) => s.replace("v_n := v_n + public.mon_raise('P2', 'price_eq_area_waiver_stale'", "v_n := v_n + public.mon_raise('P3', 'other'")],
];
for (const [label, mutate] of mutants) {
  const m = mutate(sql);
  mustCatch(label, m !== sql && problems(m).length > 0, m === sql ? 'mutation did not apply (pattern drifted)' : 'verdict stayed green');
}
console.log(failed === 0 ? 'OK: the instructed waiver repair closes its own alarm' : `${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
