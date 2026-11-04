// تربه IN منطقة حائل (city 2372) IS ITS OWN TOWN, NOT A COPY OF MAKKAH'S تربه (2156) — source-page-checks 2026-11-03.
//
// WHY. 20261026013519's G4 rule retired 2372 as «duplicate of city 2156 (تربه, 1.4 km)». The 1.4 km was circular:
// loc_city_center is the median pin of a city's OWN homes, and ~90 Hail-coordinate homes sit under 2156, so 2156's
// "center" was in Hail too. Read on the source: aqarcity 29743 publishes addressLocality «تربة», addressRegion «منطقة
// حائل», geo 28.235, 42.910 (breadcrumb state 4 = حائل), while Makkah's Turbah homes sit near 21.19, 41.60 — ~800 km
// apart. While retired, retired_place_remap_rows() moved 2372's 8 homes into منطقة مكة المكرمة (phasea_offregion_pick,
// alert 12259). The source-page-checks migration un-retires 2372.
//
// WHAT THIS PINS. The LAST migration in the tree that sets loc_catalog_city.retired_at for city 2372 must set it to
// NULL. Re-retiring Hail's تربه takes a newer migration that this check reads — i.e. a deliberate, reviewed decision
// with fresh source evidence, never a re-run of the centre-distance rule. The predicate is executed below against
// synthetic migration sets (mutation proof) before it judges the real tree.
//
//   node --experimental-strip-types scripts/verify-turbah-hail-is-its-own-town.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

type Mig = { n: string; s: string };

// One statement that touches city 2372's retirement: an UPDATE of loc_catalog_city naming city_id = 2372 and setting
// retired_at. Returns 'unretire' | 'retire' | null for each such statement, in file order.
export function verdicts(migs: Mig[]): { n: string; v: 'unretire' | 'retire' }[] {
  const out: { n: string; v: 'unretire' | 'retire' }[] = [];
  for (const m of [...migs].sort((a, b) => a.n.localeCompare(b.n))) {
    const stmts = m.s.replace(/--[^\n]*/g, '').split(/;/);
    for (const st of stmts) {
      if (!/update\s+(public\.)?loc_catalog_city\b/i.test(st)) continue;
      if (!/city_id\s*=\s*2372\b/.test(st)) continue;
      const set = st.match(/retired_at\s*=\s*([^,\n]+)/i);
      if (!set) continue;
      out.push({ n: m.n, v: /^\s*null\b/i.test(set[1]) ? 'unretire' : 'retire' });
    }
  }
  return out;
}

export function problems(migs: Mig[]): string[] {
  const v = verdicts(migs);
  if (v.length === 0) return ['no migration un-retires city 2372 (تربه, منطقة حائل)'];
  const last = v[v.length - 1];
  return last.v === 'unretire' ? [] : [`${last.n} re-retires city 2372 after it was proven a separate town`];
}

let fail = 0;
const expect = (label: string, got: string[], wantRed: boolean) => {
  const red = got.length > 0;
  if (red !== wantRed) { console.log(`FAIL  mutation: ${label} → ${red ? 'RED' : 'GREEN'}, expected ${wantRed ? 'RED' : 'GREEN'}`); fail++; }
};
const un = 'update public.loc_catalog_city\n set retired_at = null, retired_why = null\n where city_id = 2372 and region_id = 8;';
const re = "update public.loc_catalog_city set retired_at = now(), retired_why = 'dup' where city_id = 2372;";
expect('un-retire only', problems([{ n: '20261103000000_a.sql', s: un }]), false);
expect('nothing un-retires', problems([{ n: '20261103000000_a.sql', s: 'select 1;' }]), true);
expect('re-retired afterwards', problems([{ n: '20261103000000_a.sql', s: un }, { n: '20261104000000_b.sql', s: re }]), true);
expect('retire then un-retire', problems([{ n: '20261026000000_a.sql', s: re }, { n: '20261103000000_b.sql', s: un }]), false);
expect('other city ignored', problems([{ n: '20261103000000_a.sql', s: un }, { n: '20261104000000_b.sql', s: re.replace('2372', '23721') }]), false);
expect('commented-out retire ignored', problems([{ n: '20261103000000_a.sql', s: un }, { n: '20261104000000_b.sql', s: '-- ' + re }]), false);

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const tree = readdirSync(dir).filter((f) => f.endsWith('.sql')).map((n) => ({ n, s: readFileSync(join(dir, n), 'utf8') }));
const real = problems(tree);
for (const p of real) { console.log(`FAIL  ${p}`); fail++; }
if (fail) process.exit(1);
console.log(`✅ verify-turbah-hail-is-its-own-town: 6 mutations caught; last decision on city 2372 = ${verdicts(tree).at(-1)?.n}`);
