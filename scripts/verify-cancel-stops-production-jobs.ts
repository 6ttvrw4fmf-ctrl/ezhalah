// A CANCELLED RUN MUST STOP HITTING PRODUCTION (2026-11-02).
//
// A job whose `if:` contains `always()` is NOT stopped when its workflow run is cancelled: GitHub
// re-evaluates the condition, always() says yes, and the job runs on to its own timeout. Measured
// 2026-11-02: af-live-truth-check run 41446221331 was cancelled at 15:00 UTC to free production, and its
// region and city sweeps (`if: always() && …`, timeout 90) kept walking the live database until 15:31.
// `!cancelled()` keeps what always() was there for (run even when a needed job FAILED) and honours a cancel.
//
// Rule: a job-level `if:` that uses always() is allowed only on a short reporter — it must declare
// `timeout-minutes` ≤ 10. Anything longer (a sweep, a crawl, a strike) uses !cancelled().
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const MAX_ALWAYS_MINUTES = 10;

export function alwaysJobProblems(file: string, text: string): string[] {
  const problems: string[] = [];
  const lines = text.split('\n');
  const jobsAt = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobsAt < 0) return problems;
  let job: string | null = null;
  let body: string[] = [];
  const flush = () => {
    if (!job) return;
    const cond = body.find((l) => /^ {4}if:/.test(l)) ?? '';
    if (/\balways\(\)/.test(cond)) {
      const t = body.find((l) => /^ {4}timeout-minutes:/.test(l));
      const mins = t ? Number(t.split(':')[1].trim()) : NaN;
      if (!(mins <= MAX_ALWAYS_MINUTES)) {
        problems.push(`${file} job "${job}": if: always() with timeout-minutes ${t ? mins : '<unset, 360>'} — ` +
          `a cancelled run would keep it running; use \${{ !cancelled() && … }} or cap it at ${MAX_ALWAYS_MINUTES}`);
      }
    }
  };
  for (const l of lines.slice(jobsAt + 1)) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l);
    if (m) { flush(); job = m[1]; body = []; continue; }
    if (/^\S/.test(l)) break;
    body.push(l);
  }
  flush();
  return problems;
}

// ── self-proof: the predicate must catch the real 2026-11-02 shape and pass the fixed one ──
const job = (cond: string, mins?: number) =>
  `jobs:\n  sweep:\n    runs-on: ubuntu-latest\n${mins ? `    timeout-minutes: ${mins}\n` : ''}    if: ${cond}\n    steps:\n      - run: echo\n`;
const selfProofs: Array<[string, boolean]> = [
  ['the 2026-11-02 sweep (always, 90 min) is RED', alwaysJobProblems('x', job("always() && needs.gate.outputs.shipped == 'yes'", 90)).length === 1],
  ['an always() job with no timeout (360 min default) is RED', alwaysJobProblems('x', job('always()')).length === 1],
  ['the fixed sweep (!cancelled, 90 min) is GREEN', alwaysJobProblems('x', job("${{ !cancelled() && needs.gate.outputs.shipped == 'yes' }}", 90)).length === 0],
  ['a 5-minute always() reporter is GREEN', alwaysJobProblems('x', job('always()', 5)).length === 0],
  ['a step-level always() is not a job condition', alwaysJobProblems('x', 'jobs:\n  a:\n    timeout-minutes: 90\n    steps:\n      - if: always()\n        run: echo\n').length === 0],
];

let failed = 0;
for (const [name, ok] of selfProofs) {
  if (!ok) { failed++; console.error(`✗ self-proof: ${name}`); }
}
const dir = join(process.cwd(), '.github', 'workflows');
const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort();
const problems = files.flatMap((f) => alwaysJobProblems(f, readFileSync(join(dir, f), 'utf8')));
for (const p of problems) console.error(`✗ ${p}`);
if (failed || problems.length) process.exit(1);
console.log(`✓ ${files.length} workflows: every job-level always() is a reporter capped at ${MAX_ALWAYS_MINUTES} min; ` +
  `${selfProofs.length} self-proofs hold`);
