// THE WEB BUNDLE SKIPS THE NATIVE SENTRY SDK (speed, 2026-10-27).
//
// observability.ts requires @sentry/browser on web and @sentry/react-native on native; Metro bundled BOTH into the
// web entry (~250 KB unused on ezhalah.com). metro.config.js resolves @sentry/react-native to an empty module for
// platform 'web' only. This EXECUTES the real resolver from metro.config.js with a stub context and proves: web gets
// 'empty' for the native SDK, native still resolves it normally, and other modules pass through untouched.
//   node --experimental-strip-types scripts/verify-web-bundle-skips-native-sentry.ts   (discovered by `npm test`)
import { createRequire } from 'node:module';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const require = createRequire(join(root, 'package.json'));
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };

const config = require(join(root, 'metro.config.js'));
const resolve = config?.resolver?.resolveRequest as ((c: unknown, m: string, p: string | null) => unknown) | undefined;
check('metro.config.js exports a resolveRequest', typeof resolve === 'function');
if (typeof resolve === 'function') {
  const seen: string[] = [];
  const ctx = { resolveRequest: (_c: unknown, m: string, p: string | null) => { seen.push(`${p}:${m}`); return { type: 'sourceFile', filePath: `/stub/${m}` }; } };
  const web = resolve(ctx, '@sentry/react-native', 'web') as { type?: string };
  check('web: @sentry/react-native resolves to an empty module', web?.type === 'empty', JSON.stringify(web));
  const ios = resolve(ctx, '@sentry/react-native', 'ios') as { type?: string };
  check('native (ios): @sentry/react-native still resolves normally', ios?.type !== 'empty');
  const android = resolve(ctx, '@sentry/react-native', 'android') as { type?: string };
  check('native (android): @sentry/react-native still resolves normally', android?.type !== 'empty');
  const browser = resolve(ctx, '@sentry/browser', 'web') as { type?: string };
  check('web: @sentry/browser (the SDK the web actually uses) is untouched', browser?.type !== 'empty');
  const other = resolve(ctx, 'react', 'web') as { type?: string };
  check('web: any other module is untouched', other?.type !== 'empty');
}

// MUTATION PROOF: the same predicate must reject a resolver that forgets the rule, and one that applies it to phones too.
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };
type R = (c: unknown, m: string, p: string | null) => { type?: string };
const ctx2 = { resolveRequest: (_c: unknown, m: string) => ({ type: 'sourceFile', filePath: `/stub/${m}` }) };
const holds = (r: R) => r(ctx2, '@sentry/react-native', 'web')?.type === 'empty'
  && r(ctx2, '@sentry/react-native', 'ios')?.type !== 'empty' && r(ctx2, '@sentry/browser', 'web')?.type !== 'empty';
check('the predicate holds for the real resolver', typeof resolve === 'function' && holds(resolve as R));
mustCatch('a resolver without the web rule (native SDK back in the web bundle)', !holds((c, m, p) => ctx2.resolveRequest(c, m)));
mustCatch('a rule applied to every platform (phones lose crash reports)', !holds((c, m) => (m === '@sentry/react-native' ? { type: 'empty' } : ctx2.resolveRequest(c, m))));
mustCatch('a rule that empties the web SDK too (web loses crash reports)', !holds((c, m, p) => (p === 'web' && m.startsWith('@sentry/') ? { type: 'empty' } : ctx2.resolveRequest(c, m))));

if (failed) { console.error(`\n❌ verify-web-bundle-skips-native-sentry: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-web-bundle-skips-native-sentry: the web bundle leaves out the native Sentry SDK; native builds keep it.');
