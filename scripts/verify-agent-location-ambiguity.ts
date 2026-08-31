// Regression guard for the three LOST location-ambiguity cases restored from the deleted client-side
// src/app/agent.tsx locationClarification() (round-2 fix, "LOST LOCATION-AMBIGUITY CASES"). Executes
// the REAL supabase/functions/agent/locationAmbiguity.ts functions — never a re-typed copy.
//
//   node --experimental-strip-types scripts/verify-agent-location-ambiguity.ts   (auto-discovered by npm test)

import { plainRegionQuestion, emptyLocationQuestion } from '../supabase/functions/agent/locationAmbiguity.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nCASE 1 — a plain (non-twin) region: whole-region-vs-a-named-city\n');
{
  const r = plainRegionQuestion('عسير', 'أبغى شقة في عسير');
  check('a plain region with no "whole" wording -> asks whole-region-vs-city', r === 'تقصد عسير كاملة، أو مدينة معيّنة؟', String(r));

  const whole = plainRegionQuestion('عسير', 'أبغى شقة في عسير كاملة');
  check('the user already said "كاملة" this turn -> no ambiguity (null)', whole === null, String(whole));

  const wholeVariant = plainRegionQuestion('المنطقة الشرقية', 'ابي عقار في كل المنطقة الشرقية');
  check('"كل المنطقة" phrasing also counts as already-whole -> null', wholeVariant === null, String(wholeVariant));
}

console.log('\nCASE 2 — an empty-location proximity phrase: smart question echoing the user\'s own words\n');
{
  const r = emptyLocationQuestion('أبغى شقة قريبة من مستشفى الحبيب');
  check('a named proximity phrase -> echoes it back', r === 'في أي مدينة تبحث عن عقار قريبة من مستشفى الحبيب؟', String(r));

  const en = emptyLocationQuestion('a villa near the mall please');
  check('an English "near" phrase is recognised too', en !== null && en.includes('near the mall please'), String(en));
}

console.log('\nCASE 3 — a bare geography cue with no city\n');
{
  const r = emptyLocationQuestion('أبي بيت قرب البحر');
  // "قرب البحر" itself matches the generic NEAR phrase FIRST (case 2 takes priority — it is the more
  // specific, echoable match), which is correct: "near the sea" IS a proximity phrase, so echoing it
  // ("في أي مدينة تبحث عن عقار قرب البحر؟") is strictly better UX than the generic geography question.
  check('"قرب البحر" is caught (via the proximity match, which is a superset of this cue)', r !== null, String(r));

  const bare = emptyLocationQuestion('أبي شقة على الكورنيش');
  check('a bare geography cue with NO "near/قرب" wording -> the generic geography question',
    bare === 'تقصد في أي مدينة أو منطقة؟', String(bare));

  const mountain = emptyLocationQuestion('أدور شي بالجبال أجواء باردة');
  check('a mountain/highlands cue -> the generic geography question', mountain === 'تقصد في أي مدينة أو منطقة؟', String(mountain));
}

console.log('\nNEGATIVE — an ordinary message with neither cue must not be turned into an ambiguity\n');
{
  check('a plain type-only message -> null', emptyLocationQuestion('أبغى فيلا') === null);
  check('a plain budget-only message -> null', emptyLocationQuestion('ميزانيتي ٥٠٠ ألف') === null);
}

console.log(failures === 0
  ? '\n✅ verify-agent-location-ambiguity: all checks passed.\n'
  : `\n❌ verify-agent-location-ambiguity: ${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
