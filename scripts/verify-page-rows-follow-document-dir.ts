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

// ── REFRESH IN ENGLISH (owner 2026-10-23: signed in, English, refresh → sidebar on the RIGHT) ─────────────────
// The served HTML is pre-rendered in Arabic, so its row is `row-reverse`. React hydration keeps a server
// attribute/class that differs from the client's first render, and afterwards writes the DOM only when a render's
// value CHANGES from the previous render. Model exactly that, then run the hook's two renders through it.
const { firstRenderDocRtl, SERVER_RENDERED_RTL } = await import('../src/lib/firstRenderDocRtl.ts');
const afterHydration = (serverDocRtl: boolean, renders: boolean[]) => {
  let dom = firstChildLeftRow(serverDocRtl);          // what the pre-rendered HTML carries
  for (let i = 1; i < renders.length; i++) if (renders[i] !== renders[i - 1]) dom = firstChildLeftRow(renders[i]);
  return dom;
};
const hookRenders = (first: (web: boolean) => boolean | null, pageRtl: boolean) => [first(true) ?? !pageRtl, pageRtl];
for (const pageRtl of [false, true]) {
  const dom = afterHydration(SERVER_RENDERED_RTL, hookRenders(firstRenderDocRtl, pageRtl));
  check(`refresh with the page ${pageRtl ? 'Arabic (rtl)' : 'English (ltr)'} → sidebar on the LEFT`, firstChildSide(pageRtl, dom) === 'left');
}
mutantCaught('a first render that reads the page (the old hook) leaves the sidebar on the RIGHT after an English refresh',
  firstChildSide(false, afterHydration(SERVER_RENDERED_RTL, hookRenders(() => false, false))) === 'right');
const i18n = readFileSync(new URL('../src/i18n.tsx', import.meta.url), 'utf8');
const appJson = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
check('the pages ARE pre-rendered (web.output static) — the reason the first render must match the server',
  appJson.expo?.web?.output === 'static');
check('the server renders Arabic (readSavedLocale falls back to ar with no window) — SERVER_RENDERED_RTL agrees',
  SERVER_RENDERED_RTL === true && /return 'ar';\s*\}\s*\n\s*\/\/ Whether the active language is REMEMBERED/.test(i18n));
check('useDocumentRtl starts from firstRenderDocRtl, not from reading the page',
  /useState<boolean \| null>\(\(\) => firstRenderDocRtl\(Platform\.OS === 'web'\)\)/.test(readFileSync(new URL('../src/lib/useDocumentRtl.ts', import.meta.url), 'utf8')));

if (failed) { console.log(`\n❌ verify-page-rows-follow-document-dir: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-page-rows-follow-document-dir: both page rows follow the page direction itself.');
