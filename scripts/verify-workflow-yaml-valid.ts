// EVERY .github/workflows/*.yml MUST BE VALID YAML WITH NO DUPLICATE KEYS.
//
// WHY THIS EXISTS (real defect, 2026-08-29 → 2026-08-30, found by routine #6).
// PR #1314 added a second `env:` block to one step of .github/workflows/ui-parity.yml:
//
//     - name: Run UI parity tests
//       env:
//         BASE_URL: ${{ ... }}
//       env:                          # <-- duplicate key in the same mapping
//         EZHALAH_ALLOW_PAID_AI: "1"
//
// YAML mappings may not repeat a key. GitHub Actions rejects the whole file, so from the moment
// that landed:
//   1. the workflow could not run AT ALL — every trigger produced a run that failed in 0 seconds,
//      before a single step, and
//   2. its nightly `schedule` (cron 30 3 * * *) therefore never fired again, so the production-UI
//      parity check silently stopped covering anything, and
//   3. every push and every PR got a red X for a workflow nobody had touched.
//
// (2) is the dangerous one and it is the exact failure class AGENTS.md is built around: "a monitor
// that cannot fire reads as 'clean'." Nothing went red to say the check had stopped — the check
// simply ceased to exist, while still appearing in the workflows directory. Note also that even a
// parser tolerant of duplicates would be wrong here in a second way: the second `env` REPLACES the
// first, so BASE_URL would have been silently dropped and the parity run would have had no target.
//
// WHY A BARRIER AND NOT JUST THE ONE-LINE FIX: this is a whole class. Any future edit to any of the
// ~60 workflow files can repeat a key or break the YAML, and the symptom is a workflow that stops
// existing rather than one that fails loudly. `npm test` runs offline and deterministically, so it
// catches this on the PR that introduces it instead of on the night the monitor was needed.
//
// NOTE ON THE PARSER: js-yaml's default schema tolerates duplicate keys (last one wins), which is
// precisely why this went unnoticed — so duplicates are detected structurally here rather than
// trusted to the loader's own error reporting.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = '.github/workflows';
const failures: string[] = [];
let checked = 0;

/**
 * Report every duplicate key in every mapping, at any depth, with a path for the error message.
 * Hand-walked rather than delegated to a loader because the loaders available here either accept
 * duplicates silently or stop at the first one.
 */
function findDuplicateKeys(src: string): string[] {
  const dups: string[] = [];
  const lines = src.split('\n');
  // indent -> the keys seen so far in the mapping currently open at that indent
  const openMappings = new Map<number, Map<string, number>>();

  lines.forEach((raw, i) => {
    const line = raw.replace(/\t/g, '    ');
    if (!line.trim() || /^\s*#/.test(line)) return;

    // A key line: optional "- " item marker, then `key:` at this indent.
    const m = /^(\s*)(-\s+)?([A-Za-z_][\w.-]*)\s*:(\s|$)/.exec(line);
    if (!m) return;
    const [, pad, dash, key] = m;
    // A "- key:" starts a NEW mapping (a new list item), so anything recorded at that indent or
    // deeper belongs to the previous item and must not collide with this one.
    const indent = pad.length + (dash ? dash.length : 0);

    for (const known of [...openMappings.keys()]) {
      if (known > indent || (dash && known === indent)) openMappings.delete(known);
    }
    if (!openMappings.has(indent)) openMappings.set(indent, new Map());
    const seen = openMappings.get(indent)!;
    if (seen.has(key)) {
      dups.push(`duplicate key «${key}» at line ${i + 1} (first seen at line ${seen.get(key)})`);
    } else {
      seen.set(key, i + 1);
    }
  });
  return dups;
}

let files: string[];
try {
  files = readdirSync(DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
} catch (e) {
  console.error(`❌ cannot read ${DIR}: ${e}`);
  process.exit(1);
}

// An empty run set is itself a failure — a glob that matches nothing must never read as "all clean".
if (!files.length) {
  console.error(`❌ no workflow files found in ${DIR} — this check cannot pass by matching nothing`);
  process.exit(1);
}

for (const f of files) {
  const path = join(DIR, f);
  const src = readFileSync(path, 'utf8');
  checked++;
  for (const d of findDuplicateKeys(src)) failures.push(`${path}: ${d}`);
}

// SELF-TEST: the detector must actually fire. A check no mutation can turn red is decoration
// (JOURNEY_PERSISTENCE_ENGINEER.md PART 11.4), so the exact shape of the 2026-08-29 defect is
// asserted to be caught, and a valid near-miss asserted NOT to be.
const BAD = [
  'jobs:', '  a:', '    steps:', '      - name: x', '        env:', '          A: "1"',
  '        env:', '          B: "2"',
].join('\n');
if (!findDuplicateKeys(BAD).length) {
  console.error('❌ SELF-TEST FAILED: the detector does not catch a duplicate `env:` in one step');
  process.exit(1);
}
const GOOD = [
  'jobs:', '  a:', '    steps:', '      - name: x', '        env:', '          A: "1"',
  '      - name: y', '        env:', '          B: "2"',
].join('\n');
if (findDuplicateKeys(GOOD).length) {
  console.error(`❌ SELF-TEST FAILED: two sibling list items each with their own \`env:\` is VALID, `
    + `but the detector flagged it: ${findDuplicateKeys(GOOD).join('; ')}`);
  process.exit(1);
}

if (failures.length) {
  console.error(`❌ ${failures.length} duplicate-key problem(s) across ${checked} workflow file(s):`);
  for (const f of failures) console.error(`   - ${f}`);
  console.error('\nGitHub Actions REJECTS a workflow with a duplicate key: the run fails in 0s before');
  console.error('any step, and any `schedule:` on it silently stops firing. Merge the blocks instead.');
  process.exit(1);
}

console.log(`PASS  ${checked} workflow file(s): no duplicate keys`);
console.log('PASS  self-test: the duplicate-`env:` shape from PR #1314 is detected');
console.log('PASS  self-test: sibling list items with their own `env:` are not false-flagged');
