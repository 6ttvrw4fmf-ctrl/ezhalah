// AF footer buttons barrier (owner redesign, 2026-08-28).
//
// TWO owner decisions in one change, both pinned here so neither can silently revert:
//
//   1. «رجوع» and «تخطي» are REAL BUTTONS, not footnote links. The old footer rendered them as
//      13.5px text with 4px of vertical padding — "too weak visually, do not feel like clear
//      controls" (owner, verbatim). They are now equal-width bordered buttons on the option rows'
//      surface+fieldLine idiom at the primary's chip radius, ≥44pt targets, with instant
//      hover/press/keyboard-focus states, and «رجوع» carries an RTL-aware back chevron.
//   2. The in-question «عرض النتائج» early-exit (`af-skip-all`) is REMOVED entirely. The question
//      footer is متابعة / تخطي / رجوع; a round ends by walking its questions, by Back from
//      question 1, or by ✕. The intro card's own «عرض النتائج» decline link is unchanged.
//
// BEHAVIOR IS UNCHANGED by decision 1 and this barrier proves it: af-back still rides onBack,
// af-skip still rides onSkip, the primary still rides onConfirm(sel) — same handlers, same testIDs,
// same semantics (Product Contract §8.1/§8.2). Decision 2 is the one deliberate semantic change,
// recorded in the Product Contract §8.3 (2026-08-28) and pinned in both directions below.
//
//   node --experimental-strip-types scripts/verify-af-footer-buttons.ts   (auto-discovered by npm test)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
// Comments describe decisions in prose; only executable source may satisfy a check.
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

const cardRaw = read('src/components/AdvancedQuestionCard.tsx');
const cardSrc = codeOnly(cardRaw);
const agentSrc = codeOnly(read('src/app/agent.tsx'));
const i18nSrc = read('src/i18n.tsx');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// One control's rendered block, from its testID back to its opening <Pressable and forward to its
// close — so a check about Back's contents can never be satisfied by Skip's.
const blockOf = (src: string, testId: string): string => {
  const at = src.indexOf(`testID="${testId}"`);
  if (at < 0) return '';
  const open = src.lastIndexOf('<Pressable', at);
  const close = src.indexOf('</Pressable>', at);
  return open < 0 || close < 0 ? '' : src.slice(open, close);
};
const backBlock = blockOf(cardSrc, 'af-back');
const skipBlock = blockOf(cardSrc, 'af-skip');

console.log('\nAF footer — رجوع/تخطي are real buttons; the «عرض النتائج» early-exit stays removed\n');

// ── 1. BEHAVIOR UNCHANGED: same handlers, same testIDs, same commit paths ───────────────────────
check('af-back rides onBack (unchanged semantics)', /onPress=\{onBack\}/.test(backBlock));
check('af-skip rides onSkip (unchanged semantics)', /onPress=\{onSkip\}/.test(skipBlock));
check('the primary still rides onConfirm(sel)',
  /testID="af-confirm"/.test(cardSrc) && /onPress=\{\(\) => onConfirm\(sel\)\}/.test(cardSrc));
check('onAgeSkip still commits an empty answer through the ONE commit path',
  /const onAgeSkip = \(\) => \{ void commitGuidedStep\(\[\]\); \}/.test(agentSrc));
check('onAgeBack still walks back via presentGuided(stepIndex - 1)',
  /presentGuided\(stepIndex - 1, back\)/.test(agentSrc));

// ── 2. THE BUTTON TREATMENT: bordered, sized, stateful — not footnote links ─────────────────────
const styleBlock = cardRaw.match(/secondaryBtn:\s*\{[\s\S]*?\},/)?.[0] ?? '';
check('a shared secondaryBtn style exists with a real border and background',
  /backgroundColor:\s*colors\.surface/.test(styleBlock) && /borderWidth:\s*1\.5/.test(styleBlock)
  && /borderColor:\s*colors\.fieldLine/.test(styleBlock),
  'the buttons must carry the option rows\' surface+fieldLine idiom, not be bare text');
check('the buttons meet the 44pt mobile tap-target floor', /minHeight:\s*44/.test(styleBlock));
check('the buttons share the footer family radius (radius.chip, same as the primary)',
  /borderRadius:\s*radius\.chip/.test(styleBlock)
  && /primaryBtn:\s*\{[^}]*borderRadius:\s*radius\.chip/.test(cardRaw));
check('the two buttons split the row equally (flex: 1 in the shared style)', /flex:\s*1/.test(styleBlock));
check('both controls apply the shared button style',
  /s\.secondaryBtn/.test(backBlock) && /s\.secondaryBtn/.test(skipBlock));
check('hover, press and keyboard-focus states exist and are INSTANT style-state (no timers)',
  /secondaryBtnHover/.test(cardRaw) && /secondaryBtnPress/.test(cardRaw) && /secondaryBtnFocus/.test(cardRaw)
  && /hovered && s\.secondaryBtnHover/.test(backBlock)
  && /pressed && s\.secondaryBtnPress/.test(backBlock)
  && /focused && s\.secondaryBtnFocus/.test(backBlock)
  && !/setTimeout/.test(backBlock) && !/setTimeout/.test(skipBlock));
check('the keyboard-focus state is a visible on-brand ring (primary border color)',
  /secondaryBtnFocus:\s*\{[^}]*borderColor:\s*colors\.primary/.test(cardRaw));
check('both controls declare accessibilityRole="button"',
  /accessibilityRole="button"/.test(backBlock) && /accessibilityRole="button"/.test(skipBlock));
check('«رجوع» carries the RTL-aware back chevron (the AuthModal idiom: forward in RTL, back in LTR)',
  /isRTL \? 'chevron-forward' : 'chevron-back'/.test(backBlock));
check('the labels are button-weight, not footnote-weight (semibold ≥14, ink-dark)',
  /secondaryTxt:\s*\{[^}]*font\.family\.semibold/.test(cardRaw)
  && /secondaryTxt:\s*\{[^}]*fontSize:\s*14/.test(cardRaw)
  && /secondaryTxt:\s*\{[^}]*color:\s*colors\.dark/.test(cardRaw));
check('design tokens only — no raw hex/rgba anywhere in the card',
  !/#[0-9a-fA-F]{3,8}\b/.test(cardSrc) && !/rgba\(/.test(cardSrc));

// ── 3. THE REMOVAL STAYS REMOVED (Product Contract R8.3.1, owner 2026-08-28) ────────────────────
check('no af-skip-all control and no skip-all prop anywhere in the card',
  !/testID="af-skip-all"/.test(cardSrc) && !/onSkipAll/.test(cardSrc) && !/skipAllTxt/.test(cardRaw));
check('agent.tsx wires no skip-all handler', !/onAgeSkipAll/.test(agentSrc));
check('the intro card KEEPS its decline link (only the question footer changed)',
  /onPress=\{onShowResults\}/.test(cardSrc));
check('the footer row itself holds exactly the two secondary controls',
  (() => {
    const row = cardSrc.slice(cardSrc.indexOf('s.footRow'), cardSrc.indexOf('</Reanimated.View>', cardSrc.indexOf('s.footRow')));
    return (row.match(/testID="af-/g) ?? []).length === 2
      && /testID="af-back"/.test(row) && /testID="af-skip"/.test(row);
  })());

// ── 4. Arabic labels intact ─────────────────────────────────────────────────────────────────────
check('Back/Skip keep their Arabic dictionary entries',
  /'Back': 'رجوع'/.test(i18nSrc) && /'Skip': 'تخطي'/.test(i18nSrc));

// ── mutation self-proof: every load-bearing check must FAIL against its own defect ──────────────
let mutFail = 0;
const mustCatch = (label: string, brokenIsCaught: boolean) => {
  if (brokenIsCaught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};

// Handlers swapped (Back fires Skip) — the behavior-unchanged guarantee must notice.
mustCatch('af-back silently rewired to onSkip',
  !/onPress=\{onBack\}/.test(blockOf(cardSrc.replace('testID="af-back" onPress={onBack}', 'testID="af-back" onPress={onSkip}'), 'af-back')));
// The redesign quietly reverted to text links (border gone).
mustCatch('the border being stripped back off the buttons',
  !/borderWidth:\s*1\.5/.test((cardRaw.replace(/secondaryBtn:\s*\{[\s\S]*?\},/, 'secondaryBtn: { flex: 1, paddingVertical: 4 },').match(/secondaryBtn:\s*\{[\s\S]*?\},/)?.[0] ?? '')));
// The tap-target floor shrinking below 44.
mustCatch('the 44pt tap-target floor being dropped',
  !/minHeight:\s*44/.test(styleBlock.replace('minHeight: 44', 'minHeight: 28')));
// The early-exit creeping back.
mustCatch('af-skip-all creeping back into the card',
  /testID="af-skip-all"/.test(cardSrc + '\n<Pressable testID="af-skip-all" />'));
// The chevron losing its RTL awareness.
mustCatch('the back chevron losing RTL awareness',
  !/isRTL \? 'chevron-forward' : 'chevron-back'/.test(backBlock.replace(/isRTL \? 'chevron-forward' : 'chevron-back'/, "'chevron-back'")));
// The extractor going blind.
mustCatch('a missing testID reading as an empty block',
  blockOf(cardSrc.replace('testID="af-back"', ''), 'af-back') === '');

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ رجوع/تخطي are real, stateful, RTL-correct buttons with unchanged behavior; the early-exit stays removed\n');
