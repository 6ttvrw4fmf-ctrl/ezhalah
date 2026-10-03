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
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const res = spawnSync('python3', ['scripts/check_py311_syntax.py'], { cwd: ROOT, stdio: 'inherit' });
if (res.error) { console.error(`✗ could not run python3: ${res.error.message}`); process.exit(1); }
// Only a clean zero exit passes; a signal-killed child reports status null and must not read green.
process.exit(res.status === 0 ? 0 : 1);
