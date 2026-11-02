// THE SEARCH SENTENCE NEVER SAYS «MONTHLY» (owner 2026-11-02: «We don't have monthly we have short term only»).
// The «monthly» rent pool is «إقامات قصيرة» (Gathern + Aqar Monthly, AGENTS.md "RENT POOLS"). The filter's toggle
// already said «Short stays», but the sentence it writes into the chat bubble still read «… to rent monthly in Riyadh» /
// «للإيجار الشهري». This EXECUTES the real verbText() from src/data/search.ts, in English and in Arabic (the real
// i18n.tsx dictionary), and fails if either language ever says monthly again.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { liftSymbols } from './lib/liftSymbols.ts';

let fails = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) fails++; };
const mustCatch = (name: string, caught: boolean) => check(`mutation caught: ${name}`, caught);

const SEARCH = readFileSync(new URL('../src/data/search.ts', import.meta.url), 'utf8');
const I18N = readFileSync(new URL('../src/i18n.tsx', import.meta.url), 'utf8');

// the real Arabic entry for an English key, read from i18n.tsx
const arabicOf = (dict: string, key: string) => {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return dict.match(new RegExp(`^\\s*'${esc}':\\s*'([^']*)'`, 'm'))?.[1] ?? null;
};

const sentences = async (search: string, dict: string) => {
  const file = join(mkdtempSync(join(tmpdir(), 'ezhalah-verb-')), 'search.ts');
  writeFileSync(file, search);
  const keys: string[] = [];
  const m = await liftSymbols(file, [{ header: 'const verbText =' }], ['verbText'],
    'type SearchQuery = any;\nconst t = (k: string) => { (globalThis as any).__keys.push(k); return k; };') as any;
  (globalThis as any).__keys = keys;
  const out: { en: string; ar: string | null }[] = [];
  for (const rentPeriod of ['monthly', 'both']) {
    keys.length = 0;
    const en = m.verbText({ deal: 'Rent', rentPeriod });
    out.push({ en, ar: arabicOf(dict, keys[keys.length - 1]) });
  }
  return out;
};
const clean = async (search: string, dict: string) => (await sentences(search, dict)).every(({ en, ar }) =>
  !/month/i.test(en) && /short stay/i.test(en) && ar != null && !/شهر/.test(ar) && /قصيرة/.test(ar));

check('short stays (and short stays + yearly) read «short stay» / «القصيرة» and never «monthly» / «شهري», in both languages', await clean(SEARCH, I18N));
mustCatch('the English sentence goes back to «to rent monthly»',
  !(await clean(SEARCH.replace("t('for a short stay')", "t('to rent monthly')"), I18N + "\n  'to rent monthly': 'للإيجار الشهري',")));
mustCatch('the Arabic says «للإيجار الشهري» again', !(await clean(SEARCH, I18N.replace("'for a short stay': 'للإقامة القصيرة'", "'for a short stay': 'للإيجار الشهري'"))));
mustCatch('the both-pools sentence says monthly', !(await clean(SEARCH.replace("t('for a short stay or yearly rent')", "t('to rent monthly or yearly')"), I18N)));
mustCatch('the Arabic entry is missing (falls back to English)', !(await clean(SEARCH, I18N.replace("'for a short stay': 'للإقامة القصيرة',", ''))));

// The toggle's own hints (owner 2026-11-02, same day): the line under «Short stays / Yearly» and the «price cleared»
// note must not say monthly either. Every t('…') key in that block, in English and in its real Arabic entry.
const INDEX = readFileSync(new URL('../src/app/index.tsx', import.meta.url), 'utf8');
const hintKeys = (index: string) => {
  const a = index.indexOf('<Text style={s.rentHint}>');
  const b = index.indexOf('</Text>', index.indexOf('periodPriceCleared', a));
  if (a < 0 || b < 0) return null;
  return [...index.slice(a, b).replace(/\/\/[^\n]*/g, '').matchAll(/'([^'\n]{12,})'/g)].map((m) => m[1]);
};
const hintsClean = (index: string, dict: string) => {
  const keys = hintKeys(index);
  return !!keys && keys.length >= 3 && keys.every((k) => { const ar = arabicOf(dict, k); return !/month/i.test(k) && ar != null && !/شهر/.test(ar); });
};
check('the toggle hints and the «price cleared» note never say monthly / شهري', hintsClean(INDEX, I18N));
mustCatch('the both-hint says «(monthly or yearly)» again', !hintsClean(INDEX.replace("'Short stays show no price (it depends on the dates); yearly listings show the yearly price.'", "'Each listing shows its own price basis (monthly or yearly).'"), I18N + "\n  'Each listing shows its own price basis (monthly or yearly).': 'x',"));
mustCatch('the cleared note\'s Arabic says شهري', !hintsClean(INDEX, I18N.replace('(إقامات قصيرة ↔ سنوي)', '(شهري ↔ سنوي)')));

if (fails) { console.error(`\n${fails} check(s) failed`); process.exit(1); }
console.log('\nverify-short-stays-sentence-never-says-monthly: OK');
