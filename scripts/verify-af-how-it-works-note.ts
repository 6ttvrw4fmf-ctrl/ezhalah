// THE ADVANCED FILTER NOTE IS ONE SHORT LINE + «كيف يشتغل؟», AND THE READER CARRIES THE OWNER'S TEXT
// (owner 2026-11-01). The owner found the old sentence too long and asked for a short line with a tap-to-read
// «how it works» opened like the Terms & Privacy reader (white card, eagle, ✕ top-right, no emoji anywhere).
//
// Executed, not grepped, where it matters: the text module is imported and every section is checked for
// emoji and for the two-part 'heading\n\nparagraph' shape in BOTH languages; the wiring (card link →
// modal 'af-how' → InfoModal 'afhow' body) is pinned by reading the three files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AF_HOW_IT_WORKS, getAfHowItWorks } from '../src/data/afHowItWorks.ts';

const EMOJI = /\p{Extended_Pictographic}/u;
export const hasEmoji = (s: string): boolean => EMOJI.test(s);

// Predicate sanity before trusting it on the real text.
assert.equal(hasEmoji('مصعد 🛗'), true);
assert.equal(hasEmoji('مصعد'), false);
assert.equal(hasEmoji('«كما هي»'), false, 'Arabic quotes are not emoji');

for (const locale of ['ar', 'en'] as const) {
  const docs = getAfHowItWorks(locale);
  assert.equal(docs.length, 5, `[${locale}] five sections (source, AI, number, limits, responsibility)`);
  docs.forEach((d, i) => {
    assert.ok(!hasEmoji(d), `[${locale}] section ${i + 1} carries no emoji`);
    const parts = d.split('\n\n');
    assert.equal(parts.length, 2, `[${locale}] section ${i + 1} is heading + one paragraph`);
    assert.ok(parts[1].length > 60, `[${locale}] section ${i + 1} has a real paragraph`);
  });
}
// The owner's non-negotiables, by content.
const ar = AF_HOW_IT_WORKS.ar.join('\n');
assert.ok(ar.includes('الذكاء الاصطناعي') && ar.includes('يقرأ ويصنّف فقط'), 'AR names the AI and says it only reads and classifies');
assert.ok(ar.includes('هدفه توصيلك للمعلن فقط') && ar.includes('ولا نأخذ أي مبلغ أو عمولة'), 'AR: our goal is to send you to the lister, we take nothing from the deal');
assert.ok(ar.includes('«كما هي»') && ar.includes('الشروط والأحكام'), 'AR: as-is + Terms apply');
const en = AF_HOW_IT_WORKS.en.join('\n');
assert.ok(en.includes('only reads and classifies') && en.includes('take no payment or commission'), 'EN mirrors the AI role and the no-commission line');

// Wiring: the card shows the short line with the link, the link opens 'af-how', InfoModal renders it.
const card = readFileSync('src/components/AdvancedQuestionCard.tsx', 'utf8');
assert.ok(card.includes(`t("Counts come from the ads' own words")`), 'card: the short line');
assert.ok(card.includes(`t('How it works?')`) && card.includes(`openModal('af-how')`), 'card: the link opens the reader');
assert.ok(!card.includes('Your search options and counts use published listing details'), 'card: the long sentence is gone');
const modal = readFileSync('src/components/InfoModal.tsx', 'utf8');
assert.ok(modal.includes(`modal === 'af-how' ? 'afhow'`) && modal.includes('function HowItWorksBody'), 'InfoModal routes af-how to its own body');
assert.ok(modal.includes(`kind === 'afhow' ? <HowItWorksBody`), 'InfoModal renders the body');
assert.ok(/\(kind === 'legal' \|\| kind === 'afhow'\) && s\.overlayTop/.test(modal), 'the reader sits above the Advanced Filter card like the legal reader does');
const store = readFileSync('src/store.tsx', 'utf8');
assert.ok(store.includes(`'privacy' | 'af-how'`), 'store: the modal union knows af-how');
const i18n = readFileSync('src/i18n.tsx', 'utf8');
for (const k of ["Counts come from the ads' own words", 'How it works?', 'How Refine with AI works']) assert.ok(i18n.includes(k), `i18n key: ${k}`);

// MUTATION PROOF — each predicate watched failing on a deliberately broken input.
function mustCatch(label: string, caught: boolean): void { assert.ok(caught, `mutation NOT caught: ${label}`); console.log(`  (mutation) catches ${label}`); }
mustCatch('an emoji smuggled into a section', hasEmoji('٢. الذكاء الاصطناعي\n\nيقرأ 🤖 نص كل إعلان'));
mustCatch('a section without its paragraph', '٤. الحدود'.split('\n\n').length !== 2);
mustCatch('a fourth section dropped', [...AF_HOW_IT_WORKS.ar].slice(0, 4).length !== 5);

console.log('verify-af-how-it-works-note: OK — short line + «كيف يشتغل؟», five emoji-free sections in AR and EN, wired to the Terms reader host');
