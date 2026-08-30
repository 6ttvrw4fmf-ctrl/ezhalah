// Barrier: A FILTER WE COULD NOT APPLY MUST BE SAID OUT LOUD.
// Owner ruling 2026-08-30: "I do not want Ezhalah silently ignoring something the user asked for."
//
// THE HOLE THIS CLOSES. lastRejectedFilters was written on every refusal — uncertified AF intent,
// off-vocabulary value, an amenity this cohort cannot express — and read by NOBODY. The search ran
// without the filter and the reply never mentioned it, so from the user's side the request simply
// evaporated. Recording a refusal in a variable nobody reads is not honesty; it is a log entry.
//
// THE RULES IT PINS (all four are the owner's):
//   1. never pretend the rejected filter was applied
//   2. never block the whole search over one optional filter
//   3. apply everything we CAN apply
//   4. say it once, in plain words — no "Advanced Filter", no certification, no error tone
//
// Executes the real registry for the state half; asserts the wiring for the reply half.
import { readFileSync } from 'node:fs';
import { cohortAllows } from '../src/lib/afCohorts.ts';
import { applyAfIntents } from '../src/lib/afIntents.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

const agent = readFileSync('src/data/agent.ts', 'utf8');
const code = agent.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');  // assert on code
const i18n = readFileSync('src/i18n.tsx', 'utf8');

// ── 1. A REFUSAL IS STILL PRODUCED (the state half, executed) ───────────────────
// rating is a Gathern/monthly signal; on ANNUAL rent it must not apply — and must not vanish.
{
  const annual: any = { category: 'Residential', type: 'Apartment', deal: 'Rent',
                        rentPeriod: 'annual', location: 'الرياض', platforms: [], amenities: [] };
  check('the sample cohort really does NOT certify rating', !cohortAllows(annual, 'rating'));
  const r = applyAfIntents(annual, { rating: '9.5' });
  check('an uncertified value is NOT applied', (r.q as any).ratingMin === undefined);
  check('an uncertified value IS recorded as rejected', r.rejected.includes('rating'));
  // "apply everything we CAN apply": a certified sibling in the SAME sentence still lands.
  const both = applyAfIntents(annual, { rating: '9.5', bathrooms: 2 });
  check('a certified filter in the same message is still applied',
    (both.q as any).bathMin === 2, 'one unsupported filter must not discard the rest');
  check('the search is not blocked by the refusal', (both.q as any).type === 'Apartment');
}

// ── 2. THE REFUSAL REACHES THE USER (the reply half, wired) ─────────────────────
check('rejections have a runtime reader, not just a writer',
  /function rejectionNotice\(\)/.test(code),
  'lastRejectedFilters existed for weeks with no reader — that was the whole bug');
check('the notice is built from lastRejectedFilters',
  /rejectionNotice[\s\S]{0,400}lastRejectedFilters/.test(code));
check('the notice is appended to the reply the user sees',
  /const notice = rejectionNotice\(\);[\s\S]{0,200}backend\.reply = /.test(code),
  'computing a notice and not attaching it would be the same silence in a new place');
check('the notice is a TAIL, so the reply still leads with what we ARE searching for',
  /\$\{String\(backend\.reply[\s\S]{0,40}\}\\n\$\{notice\}/.test(code));

// ── 3. SAID ONCE, NOT EVERY TURN ────────────────────────────────────────────────
check('an already-explained filter is not explained again',
  /announcedRejections\.has\(f\)/.test(code) && /announcedRejections\.add\(f\)/.test(code));
check('a new conversation forgets what it already explained',
  /resetRejectionNotices\(\)/.test(code) && /!opts\?\.prevQuery/.test(code));
check('the id is normalised, so rating:VALUE and rating are the same caveat',
  /split\(':'\)\[0\]/.test(code));

// ── 4. THE WORDING ──────────────────────────────────────────────────────────────
const KEY = 'That option is not available in this search, so I showed the results without it.';
check('the notice is translated, not a hardcoded English string', i18n.includes(KEY));
check('the Arabic is the owner’s own wording',
  i18n.includes('هالخيار مو متوفر حالياً في هالبحث، فطلعت لك النتائج بدون هالشرط.'));
for (const banned of ['الفلتر المتقدم', 'Advanced Filter', 'certif', 'cohort', 'خطأ', 'error']) {
  const line = i18n.slice(i18n.indexOf(KEY), i18n.indexOf(KEY) + 400);
  check(`the wording avoids technical framing (${banned})`, !line.includes(banned));
}

console.log(
  failures === 0
    ? '\n✓ an unsupported filter is applied-where-possible, never faked, and said once in plain words'
    : `\n✗ ${failures} rejection-honesty check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
