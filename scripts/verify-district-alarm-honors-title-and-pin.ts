// district_contradicts_source honours BOTH halves of the owner's «Title/pin wins» rule (owner 2026-11-03).
//
// 2026-11-09 (🆕, backlog 1576 «reopened 5 times in 7 days»): 20261103170826 exempted a district the ad's TITLE
// decided (district_recovery.basis = 'title') but not one its MAP PIN decided (basis = 'pin'). All 41 rows the view
// returned that morning were pin-decided, and the ad's own address agreed (aqar 40214 «حي ظهره العودة غرب»), so the
// alarm counted the owner's own decision as a defect and could never stay closed. 20261109071136 adds 'pin'.
//
// This reads the NEWEST migration that defines the view and requires:
//   1. the district_recovery exemption names both 'title' and 'pin';
//   2. it exempts a row ONLY when the served district IS the recovered one (d.district_ar = t.we_display) —
//      otherwise every recovered row would be excused and real contradictions would go dark;
//   3. the spelling excusal and the MATERIALIZED fence are still there (pinned elsewhere too; cheap to re-assert).
//   node --experimental-strip-types scripts/verify-district-alarm-honors-title-and-pin.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

type Mig = { f: string; s: string };
const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const migs: Mig[] = readdirSync(dir).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort().map((f) => ({ f, s: readFileSync(join(dir, f), 'utf8') }));

const viewBody = (ms: Mig[]): { f: string; b: string } | null => {
  const re = /create\s+or\s+replace\s+view\s+public\.mon_district_contradicts_source\s+as([\s\S]*?);\s*(?:\n|$)/i;
  let out: { f: string; b: string } | null = null;
  for (const m of ms) { const x = re.exec(m.s); if (x) out = { f: m.f, b: x[1] }; }
  return out;
};

export function problems(ms: Mig[]): string[] {
  const v = viewBody(ms);
  if (!v) return ['mon_district_contradicts_source is never defined'];
  const p: string[] = [];
  const rec = /NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+district_recovery\s+d\b([\s\S]*?)\)\s*\)?\s*\)?\s*$/i.exec(v.b.trim());
  if (!rec) return [`${v.f}: the district_recovery («Title/pin wins») exemption is gone`];
  const clause = rec[1];
  const basis = /d\.basis\s*(?:=\s*'(\w+)'|IN\s*\(([^)]*)\))/i.exec(clause);
  const kinds = basis ? (basis[1] ? [basis[1]] : basis[2].split(',').map((s) => s.trim().replace(/'/g, ''))) : [];
  if (!kinds.includes('title')) p.push(`${v.f}: a district the ad's TITLE decided counts as a contradiction again`);
  if (!kinds.includes('pin')) p.push(`${v.f}: a district the ad's MAP PIN decided counts as a contradiction again (owner 2026-11-03 «Title/pin wins»; backlog 1576)`);
  if (!/d\.district_ar\s*=\s*t\.we_display/i.test(clause)) p.push(`${v.f}: the exemption no longer requires the served district to BE the recovered one — every recovered row would be excused`);
  if (!/AS\s+MATERIALIZED/i.test(v.b)) p.push(`${v.f}: the cheap text filter lost its MATERIALIZED fence`);
  return p;
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const real = problems(migs);
check('district_contradicts_source excuses a district only when the title or pin decided the one served', real.length === 0, real.join('; '));

const newest = viewBody(migs)!;
const swap = (from: string | RegExp, to: string): Mig[] => {
  const m = migs.find((x) => x.f === newest.f)!;
  const s = m.s.replace(from, to);
  if (s === m.s) throw new Error(`mutation was a no-op: ${from}`);
  return migs.map((x) => (x.f === m.f ? { f: x.f, s } : x));
};
mustCatch('the 11-03 shape (title only, pin forgotten)', problems(swap(/d\.basis\s+IN\s*\('title',\s*'pin'\)/i, "d.basis = 'title'")).length > 0);
mustCatch('pin only (title forgotten)', problems(swap(/d\.basis\s+IN\s*\('title',\s*'pin'\)/i, "d.basis = 'pin'")).length > 0);
mustCatch('an exemption that excuses every recovered row', problems(swap(/AND\s+\(d\.district_ar\s*=\s*t\.we_display\s+OR\s+/i, 'AND (')).length > 0);
mustCatch('a later view with no recovery exemption at all', problems([...migs, { f: '29990101000000_x.sql', s: 'create or replace view public.mon_district_contradicts_source as\n WITH t AS MATERIALIZED (select 1) select 1 from t;\n' }]).length > 0);

if (failed) { console.error(`\n❌ verify-district-alarm-honors-title-and-pin: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-district-alarm-honors-title-and-pin: the district alarm honours «Title/pin wins» and nothing wider.');
