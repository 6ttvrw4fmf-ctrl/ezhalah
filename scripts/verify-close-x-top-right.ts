// THE CLOSE X IS TOP RIGHT, IN ARABIC AND IN ENGLISH (owner 2026-11-10: «x for everything must always be on the top right
// no matter what, even if it's in English»; it restates 2026-10-24's «× top-RIGHT in both languages»).
// Measured live 2026-11-10 (Arabic, 390 px): the map filter's X sat 16 px from the LEFT and the full-screen map's at
// left: 12; a code audit found four more (AI question card, route panel, compact sign-in card, read-aloud pill).
// Layout facts on web (measured): the document is dir="rtl" in Arabic; under RTL a plain row lays its FIRST child at the
// physical right and row-reverse at the left (LTR the opposite); absolute left/right are physical; and React Native
// Web drops an `undefined` style value, so `{ left: undefined }` never clears a base `left` (review of #11614).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const src = (f: string) => readFileSync(join(root, f), 'utf8');
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; };
const mustCatch = (name: string, caught: boolean) => check(`(mutation) catches ${name}`, caught);

/** Where a row's FIRST child lands, physically. */
const firstChildSide = (dir: string, docRtl: boolean): 'left' | 'right' => ((dir === 'row') === docRtl ? 'right' : 'left');
/** Evaluate `cond ? 'a' : 'b'` (the only shape these rows use) for a given condition value. */
const pick = (expr: string, cond: boolean) => { const m = expr.match(/\?\s*'([\w-]+)'\s*:\s*'([\w-]+)'/); return m ? (cond ? m[1] : m[2]) : expr.replace(/'/g, ''); };

// 1. Read-aloud pill: the × is the row's FIRST child, and the row follows the document's direction.
const ra = src('src/components/ReadAloudPlayer.tsx');
const raDir = ra.match(/\{ flexDirection: (docRtl \? '[\w-]+' : '[\w-]+') \}/)?.[1] ?? '';
/** The pill's FIRST control: the first JSX element inside <Animated.View …>, whatever its tag (comments skipped). */
const firstControl = (code: string): string => {
  const open = code.indexOf('<Animated.View');
  if (open < 0) return '';
  let i = code.indexOf('>', code.indexOf(']}', open)) + 1;   // end of the opening tag (its style array ends with ]})
  const body = code.slice(i).replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  return body.match(/<[A-Z][\w.]*[^>]*>/)?.[0] ?? '';
};
const firstPill = firstControl(ra);
check('read-aloud: the row direction follows the document (useDocumentRtl), not the locale', /const docRtl = useDocumentRtl\(isRTL\);/.test(ra) && raDir !== '');
check('read-aloud: the × is the first control in the pill (any control kind)', /^<PillButton icon="close"/.test(firstPill));
check('read-aloud: the direction comes from the document only — a locale/document mismatch cannot flip it', /docRtl \?/.test(raDir) && !/isRTL/.test(raDir));
// Mutations executed on the real source: a SeekButton moved before Close, and the old order (Close last).
const seekLine = ra.match(/ *<SeekButton mirrored[^\n]*\n/)?.[0] ?? '';
const closeLine = ra.match(/ *<PillButton icon="close"[^\n]*\n/)?.[0] ?? '';
const seekFirst = ra.replace(seekLine, '').replace(closeLine, seekLine + closeLine);
mustCatch('a SeekButton moved before Close', seekLine !== '' && seekFirst !== ra && !/^<PillButton icon="close"/.test(firstControl(seekFirst)));
const closeLast = ra.replace(closeLine, '').replace(/( *)<\/Animated\.View>/, closeLine + '$1</Animated.View>');
mustCatch('Close moved back to the end', closeLast !== ra && !/^<PillButton icon="close"/.test(firstControl(closeLast)));
check('read-aloud: the × lands physically right in Arabic AND English', [true, false].every((rtl) => firstChildSide(pick(raDir, rtl), rtl) === 'right'));
// The old order put the × LAST: in this row the last child lands opposite the first, i.e. left in both languages.
mustCatch('the × as the last control (left in both languages, as shipped before)', [true, false].every((rtl) => firstChildSide(pick(raDir, rtl), rtl) !== 'left') && !/icon=\{playing/.test(firstPill));

// 2. Full-screen map: each side is its own style; no base offset left behind for an `undefined` to fail to clear.
const map = src('src/components/AppleMap.web.tsx');
check('full-screen map: the X uses the right-side style', /style=\{\[s\.closeBtn, s\.closeBtnRight\]\}[^\n]*testID="map-close-full"/.test(map) && /closeBtnRight: \{ right: 12 \}/.test(map));
check('full-screen map: the shared button style sets no side of its own', /closeBtn: \{\n\s*position: 'absolute', top: 12, width:/.test(map));
check('no `undefined` side override anywhere in the map (web drops it)', !/(?:left|right|start|end): undefined/.test(map));
mustCatch('a base left: 12 the X would keep in English', !/closeBtn: \{\n\s*position: 'absolute', top: 12, left: 12/.test(map));

// 3. Compact sign-in card: the × is pinned with a physical `right`, never a direction-relative `end` / undefined.
const auth = src('src/components/AuthModal.tsx');
check('sign-in card: the main-step × uses a physical right; the chevron keeps `end`', /step === 'main' \? \{ right: cp \? 8 : 14 \} : \{ end: cp \? 8 : 14 \}/.test(auth));
check('sign-in card: neither base style carries `end` (it would stay next to `right`)', !/popClose: \{[^}]*\bend: \d/.test(auth));

// 4. Header rows that would put the X left under RTL: each reverses under RTL.
check('AI question card: the chip/X group reverses under RTL so the X takes the corner', /<View style=\{\[s\.barSide, isRTL && \{ flexDirection: 'row-reverse' \}\]\}>/.test(src('src/components/AdvancedQuestionCard.tsx')));
check('route panel: the title/X row reverses under RTL', /<View style=\{\[s\.routeHead, isRTL && \{ flexDirection: 'row-reverse'/.test(src('src/components/MapDealRow.tsx')));
check('map filter: the header reverses under RTL', /<View style=\{\[s\.head, \{ flexDirection: isRTL \? 'row-reverse' : 'row' \}/.test(src('src/components/MapFilterCard.tsx')));
check('map pin sheet: the header reverses under RTL', /<View style=\{\[s\.head, \{ flexDirection: isRTL \? 'row-reverse' : 'row' \}\]\}>/.test(src('src/components/MapPinSheet.tsx')));

console.log(failed ? `\n❌ verify-close-x-top-right: ${failed} check(s) failed` : '\nverify-close-x-top-right: every close X is top right in both languages');
process.exit(failed ? 1 : 0);
