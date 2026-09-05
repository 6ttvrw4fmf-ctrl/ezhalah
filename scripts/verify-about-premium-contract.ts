// «من نحن» premium single-screen contract (owner brief, 2026-08-23).
//
// The About dialog was rebuilt from a five-card corporate scroll into a single-screen company
// card: hero (wordmark + thesis) + four verb-led value blocks + an abstract map panel (desktop)
// + a four-column small-print legal strip. This barrier pins the TEN contract points of that
// brief so no future edit quietly regresses any of them:
//
//   1. the long five-card scroll must not return          6. no Arabic dash separators («—»)
//      (2026-09-03: and the artwork sits in its OWN box,   7. the map panel stays desktop-only
//      never as a background under text)                  8. required legal/brand content survives
//   2. desktop fits a capped single screen
//   3. themed fully; no × on «من نحن», header-drag
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
// DESIGN CORRECTION (owner 2026-09-03, supersedes the 2026-08-29 artwork-led hero): «من نحن» is
// NOT text written over a background image. The artwork lives in its OWN box — the real image at
// its real aspect ratio, contained, nothing painted over it — and the information has its own
// structure (intro, statistic, 2×2 feature cards, trust card).
check(
  '1b. the artwork lives in its OWN box, contained at its real aspect ratio, and no gradient melt remains',
  /artBox:\s*\{/.test(modal) && /artImg:\s*\{/.test(modal) && /trustCard:\s*\{/.test(modal)
  && /<RNImage source=\{ABOUT_ART\} style=\{a\.artImg\} resizeMode="contain" \/>/.test(modal)
  && /aspectRatio: ABOUT_ART_RATIO/.test(modal) && /const ABOUT_ART_RATIO = 900 \/ 1317/.test(modal)
  && !/LinearGradient/.test(modal),
);
check(
  '1c. the artwork is never a background under text: the image is not absolutely positioned and its box holds ONLY the image',
  !/artImg:\s*\{[^}]*position: 'absolute'/.test(modal)
  && /style=\{\[a\.artBox, wide \? a\.artBoxWide : a\.artBoxNarrow\]\}>\s*\n\s*<RNImage source=\{ABOUT_ART\}[^\n]*\n\s*<\/Reveal>/.test(modal),
);

// ── 2. Desktop about is a capped single screen ──────────────────────────────────────────────────
const aboutCap = Number(modal.match(/^const ABOUT_MAX_H = (\d+);/m)?.[1] ?? NaN);
check(
  `2a. the About height cap exists and stays a dialog, not a screen takeover (${aboutCap} ≤ 720)`,
  Number.isFinite(aboutCap) && aboutCap <= 720,
);
check(
  '2b. ONE column serves every breakpoint — the retired two-panel machinery is gone',
  !/aboutWide/.test(modal) && !/ABOUT_WIDE_MIN_W = \d/.test(modal) && !/VisualPanel|MiniCard/.test(modal),
);

// ── 3. The redesign themes fully — dark mode is a real dark composition ─────────────────────────
check('3a. About styles are palette-driven (makeAbout factory), never the static light tokens',
  /function makeAbout\(pal: Record<string, string>, dark: boolean\)/.test(modal)
  && /useMemo\(\(\) => makeAbout\(pal, dark\), \[pal, dark\]\)/.test(modal));
// 3b RETARGETED 2026-09-03: the EXISTING eagle-night asset stays, and it is shown as-is — never
// dimmed, ghosted or zoomed (the 2026-08-30 per-theme opacity belonged to the wallpaper treatment).
check('3b. the artwork is the existing eagle-night asset, shown at full opacity in both themes (never ghosted)',
  /const ABOUT_ART = require\('\.\.\/\.\.\/assets\/images\/eagle-night\.jpg'\)/.test(modal)
  && !/artImg:[^\n]*opacity/.test(modal) && !/artBox(Wide|Narrow)?:[^\n]*opacity/.test(modal));
// 3c RETARGETED 2026-09-03: «من نحن» has NO close button (the backdrop closes it) and is DRAGGABLE
// by its header on desktop, starting centered on every open (no position memory).
check('3c. «من نحن» renders without a × (gated), drags by its header via the shared machinery, and never remembers a position',
  /const hasClose = kind !== 'about';/.test(modal) && /\{hasClose && \(/.test(modal)
  && /<AboutBody[^>]*gripRef=\{gripRef\}/.test(modal) && /ref=\{gripRef\}/.test(modal)
  && /attachCardDrag\(node, grip, \{/.test(modal) && !/posKey:/.test(modal)
  && /const drag = about && canDragAuthPopup\(\{ isWeb: IS_WEB, docked \}\)/.test(modal));

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
  // Strengthened 2026-09-05 (iOS focus-zoom fix): the card scale is now pinned to 1 under reduced
  // motion OR on web — `reduced || IS_WEB ? 1 : interpolate` — because a sub-1 scale entrance over
  // the support form's TextInputs made Safari zoom on focus (verify-input-font-no-ios-zoom.ts §3).
  // The reduced-motion pin is a strict subset of the new guard; requiring the full guard here means
  // dropping EITHER half re-reddens this check.
  '9. reduced motion: hook wired, Sheet scale pinned to 1, stagger disabled (IS_WEB && !reduced)',
  /useReducedMotion\(\)/.test(modal) && /reduced \|\| IS_WEB \? 1 : interpolate/.test(modal) &&
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
