// PERMANENT BARRIERS for sidebar chat/search titles (owner decision 2026-08-21):
//
//   "Sidebar titles are display metadata. Auto-generate a concise useful summary like ChatGPT, let
//    signed-in users rename inline by double-click, and never let renaming alter the underlying
//    chat/search."
//
// Two halves:
//   A. TITLE GENERATION — src/lib/chatTitle.ts is zero-dep, so this EXECUTES the real generator.
//   B. THE RENAME CONTRACT — store/Sidebar are React modules, asserted against their source. Each
//      assertion targets a specific behaviour, and the load-bearing ones are mutation-proven (see
//      the PR/commit): making rename touch the query, or letting an auto title overwrite a manual
//      one, both fail this file.
//
//   node --experimental-strip-types scripts/verify-chat-title.ts   (wired into `npm test`)
import { readFileSync } from 'node:fs';
import {
  autoTitleForQuery, autoTitleForPrompt, displayTitle, canAutoRetitle, titleDetails, MAX_DETAILS,
} from '../src/lib/chatTitle.ts';

let failed = 0;
const check = (label: string, ok: boolean, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && extra ? ` — ${extra}` : ''}`);
};

const base: any = {
  deal: 'Rent', location: 'الرياض', category: 'Residential', type: null, types: ['Apartment'],
  typeGroups: ['Apartments & Shared Housing'], detail: null, priceInput: '', priceBand: null,
  rentPeriod: 'annual', districts: null, districtLabel: null,
  contextBeds: null, contextBedsList: null, contextSize: null,
  areaMin: null, areaMax: null, priceMin: null, priceMax: null,
};

// ── A1. THE OWNER'S EXAMPLES ────────────────────────────────────────────────────────────────────
check('«شقق للإيجار في الرياض»', autoTitleForQuery(base) === 'شقق للإيجار في الرياض', autoTitleForQuery(base));
const villaJeddah = { ...base, deal: 'Buy', types: ['Villa'], typeGroup: 'Villas & Houses', location: 'جدة', rentPeriod: undefined };
check('«فلل للبيع في جدة»', autoTitleForQuery(villaJeddah) === 'فلل للبيع في جدة', autoTitleForQuery(villaJeddah));
const furnished = { ...base, furnishedPref: true, bathMin: 2 };
check('«شقق للإيجار في الرياض · مفروش · حمامين»',
  autoTitleForQuery(furnished) === 'شقق للإيجار في الرياض · مفروش · حمامين', autoTitleForQuery(furnished));

// ── A2. THE TITLE USES THE REAL نوع, NOT THE CATEGORY ───────────────────────────────────────────
// The pre-2026-08-21 label read «سكني للإيجار السنوي في الرياض» for EVERY residential filter search,
// because it fell back to the category. That is what made distinct searches look alike in the list.
check('a filter search is titled by its نوع, never the bare category',
  !autoTitleForQuery(base).startsWith('سكني'), autoTitleForQuery(base));
check('a group-only search is titled by its group',
  autoTitleForQuery({ ...base, types: null }) === 'شقق وسكن مشترك للإيجار في الرياض',
  autoTitleForQuery({ ...base, types: null }));
// Groups are multi-select since 2026-08-20 — several groups follow the same "+N" shape this file
// already asserts for several types, so the title stays one line.
check('a MULTI-group search names the first group and counts the rest',
  autoTitleForQuery({ ...base, types: null, typeGroups: ['Apartments & Shared Housing', 'Villas & Houses'] })
    === 'شقق وسكن مشترك +1 للإيجار في الرياض',
  autoTitleForQuery({ ...base, types: null, typeGroups: ['Apartments & Shared Housing', 'Villas & Houses'] }));

// ── A3. ADVANCED-FILTER SEARCHES MUST NOT LOOK IDENTICAL (owner §6) ─────────────────────────────
const afA = { ...base, furnishedPref: true };
const afB = { ...base, amenities: ['elevator', 'parking'] };
check('AF-different searches get DIFFERENT titles', autoTitleForQuery(afA) !== autoTitleForQuery(afB),
  `${autoTitleForQuery(afA)} == ${autoTitleForQuery(afB)}`);
check('owner example A → «… · مفروش»', autoTitleForQuery(afA) === 'شقق للإيجار في الرياض · مفروش', autoTitleForQuery(afA));
check('owner example B → «… · مصعد · موقف»',
  autoTitleForQuery(afB) === 'شقق للإيجار في الرياض · مصعد · موقف', autoTitleForQuery(afB));

// Every Advanced Filter answer must be able to distinguish two otherwise-identical searches.
const afCases: Array<[string, any]> = [
  ['furnished', { furnishedPref: true }], ['unfurnished', { furnishedPref: false }],
  ['amenities', { amenities: ['elevator'] }], ['bathMin', { bathMin: 3 }],
  ['ageMax', { ageMax: 5 }], ['isNewConstruction', { isNewConstruction: true }],
  ['ratingMin', { ratingMin: 4 }], ['directions', { directions: ['شمالية'] }],
  ['streetWidthMin', { streetWidthMin: 20 }], ['unitSubtypes', { unitSubtypes: ['استوديو'] }],
  ['rentPeriod monthly', { rentPeriod: 'monthly' }], ['rentPeriod both', { rentPeriod: 'both' }],
  ['bedrooms', { contextBedsList: ['3'] }], ['multi-district', { districts: ['a', 'b'], districtLabel: 'a' }],
];
for (const [name, patch] of afCases) {
  const t = autoTitleForQuery({ ...base, ...patch });
  check(`AF answer distinguishes the title — ${name}`, t !== autoTitleForQuery(base), t);
}

// ── A4. CONCISE, NOT A DUMP (owner: "Keep it concise") ──────────────────────────────────────────
const kitchenSink = {
  ...base, furnishedPref: true, bathMin: 3, amenities: ['elevator', 'parking', 'kitchen', 'pool'],
  ageMax: 5, ratingMin: 4, directions: ['شمالية'], streetWidthMin: 20, contextBedsList: ['3'],
  rentPeriod: 'monthly', unitSubtypes: ['استوديو'],
};
const dumped = autoTitleForQuery(kitchenSink);
check(`a heavily-filtered search shows at most ${MAX_DETAILS} chips`,
  (dumped.match(/ · /g) || []).length <= MAX_DETAILS, dumped);
check('a heavily-filtered title stays short enough for a sidebar row', dumped.length <= 70, `${dumped.length} chars: ${dumped}`);
check('the full detail list is still available to callers that want it',
  titleDetails(kitchenSink).length > MAX_DETAILS);

// ── A5. ANNUAL RENT IS THE DEFAULT AND IS NOT NOISE, BUT MONTHLY IS SHOWN ───────────────────────
check('annual rent (the default) adds no chip', autoTitleForQuery(base) === 'شقق للإيجار في الرياض');
check('monthly rent IS called out', autoTitleForQuery({ ...base, rentPeriod: 'monthly' }).includes('شهري'));
check('«كلاهما» is called out', autoTitleForQuery({ ...base, rentPeriod: 'both' }).includes('شهري وسنوي'));

// ── A6. ARABIC READS LIKE A PERSON WROTE IT ─────────────────────────────────────────────────────
check('2 bathrooms → «حمامين» (dual), not «2 حمامات»', autoTitleForQuery({ ...base, bathMin: 2 }).includes('حمامين'));
check('1 bedroom → «غرفة»', autoTitleForQuery({ ...base, contextBedsList: ['1'] }).includes('غرفة'));
check('3 bedrooms → «3 غرف»', autoTitleForQuery({ ...base, contextBedsList: ['3'] }).includes('3 غرف'));

// ── A7. NO CITY / NO TYPE STILL PRODUCES A SENSIBLE TITLE ───────────────────────────────────────
check('no city → السعودية', autoTitleForQuery({ ...base, location: '' }).includes('السعودية'));
check('no type and no group still titles', autoTitleForQuery({ ...base, types: null, typeGroup: null }).length > 5);
check('a title is never empty', autoTitleForQuery({} as any).trim().length > 0);

// ── A8. FREE-TEXT PROMPTS ARE SUMMARIZED, NOT STORED WHOLE (owner §7) ───────────────────────────
const prompt = 'ابي شقة بالرياض قريبة من المترو وتكون تحت 5000 بالشهر';
const summarized = autoTitleForPrompt(prompt);
check('the owner\'s example summarizes to «شقة بالرياض قرب المترو»',
  summarized === 'شقة بالرياض قرب المترو', summarized);
check('a summarized prompt is much shorter than the prompt', summarized.length < prompt.length * 0.7, summarized);
check('the leading ask is stripped', !summarized.startsWith('ابي'));
check('the budget clause is dropped', !/5000/.test(summarized));
check('a long prompt is capped', autoTitleForPrompt('أبغى فيلا كبيرة في حي الملقا شمال الرياض فيها مسبح وحديقة وغرفة خادمة ومصعد').length <= 46);
check('a prompt that is ONLY an ask still yields a title', autoTitleForPrompt('ابي').trim().length > 0);
check('an empty prompt yields an empty title (caller decides)', autoTitleForPrompt('   ') === '');

// ── A9. DISPLAY PRECEDENCE + THE MANUAL RULE (owner §4) ─────────────────────────────────────────
check('a manual title wins over everything',
  displayTitle({ title: 'شقة لديم', titleSource: 'manual', label: 'x', query: base }) === 'شقة لديم');
check('a stored auto title is used when present',
  displayTitle({ title: 'auto one', titleSource: 'auto', label: 'legacy', query: base }) === 'auto one');
check('a legacy entry with only `label` still displays (no migration needed)',
  displayTitle({ label: 'سكني للإيجار السنوي في الرياض', query: base }) === 'سكني للإيجار السنوي في الرياض');
check('an entry with neither falls back to a generated title',
  displayTitle({ query: base }) === 'شقق للإيجار في الرياض');
check('auto MAY retitle an auto row', canAutoRetitle({ titleSource: 'auto' }) === true);
check('auto MAY retitle a legacy row with no source', canAutoRetitle({}) === true);
check('auto MAY NOT retitle a manual row', canAutoRetitle({ titleSource: 'manual' }) === false);

// ── B. THE RENAME CONTRACT, ASSERTED IN THE STORE ───────────────────────────────────────────────
const store = readFileSync(new URL('../src/store.tsx', import.meta.url), 'utf8');
const storeCode = store.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const rename = storeCode.slice(storeCode.indexOf('renameHistory: (id, title) =>'), storeCode.indexOf('deleteHistory: (id) =>'));

check('B1. renameHistory exists', rename.length > 0);
check('B2. rename spreads the existing entry (nothing is dropped)', /\{ \.\.\.it,/.test(rename));
/**
 * The heart of owner rule 3: the ONLY keys rename may assign. Extracted with a depth-aware scan, not
 * a regex — `title: autoTitleForQuery(it.query, getLocale())` contains a comma and a `)` INSIDE the
 * value, and a naive split reports `getLocale())` as an assigned key (a false failure) while a value
 * containing `}` would end the match early (a false pass).
 */
function assignedKeys(src: string): string[] {
  const keys: string[] = [];
  for (let i = src.indexOf('{ ...it,'); i >= 0; i = src.indexOf('{ ...it,', i + 1)) {
    let depth = 0, quote = '', keyStart = -1;
    for (let j = i; j < src.length; j++) {
      const c = src[j];
      if (quote) { if (c === '\\') j++; else if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{' || c === '(' || c === '[') { depth++; if (depth === 1) keyStart = j + 1; continue; }
      if (c === '}' || c === ')' || c === ']') { depth--; if (depth === 0) break; continue; }
      if (depth === 1 && c === ',') keyStart = j + 1;
      if (depth === 1 && c === ':' && keyStart >= 0) { keys.push(src.slice(keyStart, j).trim()); keyStart = -1; }
    }
  }
  return keys.filter(Boolean).filter((k) => !k.startsWith('...'));
}
const assigned = assignedKeys(rename);
// Non-vacuity: if the extractor ever stops seeing the assignments, B3 would pass on an empty list.
check('B3.0 — the key extractor actually reads the rename assignments',
  ['title', 'titleSource', 'titleUpdatedAt'].every((k) => assigned.includes(k)),
  `saw: ${assigned.join(', ') || '(nothing)'}`);
const allowed = new Set(['title', 'titleSource', 'titleUpdatedAt']);
const illegal = assigned.filter((k) => !allowed.has(k));
check('B3. rename assigns ONLY title/titleSource/titleUpdatedAt', illegal.length === 0, `also assigns: ${illegal.join(', ')}`);
for (const forbidden of ['query', 'snapshot', 'label', 'starred', 'id']) {
  check(`B3.${forbidden} — rename never reassigns \`${forbidden}\``, !assigned.includes(forbidden));
}
check('B4. rename never moves `ts` (a rename must not reorder the sidebar)', !/\bts:/.test(rename));
check('B5. rename persists under the signed-in account key only', /historyKey\(user\.sub\)/.test(rename) && /if \(user\)/.test(rename));
check('B6. clearing the name hands the row back to auto-titling', /autoTitleForQuery/.test(rename) && /titleSource: 'auto'/.test(rename));

// The other half of owner rule 4: a re-run must not revert a user's name.
check('B7. recordHistory consults canAutoRetitle before titling', /canAutoRetitle\(prior\)/.test(storeCode));
check('B8. recordHistory keeps the prior title when it is manual',
  /keepTitle \? prior!\.title : autoTitleForQuery/.test(storeCode));
check('B9. a chat turn is titled with a SUMMARY, not the raw message',
  /autoTitleForPrompt\(v,/.test(storeCode));
check('B10. a chat turn also respects a manual title', /canAutoRetitle\(prev\)/.test(storeCode));
check('B11. title identity is NOT coupled to search de-duplication',
  !/sameQuery[^\n]*title/.test(storeCode) && /const sameQuery = isSameSavedSearch;/.test(storeCode));

// ── B12+. THE INLINE RENAME INTERACTION ─────────────────────────────────────────────────────────
const sb = readFileSync(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8');
const sbCode = sb.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
// react-native-web drops an `onDoubleClick` PROP (it is not on its forwardedProps allow-list), so the
// double-click must be bound as a real DOM event on the host node — a prop-shaped test would pass on
// code that never fires. This asserts the binding AND that the row actually wires it up.
// 2026-08-24: the dblclick binding moved into bindRowHost, where it is COORDINATED with the
// press-hold-drag reorder gesture (a double-click mid-hold must not rename, and a hold must not
// open) — see scripts/verify-sidebar-reorder.ts for that side of the contract.
// 2026-09-05 (ops_incident #20): the handler gained its target filter, so a double-click that
// STARTS on ⋯ (or any control marked data-nodrag) no longer renames — opening and closing that
// menu is two clicks on this same host, and the row was dropping into rename mode. TWO barriers
// pinned this one line by exact text, this one and verify-sidebar-reorder.ts, and both had to move
// with the fix; both passed for the whole time the defect was live, which is the point.
check('B12. double-click enters rename mode',
  /addEventListener\('dblclick'/.test(sbCode)
  && /const dbl = \(e: any\) => \{ if \(!dragRef\.current\?\.active && !startsOnControl\(e\?\.target\)\) beginRename\(c\); \};/.test(sbCode)
  && /ref=\{bindRowHost\(/.test(sbCode));
check('B12.1 double-click is not left as an un-forwarded react-native-web prop',
  !/onDoubleClick=?[:{]/.test(sbCode));
check('B13. the row becomes an inline TextInput (no modal)', /<TextInput/.test(sbCode) && /editingId === c\.id \?/.test(sbCode));
check('B14. Enter saves', /onSubmitEditing=\{\(\) => commitRename\(c\.id\)\}/.test(sbCode));
check('B15. blur saves', /onBlur=\{\(\) => commitRename\(c\.id\)\}/.test(sbCode));
check('B16. Escape cancels', /=== 'Escape'\) cancelRename\(\)/.test(sbCode));
check('B17. Escape survives the blur it triggers (otherwise blur re-saves the discarded text)',
  /cancelledRef/.test(sbCode) && /if \(cancelledRef\.current\)/.test(sbCode));
// 2026-08-24 (owner): HOLD now belongs to REORDER — click opens, double-click renames, hold drags,
// and the three must never trigger each other. Touch rename therefore moved to the ⋯ row menu.
check('B18. touch devices can still rename — via the ⋯ menu (hold now belongs to reorder)',
  /\{t\('Rename'\)\}/.test(sbCode) && !/onLongPress=\{\(\) => beginRename/.test(sbCode));
check('B19. the row renders through the single displayTitle precedence helper', /displayTitle\(c, locale\)/.test(sbCode));
check('B20. history rows (and therefore rename) stay signed-in only', /\{user \? \(/.test(sbCode));

console.log(failed === 0 ? '\n✅ chat-title: passed.' : `\n❌ chat-title: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
