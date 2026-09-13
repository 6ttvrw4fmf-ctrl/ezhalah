/**
 * THE RESTORE ORACLE MUST BE ABLE TO SEE THE DISTRICT (routine #6, 2026-09-13).
 *
 * `verify-web-runtime-smoke.mjs` asserts three times that a cancelled Filter search «restores
 * city/district/area EXACTLY» ([E] desktop rapid-cancel, [F] mid-flight cancel, [H] mobile). Its
 * oracle read every visible <input>'s value — which cannot see a picked district in EITHER
 * direction, because tapping a district suggestion CLEARS the text input and renders the pick as a
 * `[data-testid="district-chip"]` instead. The district half of all three assertions compared '' to
 * '' and passed whether the district survived the cancel or was silently dropped.
 *
 * That is PART 9.5's class: a check reporting a PASS while asserting nothing about the thing it
 * names. The invariant underneath is real and has a history — the 2026-08-14 "silent widening" bug,
 * where an untouched resubmit dropped the chosen حي and searched the whole city (+989 listings).
 * ops_incident #224 read this assertion's pass as evidence the UI had restored the district while
 * the request dropped it; it was never evidence about the district at all.
 *
 * THIS CHECK EXECUTES THE REAL ORACLE. It imports the same `readRestoredFormState` the smoke script
 * hands to `page.evaluate()` and runs it against synthetic DOMs, so the thing proven is the code
 * that actually decides the verdict — not a copy of it, and not its source text. A source-TEXT
 * tripwire over the old line would have stayed green for the whole life of the defect, because the
 * defective line looked entirely correct.
 *
 * THE LOAD-BEARING ASSERTION is D3: a form with the district picked and a form with the district
 * DROPPED must not compare equal. That is the exact discrimination the smoke's three checks need
 * and the one the old oracle could not make.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRestoredFormState } from '../e2e/lib/formRestoreOracle.mjs';

const ROOT = join(import.meta.dirname, '..');
const fail: string[] = [];
const check = (id: string, ok: boolean, detail = '') => {
  if (ok) console.log(`  ok   ${id}`);
  else { console.log(`  FAIL ${id} ${detail}`); fail.push(`${id} ${detail}`); }
};

// ── a synthetic DOM, hand-rolled so this check needs no browser and no jsdom ────────────────────
type El = {
  value?: string;
  textContent?: string;
  offsetParent: unknown;
  _sel: string[];                      // selectors this element answers to
  _inSigninCard?: boolean;
  closest(sel: string): unknown;
};
const input = (value: string, opts: { visible?: boolean; signin?: boolean } = {}): El => ({
  value,
  offsetParent: opts.visible === false ? null : {},
  _sel: ['input'],
  _inSigninCard: !!opts.signin,
  closest(sel: string) { return sel === '[data-testid="signin-card"]' && this._inSigninCard ? {} : null; },
});
const chip = (text: string): El => ({
  textContent: text,
  offsetParent: {},
  _sel: ['[data-testid="district-chip"]'],
  closest() { return null; },
});
const doc = (els: El[]) => ({
  querySelectorAll: (sel: string) => els.filter((e) => e._sel.includes(sel)),
});

// The real shape of the owner-example form: city filled, district picked (so its input is EMPTY and
// a chip carries it), min/max area filled.
const CITY = 'الرياض', DIST = 'حي النرجس';
const withDistrict = doc([input(CITY), input(''), input('80'), input('150'), chip(DIST)]);
const districtDropped = doc([input(CITY), input(''), input('80'), input('150')]);

// ── D1-D2: it still reads everything the old oracle read ───────────────────────────────────────
const got = readRestoredFormState(withDistrict as never);
check('D1 visible input values are still read, in order',
  JSON.stringify(got.inputs) === JSON.stringify([CITY, '', '80', '150']), JSON.stringify(got.inputs));
check('D2 the picked district is read from its chip',
  JSON.stringify(got.districts) === JSON.stringify([DIST]), JSON.stringify(got.districts));

// ── D3: THE LOAD-BEARING ONE — a dropped district must change the answer ────────────────────────
// With the old inputs-only oracle these two are byte-identical, which is precisely the defect.
const a = JSON.stringify(readRestoredFormState(withDistrict as never));
const b = JSON.stringify(readRestoredFormState(districtDropped as never));
check('D3 a form whose district was DROPPED does not compare equal to one where it survived',
  a !== b, `picked=${a} dropped=${b}`);
check('D3b and the inputs alone genuinely cannot tell them apart (so D3 is doing real work)',
  JSON.stringify(readRestoredFormState(withDistrict as never).inputs)
    === JSON.stringify(readRestoredFormState(districtDropped as never).inputs));

// ── D4-D6: the pre-existing exclusions and hygiene still hold ───────────────────────────────────
check('D4 hidden inputs are excluded',
  JSON.stringify(readRestoredFormState(doc([input(CITY), input('x', { visible: false })]) as never).inputs)
    === JSON.stringify([CITY]));
check('D5 the sign-in card\'s own inputs are excluded',
  JSON.stringify(readRestoredFormState(doc([input(CITY), input('a@b.c', { signin: true })]) as never).inputs)
    === JSON.stringify([CITY]));
check('D6 multi-select districts are all read, in DOM order',
  JSON.stringify(readRestoredFormState(doc([chip('حي أ'), chip('حي ب')]) as never).districts)
    === JSON.stringify(['حي أ', 'حي ب']));
check('D7 an empty-text chip is not counted as a district',
  readRestoredFormState(doc([chip('   ')]) as never).districts.length === 0);

// ── D9: THE NO-ARGUMENT CALL — how page.evaluate() actually invokes it ──────────────────────────
// Playwright serialises the function into the browser and calls it with NO argument, so the reader
// must fall back to the ambient document. The first draft of this fix did not, and threw
// «Cannot read properties of undefined (reading 'querySelectorAll')» on the very first snapshot
// against production — while D8/D8b (wiring, by text) both passed. That is precisely why this case
// is EXECUTED: a wiring assertion proves the call site, never that the call works.
{
  const saved = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = withDistrict;
  let threw = '';
  let out: { inputs: string[]; districts: string[] } = { inputs: [], districts: [] };
  try { out = (readRestoredFormState as () => typeof out)(); } catch (e) { threw = String(e); }
  (globalThis as { document?: unknown }).document = saved;
  check('D9 calling it with NO argument (how page.evaluate does) does not throw', threw === '', threw);
  check('D9b and that no-argument call reads the ambient document',
    JSON.stringify(out.districts) === JSON.stringify([DIST]), JSON.stringify(out));
}

// ── D8: WIRING — the smoke script must actually use this reader, not an inline copy ─────────────
// Not a substitute for the execution above; it is what stops the fix decaying back into an
// inputs-only closure that this file would then be proving nothing about.
const smoke = readFileSync(join(ROOT, 'scripts/verify-web-runtime-smoke.mjs'), 'utf8');
check('D8 the smoke script imports the shared reader', smoke.includes('readRestoredFormState'));
check('D8b it hands that reader to page.evaluate rather than an inline oracle',
  /page\.evaluate\(\s*readRestoredFormState\s*\)/.test(smoke));
check('D8c no inline querySelectorAll(\'input\') restore oracle has crept back in',
  !/querySelectorAll\('input'\)[\s\S]{0,200}\.map\(\(e\) => e\.value\)/.test(smoke));

// ── MUTATION PROOFS — the predicate above, applied to DELIBERATELY BROKEN readers ───────────────
// Each mutant is a real alternative implementation of the oracle, run through this file's OWN
// discriminating predicate. They were also watched red against the live source file (the defect
// restored, the barrier failing, then reverted); keeping them here makes that proof permanent and
// re-executed on every run instead of a claim in a commit message.
const mustCatch = (label: string, caught: boolean) => check(`MUTANT ${label}`, caught);

/** The one question this barrier exists to be able to answer. */
const discriminates = (read: (d: unknown) => { inputs: string[]; districts: string[] }) =>
  JSON.stringify(read(withDistrict)) !== JSON.stringify(read(districtDropped));

check('M0 the REAL reader discriminates (so the mutants below are not vacuous)',
  discriminates(readRestoredFormState as (d: unknown) => ReturnType<typeof readRestoredFormState>));

// M1 — THE ORIGINAL DEFECT, verbatim: every visible input's value, and nothing else.
const inputsOnly = (d: never) => ({
  inputs: Array.from((d as unknown as Document).querySelectorAll('input'))
    .filter((e: Element) => (e as HTMLElement).offsetParent !== null)
    .map((e: Element) => (e as HTMLInputElement).value),
  districts: [] as string[],
});
mustCatch('M1 an inputs-only oracle (the shipped defect) cannot tell a surviving district from a dropped one',
  !discriminates(inputsOnly as unknown as (d: unknown) => ReturnType<typeof readRestoredFormState>));

// M2 — plausible-looking and equally blind: read the district from its INPUT rather than its chip.
// The input is '' whenever the pick is real, so this reports "no district" in both states.
const districtFromInput = (d: never) => ({
  inputs: [] as string[],
  districts: Array.from((d as unknown as Document).querySelectorAll('input'))
    .map((e: Element) => (e as HTMLInputElement).value)
    .filter((v: string) => v.startsWith('حي')),
});
mustCatch('M2 reading the district from the input instead of the chip is equally blind',
  !discriminates(districtFromInput as unknown as (d: unknown) => ReturnType<typeof readRestoredFormState>));

// M3 — the no-argument call (how page.evaluate invokes it) with no ambient-document default. This
// is the bug the first draft of the fix actually shipped; it threw against production.
const noDefault = (d?: unknown) => (d as Document).querySelectorAll('input');
let m3Threw = false;
try { (noDefault as () => unknown)(); } catch { m3Threw = true; }
mustCatch('M3 a reader without the ambient-document default throws on the no-argument call', m3Threw);

console.log(fail.length ? `\nFAILED (${fail.length})` : '\nrestore oracle sees the district: OK');
process.exit(fail.length ? 1 : 0);
