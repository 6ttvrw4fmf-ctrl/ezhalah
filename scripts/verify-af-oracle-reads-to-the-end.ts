// The AF full-surface differential's DB-truth side reads the WHOLE result, never a prefix (🔬 2026-11-09, alert 11763).
//
// Measured: verify-af-full-surface-differential.ts stopped its oracle at `off > MAX_IDS` (60,000) → 62,000 rows, and
// three nights of af-live-truth-check (42367029446, 42475448017, 42495155481) reported «chip 63474 ≠ DB truth 62000 …
// EXTRA 70 ineligible listing(s)» on a correct Jeddah Apartment/Buy search. This check EXECUTES scripts/lib/pageToEnd.ts
// against a stub index of that size, proves the old capped loop would have failed it, and pins that the oracle uses it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pageToEnd } from './lib/pageToEnd.ts';
import { windowBetween } from './lib/sourceWindow.ts';

let bad = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? '✓' : '✗'} ${label}`); if (!ok) bad++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const N = 63474;                                   // the real Jeddah Apartment/Buy size the old cap truncated
const table = Array.from({ length: N }, (_, i) => i);
const fetchPage = async (off: number, size: number) => table.slice(off, off + size);

// the old loop, verbatim in shape: break once off > 60000
async function cappedOld(): Promise<number[]> {
  const out: number[] = [];
  for (let off = 0; ; off += 1000) {
    const page = await fetchPage(off, 1000);
    out.push(...page);
    if (page.length < 1000 || off > 60000) break;
  }
  return out;
}

const read = await pageToEnd(fetchPage, 1000, 500000);
check(`reads all ${N} rows (got ${read.rows.length})`, read.rows.length === N && !read.truncated);
check('no duplicates and in order', read.rows.every((v, i) => v === i));

const exact = await pageToEnd(async (o, s) => table.slice(0, 3000).slice(o, o + s), 1000, 500000);
check('an exact multiple of the page size ends on the empty page, not truncated', exact.rows.length === 3000 && !exact.truncated);

const small = await pageToEnd(fetchPage, 1000, 10000);
check('hitting the ceiling with a full page is reported as truncated', small.truncated && small.rows.length === 10000);

const old = await cappedOld();
mustCatch(`the old MAX_IDS cap (it read ${old.length} of ${N})`, old.length !== N);
// a truncating variant that silently returns a prefix must be told apart from a full read
mustCatch('a ceiling hit that claims to be complete', small.truncated === true);

// the oracle really goes through it, and nothing in the oracle still breaks on MAX_IDS
const src = readFileSync(join(import.meta.dirname, 'verify-af-full-surface-differential.ts'), 'utf8');
const body = windowBetween(src, 'async function oracle(', 'async function oracleCount(', 'verify-af-full-surface-differential.ts');
check('oracle() pages through pageToEnd()', /pageToEnd<Row>\(/.test(body));
check('oracle() never stops on MAX_IDS', !/MAX_IDS/.test(body));
check('a truncated oracle read is reported NOT measured (unhandled), never judged', /read\.truncated[\s\S]{0,80}unhandled/.test(body));

if (bad) { console.error(`\n✗ verify-af-oracle-reads-to-the-end: ${bad} problem(s)`); process.exit(1); }
console.log('\n✅ verify-af-oracle-reads-to-the-end: the DB-truth side reads to the end');
