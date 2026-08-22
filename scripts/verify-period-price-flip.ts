// Permanent tests — monthly↔annual price-unit flip (audit item 3, owner rule 2026-07-27):
// changing the rent payment period must NEVER silently keep typed price bounds whose unit meaning
// just inverted; it clears them and tells the user why. Mirrors the existing Buy↔Rent toggle rule.
//   node --experimental-strip-types scripts/verify-period-price-flip.ts   (wired into `npm test`)
import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const IX = readFileSync(new URL('../src/app/index.tsx', import.meta.url), 'utf8');
const NOWS = IX.replace(/\s+/g, '');

// 1) The period onChange clears ALL FOUR price carriers when the period actually changes.
check('period flip clears priceMin+priceMax+priceInput+priceBand together',
  NOWS.includes("rentPeriod:next,priceMin:null,priceMax:null,priceInput:'',priceBand:null"));
// 2) No-op when the same period is re-tapped (no gratuitous clearing).
check('re-tapping the same period is a no-op', NOWS.includes("if((q.rentPeriod??'annual')===next)returnq;"));
// 3) Only clears when bounds actually existed; flag drives the user-facing note.
check('clear happens only when a price was set (hadPrice gate) and raises the note flag',
  NOWS.includes('consthadPrice=!!(q.priceMin||q.priceMax||q.priceInput||q.priceBand);setPeriodPriceCleared(hadPrice);'));
// 4) The note renders with the documented i18n key and hides once a new price is typed.
check('note rendered while cleared and no new price typed',
  NOWS.includes('periodPriceCleared&&!query.priceMin&&!query.priceMax&&!query.priceInput'));
const I18N = readFileSync(new URL('../src/i18n.tsx', import.meta.url), 'utf8');
check('note has a genuine Arabic translation',
  I18N.includes('تم مسح حدود السعر لأن وحدة السعر تغيّرت'));
// 5) The sibling rule stayed intact, in an owner-upgraded form (Buy+Rent combined multi-select,
// 2026-08-20): priceMin/priceMax means "Buy budget" under Buy-only AND under Combined, but "Rent
// budget" under Rent-only — so the شراء/إيجار toggle clears price state exactly when a press flips
// WHICH deal that pair prices (Buy-only↔Rent-only, or Rent-only↔Both), never when the meaning stays
// the same (Buy-only↔Both, Both↔Buy-only) — same "clear + explain" shape as the period rule above,
// just no-longer an unconditional clear on every press (the old single-select Segmented control had
// no "meaning didn't change" case to preserve; the two-button toggle does).
// OWNER CHANGE 2026-08-22 — the CLEARING is unchanged; the NOTICE was removed. The old amber note
// fired whenever the basis flipped, which includes the ordinary Buy→Rent switch, so a user who
// simply wanted Rent got an error about a budget they had usually never typed. The rule is now:
// Buy-only silent, Rent-only silent, Buy+Rent shows one calm helper. `setDealPriceCleared` was the
// flag that drove ONLY that notice and is therefore gone; asserting it here would pin the retired
// behaviour and block the fix (a monitor must move when the guard it watches is deliberately
// retired). The clearing itself is still pinned by both remaining clauses, and the new copy rule has
// its own mutation-proven barrier: scripts/verify-deal-pair-helper-copy.ts.
check('Buy/Rent toggle clears price state exactly when priceMin/priceMax flips which deal it prices (owner-upgraded sibling rule)',
  NOWS.includes('constflips=prevAppliesTo!==nextAppliesTo;') &&
  NOWS.includes('...(flips?{priceMin:null,priceMax:null,priceBand:null,priceInput:\'\'}:{}),'));
check('the retired Buy/Rent price-cleared NOTICE is not reintroduced (owner 2026-08-22)',
  !NOWS.includes('setDealPriceCleared('),
  'single-deal states must say nothing; see scripts/verify-deal-pair-helper-copy.ts');

if (failed) { console.error(`\n✗ ${failed} period-price-flip assertion(s) FAILED`); process.exit(1); }
console.log('\n✓ all period-price-flip assertions passed (clear + explain, never silent unit inversion)');
