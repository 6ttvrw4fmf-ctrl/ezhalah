// «من نحن» premium single-screen contract (owner brief, 2026-08-23).
//
// The About dialog was rebuilt from a five-card corporate scroll into a single-screen company
// card: hero (wordmark + thesis) + four verb-led value blocks + an abstract map panel (desktop)
// + a four-column small-print legal strip. This barrier pins the TEN contract points of that
// brief so no future edit quietly regresses any of them:
//
//   1. the long five-card scroll must not return          6. no Arabic dash separators («—»)
//   2. desktop fits a capped single screen                7. the map panel stays desktop-only
//   3. panel art never overflows its 340px canvas         8. required legal/brand content survives
//   4. no letterSpacing on Arabic text                    9. reduced motion is respected
//   5. every displayed string has an Arabic entry        10. the sidebar entry still opens the modal
//
// Plus the honesty invariant: the ONLY number on the screen derives from PLATFORM_META.length at
// compile time — never a hardcoded count, never an invented listings/cities figure.
//
//   node --experimental-strip-types scripts/verify-about-premium-contract.ts    (wired into `npm test`)
//
// ABOUT_CONTRACT_ROOT overrides the repo root — used ONLY by mutation proofs (run the script
// against a deliberately broken copy and assert it fails); normal runs never set it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = process.env.ABOUT_CONTRACT_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const modal = readFileSync(join(ROOT, 'src/components/InfoModal.tsx'), 'utf8');
const i18n = readFileSync(join(ROOT, 'src/i18n.tsx'), 'utf8');
const sidebar = readFileSync(join(ROOT, 'src/components/Sidebar.tsx'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  if (!ok) {
    failed++;
    if (detail) console.error(`      ${detail}`);
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

// ── 1. The five-card corporate scroll must not return ───────────────────────────────────────────
check(
  '1a. the old five-card About stack is gone (no secCard/secIc icon-circle rhythm)',
  !/secCard|secIc|secHead|secTitle/.test(modal),
);
// REDESIGN (owner 2026-08-29): one artwork-led column replaces the 2026-08-24 hero/panel row.
check(
  '1b. the artwork-led composition exists (full-bleed hero art melting into the surface + trust card)',
  /heroArt:\s*\{/.test(modal) && /heroImg:\s*\{/.test(modal) && /trustCard:\s*\{/.test(modal)
  && /LinearGradient colors=\{\[alpha0\(pal\.paper\), pal\.paper\]\}/.test(modal),
);
check(
  '1c. the artwork is INTEGRATED, not pasted: the hero image sits under a melt gradient and the '
  + 'lockup rises out of its lower band',
  modal.indexOf('a.heroImg') < modal.indexOf('LinearGradient colors={[alpha0(pal.paper), pal.paper]}')
  && modal.indexOf('LinearGradient colors={[alpha0(pal.paper), pal.paper]}') < modal.indexOf('a.heroInner'),
);

// ── 2. Desktop about is a capped single screen ──────────────────────────────────────────────────
const aboutCap = Number(modal.match(/kind === 'about' \? (\d+) : \d+\)/)?.[1] ?? NaN);
check(
  `2a. the About height cap exists and stays a dialog, not a screen takeover (${aboutCap} ≤ 680)`,
  Number.isFinite(aboutCap) && aboutCap <= 680,
);
check(
  '2b. ONE column serves every breakpoint — the retired two-panel machinery is gone',
  !/aboutWide/.test(modal) && !/ABOUT_WIDE_MIN_W = \d/.test(modal) && !/VisualPanel|MiniCard/.test(modal),
);

// ── 3. The redesign themes fully — dark mode is a real dark composition ─────────────────────────
check('3a. About styles are palette-driven (makeAbout factory), never the static light tokens',
  /function makeAbout\(pal: Record<string, string>, dark: boolean\)/.test(modal)
  && /useMemo\(\(\) => makeAbout\(pal, dark\), \[pal, dark\]\)/.test(modal));
check('3b. the hero artwork dims for dark mode instead of glowing through it',
  /opacity: dark \? 0\.22 : 0\.55/.test(modal));
check('3c. the hero art clips and derives its text clearance from TOP_CLEAR (× can never collide)',
  /heroArt: \{ height: TOP_CLEAR \+ \d+, overflow: 'hidden'/.test(modal)
  && /heroInner: \{[^}]*paddingTop: TOP_CLEAR/.test(modal));

// ── 4. Arabic typography: no letterSpacing anywhere in the About styles ─────────────────────────
const aBlock = modal.slice(modal.indexOf('const a = StyleSheet.create'));
check('4. no letterSpacing in any About style (Latin tracking mangles Arabic script)',
  aBlock.length > 100 && !/letterSpacing/.test(aBlock));

// ── 5 + 6. Every displayed string has an Arabic entry, and none carries a «—» dash ──────────────
const keys = [...modal.matchAll(/t\('((?:[^'\\]|\\.)+)'/g)].map((m) => m[1].replace(/\\'/g, "'"));
const missing: string[] = [];
const dashed: string[] = [];
for (const k of new Set(keys)) {
  const esc = k.replace(/'/g, "\\'");
  const idx = i18n.indexOf(`'${esc}':`) !== -1 ? i18n.indexOf(`'${esc}':`) : i18n.indexOf(`'${esc}'`);
  if (idx === -1) { missing.push(k); continue; }
  // The Arabic value follows the key (same or next lines up to the closing quote+comma).
  const val = i18n.slice(idx, idx + esc.length + 400);
  if (!/[؀-ۿ]/.test(val)) missing.push(k);
  const arabic = val.match(/:\s*\n?\s*'([^']+)'/);
  if (arabic && arabic[1].includes('—')) dashed.push(k);
}
check(`5. every string InfoModal displays has an Arabic dictionary entry (${new Set(keys).size} keys)`,
  missing.length === 0, missing.length ? `missing/English-only: ${missing.join(' | ')}` : undefined);
check('6. no Arabic dash separator («—») in any string the About/Support dialog displays',
  dashed.length === 0, dashed.length ? `dashed: ${dashed.join(' | ')}` : undefined);

// ── 7. The trust content is designed, not a document: icon-led rows inside one quiet card ───────
check(
  '7. legal facts render as icon-led trust rows under the «الثثقة والشفافية» title'.replace('الثثقة','الثقة'),
  /trustRow/.test(modal) && /trustIcon/.test(modal) && /Trust & transparency/.test(modal)
  && (modal.match(/trustRow/g) ?? []).length >= 2,
);

// ── 8. Required content survives: four legal facts + labels + brand line + hero ─────────────────
const REQUIRED = [
  'Our role', 'Listing licensing', 'Disclaimer', 'Data & privacy',
  'Ezhalah is a search platform only. We do not own, list, sell, or rent properties, and we run no transactions and take no commission.',
  'Every listing is published by its source platform and remains subject to its licensing. Ezhalah does not issue or own listings.',
  'Listings come from external platforms and we do not verify them. Confirm the details with the original platform before any decision.',
  'We collect only what the service needs, and we do not sell user data.',
  'Ezhalah, and may your luck be good.',
  'Smarter property search, bringing the Saudi market together in one place.',
];
const missingReq = REQUIRED.filter((r) => !modal.includes(r));
check(`8. all ${REQUIRED.length} required legal/brand/hero strings are rendered by the dialog`,
  missingReq.length === 0, missingReq.length ? `missing: ${missingReq.join(' | ')}` : undefined);

// ── 9. Reduced motion is respected ──────────────────────────────────────────────────────────────
check(
  '9. reduced motion: hook wired, Sheet scale pinned to 1, stagger disabled (IS_WEB && !reduced)',
  /useReducedMotion\(\)/.test(modal) && /reduced \? 1 : interpolate/.test(modal) &&
    /IS_WEB && !reduced/.test(modal) && /IN_REDUCED/.test(modal) && /OUT_REDUCED/.test(modal),
);

// ── 9b. The reveal flip must never be gated on rAF alone ────────────────────────────────────────
// Browsers suspend requestAnimationFrame in hidden/throttled tabs (repo rule, afterAnimation.ts):
// a reveal gated only on rAF leaves the dialog PERMANENTLY BLANK there (caught live 2026-08-23 in
// the browser-pane preview). The timer fallback must survive any refactor of useShown.
const useShownFn = modal.match(/function useShown[\s\S]*?\n\}/)?.[0] ?? '';
check(
  '9b. the stagger flip has a timer fallback beside rAF (visibility never gated on rAF alone)',
  /requestAnimationFrame/.test(useShownFn) && /setTimeout\(\(\) => setShown\(true\)/.test(useShownFn),
);

// ── 10. Navigation contract: the sidebar entry still opens this modal ───────────────────────────
check(
  "10. Sidebar still opens «من نحن» via openInfo('about') and InfoModal still hosts both bodies",
  /openInfo\('about'\)/.test(sidebar) && /kind === 'support' \? <SupportBody/.test(modal) && /<AboutBody/.test(modal),
);

// ── Honesty invariant: the only number derives from the shipped roster ──────────────────────────
check(
  'honesty: the platform count is PLATFORM_META.length at compile time, never a hardcoded digit',
  /const PLATFORM_COUNT = PLATFORM_META\.length/.test(modal) &&
    /\+\{String\(PLATFORM_COUNT\)\}/.test(modal) &&
    !/statNum>\s*\+\d/.test(modal) && !/\+\d+ منصة/.test(modal),
);

console.log(
  failed === 0
    ? '\n✓ about-premium-contract: «من نحن» keeps its single-screen premium contract'
    : `\n✗ ${failed} assertion(s) FAILED — the «من نحن» redesign contract has regressed`,
);
if (failed > 0) process.exit(1);
