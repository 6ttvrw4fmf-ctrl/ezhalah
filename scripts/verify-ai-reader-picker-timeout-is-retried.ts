// A PICKER TIMEOUT IS LOAD, NOT "NOTHING TO READ" (owner 2026-10-29: «make sure we capture it all»).
//
// On 2026-10-29 the 16 parallel lanes asked facts_ai_todo_ids for aqar (~170k ads) at the same second; it took 0.24 s
// alone but hit the statement timeout in every lane, which printed «sampling failed» and moved on — so ~42k unread
// Aqar ads were skipped round after round while every lane finished green. scrapers/facts/extract.py must retry a
// statement timeout (with a wait) before giving up on a table. Each guard is proven by a mutation it must catch.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let failed = 0;
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
const check = (label: string, ok: boolean) => { console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}`); if (!ok) failed++; };

export const retriesTimeout = (py: string): boolean => {
  const n = /^SAMPLE_RETRIES = (\d+)/m.exec(py);
  return !!n && Number(n[1]) >= 2 &&
    /def is_statement_timeout\(e: Exception\) -> bool:\n\s+return "57014" in str\(e\)/.test(py) &&
    /for attempt in range\(SAMPLE_RETRIES \+ 1\):/.test(py) &&
    /if is_statement_timeout\(e\) and attempt < SAMPLE_RETRIES:[\s\S]{0,300}time\.sleep\(wait\)\n\s+continue/.test(py);
};

const PY = readFileSync(join(process.cwd(), 'scrapers', 'facts', 'extract.py'), 'utf8');
console.log('A picker timeout is retried, never read as nothing to read');
check('extract.py retries a statement timeout before skipping a table', retriesTimeout(PY));
mustCatch('retries set to 0', !retriesTimeout(PY.replace(/^SAMPLE_RETRIES = \d+/m, 'SAMPLE_RETRIES = 0')));
mustCatch('the retry loop removed', !retriesTimeout(PY.replace('for attempt in range(SAMPLE_RETRIES + 1):', 'for attempt in range(1):')));
mustCatch('a timeout no longer recognised', !retriesTimeout(PY.replace('return "57014" in str(e)', 'return False and str(e)')));
if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ a picker timeout is retried');
