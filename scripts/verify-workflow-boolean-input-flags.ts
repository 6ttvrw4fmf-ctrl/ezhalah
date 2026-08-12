// A workflow_dispatch boolean input must never be compared to the STRING 'true'.
//
// THE BUG THIS EXISTS FOR (2026-08-12, owner-directed gathern backlog audit). `gathern-liveness.yml`
// gated its `--apply` flag on:
//
//     ${{ (github.event_name == 'schedule' || inputs.apply == 'true') && '--apply' || '' }}
//
// `apply` is declared `type: boolean`. In the `inputs.*` context GitHub hands the expression the
// TYPED value, so this compares boolean `true` to the string `'true'`. GitHub coerces mismatched
// operands to numbers — `true` → 1, `'true'` → NaN — so the comparison is ALWAYS false and
// `--apply` was never passed. Only the `github.event_name == 'schedule'` arm ever applied.
//
// What made it dangerous rather than merely broken: the step LABEL on the line above used the
// correct truthy form, so the run rendered as "Gathern liveness sweep (APPLY)" in the Actions UI
// while the command underneath ran a dry-run. A dispatch with apply=true reported success, changed
// nothing, and looked like an apply. It was caught only by reading `scrape_runs.notes` and seeing
// "DRY-RUN scanned=150 …" on a run whose job title said APPLY.
//
// That mattered because the manual dispatch is the ONLY reviewed path for releasing a backlog the
// anomaly cap has quarantined — the exact operation the owner had asked for on a 1,107-row cohort.
// The safety gate was fine; the release valve was welded shut and reported open.
//
// THE RULE: in the typed `inputs.*` context, a boolean input is used bare (`inputs.flag`). The
// string comparison is correct ONLY in the `github.event.inputs.*` context, which always yields
// strings — several workflows here legitimately do that, and untyped inputs are strings too, so
// this guard checks the DECLARED TYPE rather than banning the pattern outright.
//
// Deliberately OFFLINE (tracked repo files only), like the other verifiers in `npm test`.
//
// Run: node --experimental-strip-types scripts/verify-workflow-boolean-input-flags.ts
import { readFileSync, readdirSync } from 'node:fs';

const DIR = '.github/workflows';
const problems: string[] = [];
const ok: string[] = [];

const files = readdirSync(DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml')).sort();
if (files.length < 10) problems.push(`only ${files.length} workflow files found — scan is not seeing ${DIR}`);

/** Names of workflow_dispatch inputs declared `type: boolean` in this file. */
function booleanInputs(sql: string): Set<string> {
  const out = new Set<string>();
  // Input blocks are indented under `inputs:`; capture `name:` then look ahead for `type: boolean`
  // before the next sibling key at the same indentation.
  const re = /^(\s+)([A-Za-z_][\w-]*):\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const indent = m[1].length;
    const name = m[2];
    const rest = sql.slice(m.index + m[0].length);
    // Stop at the next line indented at or below this key's level that is itself a key.
    const stop = rest.search(new RegExp(`^\\s{0,${indent}}[A-Za-z_][\\w-]*:`, 'm'));
    const block = stop === -1 ? rest : rest.slice(0, stop);
    if (/^\s+type:\s*boolean\s*$/m.test(block)) out.add(name);
  }
  return out;
}

let scanned = 0;
for (const f of files) {
  const sql = readFileSync(`${DIR}/${f}`, 'utf8');
  const bools = booleanInputs(sql);
  if (!bools.size) continue;
  scanned++;
  for (const name of bools) {
    // Typed context only: `inputs.x`, NOT `github.event.inputs.x` (which is always a string).
    const bad = new RegExp(`(?<!\\.event\\.)\\binputs\\.${name}\\s*==\\s*'(?:true|false)'`);
    if (bad.test(sql)) {
      problems.push(
        `${f}: \`inputs.${name}\` is declared \`type: boolean\` but is compared to a string ` +
        `("== 'true'"). In the typed inputs.* context that comparison is ALWAYS false, so the flag ` +
        `it guards is silently never passed — use \`inputs.${name}\` bare, or read it via ` +
        `\`github.event.inputs.${name}\` if you really want the string form.`);
    }
  }
}
ok.push(`checked boolean workflow_dispatch inputs across ${scanned} workflow file(s)`);

// The specific regression: the gathern liveness step LABEL and the step COMMAND must gate `--apply`
// on the same predicate. They diverged once, and the label is what a human reads before believing a
// run applied anything.
const gl = files.includes('gathern-liveness.yml') ? readFileSync(`${DIR}/gathern-liveness.yml`, 'utf8') : '';
if (!gl) {
  problems.push('gathern-liveness.yml is missing — the liveness sweep has left the tree');
} else {
  const label = gl.match(/name:\s*Gathern liveness sweep \(\$\{\{\s*(.+?)\s*&&\s*'APPLY'/);
  const cmd = gl.match(/\$\{\{\s*(.+?)\s*&&\s*'--apply'/);
  if (!label || !cmd) {
    problems.push('gathern-liveness.yml: could not find both the APPLY label and the --apply command ' +
      'predicate — the guard cannot prove they agree, so it fails closed');
  } else if (label[1].trim() !== cmd[1].trim()) {
    problems.push(
      `gathern-liveness.yml: the step LABEL and the --apply COMMAND gate on different predicates, so ` +
      `a run can render as "APPLY" while executing a dry-run.\n      label:   ${label[1].trim()}\n` +
      `      command: ${cmd[1].trim()}`);
  } else {
    ok.push('gathern-liveness.yml: the APPLY label and the --apply command use the same predicate');
  }
}

const pkg = readFileSync('package.json', 'utf8');
if (!pkg.includes('verify-workflow-boolean-input-flags')) {
  problems.push('package.json no longer runs verify-workflow-boolean-input-flags.ts — the guard is inert');
} else {
  ok.push('npm test runs this guard');
}

console.log('workflow-boolean-input-flags: a boolean input must not be compared to a string\n');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const p of problems) console.error(`  ✗ ${p}`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} check(s) failed — a dispatch flag may be silently ignored.`);
  process.exit(1);
}
console.log('\n✅ workflow-boolean-input-flags: passed.');
