// THE UNWITNESSED COORDINATE CLICK CANNOT GROW (routine #5, 2026-09-24).
//
// A live journey taps a control by measuring its centre in one round trip and clicking that point in
// the next. The Ezhalah chat reflows between the two, so the click can land on whatever slid under
// it — and because nothing checks, the journey's NEXT assertion ("…and then the app did X") fails and
// is written down as a PRODUCT defect. Measured on production 2026-09-24: 11 of 24 taps on
// «خلّنا نحدد الطلب أكثر» landed on a listing card, each reported as a broken Advanced Filter
// (`ops_incident` #340, five days of a P1 spent on a click that never happened).
//
// `scripts/lib/liveClick.ts` is the repair: measure, require the point to have held still, arm a
// capture-phase witness, click, and only then say the control was pressed. `openAfOffer` uses it and
// `scripts/verify-af-offer-click-lands.ts` mutation-proves it.
//
// THIS check keeps the rest of the class from growing. Every file that clicks a coordinate must
// either route through `clickWitnessed()` or appear in the baseline below — a SHRINK-ONLY ledger
// with a ceiling, the same ratchet shape as `scripts/verify-every-rpc-call-is-bounded.ts`. A NEW
// unwitnessed site is RED; a baselined file that no longer clicks coordinates is RED as STALE, so
// the ledger can never read better than reality.
//
// It is a TEXT check on purpose, and says so: it measures which files reach the helper, not whether
// any individual click is correct. The behavioural proof is the sibling barrier above, which
// EXECUTES the helper against a page whose click misses.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'scripts/live-coordinate-click-baseline.txt');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nEvery coordinate click in a live journey is witnessed, or it is on the shrinking ledger\n');

// Tracked files only — an untracked scratch script is nobody's coverage claim.
const tracked = execFileSync('git', ['ls-files', 'scripts', 'e2e'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter((f) => /\.(ts|mjs|js)$/.test(f));

const CLICKS = /\.mouse\.click\s*\(/;
const WITNESSED = /clickWitnessed/;

const sites = tracked.filter((f) => {
  const p = join(ROOT, f);
  if (!existsSync(p)) return false;
  const src = readFileSync(p, 'utf8');
  return CLICKS.test(src) && !WITNESSED.test(src);
});

const baselineRaw = existsSync(BASELINE) ? readFileSync(BASELINE, 'utf8') : '';
const baseline = baselineRaw.split('\n')
  .map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean)
  .map((l) => l.split('|')[0].trim());

// THE CEILING. Lowering it is the only way to shrink the class, and it takes a deliberate edit to
// BOTH this number and the ledger — a rename or a bad glob cannot do it as a side effect.
const CEILING = 21;

check('the baseline is at or below its ceiling (it may only shrink)',
  baseline.length <= CEILING, `${baseline.length} entr(y/ies), ceiling ${CEILING}`);

const newSites = sites.filter((f) => !baseline.includes(f));
check('no NEW unwitnessed coordinate click has entered the tree',
  newSites.length === 0,
  newSites.length
    ? `route these through clickWitnessed() (scripts/lib/liveClick.ts):\n      ${newSites.join('\n      ')}`
    : `${sites.length} known site(s), all on the ledger`);

const stale = baseline.filter((f) => !sites.includes(f));
check('no baseline entry is STALE (a fixed file must leave the ledger, never linger in it)',
  stale.length === 0,
  stale.length ? `these no longer click an unwitnessed coordinate — delete their rows and lower the ceiling:\n      ${stale.join('\n      ')}` : 'every entry still describes reality');

check('every baseline row names an owner and a reason',
  baselineRaw.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).every((l) => l.split('|').length >= 3),
  'format: <path> | <owning routine> | <why it is not converted yet>');

// NON-VACUITY. A discovery that finds nothing would pass everything above forever.
check('the discovery actually finds coordinate clicks (a rule that sees nothing guards nothing)',
  sites.length + tracked.filter((f) => CLICKS.test(readFileSync(join(ROOT, f), 'utf8'))).length > 0,
  `${sites.length} unwitnessed of ${tracked.filter((f) => existsSync(join(ROOT, f)) && CLICKS.test(readFileSync(join(ROOT, f), 'utf8'))).length} clicking file(s)`);

// …and that the repaired path is genuinely OUT of the unwitnessed set — the one file this run fixed.
check('the shared opener is no longer an unwitnessed site (the fix is visible to this check)',
  !sites.includes('scripts/lib/afOfferLive.ts'),
  relative(ROOT, join(ROOT, 'scripts/lib/afOfferLive.ts')));

console.log(failed
  ? `\n✗ ${failed} check(s) failed\n`
  : '\n✓ the unwitnessed coordinate click is bounded and shrinking\n');
process.exit(failed ? 1 : 0);
