// Two client defects that both turn "we don't know" into a confident wrong answer, found in the
// 2026-09-01 Advanced Filter audit.
//
// A. ARABIC-INDIC DIGITS WERE INVISIBLE TO parseQuery.
//    src/data/search.ts and src/lib/inputHygiene.ts BOTH exported `toLatinDigits`, with opposite
//    treatment of the surrounding text: search.ts folded the digits and then threw away everything
//    that was not a digit, inputHygiene folded them and kept the string. agent.ts imported the
//    former. Measured on the real bundled module before the fix:
//      toLatinDigits('ابغى شقة للايجار في الرياض ٣ غرف بسعر ٧٠٠٠٠')  ->  "370000"
//      parseQuery(that Arabic sentence)  -> { detail: null,  priceInput: ""      }
//      parseQuery(the same in 0-9)       -> { detail: "3",   priceInput: "70000" }
//    So the read-back rendered «تمام، فهمت أنك تبحث عن «370000»» and the offline/refine parse lost
//    both the bedroom count and the budget. The extractor is now named digitsOnly, which is what
//    makes the mix-up impossible rather than merely fixed — see check A1.
//
// B. A FAILED PROBE DELETED AN ANSWER THE USER HAD ALREADY GIVEN.
//    revalidateStepsAfter() read liveResultCount(), which returns null for BOTH "the source said
//    zero" and "the request never completed", then dropped the step on null. A timeout therefore
//    erased a committed AF answer from the query and from the receipt, silently. UNKNOWN IS NOT NO.
//
// Executed where the module is pure; asserted structurally where it is not (src/data/agent.ts and
// src/app/agent.tsx transitively import react-native and cannot be loaded from plain Node — the same
// constraint scripts/verify-agent-twin-scope.ts documents, with the measured verdicts recorded above).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toLatinDigits } from '../src/lib/inputHygiene.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  if (ok) console.log(`  PASS  ${msg}`);
  else { console.log(`  FAIL  ${msg}${extra ? ` — ${extra}` : ''}`); failed++; }
};

console.log('── A. digits ──');

// A1. THE ROOT CAUSE: one name, one meaning. If two modules export `toLatinDigits` again, importing
// the wrong one becomes possible again — so this is the check that actually prevents recurrence.
{
  const offenders: string[] = [];
  for (const f of ['src/data/search.ts', 'src/lib/inputHygiene.ts', 'src/data/agent.ts',
                   'src/lib/searchDefaults.ts', 'src/data/remote.ts']) {
    if (/export\s+(?:async\s+)?function\s+toLatinDigits\b/.test(read(f))) offenders.push(f);
  }
  check(offenders.length === 1 && offenders[0] === 'src/lib/inputHygiene.ts',
    'exactly ONE module exports toLatinDigits, and it is the text-preserving one',
    JSON.stringify(offenders));
  check(/export\s+function\s+digitsOnly\b/.test(read('src/data/search.ts')),
    'search.ts exports the digit EXTRACTOR under the unambiguous name digitsOnly');
}

// A2. EXECUTED: the surviving toLatinDigits folds every script and keeps the text.
{
  const ar = 'ابغى شقة للايجار في الرياض ٣ غرف بسعر ٧٠٠٠٠';
  const we = 'ابغى شقة للايجار في الرياض 3 غرف بسعر 70000';
  check(toLatinDigits(ar) === we, 'Arabic-Indic ٠-٩ fold to 0-9 with the sentence intact',
    JSON.stringify(toLatinDigits(ar)));
  check(toLatinDigits('۳ غرف') === '3 غرف', 'Persian/extended ۰-۹ fold too', JSON.stringify(toLatinDigits('۳ غرف')));
  check(toLatinDigits(we) === we, 'already-Latin text is unchanged (idempotent)');
  check(/[أ-ي]/.test(toLatinDigits(ar)), 'Arabic letters survive — the city/type dictionaries still match');
}

// A3. WIRING: the two numeric entry points latinize before reading digits. JS \d is ASCII-only, so a
// missing call here is silent — no error, just a query with no bedrooms and no budget.
{
  const agentTs = stripComments(read('src/data/agent.ts'));
  check(/import \{ toLatinDigits \} from '@\/lib\/inputHygiene'/.test(agentTs),
    'agent.ts imports the text-preserving latinizer');
  check(/from '\.\/search'/.test(agentTs) && !/\btoLatinDigits\b[^;]*from '\.\/search'/.test(agentTs),
    'agent.ts no longer takes toLatinDigits from ./search');
  check(/export function parseQuery\(text: string\): SearchQuery \{\s*const src = toLatinDigits\(text\);/.test(agentTs),
    'parseQuery latinizes at the door, before any digit is read');
  check(!/\bconst t = text\.toLowerCase\(\)/.test(agentTs),
    'parseQuery reads the latinized text, not the raw one');

  const agentTsx = stripComments(read('src/app/agent.tsx'));
  check(/toLatinDigits\(a\)\.match\(\/\\d\+\//.test(agentTsx),
    'the refine-chip bedroom read latinizes first (sibling of the same root cause)');
}

console.log('\n── B. a probe that did not answer is not a zero ──');

// B1. The distinction has to EXIST before a caller can honour it.
{
  const af = stripComments(read('src/data/advancedFilters.ts'));
  check(/export async function liveResultCountOrUnknown/.test(af),
    'advancedFilters exposes a counter that reports "unknown" separately');
  check(/if \(isProbeFailure\(c\)\) return 'unknown';/.test(af),
    "…and it returns 'unknown' exactly on a probe failure");
  check(/export async function liveResultCount\(/.test(af) && /if \(isProbeFailure\(c\) \|\| !c\) return null;/.test(af),
    'liveResultCount is UNCHANGED — null is still correct for the live footer, its other caller');
}

// B2. The consumer keeps the answer when the probe never completed, and only drops it on a real zero.
{
  const agentTsx = stripComments(read('src/app/agent.tsx'));
  const fnIdx = agentTsx.indexOf('const revalidateStepsAfter');
  check(fnIdx > -1, 'revalidateStepsAfter still exists');
  const body = agentTsx.slice(fnIdx, agentTsx.indexOf('ageFlowStepsRef.current = [...steps.slice(0, from + 1)', fnIdx));
  check(/liveResultCountOrUnknown\(/.test(body),
    'step revalidation asks the probe-aware counter');
  // STRUCTURAL: the keep must be the BODY of the unknown branch. Asserting the two merely coexist in
  // the function passes on `if (n === 'unknown') continue;`, which is the defect itself — the
  // function pushes to `kept` further down for other reasons.
  check(/if \(n === 'unknown'\) \{[^}]*kept\.push\(st\)/.test(body),
    "an 'unknown' KEEPS the step — a timeout must not delete a committed answer");
  check(!/if \(n == null \|\| n <= 0\) continue;/.test(body),
    'the old null-collapsing guard is gone');
  check(/if \(n <= 0\) continue;/.test(body),
    'a genuine zero still drops the step');
}

console.log(failed === 0
  ? '\n✅ verify-af-unknown-is-not-no-and-digits-are-script-blind: all checks passed.'
  : `\n❌ verify-af-unknown-is-not-no-and-digits-are-script-blind: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
