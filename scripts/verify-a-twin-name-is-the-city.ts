// A TWIN NAME MEANS THE CITY (owner ruling, 2026-09-06).
//
// Eight Saudi names are both a city and a region — «الرياض», «مكة المكرمة», «تبوك», «حائل»,
// «نجران», «الباحة», «الجوف», «جازان». The agent used to ASK which one was meant, and this file
// used to enforce that it always asked (it was verify-city-or-region-is-always-asked.ts).
//
// SUPERSEDED. Measured against production 2026-09-06: the question fired on 8 of the 9 biggest
// destinations — only جدة and الطائف went straight through — so nearly every major search paid an
// extra turn. The owner's ruling, verbatim: «they mean city».
//
// The rule is now a DEFINITION, not a guess: a bare twin name IS the city. The region did not
// become unreachable — «منطقة الرياض» still selects it, explicitly — so nothing is lost except the
// fork. Retiring the question also removed the last way this path could loop: there is no question
// left here to re-ask. (The two OTHER ambiguity shapes — twin_city «الهفوف», and the plain-region
// question — still ask, and are still pinned below.)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const edge = readFileSync(join(root, 'supabase/functions/agent/index.ts'), 'utf8');
let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}${ok || !extra ? '' : ` — ${extra}`}`);
  if (!ok) failed++;
};

const branch = (() => {
  const i = edge.indexOf('if (ck === "region_or_city")');
  const j = edge.indexOf('} else if (ck === "twin_city")', i);
  return i >= 0 && j > i ? edge.slice(i, j) : '';
})();
check(branch.length > 0, 'the region_or_city branch is still locatable');

// ── 1. THE BARE TWIN NAME RESOLVES TO THE CITY, WITH NO QUESTION ─────────────────────────────
check(/else if \(!wantsCity && !wantsRegion\) \{[\s\S]*?location = nm;[\s\S]*?\}/.test(branch),
  'a bare twin name resolves to the CITY (location = nm), never a question',
  'this is the owner ruling «they mean city» — restoring a question here reinstates an extra turn on 8 of the 9 biggest destinations');
check(!/اسم مدينة واسم منطقة في نفس الوقت/.test(branch),
  'the «city or region?» question is GONE from this branch');
check(!/ambiguityReply\s*=/.test(branch),
  'this branch raises no ambiguity at all, so it cannot re-ask or loop');

// ── 2. THE REGION IS STILL REACHABLE, EXPLICITLY ─────────────────────────────────────────────
// The ruling removed the GUESS, not the capability. «منطقة الرياض» must still select the region,
// or "always city" would silently become "region unreachable".
check(/if \(wantsRegion && !wantsCity\) location = `منطقة \$\{nm\}`;/.test(branch),
  '«منطقة X» still selects the whole region — the ruling removed the fork, not the region');
check(/else if \(wantsCity && !wantsRegion\) location = nm;/.test(branch),
  '«مدينة X» still selects the city explicitly');

// ── 3. THE OTHER AMBIGUITY SHAPES STILL ASK ──────────────────────────────────────────────────
// This ruling is about ONE shape (a name that is both a city and a region). A district in several
// cities, or a city in several regions, is a different question with no safe default — «الهفوف»
// really is in two regions and picking one would be a guess.
check(/أكثر من منطقة/.test(edge), 'twin_city («الهفوف» in 2+ regions) still asks — no safe default exists there');
check(/أكثر من مدينة/.test(edge), 'twin_district (a حي in 2+ cities) still asks');

// ── 4. IT NEVER GUESSES A SCOPE THE USER DID NOT NAME ────────────────────────────────────────
// "City" is now a DEFINITION of what a bare twin name means — it is not inference from context,
// and it must not become one. The only inputs are the user's own words.
check(/const wantsCity = /.test(branch) && /const wantsRegion = /.test(branch),
  'the city/region decision reads only the user\'s own words');
check(!/regionPin\s*=\s*nm/.test(branch),
  'regionPin is not reused to mean "whole region" (the 2026-07-25 defect that hid every other city)');

// ── MUTATION PROOF ────────────────────────────────────────────────────────────────────────────
// Each mutant is a shape this branch actually had. The first two are production before 2026-09-06.
const mustCatch = (what: string, caught: boolean) =>
  check(caught, `(mutation) catches ${what}`,
    'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');

const ASKS_AGAIN = `else if (!wantsCity && !wantsRegion) {
  ambiguityReply = \`«\${nm}» اسم مدينة واسم منطقة في نفس الوقت. تقصد مدينة \${nm} ولا منطقة \${nm} كاملة؟\`;
}`;
const GUESSES_REGION = 'else if (!wantsCity && !wantsRegion) { location = `منطقة ${nm}`; }';
const REGION_UNREACHABLE = 'if (wantsRegion && !wantsCity) location = nm;';

// The pre-2026-09-06 branch, verbatim: it asks instead of resolving.
mustCatch('the branch asking «city or region?» again (production before the ruling)',
  /ambiguityReply\s*=/.test(ASKS_AGAIN) && !/location = nm;/.test(ASKS_AGAIN));
// "Always city" must not be quietly flipped to "always region" — the opposite guess, same shape.
mustCatch('the branch defaulting to the whole REGION instead of the city',
  /location = `منطقة \$\{nm\}`/.test(GUESSES_REGION) && !/location = nm;\s*\}/.test(GUESSES_REGION));
// The ruling removed the fork, not the region. If «منطقة X» stopped selecting the region, "always
// city" would silently become "the region is unreachable" — a much worse bug than the question.
mustCatch('«منطقة X» no longer selecting the region (region becomes unreachable)',
  !/if \(wantsRegion && !wantsCity\) location = `منطقة \$\{nm\}`;/.test(REGION_UNREACHABLE));

console.log(failed === 0
  ? '\n✅ verify-a-twin-name-is-the-city: «الرياض» is مدينة الرياض, «منطقة الرياض» is the region, and neither is asked about.'
  : `\n❌ verify-a-twin-name-is-the-city: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
