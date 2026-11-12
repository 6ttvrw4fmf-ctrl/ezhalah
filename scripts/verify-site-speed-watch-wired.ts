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

// THE TAP REACHES THE SITE AT ONCE, IN THE VISITOR'S LANGUAGE (owner 2026-11-12: «it takes so long for me to get
// redirected … we need to keep a robot to check this»; «if it's Arabic it turns into Arabic»). The robot times the
// golden tap until the source site opens (a new tab ≤ 0.5 s, the in-app frame ≤ 3 s, through our preview's contact
// button when one shows) and fails an Arabic visitor sent to a site's /en/ page.
const reachesSite = (s: string) => /siteOpenMs: 500, siteFrameMs: 3_000/.test(s)
  && /say\(results\.siteOpenMs <= BUDGET\.siteOpenMs/.test(s) && /say\(results\.siteFrameMs <= BUDGET\.siteFrameMs/.test(s)
  && /getByTestId\('listing-preview-contact'\)/.test(s) && /the golden listing never reached its site[\s\S]{0,80}failed\+\+/.test(s)
  && s.includes('const english = /^\\/en(\\/|$)/.test(new URL(url).pathname);') && /if \(english\) failed\+\+;/.test(s);
check('the golden tap is timed until the source site opens, and an Arabic visitor never lands on an /en/ page', reachesSite(js));
mustCatch('the new-tab budget removed', !reachesSite(js.replace(/say\(results\.siteOpenMs <= BUDGET\.siteOpenMs/, 'void (0')));
mustCatch('the preview contact step removed', !reachesSite(js.replace("getByTestId('listing-preview-contact')", "getByTestId('nothing')")));
mustCatch('a wrong-language landing that only logs', !reachesSite(js.replace('if (english) failed++;', 'if (english) void 0;')));
mustCatch('a tap that never reaches the site passes', !reachesSite(js.replace("(no new tab, no frame, no contact open)'); failed++;", "(no new tab, no frame, no contact open)');")));

// MOVING THE MAP AND AN IMPATIENT TAP (owner 2026-11-05: «so slow changing and moving … gets stuck»): the robot drags
// the map, times the new area's labels and the longest stutter, and taps «خريطة» at once on a fresh phone (no pause).
const moves = (s: string) => /panMs: 3_000, panFreezeMs: 500, mapColdTapMs: 5_000/.test(s)
  && /say\(results\.panMs <= BUDGET\.panMs/.test(s) && /say\(results\.panFreezeMs <= BUDGET\.panFreezeMs/.test(s)
  && /say\(results\.mapColdTapMs <= BUDGET\.mapColdTapMs/.test(s);
check('it drags the map (time + stutter) and taps the map at once on a fresh phone, each against a budget', moves(js));
mustCatch('the drag step removed', !moves(js.replace(/say\(results\.panMs <= BUDGET\.panMs/, 'void (0')));
mustCatch('the impatient tap removed', !moves(js.replace(/say\(results\.mapColdTapMs <= BUDGET\.mapColdTapMs/, 'void (0')));
// THE SIGNED-IN SIDEBAR AND A SAVED CHAT (owner 2026-11-08, iPhone on a VPN: «takes sooooo long for it to load and pop»):
// a second journey in the same workflow seeds a signed-in visitor client-side (the journeys' harness) and times ☰ until
// the saved chats show and a row until the conversation shows, on 4G and on a VPN line, against the owner's budgets.
const sb = readFileSync(join(root, 'e2e/speed/signed-in-sidebar-live.mjs'), 'utf8');
const sidebarWired = (w: string) => /node e2e\/speed\/signed-in-sidebar-live\.mjs/.test(w)
  && /name: Signed-in sidebar[\s\S]{0,200}if: always\(\)[\s\S]{0,200}node e2e\/speed\/signed-in-sidebar-live\.mjs/.test(w);
check('the signed-in sidebar journey runs in the same workflow, even when the guest journey is red', sidebarWired(wf));
mustCatch('the signed-in step removed', !sidebarWired(wf.replace('node e2e/speed/signed-in-sidebar-live.mjs', 'true')));
const sidebarBudgets = (s: string) => /sidebarMs: 1_000, historyChatMs: 3_000/.test(s)
  && /say\(results\[`sidebarMs_\$\{line\.name\}`\] <= BUDGET\.sidebarMs/.test(s)
  && /say\(results\[`historyChatMs_\$\{line\.name\}`\] <= BUDGET\.historyChatMs/.test(s)
  && /name: 'VPN', latency: 450/.test(s) && /seedInitScript, THREE_CHATS, SUB/.test(s);
check('it keeps the owner\'s budgets (sidebar ≤ 1 s, saved chat ≤ 3 s), measures a VPN line and seeds the signed-in visitor the harness way', sidebarBudgets(sb));
mustCatch('the sidebar budget removed', !sidebarBudgets(sb.replace(/say\(results\[`sidebarMs_\$\{line\.name\}`\] <= BUDGET\.sidebarMs/, 'void (0')));
mustCatch('the VPN line removed', !sidebarBudgets(sb.replace("name: 'VPN', latency: 450", "name: 'VPN', latency: 150")));
check('a missed budget or a broken signed-in journey fails the run', loud(sb));
// CodeRabbit on #11331: a width > 0 passes while the drawer is still off-screen or the conversation is still fading in.
// Both timings wait for the element to be SEEN: inside the viewport and not faded/hidden by itself or an ancestor.
// All FOUR viewport edges, in both timings: a drawer parked off-screen to the left has right <= 0 and would pass a
// left/top-only test (CodeRabbit on #11331).
const FOUR_EDGES = /r\.right > 0 && r\.bottom > 0 && r\.left < innerWidth && r\.top < innerHeight/g;
const seenByAPerson = (s: string) => (s.match(FOUR_EDGES) ?? []).length >= 2
  && (s.match(/parseFloat\(cs\.opacity\) < 0\.9/g) ?? []).length >= 2;
check('both signed-in timings wait for the element to be on screen (all four viewport edges) and not faded (opacity walk)', seenByAPerson(sb));
mustCatch('a timing that settles for width > 0 again', !seenByAPerson(sb.replace(/r\.right > 0 && r\.bottom > 0 && r\.left < innerWidth && r\.top < innerHeight/, 'true')));
mustCatch('a timing that drops the right edge (a drawer parked off-screen to the left would count)', !seenByAPerson(sb.replace(/r\.right > 0 && /, '')));
mustCatch('a timing that drops the opacity walk', !seenByAPerson(sb.replace(/parseFloat\(cs\.opacity\) < 0\.9/, 'false')));
mustCatch('a signed-in journey that swallows its own failure', !loud(sb.replace('process.exit(1)', 'process.exit(0)')));
// pg_cron starts it (GitHub ran the schedule ~3×/day): two bundle steps ~30 min apart in the newest bundle migration
const trig = readFileSync(new URL('../supabase/migrations/20261105172415_speed_robot_started_by_pg_cron.sql', import.meta.url), 'utf8');
check('pg_cron starts the robot from both hourly bundles (:12 and :43)', (trig.match(/trigger_gh_workflow\('site-speed-live\.yml'\)/g) ?? []).length === 2 && /'12 \* \* \* \*'/.test(trig) && /'43 \* \* \* \*'/.test(trig));

if (failed) { console.error(`\n❌ verify-site-speed-watch-wired: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-site-speed-watch-wired: the phone speed journey runs every 30 min and after deploys, and alerts when it fails.');
