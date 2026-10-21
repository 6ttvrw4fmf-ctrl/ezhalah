// The two page-structure rows that keep a child on one PHYSICAL side in both languages must cancel the page's
// ACTUAL direction, never the language (owner 2026-10-21: a laptop screenshot, English page, sidebar on the
// RIGHT). Reproduced on the live site: with <html dir="rtl"> under English, a row keyed on `locale === 'ar'`
// put the docked sidebar at x=994 of 1280. src/lib/useDocumentRtl.ts keys the row on the attribute itself.
//
// This check EXECUTES firstChildLeftRow against the browser's mirroring rule, then pins that both rows (the app
// shell's sidebar row and the results screen's split row) are driven by useDocumentRtl, with mutation proofs.
import { readFileSync } from 'node:fs';
import { firstChildLeftRow } from '../src/lib/firstChildLeftRow.ts';

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? '  ✓' : '  ✗'} ${name}`); if (!ok) failed++; };
const mutantCaught = (name: string, caught: boolean) => check(`(mutation) ${name}`, caught);

// The browser: under dir=rtl a `row` lays its first child on the RIGHT; `row-reverse` puts it on the LEFT.
const firstChildSide = (docRtl: boolean, dir: 'row' | 'row-reverse') => ((docRtl ? dir === 'row' : dir === 'row-reverse') ? 'right' : 'left');
const localeKeyed = (localeAr: boolean) => (localeAr ? 'row-reverse' : 'row');

console.log('verify-page-rows-follow-document-dir: the sidebar is left and the ad pane right, whatever the language state says.');
for (const docRtl of [false, true]) check(`page dir=${docRtl ? 'rtl' : 'ltr'} → first child on the LEFT`, firstChildSide(docRtl, firstChildLeftRow(docRtl)) === 'left');
mutantCaught('keyed on the LANGUAGE, English + a page still dir=rtl puts the sidebar on the RIGHT (the screenshot)',
  firstChildSide(true, localeKeyed(false)) === 'right');

const layout = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');
const agent = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
const shellRow = /flexDirection:\s*firstChildLeftRow\(docRtl\),\s*paddingTop: promptInset\.top/;
const splitRow = /flexDirection:\s*firstChildLeftRow\(docRtl\),\s*backgroundColor: colors\.paper/;
check('the app shell row (docked sidebar) uses firstChildLeftRow(docRtl)', shellRow.test(layout) && /useDocumentRtl\(/.test(layout));
check('the results split row (ad pane) uses firstChildLeftRow(docRtl)', splitRow.test(agent) && /useDocumentRtl\(/.test(agent));
mutantCaught('the old locale-keyed shell row is no longer what the guard accepts',
  !shellRow.test(layout.replace('flexDirection: firstChildLeftRow(docRtl), paddingTop', "flexDirection: isRTL ? 'row-reverse' : 'row', paddingTop")));
mutantCaught('the old locale-keyed split row is no longer what the guard accepts',
  !splitRow.test(agent.replace('flexDirection: firstChildLeftRow(docRtl), backgroundColor', "flexDirection: locale === 'ar' ? 'row-reverse' : 'row', backgroundColor")));

if (failed) { console.log(`\n❌ verify-page-rows-follow-document-dir: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-page-rows-follow-document-dir: both page rows follow the page direction itself.');
