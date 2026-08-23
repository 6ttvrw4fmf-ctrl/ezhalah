// InfoModal header clearance — the Support/About dialog must never paint its × close button over
// its own heading.
//
// THE DEFECT (production, 2026-08-23): the Support dialog's heading «المساعدة/تواصل معنا» lost its
// first word. The close button is absolutely positioned (top/right 14, 34x34, zIndex 5) over the
// card's PHYSICAL top-right, while the heading sat in a body padded only 24px on that side — so the
// heading's box ran 24px UNDER the button and, because Arabic is RTL, the hidden 24px was exactly
// where the text STARTS. Measured on an iPhone 13: title box right=350, button left=326,
// document.elementFromPoint(title.right-2, title.midY) === BUTTON. Same 24px overlap on Pixel 5,
// on desktop 1280x900 and on a 320px-wide phone. The sibling «من نحن» dialog escaped only by
// accident: its 56px eagle badge already occupies the RTL-leading slot.
//
// THE FIX: src/components/InfoModal.tsx declares the button's geometry once (BODY_PAD /
// CLOSE_INSET / CLOSE_SIZE / CLOSE_GAP) and DERIVES the heading's extra physical-right padding
// (CLOSE_CLEAR) from it, so moving or resizing the button keeps the heading clear automatically.
//
// WHY THIS BARRIER: the bug is pure arithmetic between two style blocks that live ~180 lines apart.
// Nothing in TypeScript or in a snapshot test relates them, so the next person to nudge the button
// (or to "clean up" the padding on the heading) reintroduces it silently. This script re-does the
// arithmetic on the real source values — it evaluates whatever expression CLOSE_CLEAR is actually
// declared as, so it bites both when the heading loses its padding and when the padding is frozen
// to a literal that a bigger button then outgrows.
//
//   node --experimental-strip-types scripts/verify-info-modal-header-clearance.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'src/components/InfoModal.tsx';
const src = readFileSync(join(root, SRC), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  if (!ok) {
    failed++;
    if (detail) console.error(`      ${detail}`);
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

// ── The declared geometry ───────────────────────────────────────────────────────────────────────
const num = (name: string): number | null => {
  const m = src.match(new RegExp(`^const ${name} = (-?[\\d.]+);`, 'm'));
  return m ? Number(m[1]) : null;
};
const BODY_PAD = num('BODY_PAD');
const CLOSE_INSET = num('CLOSE_INSET');
const CLOSE_SIZE = num('CLOSE_SIZE');
const CLOSE_GAP = num('CLOSE_GAP');

check(
  `${SRC} declares the dialog geometry as named constants (BODY_PAD/CLOSE_INSET/CLOSE_SIZE/CLOSE_GAP)`,
  [BODY_PAD, CLOSE_INSET, CLOSE_SIZE, CLOSE_GAP].every((v) => typeof v === 'number' && Number.isFinite(v)),
  `parsed BODY_PAD=${BODY_PAD} CLOSE_INSET=${CLOSE_INSET} CLOSE_SIZE=${CLOSE_SIZE} CLOSE_GAP=${CLOSE_GAP}`,
);

// The constants must be the ones the button and the body actually lay out with — a hard-coded
// literal sneaking back into either style would make the arithmetic below a lie.
const xBtn = src.match(/xBtn:\s*\{[\s\S]*?\n {2}\}/)?.[0] ?? '';
check(
  'the close button positions itself from CLOSE_INSET/CLOSE_SIZE (no re-hardcoded 14/34)',
  /top:\s*CLOSE_INSET/.test(xBtn) && /right:\s*CLOSE_INSET/.test(xBtn) &&
    /width:\s*CLOSE_SIZE/.test(xBtn) && /height:\s*CLOSE_SIZE/.test(xBtn),
  `xBtn block:\n${xBtn}`,
);
check(
  'the dialog body pads itself from BODY_PAD',
  /bodyPad:\s*\{[^}]*paddingHorizontal:\s*BODY_PAD/.test(src),
);

// ── THE regression: the Support heading must reserve the button's footprint ─────────────────────
const h = src.match(/\n {2}h:\s*\{[^}]*\}/)?.[0] ?? '';
const headingPad = h.match(/paddingRight:\s*([A-Za-z_$][\w$]*|[\d.]+)/)?.[1];
check(
  'the Support heading (style `h`) reserves physical-right space for the close button (paddingRight)',
  headingPad != null,
  `heading style block:\n${h}`,
);
// `paddingEnd`/`marginEnd` are LOGICAL — under RTL they resolve to the physical LEFT, i.e. the far
// side from the button. Using one here would look fixed in an LTR review and stay broken in Arabic.
check(
  'the heading uses PHYSICAL paddingRight, not a logical paddingEnd/paddingStart that flips under RTL',
  !/padding(End|Start):/.test(h),
  `heading style block:\n${h}`,
);

// Evaluate whatever CLOSE_CLEAR is declared as (derived expression or literal) and re-do the
// geometry: the heading's right edge sits at cardRight - (BODY_PAD + clearance); the button's left
// edge sits at cardRight - (CLOSE_INSET + CLOSE_SIZE). The first must clear the second.
const clearExpr = src.match(/^const CLOSE_CLEAR = ([^;]+);/m)?.[1]?.trim() ?? '';
const SAFE = /^[\w\s+\-*/().]+$/;
let clearance: number | null = null;
if (SAFE.test(clearExpr)) {
  try {
    clearance = Number(
      new Function('BODY_PAD', 'CLOSE_INSET', 'CLOSE_SIZE', 'CLOSE_GAP', `return (${clearExpr});`)(
        BODY_PAD, CLOSE_INSET, CLOSE_SIZE, CLOSE_GAP,
      ),
    );
  } catch { /* reported by the check below */ }
}
check('CLOSE_CLEAR is declared and evaluable from the geometry constants', Number.isFinite(clearance), `expr: ${clearExpr || '(missing)'}`);

const reserved = (BODY_PAD ?? 0) + (headingPad === 'CLOSE_CLEAR' ? (clearance ?? 0) : Number(headingPad ?? 0));
const footprint = (CLOSE_INSET ?? 0) + (CLOSE_SIZE ?? 0);
check(
  `the heading reserves ${reserved}px on the physical right ≥ the button's ${footprint}px footprint + ${CLOSE_GAP}px gap`,
  reserved >= footprint + (CLOSE_GAP ?? 0),
  `heading right edge = cardRight-${reserved}, button left edge = cardRight-${footprint}` +
    (reserved < footprint ? `  → ${footprint - reserved}px of the heading is painted UNDER the ×` : ''),
);

// ── The sibling that escapes structurally: the About header ────────────────────────────────────
// «من نحن» never needed padding because its eagle badge holds the RTL-leading slot. That is a real
// guarantee only while the badge is wider than the button's footprint — pin it, so shrinking the
// badge can't quietly hand the About title the same bug.
const badgeW = Number(src.match(/brandBadge:\s*\{\s*\n?\s*width:\s*([\d.]+)/)?.[1] ?? NaN);
const headGap = Number(src.match(/head:\s*\{[^}]*gap:\s*([\d.]+)/)?.[1] ?? NaN);
check(
  `the About header's eagle badge (${badgeW}px + ${headGap}px gap) still holds its title clear of the button`,
  Number.isFinite(badgeW) && Number.isFinite(headGap) && (BODY_PAD ?? 0) + badgeW + headGap >= footprint + (CLOSE_GAP ?? 0),
);

console.log(
  failed === 0
    ? '\n✓ info-modal header clearance: the × never paints over the dialog heading'
    : `\n✗ ${failed} assertion(s) FAILED — the Support heading is (or can be) painted under the close button`,
);
process.exit(failed === 0 ? 0 : 1);
