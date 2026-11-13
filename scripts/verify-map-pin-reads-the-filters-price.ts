// THE PIN SAYS THE PRICE THE CARD SAYS (owner 2026-11-12, الجلة: «it says سعر عند الطلب when I click I see the price …
// takes so long to load»). Three facts, each with a mutation that must be caught:
//   1. Every map read prices a sale by the Filter's column, coalesce(price_total_effective, price_total) — never the
//      bare price_total, which is empty for 7,817 per-metre-priced ads on the map (haraj 19063138: 1,000 × 10,255 m²).
//      Read from the committed migrations: the fix migration rewrites all seven reads, and no later migration may put
//      the bare read back into a map function.
//   2. One spot is one pin: map_pins_ar groups exact spots by coordinates rounded to 6 decimals (haraj and dealapp
//      wrote the same point with 12 and 15 decimals and got two pins).
//   3. The pin's sheet asks for the card and its place AT THE SAME TIME (one round trip, not two), and folds copies by
//      the same full price.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname ?? '.', '..');
let failed = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const OLD_PRICE = 'then s.price_total else s.price_annual end as price';
const NEW_PRICE = 'then coalesce(s.price_total_effective, s.price_total) else s.price_annual end as price';
const NEW_LL = 'round(coalesce(snap.lat, s.latitude::double precision)::numeric, 6)::double precision la';
const FIX = '20261112184000_map_pin_reads_the_filters_price_and_one_spot_is_one_pin.sql';
const MAP_READS = ['map_pins_ar', 'map_posted_window_counts_ar', 'map_nopin_refresh_ar', 'map_view_facts_core'];

const dir = join(root, 'supabase/migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

function migrationProblems(names: string[], read: (f: string) => string): string[] {
  const out: string[] = [];
  if (!names.includes(FIX)) return ['the fix migration is missing'];
  const sql = read(FIX);
  if (!sql.includes(`old_price constant text := '${OLD_PRICE}'`) || !sql.includes(`new_price constant text := '${NEW_PRICE}'`)) out.push('the fix does not rewrite the sale price to the Filter column');
  if (!/if n <> 4 then raise exception 'map_pins_ar: expected 4 price reads/.test(sql)) out.push('map_pins_ar: not all 4 price reads are required');
  if (!/if n <> 1 then raise exception 'map_posted_window_counts_ar/.test(sql)) out.push('map_posted_window_counts_ar is not rewritten');
  if (!/if n <> 2 then raise exception 'map_nopin_refresh_ar/.test(sql)) out.push('the district markers are not rewritten');
  if (!sql.includes("'    s.price_total_effective'")) out.push('the pins view does not carry price_total_effective');
  if (!sql.includes(NEW_LL) || !/if n <> 3 then raise exception 'map_pins_ar: expected 3 exact-spot reads/.test(sql)) out.push('exact spots are not rounded to 6 decimals on all 3 reads');
  // Nothing after the fix may put the bare read back into a map function: the NEWEST definition of every map read
  // (map_view_facts_core included — the pill's facts, 2026-11-12) must price a sale by the Filter's column. A file that
  // only MENTIONS a map read, or one a later migration redefines with the Filter's price, is not a regression.
  for (const fn of MAP_READS) {
    const head = new RegExp(`create or replace function public\\.${fn}\\(`);
    const defining = names.filter((x) => x > FIX && head.test(read(x)));
    const last = defining[defining.length - 1];
    if (!last) continue;
    const t = read(last);
    const at = t.search(head);
    const next = t.slice(at + 1).search(/create or replace function /);
    const def = next < 0 ? t.slice(at) : t.slice(at, at + 1 + next);
    if (def.includes(OLD_PRICE) && !def.includes(NEW_PRICE)) out.push(`${last} reads the bare sale price in ${fn}`);
  }
  return out;
}
const readMig = (f: string) => readFileSync(join(dir, f), 'utf8');
const mig = migrationProblems(files, readMig);
check(`every map read prices a sale like the Filter, and one spot is one pin${mig.length ? ' → ' + mig.join('; ') : ''}`, mig.length === 0);
mustCatch('the view left without price_total_effective', migrationProblems(files, (f) => f === FIX ? readMig(f).split("'    s.price_total_effective'").join("''") : readMig(f)).length > 0);
mustCatch('a map_pins_ar read left on the bare price', migrationProblems(files, (f) => f === FIX ? readMig(f).replace('if n <> 4 then', 'if n <> 3 then') : readMig(f)).length > 0);
mustCatch('a later migration putting the bare read back', migrationProblems([...files, '20991231000000_x.sql'], (f) => f === '20991231000000_x.sql' ? `create or replace function public.map_pins_ar() … ${OLD_PRICE}` : readMig(f)).length > 0);
mustCatch('the pill facts\' newest definition left on the bare price', migrationProblems([...files, '20991231000001_y.sql'], (f) => f === '20991231000001_y.sql' ? `create or replace function public.map_view_facts_core(p_s double precision) … ${OLD_PRICE}` : readMig(f)).length > 0);
mustCatch('spots grouped by their raw coordinates', migrationProblems(files, (f) => f === FIX ? readMig(f).split(NEW_LL).join('x') : readMig(f)).length > 0);

// 3. The sheet's fetch.
const remote = readFileSync(join(root, 'src/data/remote.ts'), 'utf8');
function fetchProblems(src: string): string[] {
  const at = src.indexOf('export async function fetchListingCards(');
  if (at < 0) return ['fetchListingCards is gone'];
  const body = src.slice(at, src.indexOf('\n}\n', at));
  const out: string[] = [];
  const all = body.indexOf('await Promise.all([');
  const card = body.indexOf('supabase.from(table).select(listSelectFor(table))');
  const place = body.indexOf("supabase.from('search_listings_ar')");
  if (all < 0 || card < all || place < all) out.push('the card and its place are not asked together');
  if (/await bounded\(supabase\.from\(/.test(body)) out.push('a read is awaited on its own (one extra round trip)');
  if (!/x\.deal_ar === 'بيع' \? \(x\.price_total_effective \?\? x\.price_total\)/.test(body) || !body.includes('price_total_effective,price_annual')) out.push('copies are folded by the bare price');
  return out;
}
const fp = fetchProblems(remote);
check(`the pin sheet asks once, in parallel, and folds by the full price${fp.length ? ' → ' + fp.join('; ') : ''}`, fp.length === 0);
mustCatch('the two reads asked one after the other', fetchProblems(remote.replace('  const [cardRead, loc] = await Promise.all([\n    bounded(supabase.from(table)', '  const cardRead = await bounded(supabase.from(table)')).length > 0);
mustCatch('folding by the bare price', fetchProblems(remote.replace('(x.price_total_effective ?? x.price_total)', 'x.price_total')).length > 0);

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nmap pin price = Filter price, one spot = one pin, sheet asks in parallel');
