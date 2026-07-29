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
// 5) The sibling rule stayed intact: Buy↔Rent toggle still clears price state.
check('Buy↔Rent toggle still clears price state (sibling rule untouched)',
  NOWS.includes("deal:vasany,priceBand:null,priceMin:null,priceMax:null,priceInput:''"));

if (failed) { console.error(`\n✗ ${failed} period-price-flip assertion(s) FAILED`); process.exit(1); }
console.log('\n✓ all period-price-flip assertions passed (clear + explain, never silent unit inversion)');
