// Automated tests — the AI-agent chat's empty-state example prompts (and the home onboarding grid,
// which shares the same data) must never leak raw English into the Arabic half.
//
// Production audit finding (2026-07-13, live on ezhalah-app.vercel.app): EVERY example prompt shown
// on the agent chat's empty state had the city name in raw English ("استراحة للبيع في الخليج، Riyadh"),
// and property types missing from a hand-rolled switch leaked too ("Industrial Land للبيع...").
//
// Root cause: src/data/remote.ts's fetchPromptIdeas() built the Arabic prompt half as
// `${typeToArabic(next.type)} ${dAR} في ${districtARStripped}، ${next.city}` — the city was NEVER
// translated (raw DB value interpolated directly), and typeToArabic() was an 11-case hand-rolled
// switch (`default: return t`) that had drifted out of sync with the canonical, deploy-gated
// EN_TO_AR map (src/data/propertyTypes.ts, 39 keys) — e.g. it didn't know 'Industrial Land'.
//
// Fixed by: (1) replacing the raw `next.city` with `cityDisplay(next.city, 'ar')` (the same guarded
// lookup used everywhere else in the app), (2) replacing the hand-rolled switch with a lookup into
// the canonical EN_TO_AR map, wrapped in arabicOrPlaceholder as a safety net for any future gap.
//
// src/data/propertyTypes.ts is zero-dependency (confirmed: no imports at all) and src/lib/cityDisplay.ts
// / src/lib/arabicText.ts are zero-dependency by design, so this test genuinely imports and executes
// the real EN_TO_AR map + cityDisplayPure + arabicOrPlaceholder — not a source-text guess. The actual
// call site in src/data/remote.ts (which transitively imports supabase + search.ts and can't be
// live-imported by a bare Node script) is checked via a whitespace-tolerant source-text assertion.
//
//   node --experimental-strip-types scripts/verify-example-prompts-arabic.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { EN_TO_AR } from '../src/data/propertyTypes.ts';
import { cityDisplayPure } from '../src/lib/cityDisplay.ts';
import { arabicOrPlaceholder, hasArabicChar } from '../src/lib/arabicText.ts';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};
const eq = (label: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected;
  if (!ok) console.error(`  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  check(label, ok);
};

const TYPE_UNRESOLVED_AR = 'نوع غير محدد';
const typeToArabic = (t: string) => arabicOrPlaceholder(EN_TO_AR[t] ?? t, 'ar', TYPE_UNRESOLVED_AR);

// ── THE exact reported cases: every city seen leaking raw English in the live production screenshot ──
const leakedCities = ['Riyadh', 'Jeddah', 'Shaqra', 'Tabuk', 'Al Majardah', 'Khobar', 'Medina', 'Dammam', 'Al Bukayriyah'];
for (const c of leakedCities) {
  const result = cityDisplayPure(c);
  check(`city '${c}' (seen leaking in production) now resolves to real Arabic, not null/English`, !!result && hasArabicChar(result));
}

// ── THE exact reported case: 'Industrial Land' fell through the old 11-case switch's default ──
eq("typeToArabic('Industrial Land') — the exact reported leak — resolves to real Arabic", typeToArabic('Industrial Land'), 'أرض صناعية');
eq("typeToArabic('Apartment') — a type the old switch also covered — still correct", typeToArabic('Apartment'), 'شقة');
check(
  `EN_TO_AR covers a broad, real set of types (found ${Object.keys(EN_TO_AR).length}, expect >= 30)`,
  Object.keys(EN_TO_AR).length >= 30,
);
check(
  'typeToArabic degrades to the Arabic placeholder (not raw English) for a genuinely unmapped type',
  typeToArabic('SomeFutureUnmappedType123') === TYPE_UNRESOLVED_AR,
);

// ── Source-text check for the actual call site (remote.ts can't be live-imported — heavy deps) ────
const stripWs = (s: string) => s.replace(/\s+/g, '');
const PROPERTY_TYPES_TS = readFileSync(new URL('../src/data/propertyTypes.ts', import.meta.url), 'utf8');
const REMOTE_TS = readFileSync(new URL('../src/data/remote.ts', import.meta.url), 'utf8');
const REMOTE_NOWS = stripWs(REMOTE_TS);

check(
  "fetchPromptIdeas() computes cityAR via cityDisplay(next.city, 'ar')",
  REMOTE_NOWS.includes("constcityAR=cityDisplay(next.city,'ar')"),
);
check(
  "fetchPromptIdeas()'s ar template uses cityAR, not the raw next.city (the original leak shape)",
  REMOTE_NOWS.includes('،${cityAR}') && !REMOTE_NOWS.includes('،${next.city}'),
);
const typeToArabicSrc = REMOTE_TS.slice(REMOTE_TS.indexOf('function typeToArabic'));
check(
  'typeToArabic() uses the canonical EN_TO_AR map, not a hand-rolled switch with a raw-text default',
  stripWs(typeToArabicSrc).startsWith('functiontypeToArabic(t:string):string{returnarabicOrPlaceholder(EN_TO_AR[t]??t,') &&
  !/switch\s*\(\s*t\s*\)/.test(typeToArabicSrc.slice(0, 400)),
);
check(
  'propertyTypes.ts exports EN_TO_AR (not left module-private)',
  PROPERTY_TYPES_TS.includes('export const EN_TO_AR'),
);

console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} example-prompts-arabic assertion(s) FAILED`);
  process.exit(1);
}
console.log('✓ all example-prompts-arabic assertions passed');
