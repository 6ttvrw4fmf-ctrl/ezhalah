// RETIRED, KEPT ON DISK, IMPORTED BY NOTHING.
//
// This table served the phone/WhatsApp-OTP sign-in path, which the owner removed on 2026-09-01
// ("Google and Apple, that's it"). The file itself stays for one reason only: scripts/preflight-verify.sh
// refuses to deploy when any src/ file present in the APPROVED PRODUCTION BASELINE is deleted — that
// check is the shape of the 2026-07-09 P0 UI-rollback incident and it cannot distinguish "dead data
// table" from "approved screen". Deleting this file therefore blocked the deploy that removes phone
// sign-in (run 33656985287). Keeping it costs nothing: it is not imported anywhere, so the bundler
// never sees it.
//
// scripts/verify-no-phone-auth.ts asserts the invariant that actually matters — NO import of this
// module exists in src/. Delete this file in a later change, once safe-deploy's post-deploy baseline
// advance has moved the approved baseline past the phone-removal commit.
// Gulf dial codes the prototype ships with. `name` and `hint` are English i18n keys
// (look them up with t(...) at render time). Saudi Arabia is the default (index 0).
export type Country = {
  flag: string;
  code: string;
  name: string;
  prefixes: string[];
  len: number;
  hint: string;
};

// Saudi Arabia only — the app is KSA-exclusive, so phone sign-in / change-number is locked to
// +966 with no country picker. (user request: "phone number, only include Saudi Arabia".)
export const COUNTRIES: Country[] = [
  { flag: '🇸🇦', code: '+966', name: 'Saudi Arabia', prefixes: ['5'], len: 9, hint: '5' },
];
// True when there's a single country → render the dial code as a fixed label, not a dropdown.
export const SINGLE_COUNTRY = COUNTRIES.length === 1;
