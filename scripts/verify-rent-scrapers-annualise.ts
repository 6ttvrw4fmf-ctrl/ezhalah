// A SCRAPER THAT LABELS A RENT «monthly» MUST ANNUALISE IT.
//
// THE CONTRACT. `price_annual` holds a YEARLY figure. src/data/listings.ts divides it by 12 for any
// row whose rent_period is monthly, so the card can show the monthly rent the source published. A
// scraper that labels the period monthly and stores the raw monthly figure therefore renders 1/12 of
// the advertised rent.
//
// THE DEFECT (P1, incident #11). muktamel did exactly that on all 130 active monthly rows —
// 2,500/month shown as ~208, a 75,000 commercial showroom as 6,250. It was the ONE rent scraper in
// the fleet that labelled a period and never called annualize_rent().
//
// WHY THIS IS A CLASS BARRIER AND NOT A MUKTAMEL TEST. aqarcity fixed this identical bug on
// 2026-07-13 — its code still carries the comment, "storing the raw monthly showed 1/12 of the real
// rent (price-fidelity fix 2026-07-13)". The fix was applied to the scraper that was reported and to
// no other, and muktamel then shipped the same defect for eight weeks. A fix applied at one call site
// is the shape routine #8 exists for; the durable answer is a rule over EVERY scraper, so the next
// platform added cannot reintroduce it.
//
// TWO HALVES, because the bug can live in either:
//   WIRING — a scraper that writes a monthly period must route price_annual through the fleet's one
//     converter. This is a shape assertion by necessity: the defect is a call that ISN'T there.
//   BEHAVIOUR — and that converter must actually convert. annualize_rent() is executed here through
//     the real Python, not re-implemented, so a change to its arithmetic fails this too.
//
// Run: node --experimental-strip-types scripts/verify-rent-scrapers-annualise.ts

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const SCRAPERS = join(ROOT, 'scrapers');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

// ── The predicate, named so the mutations below apply THIS rule and not a copy of it. ─────────
const LABELS_MONTHLY = /rent_period\s*=[^\n]*["']monthly["']|["']rent_period["']\s*:\s*[^\n]*["']monthly["']/;
// The fleet converter, OR an explicit inline ×12 — six scrapers (aqarmonthly, gathern, october,
// sanadak, souq24, wasalt) do the multiplication in place and are equally correct: the contract is
// about the VALUE in the column, not about which code produced it. Accepting only the helper would
// have made this barrier red on six correct scrapers, and a barrier that cries wolf is one people
// learn to route around.
// …but the ×12 must be NEAR the price_annual write. A bare /\*\s*12/ anywhere in the file would be
// satisfied by an unrelated multiplication (a page size, a month index) — a predicate loose enough to
// pass the very defect it exists to catch. Look only in a window around each price_annual mention.
// THE INVARIANT, stated once: for a row labelled monthly, the figure written to price_annual has
// been multiplied by 12 somewhere. Three forms satisfy it, and all three are genuinely correct —
// accepting only the first would make this red on six correct scrapers, and a barrier that cries
// wolf is one people learn to route around:
//   (a) the fleet converter — annualize_rent() / rent_period_and_annual()
//   (b) a scraper-local helper whose NAME says it annualises — october's _rent_annualize()
//   (c) an inline ×12 at the write — aqarmonthly, gathern, sanadak, souq24, wasalt
// (c) is deliberately WINDOWED to ±3 lines of a price_annual mention: a bare /\*\s*12/ anywhere in
// the file would be satisfied by an unrelated multiplication (a page size, a month index), i.e. a
// predicate loose enough to pass the very defect this exists to catch.
// Any call whose NAME contains "annual" — annualize_rent(), rent_period_and_annual() (the fleet's
// other converter, which aouj uses), october's _rent_annualize(). An earlier version of this regex
// demanded "annualiz/s" and so silently dropped rent_period_and_annual, flagging aouj for using a
// converter this barrier is supposed to endorse.
const ANNUALISING_CALL = /\b[A-Za-z_]*annual[A-Za-z_]*\s*\(/;

// STRIP PYTHON COMMENTS AT THE READER (added 2026-09-04 by routine #10 — two proven holes).
//
// HOLE 1, the comment dodge. `# TODO: call annualize_rent(price, period) here one day` satisfied
// ANNUALISING_CALL, so the muktamel defect verbatim plus that one comment line read as CONVERTED and
// was never flagged. Watched: offends(<defect + that comment>) returned false. The barrier's own
// mutation claimed to cover this ("the converter mentioned in a COMMENT is not a call") but used a
// mention with NO parentheses — the one form the regex already rejected — so it proved the case that
// was never in doubt and passed straight over the case that was.
//
// HOLE 2, the unwindowed name. ANNUALISING_CALL was tested against the WHOLE FILE while the ×12 form
// was windowed to the write — and the file's own comment gives the reason windowing is required: a
// match far from `price_annual` "would be satisfied by an unrelated multiplication … a predicate
// loose enough to pass the very defect it exists to catch". That argument applies verbatim to a
// converter call sitting in the SALE branch, or in a helper for another field. Watched:
// offends(<defect + an unrelated `annual_report_page()` 80 lines away>) returned false.
//
// MEASURED BEFORE TIGHTENING, so this cannot be a barrier that cries wolf: all 13 monthly-labelling
// scrapers in the fleet carry their annualisation evidence WITHIN the ±3-line window already.
const stripPyComments = (src: string): string =>
  src.split('\n').map((l) => l.replace(/(^|[^'"])#.*$/, '$1')).join('\n');

/**
 * The annualisation evidence must sit next to the price_annual write — or next to the assignment of
 * the variable that write reads.
 *
 * ONE HOP, ON PURPOSE. Windowing on the write alone is too tight for a real, correct shape: wasalt
 * computes `rent_price = int(rf_monthly["amount"]) * 12` at line 404 and writes
 * `"price_annual": int(rent_price) …` at line 482, 78 lines later. Tightening to the write alone
 * flagged wasalt, which is CORRECT code — so the window follows the value instead of widening to
 * accept anything. A stray `* 12` still proves nothing unless it lands on the assignment of the very
 * identifier the write consumes.
 *
 * CEILING: one hop, textual. A value laundered through two intermediate variables would read as
 * unconverted (a false RED — the safe direction: it demands a human look, it never waves a defect
 * through). If a scraper ever legitimately needs two hops, follow the chain — do not widen the
 * window, and do not add an exemption.
 */
export const annualisesNearPriceAnnual = (raw: string): boolean => {
  const lines = stripPyComments(raw).split('\n');
  const near = (i: number) =>
    lines.slice(Math.max(0, i - 3), i + 4).some((w) => ANNUALISING_CALL.test(w) || /\*\s*12\b/.test(w));

  const writes = lines.map((l, i) => [l, i] as const).filter(([l]) => /price_annual/.test(l));
  if (writes.some(([, i]) => near(i))) return true;

  // One hop: the identifiers the write reads, and where each is assigned.
  const feeds = new Set(writes.flatMap(([l]) => l.match(/[A-Za-z_]\w*/g) ?? []));
  feeds.delete('price_annual');
  return lines.some((l, i) => {
    const assigned = /^\s*([A-Za-z_]\w*)\s*=[^=]/.exec(l)?.[1];
    return !!assigned && feeds.has(assigned) && near(i);
  });
};

/** A scraper that writes a monthly rent_period but never routes through the fleet converter. */
export const offends = (raw: string): boolean =>
  LABELS_MONTHLY.test(stripPyComments(raw)) && !annualisesNearPriceAnnual(raw);

// ── 1. WIRING, across every scraper in the tree. ──────────────────────────────────────────────
const runs = readdirSync(SCRAPERS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(SCRAPERS, d.name, 'run.py')))
  .map((d) => ({ name: d.name, src: readFileSync(join(SCRAPERS, d.name, 'run.py'), 'utf8') }));

check(`the scan still sees the fleet (${runs.length} scrapers with a run.py)`, runs.length >= 20,
  `found only ${runs.length} — the scan has gone blind`);

const monthly = runs.filter((r) => LABELS_MONTHLY.test(stripPyComments(r.src)));
check(`at least one scraper labels a monthly period (${monthly.length} do) — the rule has subjects`,
  monthly.length > 0);

const bad = runs.filter((r) => offends(r.src)).map((r) => r.name);
check('every scraper that labels a rent «monthly» routes price_annual through the fleet converter',
  bad.length === 0,
  `${bad.join(', ')} label a monthly period and never call annualize_rent()/rent_period_and_annual() — ` +
  'each stores a monthly figure in a column the card divides by 12, so it shows 1/12 of the source price');

// ── 2. BEHAVIOUR — the real converter, executed. ──────────────────────────────────────────────
const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(ROOT)})
from scrapers.common.normalize import annualize_rent as a
print(json.dumps({
  "monthly": a(2500, "monthly"),
  "annual":  a(30000, "annual"),
  "unknown": a(2500, None),
  "arabic":  a(2500, "شهري"),
  "quarter": a(2500, "quarterly"),
  "none":    a(None, "monthly"),
}))
`;
try {
  const out = JSON.parse(execFileSync('python3', ['-c', py], { encoding: 'utf8' }));
  check('annualize_rent: a monthly 2,500 becomes 30,000', out.monthly === 30000, `got ${out.monthly}`);
  check('annualize_rent: an ANNUAL figure is left alone', out.annual === 30000, `got ${out.annual}`);
  check('annualize_rent: an UNKNOWN period is left EXACTLY as published — never guessed into a period',
    out.unknown === 2500, `got ${out.unknown}`);
  check('annualize_rent: the Arabic «شهري» converts too', out.arabic === 30000, `got ${out.arabic}`);
  check('annualize_rent: quarterly is ×4, not ×12', out.quarter === 10000, `got ${out.quarter}`);
  check('annualize_rent: no price stays no price', out.none === null, `got ${out.none}`);
} catch (e) {
  check('annualize_rent could be executed', false, (e as Error).message.split('\n')[0]);
}

check('npm test runs this guard', npmTestRuns(ROOT, 'verify-rent-scrapers-annualise'), 'the guard is inert');

// ── 3. MUTATION PROOFS — the rule applied to the defect verbatim. ─────────────────────────────
const mustCatch = (what: string, caught: boolean) => check(`MUTATION: catches ${what}`, caught);

// muktamel's pre-fix source, verbatim.
mustCatch('the muktamel defect verbatim (labels monthly, assigns the raw figure)',
  offends('rent_period = None if _per_year is None else ("annual" if _per_year else "monthly")\nprice_annual = price'));
// The aqarcity shape — labels monthly AND converts — must NOT be flagged.
mustCatch('nothing — a scraper that labels monthly AND converts is not flagged (no false alarm)',
  !offends('rent_period = "monthly"\n"price_annual": normalize.annualize_rent(price, "monthly"),'));
// A scraper that never labels a monthly period is out of scope entirely.
mustCatch('nothing — a Buy-only scraper with no rent_period at all is out of scope',
  !offends('price_total = price'));
// The converter mentioned in a COMMENT is not a call. BOTH forms, because only the second one was
// ever in doubt: the original mutation used a mention with no parentheses, which ANNUALISING_CALL
// already rejected, so it proved nothing and the parenthesised form walked straight through.
mustCatch('a scraper that only MENTIONS the converter in prose',
  offends('rent_period = "monthly"\n# TODO: call annualize_rent here one day\nprice_annual = price'));
mustCatch('the comment dodge — a converter named WITH PARENTHESES inside a Python comment',
  offends('rent_period = "monthly"\n# TODO: call annualize_rent(price, period) here one day\nprice_annual = price'));
mustCatch('a converter named in a trailing comment on the write line itself',
  offends('rent_period = "monthly"\nprice_annual = price  # should be annualize_rent(price)'));
// The windowing must bind the CALL form exactly as it binds the ×12 form.
mustCatch('a real converter call that is nowhere near the price_annual write (a SALE-branch call)',
  offends(`def annual_report_page():\n    pass\n${'\n'.repeat(80)}rent_period = "monthly"\nprice_annual = price`));

// The one-hop rule, both directions — wasalt's real shape, and the same shape with the ×12 removed.
mustCatch('nothing — a ×12 on the ASSIGNMENT that feeds the write counts, however far away (wasalt)',
  !offends(`rent_period = "monthly"\nrent_price = int(amount) * 12\n${'\n'.repeat(60)}"price_annual": int(rent_price),`));
mustCatch('the same distant shape with the ×12 REMOVED (the hop must carry evidence, not just exist)',
  offends(`rent_period = "monthly"\nrent_price = int(amount)\n${'\n'.repeat(60)}"price_annual": int(rent_price),`));

mustCatch('a stray unrelated `* 12` standing in for a real annualisation',
  offends('rent_period = "monthly"\nPAGE = n * 12\n\n\n\n\n\nprice_annual = price'));
mustCatch('nothing — an inline ×12 on the line ABOVE the write is still a real annualisation',
  !offends('rent_period = "monthly"\nannual = monthly * 12\nprice_annual = annual'));
// october's real shape: `price_annual = price` initialises the SALE case and is overwritten for Rent
// by a scraper-local _rent_annualize(). Flagging it would be a false alarm on correct code.
mustCatch('nothing — the fleet\'s OTHER converter, rent_period_and_annual(), counts (aouj\'s real shape)',
  !offends('rent_period = "monthly"\nrent_period, price_annual = N.rent_period_and_annual(price, period_text)'));
mustCatch('nothing — a scraper-local _rent_annualize() helper counts (october\'s real shape)',
  !offends('rent_period = "monthly"\ndef _rent_annualize(p, u): return p * 12\nprice_annual = price\nprice_annual = _rent_annualize(price, unit)'));

console.log(failed === 0
  ? `\n✅ verify-rent-scrapers-annualise: every monthly-labelling scraper converts, and the converter converts.\n`
  : `\n❌ verify-rent-scrapers-annualise: ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
