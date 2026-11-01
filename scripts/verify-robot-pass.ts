// SECURITY PHASE 4.4 (2026-10-21): our own browser robots carry the robot pass, and it goes nowhere but our front door.
//
// Once the network guard and the bot checks BLOCK (owner: no VPN, like Aqar), every robot that browses the real site
// from GitHub or Google Cloud would be refused, including the deploy's own hydration check. scripts/lib/robotPass.mjs
// gives them a pass. This barrier EXECUTES the header rule, and DISCOVERS by shape (no list to remember): every script
// that drives a browser against ezhalah-app.vercel.app must import robotPass.mjs, and every workflow that installs
// Playwright must hand it EZ_GATE_SECRET. A robot added tomorrow without the pass is RED here.
//   node --experimental-strip-types scripts/verify-robot-pass.ts   (discovered by `npm test`)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { robotPassHeaders } from './lib/robotPass.mjs';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

// 1. The pass goes only to our own front door.
const s = 'sek';
check('the pass is added only for our own front door, never another host or path',
  robotPassHeaders('https://ezhalah-app.vercel.app/sb/rest/v1/search_listings_ar?x=1', { a: '1' }, s)?.['x-ezhalah-robot'] === s
  && robotPassHeaders('https://ezhalah-app.vercel.app/agent', {}, s) === null
  && robotPassHeaders('https://challenges.cloudflare.com/sb/rest/v1/x', {}, s) === null
  && robotPassHeaders('https://maps.googleapis.com/sb/rest/v1/x', {}, s) === null
  && robotPassHeaders('https://ezhalah-app.vercel.app/sb/rest/v1/x', {}, '') === null);

// 2. Every site-browsing robot imports the pass (discovered by shape).
const walk = (d: string): string[] => readdirSync(join(root, d)).flatMap((n) => {
  const p = join(d, n);
  if (n === 'node_modules' || n.startsWith('.')) return [];
  return statSync(join(root, p)).isDirectory() ? walk(p) : /\.(m?js|ts)$/.test(n) ? [p.replace(/\\/g, '/')] : [];
});
const isRobot = (src: string) => /ezhalah-app\.vercel\.app/.test(src) && /(chromium|firefox|webkit)\.launch|launchPersistentContext\(/.test(src);
const robots = [...walk('scripts'), ...walk('e2e')]
  .filter((f) => !f.endsWith('lib/robotPass.mjs') && !f.endsWith('verify-robot-pass.ts'))
  .map((f) => [f, readFileSync(join(root, f), 'utf8')] as const)
  .filter(([, src]) => isRobot(src));
const unwired = robots.filter(([, src]) => !/import ['"][./]+(?:scripts\/)?lib\/robotPass\.mjs['"]/.test(src)).map(([f]) => f);
check(`every robot that drives a browser at the real site carries the pass (${robots.length} found)`, robots.length >= 10 && unwired.length === 0,
  unwired.join(', ') || `only ${robots.length} robots discovered`);

// 3. Every workflow that installs Playwright hands the robots the secret.
const wfDir = join(root, '.github/workflows');
const pw = readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).map((f) => [f, readFileSync(join(wfDir, f), 'utf8')] as const)
  .filter(([, t]) => /playwright install/.test(t));
const noSecret = pw.filter(([, t]) => !/EZ_GATE_SECRET: \$\{\{ secrets\.EZ_GATE_SECRET \}\}/.test(t)).map(([f]) => f);
check(`every Playwright workflow gives its robots the pass (${pw.length})`, pw.length > 0 && noSecret.length === 0, noSecret.join(', '));

// 4. The front door lets a pass-holder through the bot checks, and tells the database only «robot: 1».
const proxy = readFileSync(join(root, 'api/sb.ts'), 'utf8');
const honours = (p: string) => /const robot = robotPass\(request\.headers\.get\('x-ezhalah-robot'\), GATE\);\s*if \(!robot && \(/.test(p)
  && /if \(robot\) headers\.set\('x-ezhalah-robot', '1'\);/.test(p);
check('the front door lets a pass-holder through and forwards only robot: 1', honours(proxy));

mustCatch('a robot without the pass', robots.length > 0 && !(() => {
  const [, src] = robots[0];
  return /import ['"][./]+(?:scripts\/)?lib\/robotPass\.mjs['"]/.test(src.replace(/import ['"][./]+(?:scripts\/)?lib\/robotPass\.mjs['"];[^\n]*\n/, ''));
})());
mustCatch('the pass leaking to Cloudflare', robotPassHeaders('https://challenges.cloudflare.com/sb/rest/v1/x', {}, s) === null);
mustCatch('the front door ignoring the pass', !honours(proxy.replace('if (!robot && (', 'if ((')));

if (failed) { console.error(`\n❌ verify-robot-pass: ${failed} check(s) failed.`); process.exit(1); }
console.log(`\n✅ verify-robot-pass: ${robots.length} robots carry a pass that reaches only our own front door.`);
console.log(`   (${relative(root, wfDir)}: ${pw.length} Playwright workflows hand it EZ_GATE_SECRET)`);
