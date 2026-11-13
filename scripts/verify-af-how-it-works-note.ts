// THE ADVANCED FILTER NOTE IS ONE SHORT LINE + «كيف يشتغل؟», AND THE READER CARRIES THE OWNER'S TEXT
// (owner 2026-11-01). The owner found the old sentence too long and asked for a short line with a tap-to-read
// «how it works» opened like the Terms & Privacy reader (white card, eagle, ✕ top-right, no emoji anywhere).
//
// Executed, not grepped, where it matters: the text module is imported and every section is checked for
// emoji, for Arabic diacritics (owner 2026-11-02: «تأكد أنه يكون من غير حركات») and for the two-part
// 'heading\n\nparagraph' shape in BOTH languages; the wiring (card link → modal 'af-how' → InfoModal 'afhow'
// body), the reader's question-card footprint and the Skip note (owner 2026-11-02) are pinned by reading the files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AF_HOW_IT_WORKS, getAfHowItWorks } from '../src/data/afHowItWorks.ts';

const EMOJI = /\p{Extended_Pictographic}/u;
export const hasEmoji = (s: string): boolean => EMOJI.test(s);
// Arabic diacritics (tashkeel): fathatan…sukun, superscript alef, and the Quranic-style marks. Tatweel is
// not a diacritic and hamza seats (أ إ ؤ ئ) are letters, so they pass.
const HARAKAT = /[\u064B-\u065F\u0670\u06D6-\u06ED]/u;
export const hasHarakat = (s: string): boolean => HARAKAT.test(s);
assert.equal(hasHarakat('دقّق'), true);
assert.equal(hasHarakat('صراحةً'), true);
assert.equal(hasHarakat('إزهله لا تضيف ولا تخمن'), false);

// Predicate sanity before trusting it on the real text.
assert.equal(hasEmoji('مصعد 🛗'), true);
assert.equal(hasEmoji('مصعد'), false);
assert.equal(hasEmoji('«كما هي»'), false, 'Arabic quotes are not emoji');

for (const locale of ['ar', 'en'] as const) {
  const docs = getAfHowItWorks(locale);
  assert.equal(docs.length, 6, `[${locale}] six sections (source, AI, number, limits, responsibility, skipping)`);
  docs.forEach((d, i) => {
    assert.ok(!hasEmoji(d), `[${locale}] section ${i + 1} carries no emoji`);
    assert.ok(!hasHarakat(d), `[${locale}] section ${i + 1} carries no Arabic diacritics`);
    const parts = d.split('\n\n');
    assert.equal(parts.length, 2, `[${locale}] section ${i + 1} is heading + one paragraph`);
    assert.ok(parts[1].length > 60, `[${locale}] section ${i + 1} has a real paragraph`);
  });
}
// The owner's non-negotiables, by content.
const ar = AF_HOW_IT_WORKS.ar.join('\n');
assert.ok(ar.includes('الذكاء الاصطناعي') && ar.includes('يقرأ ويصنف فقط'), 'AR names the AI and says it only reads and classifies');
assert.ok(ar.includes('هدفه توصيلك للمعلن فقط') && ar.includes('ولا نأخذ أي مبلغ أو عمولة'), 'AR: our goal is to send you to the lister, we take nothing from the deal');
assert.ok(ar.includes('«كما هي»') && ar.includes('الشروط والأحكام'), 'AR: as-is + Terms apply');
assert.ok(ar.includes('٦. التخطي') && ar.includes('أسئلة وخيارات أكثر'), 'AR: section 6 says Skip keeps more questions and options');
const en = AF_HOW_IT_WORKS.en.join('\n');
assert.ok(en.includes('only reads and classifies') && en.includes('take no payment or commission'), 'EN mirrors the AI role and the no-commission line');
assert.ok(en.includes('6. Skipping') && en.includes('more questions and options'), 'EN: section 6 mirrors the Skip explanation');

// Wiring: the card shows the short line with the link, the link opens 'af-how', InfoModal renders it.
const card = readFileSync('src/components/AdvancedQuestionCard.tsx', 'utf8');
assert.ok(card.includes(`t("Counts come from the ads' own words")`), 'card: the short line');
assert.ok(card.includes(`t('How it works?')`) && card.includes(`openModal('af-how')`), 'card: the link opens the reader');
assert.ok(!card.includes('Your search options and counts use published listing details'), 'card: the long sentence is gone');
// The Skip note sits under the footer, only while Skip is offered, and its Arabic carries no diacritics.
assert.ok(/\{hideSkip \? null : \(\s*<Text testID="af-skip-note"/.test(card), 'card: the Skip note is rendered only with the Skip button');
assert.ok(card.includes(`t('Skip and you get more questions and options')`), 'card: the Skip note text');
const modal = readFileSync('src/components/InfoModal.tsx', 'utf8');
assert.ok(modal.includes(`modal === 'af-how' ? 'afhow'`) && modal.includes('function HowItWorksBody'), 'InfoModal routes af-how to its own body');
assert.ok(modal.includes(`kind === 'afhow' ? <HowItWorksBody`), 'InfoModal renders the body');
assert.ok(/\(kind === 'legal' \|\| kind === 'afhow'\) && s\.overlayTop/.test(modal), 'the reader sits above the Advanced Filter card like the legal reader does');
// Same footprint as the question card (owner 2026-11-02): width pinned to the card's maxWidth, never the Terms reader's 640.
const cardMaxW = Number(/maxWidth: (\d+), maxHeight: '100%', backgroundColor: colors\.paper/.exec(card)?.[1]);
const readerMaxW = Number(/const AF_HOW_MAX_W = (\d+);/.exec(modal)?.[1]);
assert.ok(cardMaxW > 0 && readerMaxW === cardMaxW, `reader width ${readerMaxW} equals the question card's ${cardMaxW}`);
assert.ok(modal.includes(`kind === 'afhow' ? AF_HOW_MAX_W : kind === 'legal' ? LEGAL_MAX_W`), 'InfoModal picks the card width for afhow');
assert.ok(modal.includes(`kind === 'afhow' ? AF_HOW_MAX_H`), 'InfoModal caps the reader height for afhow');
const store = readFileSync('src/store.tsx', 'utf8');
assert.ok(store.includes(`'privacy' | 'af-how'`), 'store: the modal union knows af-how');
const i18n = readFileSync('src/i18n.tsx', 'utf8');
for (const k of ["Counts come from the ads' own words", 'How it works?', 'How Refine with AI works', 'Skip and you get more questions and options']) assert.ok(i18n.includes(k), `i18n key: ${k}`);
const skipAr = /'Skip and you get more questions and options': '([^']+)'/.exec(i18n)?.[1] ?? '';
assert.ok(skipAr.length > 10 && !hasHarakat(skipAr) && !hasEmoji(skipAr), 'i18n: the Arabic Skip note has no diacritics and no emoji');
// The payment disclaimer sits INSIDE the brand strip, right under the provider logos (owner 2026-11-02).
assert.ok(/<Image source=\{BRAND_IMAGES\[brandImage\]\}[\s\S]{0,600}<Text testID="af-payment-note"/.test(card), 'card: the payment note renders under the provider logos');
// Reworded 2026-11-12 (owner, with the one-chip instalments merge): the lister says instalments or monthly payments,
// through one of these providers or another way, and Ezhalah cannot guarantee it — confirm with the lister.
const PAY_EN = 'Listers say you can pay in instalments or monthly, through one of these providers or another way. Ezhalah cannot guarantee it; confirm with the lister.';
assert.ok(card.includes(`{t('${PAY_EN}')}`), 'card: the payment note renders the 2026-11-12 wording');
const payAr = new RegExp(`'${PAY_EN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}': '([^']+)'`).exec(i18n)?.[1] ?? '';
assert.ok(payAr.length > 20 && !hasHarakat(payAr) && !hasEmoji(payAr), 'i18n: the Arabic payment note has no diacritics and no emoji');
// it says both halves the owner asked for: «another way» (not only these providers) and «cannot guarantee»
const payNoteSaysBoth = (ar: string) => /بطريقة أخرى/.test(ar) && /لا تضمن/.test(ar) && /المعلن/.test(ar);
assert.ok(payNoteSaysBoth(payAr), `i18n: the Arabic payment note names «another way», «cannot guarantee» and the lister (got «${payAr}»)`);
assert.ok(!card.includes("t('Ezhalah does not guarantee the payment method or the provider."), 'card: the pre-2026-11-12 payment note is gone');

// MUTATION PROOF — each predicate watched failing on a deliberately broken input.
function mustCatch(label: string, caught: boolean): void { assert.ok(caught, `mutation NOT caught: ${label}`); console.log(`  (mutation) catches ${label}`); }
mustCatch('an emoji smuggled into a section', hasEmoji('٢. الذكاء الاصطناعي\n\nيقرأ 🤖 نص كل إعلان'));
mustCatch('a section without its paragraph', '٤. الحدود'.split('\n\n').length !== 2);
mustCatch('a section dropped', [...AF_HOW_IT_WORKS.ar].slice(0, 5).length !== 6);
mustCatch('a diacritic smuggled into a section', hasHarakat('٣. الرقم\n\nعدد الإعلانات التي ذكرت الميزة صراحةً'));
mustCatch('the reader widened back to the Terms width', !(640 === cardMaxW));
mustCatch('the payment note moved out of the brand strip', !/<Image source=\{BRAND_IMAGES\[brandImage\]\}[\s\S]{0,600}<Text testID="af-payment-note"/.test('<Text testID="af-payment-note"/> … <Image source={BRAND_IMAGES[brandImage]} />'));
mustCatch('the old provider-only payment note (no «another way»)', !payNoteSaysBoth('إزهله لا تضمن طريقة الدفع ولا مزود التقسيط. تأكد من المعلن مباشرة.'));
mustCatch('a payment note that drops «cannot guarantee»', !payNoteSaysBoth('يذكر المعلن إمكانية الدفع بالتقسيط أو على دفعات، عبر أحد هؤلاء المزودين أو بطريقة أخرى.'));
mustCatch('the Skip note rendered unconditionally', !/\{hideSkip \? null : \(\s*<Text testID="af-skip-note"/.test('<Text testID="af-skip-note">'));

console.log('verify-af-how-it-works-note: OK — short line + «كيف يشتغل؟», six emoji-free, diacritic-free sections in AR and EN, card-sized reader, Skip note wired');
