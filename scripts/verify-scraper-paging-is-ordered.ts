// A SCRAPER THAT PAGES THROUGH A TABLE MUST PAGE IN A FIXED ORDER (2026-11-05).
// `.range(start, start + 999)` with no `.order(...)` asks Postgres for «rows 1000-1999 in whatever order you happen to
// scan them». While other runs write the same table (24 dealapp shards, 12 at a time, upserting dealapp_*_listings),
// an UPDATE moves a row to a new place in the heap between two page reads, so the walk silently SKIPS some rows and
// reads others twice. Measured 2026-11-05: dealapp shard 22/24 had 3 fetch failures and still re-confirmed only
// 1,674 of the 2,113 active ads it owns — the reconfirm list (scrapers/dealapp/run.py::_active_ids_for_reconfirm)
// never contained the rest, so the prune guard withheld and enumeration_incomplete:dealapp stayed open for weeks.
// RULE: every `.range(<variable>, …)` page (a paging walk, not a one-shot fixed window) carries `.order(` in the same
// chained statement. Discovered by SHAPE across scrapers/**/*.py, never from a list.
// Run: node --experimental-strip-types scripts/verify-scraper-paging-is-ordered.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

export function unorderedPages(src: string): number[] {
  const lines = src.split('\n');
  const bad: number[] = [];
  lines.forEach((l, i) => {
    if (!/\.range\(\s*[A-Za-z_]/.test(l)) return;             // a paging walk: the offset is a variable
    // the chained statement: walk back to the line that opens it (`.table(`), at most 8 lines
    let j = i, chain = l;
    while (j > 0 && i - j < 8 && !/\.table\(/.test(lines[j])) { j--; chain = lines[j] + '\n' + chain; }
    // Judged only where the query is BUILT in the same statement. A helper paging a builder it was handed
    // (`_all(q)`, `make_query().range(...)`) cannot be judged from this line; its order is the caller's.
    if (!/\.table\(/.test(chain)) return;
    if (!/\.order\(/.test(chain)) bad.push(i + 1);
  });
  return bad;
}

function pyFiles(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== 'tests' && n !== '__pycache__') out.push(...pyFiles(p)); }
    else if (n.endsWith('.py')) out.push(p);
  }
  return out;
}

let failed = 0;
const check = (m: string, c: boolean, d = '') => { if (c) console.log(`  ✓ ${m}`); else { console.error(`  ❌ ${m}${d ? `\n      ${d}` : ''}`); failed++; } };
const mutation = (m: string, caught: boolean) => check(`(mutation) catches ${m}`, caught);

const hits: string[] = [];
let walks = 0;
for (const f of pyFiles(join(ROOT, 'scrapers'))) {
  const src = readFileSync(f, 'utf8');
  walks += (src.match(/\.range\(\s*[A-Za-z_]/g) ?? []).length;
  for (const ln of unorderedPages(src)) hits.push(`${relative(ROOT, f)}:${ln}`);
}
check(`found the paging walks to look at (${walks})`, walks >= 5, 'the shape stopped matching — fix the predicate, never the floor');
check('every paging walk over a table carries .order(...) in the same statement', hits.length === 0, hits.join('\n      '));

const WALK = `rows = db._execute(\n    db.sb().table(t).select("ad_number").eq("active", True)\n      .range(start, start + 999), what="x").data`;
mutation('the measured dealapp shape (no order)', unorderedPages(WALK).length === 1);
check('the same walk with .order("id") passes', unorderedPages(WALK.replace('.eq("active", True)', '.eq("active", True).order("id")')).length === 0);
check('a one-shot fixed window (.range(0, 4999)) is not a paging walk', unorderedPages('db.sb().table(t).select("x").range(0, 4999)').length === 0);
check('a helper paging a handed-in builder is the caller\'s call, not judged here', unorderedPages('rows = q.range(lo, lo + 999).execute().data').length === 0);
mutation('an order placed on ANOTHER statement does not count', unorderedPages('q = c.table(a).select("x").order("id")\n' + 'r = c.table(b).select("y")\n  .range(off, off + 999)').length === 1);

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ every scraper paging walk reads in a fixed order');
