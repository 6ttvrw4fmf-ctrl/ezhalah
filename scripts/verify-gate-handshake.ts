// SECURITY PHASE 4.5 (2026-10-21): before the back door closes, every one of OUR callers carries the secret handshake,
// and the handshake goes nowhere but our own database.
//
// The database will soon serve the public key only to callers with x-ezhalah-gate = EZ_GATE_SECRET (real visitors
// through the front door; our own robots through scripts/lib/gateFetch.mjs and robotPass.mjs). Measured 2026-10-22:
// ~57,000 of ~65,000 direct public-key calls in six hours were OUR robots. A robot left without the handshake would
// simply stop working the day the door closes. This barrier EXECUTES the header rule and DISCOVERS by shape (no list to
// keep): every script that talks to the database, every browser robot and every workflow must carry it.
//   node --experimental-strip-types scripts/verify-gate-handshake.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { gateHeaders } from './lib/gateFetch.mjs';

const root = join(import.meta.dirname, '..');
const read = (f: string) => readFileSync(join(root, f), 'utf8');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

// 1. The handshake goes only to our database's REST API.
const db = 'https://aannarbkwcymrotzwdbo.supabase.co';
check('the handshake goes only to our own database REST API',
  gateHeaders(`${db}/rest/v1/search_listings_ar`, 's')?.['x-ezhalah-gate'] === 's'
  && gateHeaders(`${db}/auth/v1/user`, 's') === null && gateHeaders(`${db}/functions/v1/agent`, 's') === null
  && gateHeaders('https://other.supabase.co/rest/v1/x', 's') === null && gateHeaders('https://example.com/rest/v1/x', 's') === null
  && gateHeaders(`${db}/rest/v1/x`, '') === null);

// 2. Every script that talks to the database carries it (via the shared helper, or its own import).
const files = execSync('git ls-files scripts e2e', { cwd: root, encoding: 'utf8' }).split('\n').filter((f) => /\.(m?js|ts)$/.test(f));
const SELF = /scripts\/lib\/(gateFetch|robotPass|robotPassCore)\.mjs$|scripts\/lib\/public-supabase\.ts$|scripts\/verify-gate-handshake\.ts$/;
const talksToDb = (s: string) => /aannarbkwcymrotzwdbo\.supabase\.co|EXPO_PUBLIC_SUPABASE_(KEY|ANON_KEY|URL)|sb_publishable_/.test(s);
const carries = (s: string) => /gateFetch\.mjs|public-supabase|robotPass\.mjs/.test(s);
const dbScripts = files.filter((f) => !SELF.test(f)).map((f) => [f, read(f)] as const).filter(([, s]) => talksToDb(s));
const bare = dbScripts.filter(([, s]) => !carries(s)).map(([f]) => f);
check(`every script that talks to our database carries the handshake (${dbScripts.length})`, dbScripts.length > 20 && bare.length === 0, bare.join(', '));
check('the shared public-endpoint helper loads it', /import '\.\/gateFetch\.mjs';/.test(read('scripts/lib/public-supabase.ts')));

// 3. Every browser robot carries it (robotPass.mjs also hands the handshake to a test copy's direct database calls).
const browsers = files.filter((f) => !SELF.test(f)).map((f) => [f, read(f)] as const)
  .filter(([, s]) => /(chromium|firefox|webkit)\.launch|launchPersistentContext\(/.test(s));
const bareBrowsers = browsers.filter(([, s]) => !/robotPass\.mjs/.test(s)).map(([f]) => f);
check(`every browser robot carries the pass + handshake (${browsers.length})`, bareBrowsers.length === 0, bareBrowsers.join(', '));
// Playwright TEST SPECS cannot load a module that awaits at load time (2026-10-22: importing robotPass.mjs from
// playwright.config.ts made every spec fail to load), so each spec grants the pass per test from robotPassCore.mjs.
const specs = files.filter((f) => /\.spec\.(ts|mjs|js)$/.test(f));
const bareSpecs = specs.filter((f) => !/import \{ grantRobotPass \} from '[./]+(?:scripts\/)?lib\/robotPassCore\.mjs';[\s\S]*test\.beforeEach\(async \(\{ context \}\) => \{ await grantRobotPass\(context\); \}\);/.test(read(f)));
check(`every Playwright spec grants the pass per test (${specs.length})`, specs.length > 0 && bareSpecs.length === 0, bareSpecs.join(', '));
check('the test runner config does not import the awaiting module (it would stop every spec loading)', !/robotPass\.mjs/.test(read('playwright.config.ts')));
check('a test copy\'s direct database calls get the handshake', /context\.route\(\/\\\.supabase\\\.co\\\/rest\\\/v1\\\/\//.test(read('scripts/lib/robotPassCore.mjs')));

// 4. Every workflow hands its jobs the secret.
const wfDir = join(root, '.github/workflows');
const wfs = readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f));
const noSecret = wfs.filter((f) => !/^env:[\s\S]*?\n  EZ_GATE_SECRET: \$\{\{ secrets\.EZ_GATE_SECRET \}\}/m.test(readFileSync(join(wfDir, f), 'utf8')));
check(`every workflow gives its jobs EZ_GATE_SECRET (${wfs.length})`, noSecret.length === 0, noSecret.join(', '));

mustCatch('the handshake leaking to another host', gateHeaders('https://example.com/rest/v1/x', 's') === null);
mustCatch('a database script without the handshake', dbScripts.length > 0 && !carries(dbScripts.find(([, s]) => /gateFetch\.mjs/.test(s) && !/robotPass\.mjs|public-supabase/.test(s))?.[1]
  .replace(/import '[./]+(?:scripts\/)?lib\/gateFetch\.mjs';[^\n]*\n/, '') ?? 'x'));
mustCatch('a workflow without the secret', !/^env:[\s\S]*?\n  EZ_GATE_SECRET: \$\{\{ secrets\.EZ_GATE_SECRET \}\}/m.test('name: x\njobs:\n  a:\n    runs-on: x\n'));

if (failed) { console.error(`\n❌ verify-gate-handshake: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-gate-handshake: every one of our callers carries the handshake, and it reaches only our database.');
