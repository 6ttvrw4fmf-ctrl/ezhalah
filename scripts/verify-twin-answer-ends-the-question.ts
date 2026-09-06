// THE TWIN QUESTION MUST END WHEN THE USER ANSWERS IT (owner screenshot, 2026-09-05).
//
// «الرياض» is a city AND a region, so the agent asks «تقصد مدينة الرياض ولا منطقة الرياض كاملة؟».
// A user answered «المدينة» and was asked THE IDENTICAL QUESTION AGAIN. Both halves of that turn
// were defects, and both are pinned here:
//
//   1. the reply «المدينة» carries «ال» fused, which the scope-word lookarounds deliberately reject
//      so «المدينة المنورة» is never mistaken for a scope choice. Right for a sentence, wrong for a
//      one-word answer — nothing consumed it, so the question repeated with no exit.
//   2. the ORIGINAL message said «مدنية الرياض» — «مدينة» with ي/ن transposed, one of the most
//      common Arabic typos. The user had named the city outright and was asked anyway.
//
// WHY A SOURCE TEST AND NOT ONLY A UNIT TEST. The fix lives in the edge function, which cannot be
// imported here (Deno, no module aliases) — the same reason decide.ts keeps a physical mirror of
// INTERVIEW_PHRASE_RE. So the regexes are EXTRACTED FROM THE DEPLOYED SOURCE and executed, rather
// than retyped: a copy that drifts from index.ts would pass while production stayed broken.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scopeNamedForTwin } from '../src/lib/regionOrCityAnswer.ts';

const root = join(import.meta.dirname, '..');
const edge = readFileSync(join(root, 'supabase/functions/agent/index.ts'), 'utf8');
let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}${ok || !extra ? '' : ` — ${extra}`}`);
  if (!ok) failed++;
};

// ── Pull the LIVE regexes out of the deployed edge source and run them ────────────────────────
const grab = (name: string) => {
  const m = new RegExp(`const ${name} = (?:alreadyAsked && )?(/[^\\n]*?/u)\\.test\\(text\\)`).exec(edge)
    ?? new RegExp(`const ${name} = \\w+ \\|\\| (/[^\\n]*?/u)\\.test\\(text\\)`).exec(edge);
  return m ? m[1] : null;
};
const src = { bareCity: grab('bareCity'), bareRegion: grab('bareRegion'), wantsCity: grab('wantsCity') };
check(!!src.bareCity && !!src.bareRegion, 'the edge defines a BARE-answer rule for the twin question',
  'without it a one-word «المدينة» is not an answer and the question repeats forever');
check(!!src.wantsCity, 'the edge still defines wantsCity');

const rx = (lit: string | null) => {
  if (!lit) return null;
  const m = /^\/(.*)\/([a-z]*)$/s.exec(lit);
  return m ? new RegExp(m[1], m[2]) : null;
};
const bareCity = rx(src.bareCity), bareRegion = rx(src.bareRegion), wantsCity = rx(src.wantsCity);

// ── 1. THE SCREENSHOT ─────────────────────────────────────────────────────────────────────────
if (bareCity && bareRegion && wantsCity) {
  check(bareCity.test('المدينة'), 'reply «المدينة» IS the city answer (the exact reply that looped)');
  check(bareCity.test('المدينه'), '…and the ه spelling «المدينه»');
  check(bareCity.test('مدينة'), '…and the un-prefixed «مدينة»');
  check(bareRegion.test('المنطقة'), 'reply «المنطقة» IS the region answer');
  check(wantsCity.test('ابي شقة يكون فيها جم حمامين في مدنية الرياض'),
    'the typo «مدنية الرياض» reads as a city, so the question is never asked (the screenshot\'s first message)');

  // ── 2. IT MUST NOT EAT A REAL PLACE ─────────────────────────────────────────────────────────
  // «المدينة المنورة» and «المنطقة الشرقية» are real places. The bare rule is whole-string, so a
  // two-word place can never match it — that is the property that makes this safe.
  check(!bareCity.test('المدينة المنورة'), '«المدينة المنورة» is NOT a bare scope answer');
  check(!bareCity.test('شقة في المدينة المنورة'), '…nor inside a sentence');
  check(!bareRegion.test('المنطقة الشرقية'), '«المنطقة الشرقية» is NOT a bare scope answer');
  check(!wantsCity.test('الأحوال المدنية'), '«الأحوال المدنية» is not a city intent (ال-fused «مدنية»)');

  // ── 3. THE BARE RULE IS GATED ON HAVING ASKED ───────────────────────────────────────────────
  // A lone «المدينة» is only unambiguous because WE asked. Unprompted it could mean Madinah.
  check(/const bareCity = alreadyAsked &&/.test(edge) && /const bareRegion = alreadyAsked &&/.test(edge),
    'the bare rule fires ONLY when we actually asked (alreadyAsked), never unprompted');
}

// ── 4. THE CLIENT HALF: the typo must not re-open the question there either ───────────────────
check(scopeNamedForTwin('ابي شقة يكون فيها جم حمامين في مدنية الرياض', 'الرياض') === 'city',
  'client: «مدنية الرياض» resolves to the city');
check(scopeNamedForTwin('مدينة الرياض', 'الرياض') === 'city', 'client: «مدينة الرياض» still resolves');
check(scopeNamedForTwin('منطقة الرياض', 'الرياض') === 'region', 'client: «منطقة الرياض» still resolves');
check(scopeNamedForTwin('الأحوال المدنية في الرياض', 'الرياض') === null,
  'client: «الأحوال المدنية» is not a scope choice');

// ── 5. THE STALE CLAIM IS GONE ────────────────────────────────────────────────────────────────
// The old comment asserted the loop was impossible while listing only two answer shapes. It was
// wrong, a user hit it, and a comment that confidently states a false invariant is worse than none.
check(!/NOT A LOOP\. The question is CLOSED — it names both options — and either answer\s*\n\s*\/\/ resolves it deterministically on the very next turn through the two branches above/.test(edge),
  'the superseded "NOT A LOOP" claim (which listed only two answer shapes) no longer stands unqualified');

// ── MUTATION PROOF ────────────────────────────────────────────────────────────────────────────
// A rule nobody has watched fail is indistinguishable from prose. Each mutant below is a shape this
// code actually had: the first two are production on 2026-09-05 (the screenshot), the third and
// fourth are the plausible over-corrections that would eat a real city.
const mustCatch = (what: string, caught: boolean) =>
  check(caught, `(mutation) catches ${what}`,
    'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');

const OLD_CITY = /(?<![\p{L}\p{N}])مدينة(?![\p{L}\p{N}])/u;          // production, pre-fix
const NO_ANCHOR = /(?:ال)?مدين[ةه]/u;                                    // bare rule without ^…$
mustCatch('the pre-fix rule, verbatim: a bare «المدينة» is not an answer (the reported loop)',
  !OLD_CITY.test('المدينة'));
mustCatch('the pre-fix rule, verbatim: the typo «مدنية الرياض» is not a city (the reported first turn)',
  !OLD_CITY.test('ابي شقة يكون فيها جم حمامين في مدنية الرياض'));
mustCatch('an un-anchored bare rule, which would swallow the real city «المدينة المنورة»',
  NO_ANCHOR.test('المدينة المنورة'));
mustCatch('an un-anchored bare rule firing mid-sentence, where no answer was given at all',
  NO_ANCHOR.test('ابغى شقة في المدينة المنورة'));

console.log(failed === 0
  ? '\n✅ verify-twin-answer-ends-the-question: the twin question ends when the user answers it.'
  : `\n❌ verify-twin-answer-ends-the-question: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
