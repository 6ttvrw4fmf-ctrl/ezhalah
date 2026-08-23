// SIDEBAR CHAT SEARCH — Arabic-only input, ChatGPT-style in-sidebar mode, read-only discovery.
//
// Owner 2026-08-24. The rules this pins:
//   * A clearly visible Search control sits at the top of the sidebar (under «محادثة جديدة») and
//     morphs into an input IN PLACE — never a route change, never a modal.
//   * The input is ARABIC-ONLY: Latin letters are stripped calmly at the boundary and can never
//     become a search query («hi» must sanitise to nothing). One quiet Arabic hint, no error state.
//   * Search is READ-ONLY discovery: filtering returns the same history rows, and opening a result
//     rides the exact same row-open path as a normal sidebar row — so search can never create,
//     rename, duplicate or lose a conversation.
//   * Arabic-first everywhere: the empty state is «ما لقينا محادثة بهذا الاسم», never "No results",
//     and the headerless results group can never leak a literal English "Results".
//
// The matching/sanitising logic lives in src/lib/chatSearch.ts as a PURE module precisely so this
// barrier can EXECUTE it (sections 1–6) rather than trust prose; the wiring that cannot be executed
// is pinned by source checks (sections 7+), each mutation-proven at the bottom.
//
//   node --experimental-strip-types scripts/verify-sidebar-chat-search.ts     (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeArabicSearch, isSearchableQuery, matchesChat, filterChats, normalizeArabic } from '../src/lib/chatSearch.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
const sidebar = stripComments(read('src/components/Sidebar.tsx'));
const i18n = read('src/i18n.tsx');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nSidebar chat search — Arabic-only, in-sidebar, read-only\n');

// ── 1. Latin never becomes a query (both layers independently) ──────────────────────────────────
{
  const hi = sanitizeArabicSearch('hi');
  check('«hi» sanitises to an empty query and is not searchable',
    hi.text === '' && hi.hadLatin === true && !isSearchableQuery(hi.text));
  check('even UNSANITISED Latin is not searchable (second, independent layer)',
    !isSearchableQuery('hi') && !isSearchableQuery('hello world'));
}

// ── 2. mixed input keeps the Arabic, drops the Latin ────────────────────────────────────────────
{
  const m = sanitizeArabicSearch('فيلا hi جدة');
  check('«فيلا hi جدة» → «فيلا جدة» (Latin gone, Arabic predictable)',
    m.text.replace(/\s+/g, ' ').trim() === 'فيلا جدة' && m.hadLatin === true);
}

// ── 3. allowed input passes through untouched ───────────────────────────────────────────────────
check('Arabic text, Arabic-Indic digits and harmless punctuation survive sanitising',
  sanitizeArabicSearch('عقارات الرياض').hadLatin === false
  && sanitizeArabicSearch('شقة ١٢٣').text.includes('١٢٣')
  && sanitizeArabicSearch('مشروع نيوم').text === 'مشروع نيوم');
check('bare digits or punctuation do NOT start filtering the list',
  !isSearchableQuery('١٢٣') && !isSearchableQuery('...') && !isSearchableQuery('  '));

// ── 4. normalised matching (alef/teh-marbuta variants) ──────────────────────────────────────────
check('«أبها» finds «ابها» (normalised comparison, both directions)',
  matchesChat('فيلا ابها', 'أبها') && matchesChat('فيلا أبها', 'ابها')
  && normalizeArabic('أبهــــا') === 'ابها');

// ── 5. live filtering narrows with AND semantics ────────────────────────────────────────────────
{
  const chats = [
    { id: 'a', title: 'عقارات سكنية للبيع في الرياض' },
    { id: 'b', title: 'فلل جدة' },
    { id: 'c', title: 'شقق للإيجار في الخبر' },
  ];
  const one = filterChats(chats, (c) => c.title, 'الرياض');
  const two = filterChats(chats, (c) => c.title, 'الرياض سكنية');
  check('typing «الرياض» finds exactly the Riyadh chat; adding «سكنية» keeps narrowing',
    one.length === 1 && one[0].id === 'a' && two.length === 1 && two[0].id === 'a');
  check('a stray punctuation token never blocks a real match',
    filterChats(chats, (c) => c.title, 'الرياض ،')[0]?.id === 'a');
  check('no match → empty list (drives the Arabic empty state)',
    filterChats(chats, (c) => c.title, 'مشروع نيوم').length === 0);
}

// ── 6. read-only discovery: same references, same order, zero writes ────────────────────────────
{
  const chats = [{ id: '1', title: 'فلل جدة' }, { id: '2', title: 'شقق جدة' }];
  const snapshot = JSON.stringify(chats);
  const out = filterChats(chats, (c) => c.title, 'جدة');
  check('filtering returns the SAME row objects in the caller’s order and mutates nothing',
    out.length === 2 && out[0] === chats[0] && out[1] === chats[1]
    && JSON.stringify(chats) === snapshot);
}

// ── 7. the Search control exists, discoverable, in the sidebar hierarchy ────────────────────────
check('a Search button with a stable testID renders under New Chat (not buried in a menu)',
  /testID="sidebar-search-btn"/.test(sidebar)
  && sidebar.indexOf('sidebar-search-btn') > sidebar.indexOf("t('New Chat')")
  && sidebar.indexOf('sidebar-search-btn') < sidebar.indexOf('<ScrollView style={s.hist}'));
check('search mode is an in-place morph — input + close carry stable testIDs, no route/modal',
  /testID="sidebar-search-input"/.test(sidebar) && /testID="sidebar-search-close"/.test(sidebar)
  && !/router\.(push|replace)\([^)]*search/i.test(sidebar));

// ── 8. every keystroke routes through the sanitiser (the ONLY input path) ───────────────────────
check('the input’s onChangeText goes through sanitizeArabicSearch',
  /onChangeText=\{onSearchChange\}/.test(sidebar)
  && /const \{ text, hadLatin: stripped \} = sanitizeArabicSearch\(raw\)/.test(sidebar));
check('the Latin hint is calm: shown from a flag, cleared on empty/close — never per keystroke',
  /if \(stripped\) setHadLatin\(true\);/.test(sidebar)
  && /else if \(!text\) setHadLatin\(false\);/.test(sidebar)
  && /searching && hadLatin \?/.test(sidebar));

// ── 9. close/escape restores the normal list ────────────────────────────────────────────────────
check('closeSearch clears text + flag + mode in one place; Escape and × both ride it',
  /const closeSearch = \(\) => \{ setSearching\(false\); setSearchText\(''\); setHadLatin\(false\); \}/.test(sidebar)
  && /onPress=\{closeSearch\}/.test(sidebar)
  && /key === 'Escape'\) closeSearch\(\)/.test(sidebar));

// ── 10. results reuse the SAME rows and the SAME open path ──────────────────────────────────────
check('search filters into the one existing row renderer (no second result-row implementation)',
  /filterChats\(history,/.test(sidebar)
  && (sidebar.match(/onPress=\{\(\) => armOpenRow\(c\)\}/g) ?? []).length === 1
  && (sidebar.match(/const openHistory = /g) ?? []).length === 1);
check('opening a result exits search mode via the shared openHistory',
  /const openHistory = \(c: HistoryItem\) => \{\s*closeSearch\(\);/.test(sidebar));
check('search never writes: the search block calls no history mutators and records nothing',
  !/searchMatches[\s\S]{0,400}(setHistory|renameHistory|deleteHistory|runQuery)\(/.test(sidebar)
  && !/onSearchChange[\s\S]{0,300}(setHistory|renameHistory|deleteHistory|runQuery)\(/.test(sidebar));

// ── 11. Arabic-first UI, no English leak ────────────────────────────────────────────────────────
const KEYS: Array<[string, string]> = [
  ['Search chats', 'البحث في المحادثات'],
  ['Search your chats…', 'ابحث في محادثاتك…'],
  ['Close search', 'إغلاق البحث'],
  ['Type in Arabic to search your chats', 'اكتب بالعربي للبحث في محادثاتك'],
  ['No chat with that name', 'ما لقينا محادثة بهذا الاسم'],
];
check('all five search strings have their Arabic translations registered',
  KEYS.every(([en, ar]) => i18n.includes(`'${en}': '${ar}'`)));
check('every user-facing search string renders through t() (no hardcoded copy)',
  KEYS.every(([en]) => en === 'Type in Arabic to search your chats'
    ? sidebar.includes(`t('${en}')`) : sidebar.includes(`t('${en}`)));
check('the empty state is the Arabic key — never a literal "No results"',
  /searchActive \? t\('No chat with that name'\)/.test(sidebar) && !/No results/.test(sidebar));
check('the headerless Results group cannot leak a literal English header',
  /g\.key !== 'Results' && \(/.test(sidebar) && !/t\('Results'\)/.test(sidebar));

// ── 12. motion is restrained and reduced-motion-safe ────────────────────────────────────────────
check('the morph is a ~180ms timing gated on reduced motion — no layout jump machinery',
  /searchEnter\.value = withTiming\(1, \{ duration: 180/.test(sidebar)
  && /reducedMotion \? 1 : 0/.test(sidebar));

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof — each guard must FAIL on its own defect\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
const mut = (src: string, from: string | RegExp, to: string) => src.replace(from, to);

// executable defects
mustCatch('a sanitiser that lets Latin through would still be stopped by the searchable gate',
  !isSearchableQuery('hi') && !isSearchableQuery('abc123'));
mustCatch('an OR-matcher would be caught (query «الرياض سكنية» must NOT match «فلل سكنية جدة»)',
  !matchesChat('فلل سكنية جدة', 'الرياض سكنية'));
mustCatch('a raw (unnormalised) matcher would be caught («أبها» vs «ابها»)',
  normalizeArabic('أبها') === normalizeArabic('ابها') && 'أبها'.includes('ابها') === false);

// source defects
mustCatch('the Search button losing its testID',
  !/testID="sidebar-search-btn"/.test(mut(sidebar, 'testID="sidebar-search-btn"', '')));
mustCatch('the input bypassing the sanitiser',
  !/onChangeText=\{onSearchChange\}/.test(mut(sidebar, 'onChangeText={onSearchChange}', 'onChangeText={setSearchText}')));
mustCatch('close forgetting to clear the text (stale query on reopen)',
  !/const closeSearch = \(\) => \{ setSearching\(false\); setSearchText\(''\); setHadLatin\(false\); \}/.test(
    mut(sidebar, "setSearching(false); setSearchText(''); setHadLatin(false);", 'setSearching(false);')));
mustCatch('openHistory dropping the search-mode exit',
  !/const openHistory = \(c: HistoryItem\) => \{\s*closeSearch\(\);/.test(
    mut(sidebar, /const openHistory = \(c: HistoryItem\) => \{\s*closeSearch\(\);/, 'const openHistory = (c: HistoryItem) => {')));
mustCatch('a second result-row implementation appearing (duplicate open path)',
  (mut(sidebar, 'onPress={() => armOpenRow(c)}', 'onPress={() => armOpenRow(c)}#onPress={() => armOpenRow(c)}')
    .match(/onPress=\{\(\) => armOpenRow\(c\)\}/g) ?? []).length !== 1);
mustCatch('the Arabic empty state replaced with English',
  !/searchActive \? t\('No chat with that name'\)/.test(
    mut(sidebar, "searchActive ? t('No chat with that name')", "searchActive ? 'No results'")));
mustCatch('the Results header leaking as literal English',
  /t\('Results'\)/.test(mut(sidebar, "g.key !== 'Results' && (", "true && (").replace('</View>', "<Text>{t('Results')}</Text></View>")));

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ sidebar chat search: Arabic-only, in-sidebar, read-only — all pinned\n');
