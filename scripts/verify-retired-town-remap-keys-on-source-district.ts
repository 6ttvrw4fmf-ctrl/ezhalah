// A home whose SITE names a retired town as its district keeps its move to that town (🆕 2026-11-12, alert 14421,
// repeat_bug 14335 / backlog 1789).
//
// retired_place_remap_rows() moves a home whose district is a retired town («حي جواثا», retired as city 3700) into
// that town. Until 20261112071500 its g2 / g2n arms read the town only from v1.district_ar or district_recovery —
// and district_recovery is rewritten every hour by the TITLE arm. Measured on aqar 9594877 / 26273326: the title arm
// wrote «حي الكلابية» while the home sat in جواثا, the remap lost the town, the home fell back to الهفوف, the title arm
// stopped (wrong city), the town came back… an hourly city swap that reopened district_contradicts_source 11 times
// in 7 days. The source's own district (listing_source_district_ar_fleet) does not move, so both arms key on it too.
//
// This check reads every migration in order and fails when:
//   1. no migration adds the source-district key to retired_place_remap_rows() in BOTH g2 and g2n, or its check block
//      stops executing the function on the two homes that swapped;
//   2. a LATER migration redefines retired_place_remap_rows() (create or replace) without that key in both arms —
//      the shape that would silently bring the hourly swap back.
//   node --experimental-strip-types scripts/verify-retired-town-remap-keys-on-source-district.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

type Mig = { f: string; s: string };
const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const load = (): Mig[] =>
  readdirSync(dir).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort().map((f) => ({ f, s: readFileSync(join(dir, f), 'utf8') }));

const KEY = 'listing_source_district_ar_fleet';
const FIX = '20261112071500';
const count = (s: string, needle: string): number => s.split(needle).length - 1;
const REDEFINE = /create\s+or\s+replace\s+function\s+public\.retired_place_remap_rows\s*\(/i;

export function problems(ms: Mig[]): string[] {
  const p: string[] = [];
  const fix = ms.find((m) => m.f.startsWith(FIX));
  if (!fix) return [`${FIX}_*.sql is missing — retired_place_remap_rows() never learned the source-district key`];
  const [edit, check = ''] = fix.s.split(/do\s+\$chk\$/i);
  if (!/pg_get_functiondef\('public\.retired_place_remap_rows\(\)'::regprocedure\)/.test(edit))
    p.push(`${fix.f}: the fix no longer edits the LIVE retired_place_remap_rows() body`);
  if (!/c\s*<>\s*2\s+then\s+raise/.test(edit)) p.push(`${fix.f}: the needle edit no longer insists on exactly 2 arms (g2 and g2n)`);
  if (!/repl constant text := 'g2d\.k in \(/.test(edit) || !edit.includes(`from public.${KEY} sd`))
    p.push(`${fix.f}: the replacement no longer keys the town on ${KEY}`);
  if (!/listing_id in \(9594877, 26273326\) and new_city_id = 3700\) <> 2/.test(check))
    p.push(`${fix.f}: the check block no longer executes the remap on aqar 9594877 / 26273326 → جواثا (3700)`);
  if (!/n_pin < 32 or n_other < 524/.test(check)) p.push(`${fix.f}: the check block no longer refuses a remap that shrank`);
  for (const m of ms) {
    if (m.f <= fix.f || !REDEFINE.test(m.s)) continue;
    const body = m.s.slice(m.s.search(REDEFINE));
    const end = body.search(/\$function\$\s*;|\$\$\s*;/);
    if (count(end > 0 ? body.slice(0, end) : body, KEY) < 2)
      p.push(`${m.f}: redefines retired_place_remap_rows() without the ${KEY} key in both g2 and g2n — the hourly city swap returns`);
  }
  return p;
}

const failures: string[] = [];
const mustCatch = (label: string, caught: boolean): void => {
  if (!caught) failures.push(`mutation NOT caught: ${label}`);
};

const real = load();
const now = problems(real);
const fixIdx = real.findIndex((m) => m.f.startsWith(FIX));
const swap = (from: string, to: string): Mig[] =>
  real.map((m, i) => (i === fixIdx ? { f: m.f, s: m.s.replace(from, to) } : m));

mustCatch('the fix migration deleted', problems(real.filter((_, i) => i !== fixIdx)).length > 0);
mustCatch('the replacement no longer reads the source district', problems(swap(`from public.${KEY} sd`, 'from public.district_recovery sd')).length > 0);
mustCatch('the needle may land in one arm only', problems(swap('if c <> 2 then raise', 'if c < 1 then raise')).length > 0);
mustCatch('the check block stops executing the two swapping homes', problems(swap('listing_id in (9594877, 26273326) and new_city_id = 3700) <> 2', 'listing_id in (9594877, 26273326) and new_city_id = 3700) < 0')).length > 0);
mustCatch('the shrink guard removed', problems(swap('n_pin < 32 or n_other < 524', 'false')).length > 0);
mustCatch(
  'a later migration redefines the function without the key',
  problems([...real, { f: '29991231235959_regress.sql', s: 'create or replace function public.retired_place_remap_rows()\n returns table(x int) language sql as $function$ select 1 $function$;' }]).length > 0,
);

if (now.length || failures.length) {
  for (const x of [...now, ...failures]) console.error(`❌ ${x}`);
  process.exit(1);
}
console.log(`✅ retired_place_remap_rows() keys a retired town on the source's own district in g2 and g2n (${FIX}); 6 mutations caught`);
