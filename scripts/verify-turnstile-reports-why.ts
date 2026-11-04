// SECURITY (owner 2026-11-04, «add a second guard … it needs a small repair first»): Cloudflare Turnstile must say WHY it
// failed. Measured 2026-11-04 (24 h, real browsers): iPhones carried the human pass on 1,125 calls, desktop browsers on 29 of
// 1,157 and Android on 0 of 433, and src/lib/supabase.ts swallowed every widget error, so the cause was invisible.
// Every front-door call now carries «ezhalah-tsc=<state>» in x-client-info (wait | ok | err<code> | srv<status> | load).
//
// EXECUTES the lifted turnstileLabel(), checks each outcome is recorded where it happens and that the door call carries it,
// checks it never delays or refuses anything, and proves mutations bite.
//   node --experimental-strip-types scripts/verify-turnstile-reports-why.ts   (discovered by `npm test`)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { liftSymbols } from './lib/liftSymbols.ts';

const root = join(import.meta.dirname, '..');
const file = join(root, 'src/lib/supabase.ts');
const src = readFileSync(file, 'utf8');
type Label = (kind: string, detail?: string) => string;
const lift = async (f: string) => (await liftSymbols(f, [{ header: 'export function turnstileLabel(' }], ['turnstileLabel'])).turnstileLabel as Label;
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };

const turnstileLabel = await lift(file);
const cases: [string, string | undefined, string][] = [
  ['wait', undefined, 'ezhalah-tsc=wait'], ['ok', undefined, 'ezhalah-tsc=ok'], ['err', '600010', 'ezhalah-tsc=err600010'],
  ['err', '110200', 'ezhalah-tsc=err110200'], ['srv', '403', 'ezhalah-tsc=srv403'], ['srv', 'net', 'ezhalah-tsc=srvnet'],
  ['load', undefined, 'ezhalah-tsc=load'], ['err', '', 'ezhalah-tsc=errx'], ['err', 'a b<script>', 'ezhalah-tsc=errx'],
  ['err', '1'.repeat(40), 'ezhalah-tsc=errx'], ['nonsense', '1', 'ezhalah-tsc=other'],
];
const bad = cases.filter(([k, d, want]) => turnstileLabel(k, d) !== want).map(([k, d, want]) => `${k}/${d} → ${turnstileLabel(k, d)} (want ${want})`);
check('each Turnstile outcome becomes one short, safe log token', bad.length === 0, bad.join('; '));

check('the widget\'s error code is recorded, and the error stays handled (no page error)',
  /'error-callback': \(code\?: string \| number\) => \{ turnstileState = turnstileLabel\('err', String\(code \?\? ''\)\); return true; \}/.test(src));
check('/api/human\'s answer is recorded (ok, or the refusing status)',
  /turnstileState = r\.ok \? turnstileLabel\('ok'\) : turnstileLabel\('srv', String\(r\.status\)\)/.test(src));
check('a script that never loads is recorded', /s\.onerror = \(\) => \{ turnstileState = turnstileLabel\('load'\); \};/.test(src));
check('every door call carries the state', /const viaDoor = \(\) => window\.fetch\(front, withTurnstileLabel\(init\)\);/.test(src)
  && /headers\.set\('x-client-info', `\$\{headers\.get\('x-client-info'\) \?\? ''\} \$\{turnstileState\}`\.trim\(\)\)/.test(src));
check('measurement only: nothing awaits the Turnstile state', !/await[^;\n]*turnstileState|turnstileState[^;\n]*\.then\(/.test(src));

// Mutations: a label that leaks raw input, and a door call that drops the state, must each turn this red.
const tmp = mkdtempSync(join(tmpdir(), 'ts-label-'));
const leakyFile = join(tmp, 'leaky.ts');
writeFileSync(leakyFile, src.replace("/^[0-9a-z]{1,8}$/i.test(String(detail))", 'true'));
const leaky = await lift(leakyFile);
check('(mutation) catches a label that passes raw text into the logs', leaky('err', 'a b<script>') !== 'ezhalah-tsc=errx');
const dropped = src.replace('window.fetch(front, withTurnstileLabel(init))', 'window.fetch(front, init)');
check('(mutation) catches a door call that drops the state', !/const viaDoor = \(\) => window\.fetch\(front, withTurnstileLabel\(init\)\);/.test(dropped));

if (failed) { console.log(`\n❌ verify-turnstile-reports-why: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ Turnstile reports why it passed or failed on every door call, and still never blocks or delays anyone.');
