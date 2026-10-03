// Every .py under scrapers/ and scripts/ must parse on Python 3.11.
//
// The ♻️ Lifecycle Engineer's container runs 3.11; CI runs 3.13. On 2026-10-02 a test file with a
// backslash inside an f-string field (PEP 701, 3.12+) could not be imported there and was skipped
// (#5608 → #5640). The detector is scripts/check_py311_syntax.py (tokenize + ast on 3.12+,
// compile() on 3.11); scrapers/common/tests/test_py311_syntax_guard.py proves it against true and
// false positives. This wrapper puts the repo scan in `npm test`, which runs on EVERY pull request —
// common-location-tests.yml only runs on scrapers/** changes, so a scripts/*.py offender needs it.
//
//   node --experimental-strip-types scripts/verify-py311-syntax.ts

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

// MUTATION PROOF: the same predicate (a clean zero exit) must FAIL on a file that is valid on 3.13
// and illegal on 3.11 — a backslash inside an f-string replacement field — and PASS on one that is
// legal on both, or this wrapper would pass anything.
{
  const dir = mkdtempSync(join(tmpdir(), 'py311-proof-'));
  const run = (name: string, src: string) => {
    const f = join(dir, name);
    writeFileSync(f, src);
    return spawnSync('python3', ['scripts/check_py311_syntax.py', f], { cwd: ROOT, stdio: 'ignore' }).status;
  };
  const bad = run('bad.py', 'x = "a"\nprint(f"{x + \'\\n\'}")\n');
  const good = run('good.py', 'x = "a"\nprint(f"{x}")\n');
  rmSync(dir, { recursive: true, force: true });
  const mustCatch = (what: string, caught: boolean) => {
    if (!caught) { console.error(`✗ MUTATION SURVIVED: ${what} was NOT caught`); process.exit(1); }
  };
  mustCatch('a backslash inside an f-string field (legal on 3.13, illegal on 3.11)', bad !== 0);
  mustCatch('the guard failing a file that is legal on 3.11', good === 0);
}
const res = spawnSync('python3', ['scripts/check_py311_syntax.py'], { cwd: ROOT, stdio: 'inherit' });
if (res.error) { console.error(`✗ could not run python3: ${res.error.message}`); process.exit(1); }
// Only a clean zero exit passes; a signal-killed child reports status null and must not read green.
process.exit(res.status === 0 ? 0 : 1);
