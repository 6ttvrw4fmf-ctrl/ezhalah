// THE TOP BAR FITS A PHONE (owner 2026-11-03, a screenshot on a 430 pt iPhone: «look, the share button — why is it like
// this»). The long «إنشاء حساب / تسجيل الدخول» label was chosen from 420 px (the share-label breakpoint), and with the
// «ENG» pill added beside it later the row no longer fit: «مشاركة» was pushed off the right edge. The long label now has
// its own breakpoint, above every phone width, on all three screens that carry the top bar.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; };

const resp = readFileSync(join(root, 'src/lib/responsive.ts'), 'utf8');
const bp = Number(/export const SIGNUP_LABEL_BREAKPOINT = (\d+);/.exec(resp)?.[1] ?? NaN);
// The widest phones in use are 430-440 pt (iPhone Pro Max / Plus); the long label must never be picked on one.
check('the long sign-up label waits for a width above every phone (> 440)', bp > 440);
for (const f of ['src/app/index.tsx', 'src/app/map.tsx', 'src/app/agent.tsx']) {
  const src = readFileSync(join(root, f), 'utf8');
  check(`${f}: the long label follows SIGNUP_LABEL_BREAKPOINT, never the 420 share breakpoint`,
    /const signUpLabelFits = useAtLeast\(SIGNUP_LABEL_BREAKPOINT\);/.test(src)
    && /t\(signUpLabelFits \? 'Sign up \/ Log in' : 'Sign in'\)/.test(src)
    && !/t\(topBarRoomy \? 'Sign up \/ Log in'/.test(src));
}
// Mutation proof: the defect (the long label on the 420 breakpoint) is what the per-file check rejects.
const mutant = "t(topBarRoomy ? 'Sign up / Log in' : 'Sign in')";
check('(mutation) the 420-breakpoint choice is rejected', /t\(topBarRoomy \? 'Sign up \/ Log in'/.test(mutant));

if (failed) { console.error(`\n❌ verify-topbar-fits-phone: ${failed} check(s) failed.`); process.exit(1); }
console.log('\nverify-topbar-fits-phone: all checks passed');
