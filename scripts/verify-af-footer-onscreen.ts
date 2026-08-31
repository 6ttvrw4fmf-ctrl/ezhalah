// TRIPWIRE: the Advanced-Filter card's action row must NEVER be able to scroll off the screen.
//
// THE DEFECT (production, reproduced 2026-08-23 on an iPhone 13 / 390x664 at ezhalah-app.vercel.app).
// `<View style={s.foot}>` — «متابعة · N نتيجة» plus the «رجوع / تخطي / عرض النتائج» row — was the LAST
// CHILD INSIDE the card's body ScrollView. A short question fitted, so the bug hid: the bathrooms
// question put «عرض النتائج» at y=541..558, fully on screen. The very next question (amenities, 7
// options) pushed the same row to y=656..682 against innerHeight=664 — roughly 8px of glyph left, and
// the inner scroller measured clientHeight=601 / scrollHeight=639, i.e. exactly 38px of scroll room
// with no scrollbar and no fade cue to advertise it. Every exit from the interview lived down there:
// «رجوع», «تخطي» and «عرض النتائج» were all unreachable until the user guessed at a 38px scroll.
//
// THE FIX. The action row is now a SIBLING of the ScrollView, not a descendant: only the question body
// (title / description / options / availability note) scrolls, and the footer is pinned to the bottom
// of the card. Post-fix on the same device the row sits at y=604..630, fully visible, tappable with no
// scrolling at all.
//
// WHY A BARRIER. The card is the ONE renderer for every AF question (docs/ADVANCED_FILTER_DESIGN_
// CONTRACT.md §1/§10) and the footer JSX is the natural thing to drag back inside the scrolling body
// during a refactor — at which point the bug returns silently for whichever question happens to be
// tallest on whichever phone, which is exactly how it shipped the first time. This is a hermetic
// source-parse: no browser, no network, runs in `npm test` on every CI.
//
//   node --experimental-strip-types scripts/verify-af-footer-onscreen.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

const src = readFileSync(new URL('../src/components/AdvancedQuestionCard.tsx', import.meta.url), 'utf8');
// Strip every comment — block, JSX (`{/* … */}`) and line — so a guarantee that exists only in prose
// can never satisfy a check below. The prose in this very file names both `ScrollView` and all the
// footer testIDs, so an unstripped parse would pass no matter where the JSX actually sits.
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const svOpen = code.indexOf('<ScrollView');
const svClose = code.indexOf('</ScrollView>');
check('0. the card still has exactly one body ScrollView',
  svOpen > -1 && svClose > svOpen && code.indexOf('<ScrollView', svOpen + 1) === -1,
  'the checks below locate the footer relative to this element');

// ── 1. THE INVARIANT: every footer control lives OUTSIDE the scroller ────────────────────────────
// af-skip-all removed from this list 2026-08-28: the owner removed the in-question «عرض النتائج»
// early-exit entirely — the footer is متابعة / تخطي / رجوع (verify-af-footer-buttons.ts pins both
// the removal and the new button treatment).
const FOOTER_CONTROLS = ['af-confirm', 'af-back', 'af-skip'];
for (const id of FOOTER_CONTROLS) {
  const at = code.indexOf(`testID="${id}"`);
  check(`1. «${id}» is rendered OUTSIDE the body ScrollView (pinned, cannot scroll off screen)`,
    at > -1 && at > svClose,
    at === -1
      ? `testID="${id}" is gone — the AF footer must keep all three controls (contract §4/§7; owner removed af-skip-all 2026-08-28)`
      : `testID="${id}" sits at index ${at}, inside the ScrollView (ends at ${svClose}). ` +
        'On a 664pt phone the tallest question pushes it past the bottom edge — the 2026-08-23 defect.');
}

// The style object itself must be applied outside too — a footer whose controls escaped but whose
// container did not would still be laid out inside the scroller.
const footUse = code.indexOf('s.foot');
check('2. the s.foot container is mounted after </ScrollView>, as a sibling',
  footUse > -1 && footUse > svClose,
  'the pinned row must be a child of the card, not of the scrolling body');
check('3. the footer is still inside the card Shell (pinned to the card, not floating over the page)',
  footUse > -1 && footUse < code.indexOf('</Shell>', svClose));

// ── 4. the scroller, not the footer, is what gives up height ─────────────────────────────────────
// RN and react-native-web disagree on ScrollView's default flex, so this must be stated explicitly:
// if the footer were the shrinking element the row would be squashed instead of the option list.
check('4a. the ScrollView carries an explicit style (s.scroll)',
  /<ScrollView[^>]*style=\{s\.scroll\}/.test(code));
check('4b. s.scroll declares flexShrink so the option list — never the footer — absorbs the overflow',
  /scroll:\s*\{[^}]*flexShrink:\s*1/.test(code));

// ── 5. the card can never grow flush to the viewport edges ───────────────────────────────────────
// `maxHeight: '100%'` resolves against the overlay's CONTENT box, so the vertical padding is what
// keeps the pinned row clear of a phone's home indicator / the browser's own bottom chrome.
check('5a. the card is still height-capped to the screen (maxHeight)',
  /card:\s*\{[\s\S]{0,240}?maxHeight:\s*'100%'/.test(code));
check('5b. the overlay reserves vertical padding, so the card bottom is never the viewport bottom',
  /overlay:\s*\{[^}]*paddingVertical:/.test(code));

// ── 6. no substitute that re-hides the row ───────────────────────────────────────────────────────
// A footer pinned with position:absolute over the scroller would pass §1 on paper and still overlap
// the last option; the contract wants a real flex sibling.
check('6. the footer is a flow sibling, not absolutely positioned over the body',
  !/foot:\s*\{[^}]*position:\s*'absolute'/.test(code));

console.log(failures === 0
  ? '\n✓ af-footer-onscreen: the AF action row is pinned outside the scroller — it cannot scroll off screen'
  : `\n✗ ${failures} assertion(s) FAILED — the AF footer can scroll off the bottom of the phone again`);
process.exit(failures === 0 ? 0 : 1);
