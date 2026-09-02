// Barrier: SIGN-IN IS GOOGLE AND APPLE. NOTHING ELSE. (owner ruling 2026-09-01)
//
// "Remove phone number, we will just do Google and Apple, that's it." The WhatsApp-OTP sign-in path
// was removed in full: the AuthModal step, the account-menu "change phone" flow, the OTP helpers in
// auth.ts, the country/prefix table, and every OTP string in i18n. Zero users had ever signed in by
// phone (auth.identities on the day: google 5, email 2, phone 0), so nothing was stranded.
//
// WHY A BARRIER. A phone field is the single most "obviously helpful" thing a future session could
// add back to a sign-in sheet, and half of it would come back through copy-paste of the old code from
// git history. This pins the decision at every layer it used to live in, so it cannot return one
// layer at a time.
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};
const code = (p: string) => readFileSync(p, 'utf8').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

// ── 1. THE AUTH SEAM HAS NO PHONE PATH ─────────────────────────────────────────
const auth = code('src/lib/auth.ts');
check('auth.ts has no OTP send/verify helpers', !/sendPhoneOtp|verifyPhoneOtp|friendlyOtpError/.test(auth));
check('auth.ts never calls Supabase phone OTP', !/signInWithOtp|verifyOtp\(|channel:\s*'whatsapp'/.test(auth));
check("auth.ts no longer defaults a session to method 'phone'", !/=\s*'phone'/.test(auth));

// ── 2. THE USER TYPE CANNOT EXPRESS A PHONE LOGIN ──────────────────────────────
const store = code('src/store.tsx');
check("AuthUser.method is exactly 'google' | 'apple'", /method:\s*'google'\s*\|\s*'apple';/.test(store));
check("the store never maps a session to 'phone'", !/'phone'/.test(store));

// ── 3. THE SIGN-IN SHEET SHOWS GOOGLE AND APPLE, AND ONLY THOSE ─────────────────
const modal = code('src/components/AuthModal.tsx');
check('AuthModal has no OTP step', !/'otp'/.test(modal));
check('AuthModal has no phone state or country picker', !/setPhone|setCc\(|ccOpen|COUNTRIES|e164/.test(modal));
check('AuthModal has no OTP input', !/otpRef|otpHidden|otpBoxes/.test(modal));
check('Continue with Google is offered', /Continue with Google/.test(modal));
check('Continue with Apple is offered', /Continue with Apple/.test(modal));
check('no "or" divider dangles below the two providers', !/s\.orRow|s\.orLine|s\.orText/.test(modal));
check('the phone-number placeholder is gone', !/Phone number/.test(modal));

// ── 4. THE ACCOUNT MENU CANNOT CHANGE A PHONE ──────────────────────────────────
const menu = code('src/components/AccountMenu.tsx');
check('AccountMenu has no ChangePhone flow', !/ChangePhone|phOpen|account-menu-phone-change/.test(menu));
check("AccountMenu never branches on method === 'phone'", !/'phone'/.test(menu));
check('AccountMenu still shows the locked provider row', /Google Account/.test(menu) && /Apple Account/.test(menu));

// ── 5. THE SUPPORTING DATA AND COPY ARE GONE TOO ───────────────────────────────
// The country/prefix table is kept ON DISK but must be imported by NOTHING. (Deleting it tripped
// preflight's approved-baseline deletion guard — run 33656985287 — which cannot tell a dead data
// table from an approved screen. The invariant that matters is that no code path reaches it.)
{
  const importers = execSync(`grep -rlE "data/countries" src/ || true`).toString().trim();
  check('the country/prefix table is imported by nothing in src/', importers === '', importers);
  check('the country/prefix table is marked retired at its head',
    !existsSync('src/data/countries.ts') || /RETIRED, KEPT ON DISK, IMPORTED BY NOTHING/.test(readFileSync('src/data/countries.ts', 'utf8')));
}
const i18n = readFileSync('src/i18n.tsx', 'utf8');
// PATTERN SCAN, not a hand-list. The list below was curated and it MISSED 'Change phone number' —
// the key sat in the production bundle after the removal shipped (found by the live bundle check on
// 2026-09-02). A barrier that only catches what someone remembered to list is asserting the bug.
// This scans EVERY i18n key for an auth-shaped phone phrase. Deliberately phrase-level, not the bare
// word: a listing/contact string may legitimately say «جوال», but no key should describe phone
// sign-in, OTP, WhatsApp codes, or changing a phone number.
{
  const keys = [...i18n.matchAll(/^\s*'([^']+)':\s*'/gm)].map((m) => m[1]);
  // 'WhatsApp' alone is the share-sheet label (WhatsApp / X / Telegram) and stays. Only WhatsApp
  // used as a CODE CHANNEL is auth: «on WhatsApp», «WhatsApp code», «Resend code on WhatsApp».
  const phoneAuth = /phone number|change phone|\botp\b|on whatsapp|whatsapp (code|otp)|verification code|enter the code|resend code|sent a .*code/i;
  const leftovers = keys.filter((k) => phoneAuth.test(k));
  check('no i18n key describes phone sign-in / OTP / WhatsApp (pattern scan, not a hand-list)',
    leftovers.length === 0, leftovers.length ? 'leftovers: ' + leftovers.join(' | ') : '');
}
for (const key of ['Enter the code', 'We sent a 6-digit code on WhatsApp to', 'Resend code on WhatsApp',
                   'Phone number', 'Phone Number', 'Please enter a valid phone number.',
                   'Phone sign-in isn’t available right now. Please try another method.']) {
  check(`i18n no longer carries "${key}"`, !i18n.includes(`'${key}'`) && !i18n.includes(`"${key}"`));
}

// ── 6. NOTHING ANYWHERE IN src/ REACHES A PHONE OTP ────────────────────────────
{
  const hits = execSync(`grep -rlE "signInWithOtp|verifyOtp\\(|channel: *'whatsapp'" src/ || true`).toString().trim();
  check('no file in src/ calls a phone-OTP API', hits === '', hits);
}

console.log(failures === 0
  ? '\n✓ sign-in is Google and Apple only; the phone/OTP path cannot return one layer at a time'
  : `\n✗ ${failures} phone-auth check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
