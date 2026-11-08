// THE 📱 IPHONE ROBOT IS WIRED AND CAN FAIL (owner 2026-11-08: «We need to check this always»). The live half
// (e2e/speed/iphone-keyboard-zone-live.mjs) needs WebKit and production, so it runs in .github/workflows/iphone-robot-live.yml;
// this hermetic half proves the workflow keeps running it on WebKit, often, with a red run reaching a human, and that the
// robot keeps its two rules (first row in the top 55 %, a tap answers within 3 s) and fails loudly.
//   node --experimental-strip-types scripts/verify-iphone-robot-wired.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const wf = readFileSync(join(root, '.github/workflows/iphone-robot-live.yml'), 'utf8');
const js = readFileSync(join(root, 'e2e/speed/iphone-keyboard-zone-live.mjs'), 'utf8');
let failed = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const wired = (w: string) => /cron: '/.test(w) && /workflows: \['Site speed watch \(live\)'\]/.test(w)
  && /playwright install --with-deps webkit/.test(w) && /node e2e\/speed\/iphone-keyboard-zone-live\.mjs/.test(w)
  && /raise-workflow-alert\.mjs/.test(w) && /--workflow iphone-robot-live\.yml/.test(w) && /if: always\(\)/.test(w);
check('runs on WebKit after every speed watch and hourly, and a red run raises an alert', wired(wf));
mustCatch('the robot step removed', !wired(wf.replace('node e2e/speed/iphone-keyboard-zone-live.mjs', 'true')));
mustCatch('Chromium instead of WebKit', !wired(wf.replace('--with-deps webkit', '--with-deps chromium')));
mustCatch('the alert bridge removed', !wired(wf.replace('raise-workflow-alert.mjs', 'nothing.mjs')));

const rules = (s: string) => /KEYBOARD_TOP_SHARE = 0\.55;/.test(s) && /TAP_ANSWER_MS = 3_000;/.test(s)
  && /first\.bottom <= limit/.test(s) && /box\.y \+ box\.height <= limit/.test(s);
const walks = (s: string) => /getByPlaceholder\('اختر المدينة'/.test(s) && /getByTestId\('district-input'\)/.test(s) && /devices\['iPhone 13'\]/.test(s)
  && /: webkit;/.test(s);
const loud = (s: string) => /process\.exit\(failed \? 1 : 0\)/.test(s) && /say\(false, 'journey'/.test(s);
check('keeps the keyboard-zone rule (top 55 %, input and first row) and the 3 s tap rule', rules(js));
check('walks the city and district boxes on the iPhone 13 profile, WebKit by default', walks(js));
check('a FAIL or a broken journey exits 1 (never a silent pass), with the robot pass', loud(js) && /import '\.\.\/\.\.\/scripts\/lib\/robotPass\.mjs'/.test(js));
mustCatch('a looser keyboard zone', !rules(js.replace('KEYBOARD_TOP_SHARE = 0.55;', 'KEYBOARD_TOP_SHARE = 0.9;')));
mustCatch('a slower tap allowance', !rules(js.replace('TAP_ANSWER_MS = 3_000;', 'TAP_ANSWER_MS = 10_000;')));
mustCatch('a robot that swallows its failure', !loud(js.replace('process.exit(failed ? 1 : 0)', 'process.exit(0)')));
const room = (s: string) => /await addKeyboardRoom\(input\);/.test(s) && /room\.style\.height = `\$\{innerHeight\}px`/.test(s);
check('gives the page the keyboard\'s scroll room before every tap (without it a headless phone cannot show the bug)', room(js));
mustCatch('the keyboard room removed (the 2026-11-08 probe passed on the buggy site without it)', !room(js.replace('await addKeyboardRoom(input);', '')));
const ownerScreen = (s: string) => /getByTestId\('cookie-consent'\)\.waitFor\(\{ state: 'detached'/.test(s) && /accounts\\\.google\\\.com/.test(s) && /r\.abort\(\)/.test(s);
check('walks the signed-in owner\'s screen: cookie card answered, Google one-tap sheet blocked (they shrank the box)', ownerScreen(js));
mustCatch('the cookie card left on screen (the 11-08 probe passed on the buggy site that way)', !ownerScreen(js.replace("getByTestId('cookie-consent').waitFor({ state: 'detached'", "getByTestId('x').waitFor({ state: 'visible'")));
mustCatch('the district box dropped from the walk', !walks(js.replace("getByTestId('district-input')", "getByTestId('x')")));

if (failed) { console.error(`\n❌ verify-iphone-robot-wired: ${failed} check(s) failed`); process.exit(1); }
console.log('\n✅ verify-iphone-robot-wired: the iPhone robot runs, keeps its rules and fails loudly');
