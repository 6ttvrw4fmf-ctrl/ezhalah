// THE PERIOD/DEAL PRICE-CLEARING RULE, AS A PREDICATE THAT CAN BE HANDED A BROKEN FILE.
//
// WHY THIS EXISTS (routine #10, R1, 2026-09-23). scripts/verify-period-price-flip.ts was on
// scripts/mutation-proof-grandfathered.txt — a barrier nobody had ever watched fail — and it was
// seven `wholeFile.includes('…')` assertions with no proof in either direction. Its blast radius is
// price: if the four price carriers stop being cleared when the rent period flips, an annual budget
// silently becomes a monthly one and the user is shown the wrong band with no notice.
//
// The whole-file read could not be lifted out (the handlers are inline JSX inside a large screen
// component, the same reason verify-city-rehydration.ts states for staying a text reader), so the
// repair is the other half of the technique: extract the verdict as a PURE function, feed it
// DELIBERATELY BROKEN COPIES OF THE REAL SHIPPED FILE, and keep a negative control proving the
// shipped file is not flagged. A barrier that supplies its own input proves nothing; every proof in
// scripts/verify-period-price-flip.ts starts from the bytes production actually ships.
//
// Sources arrive PRE-STRIPPED so a proof can target an exact needle: stripWs() once at the reader,
// then the mutation edits the same string the predicate reads.

/** The reader's normalisation: whitespace carries no meaning in the shapes below. */
export const stripWs = (s: string): string => s.replace(/\s+/g, '');

export type FlipSources = {
  /** src/app/index.tsx, whitespace-stripped. */
  index: string;
  /** src/i18n.tsx, whitespace-stripped. */
  i18n: string;
};

type Rule = {
  id: string;
  /** Plain words: what breaks for a real user if this is false. */
  why: string;
  holds: (s: FlipSources) => boolean;
};

const RULES: Rule[] = [
  {
    id: 'period-flip-clears-all-four-carriers',
    why: 'a rent-period flip must clear priceMin, priceMax, priceInput AND priceBand together — '
      + 'leaving any one behind reinterprets an annual budget as a monthly one, silently',
    holds: (s) => s.index.includes("rentPeriod:next,priceMin:null,priceMax:null,priceInput:'',priceBand:null"),
  },
  {
    id: 'same-period-retap-is-a-noop',
    why: 're-tapping the period already selected must not clear anything — a gratuitous clear looks '
      + 'to the user like the app lost their budget for no reason',
    holds: (s) => s.index.includes("if((q.rentPeriod??'annual')===next)returnq;"),
  },
  {
    id: 'clear-is-gated-on-a-price-having-existed',
    why: 'the clear and its note must fire only when a price was actually set (the hadPrice gate), '
      + 'or every period tap raises a notice about a budget the user never typed',
    holds: (s) => s.index.includes(
      'consthadPrice=!!(q.priceMin||q.priceMax||q.priceInput||q.priceBand);setPeriodPriceCleared(hadPrice);'),
  },
  {
    id: 'note-renders-while-cleared-and-no-new-price',
    why: 'the explanatory note must render while the clear stands and disappear once a new price is '
      + 'typed — a clear the user is never told about is a silent unit inversion',
    holds: (s) => s.index.includes('periodPriceCleared&&!query.priceMin&&!query.priceMax&&!query.priceInput'),
  },
  {
    id: 'note-has-a-real-arabic-translation',
    why: 'the note must carry its Arabic copy, not a key — an untranslated key on screen is the '
      + 'same as no explanation',
    // Stripped, because the sources are: this needle carries spaces the reader has removed, and
    // comparing a raw needle against stripped source is a guard that can never pass. The negative
    // control below is what caught exactly that, the first time this rule ran.
    holds: (s) => s.i18n.includes(stripWs('تم مسح حدود السعر لأن وحدة السعر تغيّرت')),
  },
  {
    id: 'deal-toggle-clears-only-when-the-pair-changes-meaning',
    why: 'priceMin/priceMax means "Buy budget" under Buy-only and under Combined, but "Rent budget" '
      + 'under Rent-only, so the شراء/إيجار toggle must clear exactly when a press flips WHICH deal '
      + 'the pair prices — and never when the meaning is unchanged (owner, 2026-08-20)',
    holds: (s) =>
      s.index.includes('constflips=prevAppliesTo!==nextAppliesTo;') &&
      s.index.includes("...(flips?{priceMin:null,priceMax:null,priceBand:null,priceInput:''}:{}),"),
  },
  {
    id: 'retired-deal-notice-not-reintroduced',
    why: 'the amber Buy/Rent price-cleared NOTICE was retired by the owner on 2026-08-22 because it '
      + 'fired on the ordinary Buy→Rent switch; single-deal states must say nothing. The CLEARING is '
      + 'unchanged — only setDealPriceCleared, the flag that drove the notice, is gone',
    holds: (s) => !s.index.includes('setDealPriceCleared('),
  },
];

/** Ids in shipped order, so the barrier's proofs can name a rule without duplicating the list. */
export const RULE_IDS = RULES.map((r) => r.id);

/** Returns one line per broken rule. Empty means the shipped files still carry the whole contract. */
export function periodPriceFlipProblems(s: FlipSources): string[] {
  // A source that could not be read is UNKNOWN, and UNKNOWN is never health. Without this, a moved
  // or renamed product file would turn every `includes` false OR — with a different reader — silently
  // empty, and an empty problem list reads as a clean bill of health.
  if (!s.index || !s.i18n) {
    return ['one of src/app/index.tsx / src/i18n.tsx read as empty, so whether the price-clearing '
      + 'contract still holds is UNKNOWN — never treat an unread file as a passing one'];
  }
  return RULES.filter((r) => !r.holds(s)).map((r) => `${r.id}: ${r.why}`);
}
