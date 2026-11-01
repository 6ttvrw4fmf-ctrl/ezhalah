// UNKNOWN IS NOT NO — at the OFFER too (Falcon 2026-10-09, backlog 317; 🔬 AF engineer 2026-10-10)
//
//   node --experimental-strip-types scripts/verify-af-unknown-still-offers-narrowing.ts   (in `npm test`)
//
// The results turn shows «تحديد أكثر» from assessNarrowing()'s verdict ('yes' | 'no' | 'unknown').
// It read `verdict === 'yes'`, so when the counts timed out under load ('unknown') the customer saw no
// Advanced Filter at all: live-search-sweep run 37984840422 caught a 26,869-result Riyadh apartment
// scope with no offer inside the :20 refresh window, while the same scope offered it at 09:32. The
// interview's own tap path already retries an undetermined batch once and leaves the button in place if
// it still cannot tell (shouldRetryProbes / mayAssertNothingToNarrow), so offering on 'unknown' is safe.
//
// This barrier EXECUTES offersNarrowing (src/lib/afProbe.ts is pure) and pins that agent.tsx feeds the
// verdict through it, never through a re-derived comparison.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { offersNarrowing } from '../src/lib/afProbe.ts';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

check('a decided yes offers «تحديد أكثر»', offersNarrowing('yes'));
check('UNKNOWN offers «تحديد أكثر» (the tap re-probes)', offersNarrowing('unknown'));
check('only a decided no hides it', !offersNarrowing('no'));

const agent = readFileSync(join(process.cwd(), 'src/app/agent.tsx'), 'utf8')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');           // code, never a comment
const WIRED = /setAfCanNarrow\(\(c\) => \(\{ \.\.\.c, \[m\.id\]: offersNarrowing\(verdict\) \}\)\)/;
check('agent.tsx sets the offer through offersNarrowing(verdict)', WIRED.test(agent));
check("no call site re-derives the offer as `verdict === 'yes'`", !/\[m\.id\]:\s*verdict\s*===\s*'yes'/.test(agent));

// ── mutation proof: each guard must FAIL on its own defect ──────────────────────────────────────
console.log('\n  mutation proof — each guard must FAIL on its own defect\n');
let mutFail = 0;
const mustCatch = (label: string, brokenIsCaught: boolean) => {
  if (brokenIsCaught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
const oldRule = (v: 'yes' | 'no' | 'unknown') => v === 'yes';
mustCatch('the old rule (unknown hides the offer)', !oldRule('unknown'));
const reverted = agent.replace('offersNarrowing(verdict)', "verdict === 'yes'");
mustCatch('agent.tsx reverting to `verdict === \'yes\'`', !WIRED.test(reverted) && /\[m\.id\]:\s*verdict\s*===\s*'yes'/.test(reverted));
const commentOnly = agent.replace('offersNarrowing(verdict)', "verdict === 'yes'") + '\n// [m.id]: offersNarrowing(verdict)';
mustCatch('the wiring surviving only as a comment', !WIRED.test(commentOnly.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')));

if (failed || mutFail) {
  console.error(`\n❌ verify-af-unknown-still-offers-narrowing: ${failed} check(s), ${mutFail} mutation(s) failed`);
  process.exit(1);
}
console.log('\n✅ verify-af-unknown-still-offers-narrowing: an undetermined verdict keeps «تحديد أكثر» on screen.');
