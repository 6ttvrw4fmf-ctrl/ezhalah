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
