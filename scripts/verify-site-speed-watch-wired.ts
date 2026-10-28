// THE SITE SPEED WATCH IS WIRED AND CAN FAIL (owner 2026-10-27: «I want a robot to check this … fix it if anything
// goes wrong immediately»). e2e/speed/site-speed-live.mjs needs a browser and production, so it runs in
// .github/workflows/site-speed-live.yml; this hermetic half proves that workflow keeps running it on a schedule and
// after deploys, that a red run reaches a human, and that the journey keeps its three budgets and fails loudly.
//   node --experimental-strip-types scripts/verify-site-speed-watch-wired.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const wf = readFileSync(join(root, '.github/workflows/site-speed-live.yml'), 'utf8');
const js = readFileSync(join(root, 'e2e/speed/site-speed-live.mjs'), 'utf8');
let failed = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const wired = (w: string) => /cron: '/.test(w) && /workflows: \['Ad viewer speed — live guard'\]/.test(w) /* after-deploy robots take turns; this runs last */
  && /node e2e\/speed\/site-speed-live\.mjs/.test(w) && /raise-workflow-alert\.mjs/.test(w) && /if: always\(\)/.test(w);
check('runs every 30 min and after each deploy (in turn, after the ad-viewer robot), and a red run raises an alert', wired(wf));
mustCatch('the journey step removed', !wired(wf.replace('node e2e/speed/site-speed-live.mjs', 'true')));
mustCatch('the alert bridge removed', !wired(wf.replace('raise-workflow-alert.mjs', 'nothing.mjs')));

const budgets = (s: string) => /openMs: 12_000/.test(s) && /searchMs: 25_000/.test(s) && /tapFreezeMs: 1_000/.test(s);
const loud = (s: string) => /if \(failed\) \{ console\.error\([\s\S]{0,160}process\.exit\(1\)/.test(s) && /the journey could not complete/.test(s);
check('the journey keeps its three budgets (open, search, golden-listing tap freeze)', budgets(js));
check('a missed budget or a broken journey fails the run (never a silent pass)', loud(js));
mustCatch('a journey that swallows its own failure', !loud(js.replace('process.exit(1)', 'process.exit(0)')));
check('it uses the robot pass (never blocked by our own guards) and a phone with a slowed CPU',
  /import '\.\.\/\.\.\/scripts\/lib\/robotPass\.mjs'/.test(js) && /setCPUThrottlingRate', \{ rate: 4 \}/.test(js) && /devices\['iPhone 13'\]/.test(js));

if (failed) { console.error(`\n❌ verify-site-speed-watch-wired: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-site-speed-watch-wired: the phone speed journey runs every 30 min and after deploys, and alerts when it fails.');
