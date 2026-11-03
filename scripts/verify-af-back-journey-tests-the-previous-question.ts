// THE BACK JOURNEY MUST PRESS BACK FROM QUESTION TWO (2026-10-31, 🔬).
// R8.2.1: Back restores the PREVIOUS question. verify-af-live-truth.ts's «scope tier» loop (10-23) answers up to two
// more round questions after the first confirm. On the BACK journey that moved the card to question four, so Back
// correctly returned to question three while the check expected question one — af-live-truth-check red on every run
// with no product defect (run 41178264864: expected=وش المميزات المهمة لك؟ got=كم عمر العقار تقريباً؟).
// This executes the loop's own guard expression (lifted from the file) for the BACK journey and an ordinary one.
//
//   node --experimental-strip-types scripts/verify-af-back-journey-tests-the-previous-question.ts   (in `npm test`)
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./verify-af-live-truth.ts', import.meta.url), 'utf8');
let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

// The tier loop: `for (let tier = 0; tier < 2 && <guard>; tier++)` — lift <guard>.
const guardOf = (text: string) => /for \(let tier = 0; tier < 2 && ([^;]+); tier\+\+\)/.exec(text)?.[1] ?? '';
const runsFor = (guard: string, backAndChange: boolean) =>
  new Function('lastSearchBody', 'backAndChange', `return !!(${guard});`)(null, backAndChange) as boolean;

const guard = guardOf(src);
check(`the tier loop's guard is found («${guard}»)`, guard.length > 0);
check('the tier loop does NOT run on the BACK journey (Back is pressed from question two)', guard !== '' && !runsFor(guard, true));
check('the tier loop still runs on every other journey with no search yet (10-23 scope tiers kept)', guard !== '' && runsFor(guard, false));
check('the BACK journey still proves the round advanced before it presses Back',
  /const advanced = await readCardUntil\(\(s\) => s\.hasCard && s\.q != null && s\.q !== st\.q/.test(src));

const OLD = 'for (let tier = 0; tier < 2 && lastSearchBody === null; tier++)';
mustCatch('the 10-23..10-31 guard that walked the BACK journey to question four', runsFor(guardOf(OLD), true));
mustCatch('a guard that drops the scope tiers for every journey',
  !runsFor(guardOf('for (let tier = 0; tier < 2 && false; tier++)'), false));

console.log(failed ? `\n✗ ${failed} FAILED` : '\n✓ the BACK journey tests R8.2.1 from question two');
process.exit(failed ? 1 : 0);
