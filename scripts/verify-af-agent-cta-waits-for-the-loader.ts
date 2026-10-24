// The agent-flow CTA journey judges the CTA only after the searching turn has handed over (🦅 Falcon, 2026-10-23).
//
// af-live-truth run 39940963632: verify-af-agent-cta-live.ts read «24 cards held still» while the loader
// («نراجع 172,667 إعلان في الرياض…») was still up, tapped a covered, off-screen «تحديد أكثر», issued nothing, and failed
// NOT EXERCISED. Its settle predicate now also requires the loader's platform roster (testID «loader-roster») to be gone.
// This pins BOTH halves: the robot waits on that testid, and the app still renders it — so a rename in src cannot turn
// the wait into a no-op that is always satisfied.
//   node --experimental-strip-types scripts/verify-af-agent-cta-waits-for-the-loader.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const robot = readFileSync(join(root, 'scripts/verify-af-agent-cta-live.ts'), 'utf8');
const roster = readFileSync(join(root, 'src/components/PlatformRosterPager.tsx'), 'utf8');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const robotWaits = (src: string) => /awaitFirstResultsSettled\([\s\S]{0,1200}data-testid="loader-roster"\]'\)\.count\(\)\) === 0/.test(src);
const appRenders = (src: string) => /testID="loader-roster"/.test(src);

check('the CTA journey waits for the loader roster to leave before reading the CTA', robotWaits(robot), 'settle predicate lost the loader-roster clause');
check('the app still renders testID="loader-roster" on the searching turn', appRenders(roster), 'testid renamed or removed');
mustCatch('the settle predicate back on «actions row mounted» alone', !robotWaits(robot.replace(/\n\s*&& \(await page\.locator\('\[data-testid="loader-roster"\]'\)\.count\(\)\) === 0/, '')));
mustCatch('the app renaming the loader testid', !appRenders(roster.replace('testID="loader-roster"', 'testID="loader-platforms"')));

if (failed) { console.error(`\n❌ verify-af-agent-cta-waits-for-the-loader: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-af-agent-cta-waits-for-the-loader: the CTA is read only on a screen that has finished searching.');
