// THE CHAT IS A THREAD, NOT A SCREEN — progressive Advanced Filter rounds must accumulate, never replace.
//
// Owner 2026-08-24: "Old property cards STAY in the chat. The completed result turn LOSES its action
// buttons and gets a read-only selection receipt instead. The new narrowed result renders BELOW. ONLY
// THE LATEST result turn carries active actions."
//
// WHAT BREAKING IT COSTS THE USER. Three distinct regressions, each of which looks harmless in a diff:
//   1. An OLD turn keeps «تحديد أكثر». The user scrolls up, taps it, and re-opens a round against a set
//      they already narrowed past — the carry is seeded from a stale turn and the thread forks.
//   2. An old turn keeps «عرض المزيد». Tapping it pages a superseded search into the middle of the
//      conversation, below the newer result. Cards for two different queries interleave.
//   3. The buttons are hidden by DELETING the turn (or its cards). The user loses the record of what
//      they were looking at before they narrowed — the very thing "continuous chat" is for.
// The fix that ships is a swap, not a removal: the spent turn renders a RECEIPT of what that round
// committed. Which makes a fourth failure possible — a receipt that lists an answer the user SKIPPED.
// It must be built by buildAfSummary() over the COMMITTED facets, because a skip writes no facet at all
// (afSteps.ts: `if (!st.keys.length) continue;`). Summary == committed state, permanent rule.
//
// AND THE HONESTY BOUNDARY. "Latest turn only" is a rule about CONTROLS. It must never leak into the
// counts: every turn's closing message keeps stating its own true total (min(true, 100) is a BROWSE
// cap — scripts/verify-result-cap-honesty.ts owns that logic and is NOT duplicated here). This file
// pins only what is new: that `isLatestResults` reaches the two button flags and NOTHING else.
//
//   node --experimental-strip-types scripts/verify-af-continuous-chat-history.ts   (wire into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAfSummary } from '../src/lib/afSummary.ts';
import { deriveGuided, type GuidedStep } from '../src/lib/afSteps.ts';
import { resultCounts, closingNoteKey } from '../src/data/resultCount.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
// Prose describes the intent; only executable source may satisfy a check.
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

const agentRaw = read('src/app/agent.tsx');
const agent = codeOnly(agentRaw);
const i18n = read('src/i18n.tsx');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// The rendered block of ONE element — so a claim about the receipt can never be satisfied by markup
// that belongs to the buttons row. It starts at the element's OPENING ANGLE BRACKET, not at its
// testID: a prop written before the testID (`<Pressable onPress={…} testID="af-round-receipt">`) is
// part of that element and must be inside the block. Mutation-found blind spot, 2026-08-24.
const block = (src: string, testId: string, close: string): string => {
  const at = src.indexOf(`testID="${testId}"`);
  if (at < 0) return '';
  const open = src.lastIndexOf('<', at);
  const end = src.indexOf(close, at);
  return end < 0 || open < 0 ? '' : src.slice(open, end);
};

console.log('\nContinuous chat: old turns are history, only the newest one still has controls\n');

// ── 1. ONLY THE NEWEST RESULTS TURN CARRIES LIVE ACTIONS ─────────────────────────────────────────
check('the newest results turn is identified by scanning the thread backwards',
  /const lastResultsMsg = useMemo\(\(\) => \{[\s\S]{0,300}?for \(let i = msgs\.length - 1; i >= 0; i--\) if \(msgs\[i\]\.role === 'results'\) return msgs\[i\]/.test(agent),
  'agent.tsx: without a single "which turn is newest" derivation every turn believes it is current');
check('each results turn knows whether it is the newest one',
  /const isLatestResults = m\.id === lastResultsMsg\?\.id;/.test(agent),
  'agent.tsx: `isLatestResults` is the whole mechanism — it must compare THIS turn against lastResultsMsg');
check('«عرض المزيد» is offered by the newest turn only',
  /const hasMore = rc\.hasMore && isLatestResults;/.test(agent),
  'agent.tsx: an older turn offering "load more" pages a superseded search below a newer result');
check('«تحديد أكثر» is offered by the newest turn only',
  /const canNarrowFurther = rawTotal > INTERVIEW_STOP_AT && isLatestResults && /.test(agent),
  'agent.tsx: an older turn offering "narrow further" seeds the round carry from a set the user moved past');
// Read Aloud must describe the buttons that are actually there — it reads the SAME two flags, so a
// history turn is never spoken as if it still had actions.
check('the spoken closing note names the same two latest-turn-aware flags',
  /const spokenActionLabels = \[hasMore && t\('Load more'\), canNarrowFurther && t\('Let’s narrow it down'\)\]/.test(agent),
  'agent.tsx: reading rc.hasMore instead of hasMore would announce buttons an old turn does not render');

// ── 2. THE HONESTY BOUNDARY: latest-only touches the BUTTONS and nothing else ────────────────────
// The counts, the closing message and the browse cap stay identical on every turn. Enumerate every
// occurrence of `isLatestResults` and require each to be one of the three lines above.
{
  const lines = agent.split('\n').map((l, i) => [i + 1, l] as const)
    .filter(([, l]) => l.includes('isLatestResults'));
  const allowed = [
    /const isLatestResults = m\.id === lastResultsMsg\?\.id;/,
    /const hasMore = rc\.hasMore && isLatestResults;/,
    /const canNarrowFurther = rawTotal > INTERVIEW_STOP_AT && isLatestResults && /,
  ];
  const stray = lines.filter(([, l]) => !allowed.some((re) => re.test(l)));
  check('`isLatestResults` gates the two buttons and NOTHING else (counts/messages/cards stay honest per turn)',
    lines.length === 3 && stray.length === 0,
    stray.length
      ? `agent.tsx: a history turn must still state its own true total — stray use at line(s) ${stray.map(([n]) => n).join(', ')}: ${stray.map(([, l]) => l.trim()).join(' | ')}`
      : `expected exactly 3 uses, found ${lines.length}`);
}
check('the closing count still comes from resultCounts() on EVERY turn (see verify-result-cap-honesty.ts)',
  /const rc = resultCounts\(\{ trueTotal, shown, fetched, serverMore \}\);/.test(agent)
  && agent.indexOf('const rc = resultCounts(') < agent.indexOf('const isLatestResults ='),
  'agent.tsx: rc is computed before (and independently of) the latest-turn question — the 100 is a browse cap, never a total');

// ── 3. THE CARDS STAY ────────────────────────────────────────────────────────────────────────────
check('a results turn renders its cards from its own reveal count, ungated by recency',
  // The not-yet-revealed fallback became initialReveal(m.result) on 2026-08-30 (a ≤INTERVIEW_STOP_AT set
  // renders in full — src/lib/initialReveal.ts). The INVARIANT this check guards is unchanged and still
  // pinned: the turn's OWN revealCount[m.id] leads, a typing turn starts at 0, and nothing about recency
  // (isLatestResults) may appear in the slice bound.
  /m\.result\.listings\.slice\(0, revealCount\[m\.id\] \?\? \(m\.typing \? 0 : initialReveal\(m\.result\)\)\)\.map\(/.test(agent)
  && !/listings\.slice\(0, [^)]*isLatestResults/.test(agent),
  'agent.tsx: an old turn must keep showing exactly the cards it was showing — never 0, never re-collapsed');
check('the cards render ABOVE the actions/receipt slot, so swapping that slot cannot take them with it',
  agent.indexOf('m.result.listings.slice(0, revealCount[m.id]') < agent.indexOf('showActionsRow ? ('),
  'agent.tsx: if the cards moved inside the actions ternary, losing the buttons would unmount the cards');
check('a new turn freezes the previous turn\'s cascade at what it had, and touches no other turn',
  /const finalizeReveal = \(\) => \{[\s\S]{0,240}?if \(active\) setRevealCount\(\(c\) => \(\{ \.\.\.c, \[active\.id\]: active\.count \}\)\);/.test(agent),
  'agent.tsx: finalizeReveal must preserve (spread) every other turn\'s count and pin the active one at active.count, never 0');

// ── 4. THE RECEIPT REPLACES THE ACTIONS — and is a record, not a control ─────────────────────────
check('the receipt is the ELSE branch of the actions row (the two can never render together)',
  /\{showActionsRow \? \([\s\S]*?\) : afReceipt\[m\.id\] \? \([\s\S]*?testID="af-round-receipt"/.test(agent),
  'agent.tsx: a spent turn must SWAP its buttons for the receipt — not show both, and not simply render nothing');
{
  const receipt = block(agent, 'af-round-receipt', '</View>');
  check('the receipt block is present and holds the choices line',
    receipt !== '' && /testID="af-round-receipt-choices"/.test(receipt),
    'agent.tsx: af-round-receipt must contain the «اختياراتك: …» line');
  check('the receipt has nothing to tap (no Pressable, no press handler)',
    receipt !== '' && !/Pressable|onPress|<Tap\b|TouchableOpacity/.test(receipt),
    'agent.tsx: the receipt is a RECORD of a finished round — making it interactive re-opens the fork this rule closes');
  check('the receipt states the round\'s choices through the shared summary builder',
    /t\('Your choices: \{summary\}', \{ summary: afReceipt\[m\.id\] \}\)/.test(receipt),
    'agent.tsx: the choices line must render the stored buildAfSummary() string, never a re-derived one');
  check('an empty summary renders NO receipt at all (nothing committed ⇒ nothing to record)',
    /\) : afReceipt\[m\.id\] \? \(/.test(agent),
    'agent.tsx: gating on the summary string means an all-skipped round shows no «اختياراتك: » with an empty tail');
}
check('the receipt is written for the ORIGIN turn from the COMMITTED facets only',
  /setAfReceipt\(\(r\) => \(\{ \.\.\.r, \[carry\.msgId\]: buildAfSummary\(ageFlowFacetsRef\.current\) \}\)\)/.test(agent),
  'agent.tsx (finishGuided): keyed on carry.msgId = the turn the round was opened FROM; built from facets, which skips never enter');
check('the receipt strings are translated with the owner\'s exact wording',
  /'Continued with the advanced filter': 'تابع المستخدم باستخدام التصفية المتقدمة'/.test(i18n)
  && /'Your choices: \{summary\}': 'اختياراتك: \{summary\}'/.test(i18n),
  'src/i18n.tsx: Arabic is the product language — an untranslated key renders the English source string');

// ── 5. EXECUTED: summary == committed state, so a SKIPPED answer can never reach the receipt ─────
// Not a grep: run the real pipeline the receipt is built from (deriveGuided → facets → buildAfSummary)
// with a skipped question in the middle and prove the skip leaves no trace in the rendered string.
{
  type Q = GuidedStep['question'];
  const q = (id: string, apply: (x: any, keys: string[]) => any): Q =>
    ({ id, titleKey: id, selection: 'single', eligibility: () => true, resolveOptions: async () => ({} as any), apply } as unknown as Q);
  const BATH = q('bathrooms', (x, k) => ({ ...x, bathMin: Number(k[0]) }));
  const FURN = q('furnished', (x, k) => ({ ...x, furnished: k[0] }));
  const AGE = q('property_age', (x, k) => ({ ...x, age: k[0] }));
  const opts = (...ks: [string, string][]) =>
    ks.map(([key, label]) => ({ key, label, count: 10 })) as GuidedStep['options'];
  const step = (question: Q, options: GuidedStep['options'], keys: string[] | null): GuidedStep =>
    ({ question, options, unknownCount: 0, total: 100, keys });

  // Round: bathrooms ANSWERED, furnished SKIPPED, property_age ANSWERED.
  const steps = [
    step(BATH, opts(['3', '+٣']), ['3']),
    step(FURN, opts(['yes', 'مفروشة']), []),          // SKIP — asked, no predicate, no facet
    step(AGE, opts(['3_5', '٣-٥ سنوات']), ['3_5']),
  ];
  const d = deriveGuided({ city: 'الرياض' } as any, steps, steps.length);
  const summary = buildAfSummary(d.facets);

  check('a skipped question is still recorded as ASKED (so the next round never re-asks it)',
    d.askedIds.length === 3 && d.askedIds.includes('furnished'),
    `askedIds=${JSON.stringify(d.askedIds)}`);
  check('a skipped question commits NO facet (the receipt has nothing to print for it)',
    d.facets.length === 2 && !d.facets.some((f) => f.id === 'furnished'),
    `facets=${JSON.stringify(d.facets.map((f) => f.id))}`);
  check('the receipt string lists both committed answers',
    summary.includes('+٣') && summary.includes('٣-٥ سنوات'),
    `summary="${summary}"`);
  check('the receipt string never mentions the SKIPPED answer',
    !summary.includes('مفروشة') && !summary.includes('🛋️'),
    `a skip leaked into the receipt: "${summary}"`);
  check('a round that skipped everything produces an EMPTY summary (⇒ no receipt renders)',
    buildAfSummary(deriveGuided({} as any, [step(BATH, opts(['3', '+٣']), []), step(FURN, opts(['yes', 'مفروشة']), [])], 2).facets) === '');
}

// ── 6. «عرض المزيد» — the conversation keeps flowing downward, then says so honestly ─────────────
{
  const more = block(agent, 'results-load-more', '</Pressable>');
  check('«عرض المزيد» is rendered inside the hasMore gate, so it disappears once there is nothing left',
    /\{hasMore \? \([\s\S]{0,600}?testID="results-load-more"/.test(agent) && /onPress=\{\(\) => loadMore\(m\)\}/.test(more),
    'agent.tsx: the button must be a function of hasMore — a button that survives exhaustion has nothing to fetch');
  check('loading more APPENDS to the same turn (cards continue below; nothing is replaced)',
    /listings: \[\.\.\.mm\.result\.listings, \.\.\.add\]/.test(agent)
    && !/setRevealCount\(\(c\) => \(\{ \.\.\.c, \[mid\]: 0 \}\)\)/.test(agent),
    'agent.tsx (loadMore): a page must extend the list and reveal upward from `cur`, never reset the turn to 0');
  // The key used to be an inline `t(...)` call in agent.tsx and was asserted by matching that line.
  // Since 2026-09-05 it comes from the pure `closingNoteKey` (src/data/resultCount.ts) — the old
  // inline wording was blind to `isLatestResults`/`!ageFlow` and promised buttons that were not
  // rendered. EXECUTE the exhausted case instead of grepping for it; the Arabic half is unchanged.
  check('the exhausted case has an explicit Arabic all-shown message',
    closingNoteKey({ endKind: 'all', quoteTotal: true, offersMore: false, offersNarrow: false })
      === 'I showed you all {n} matching listings.'
    && /'I showed you all \{n\} matching listings\.': 'عرضت لك كل النتائج المطابقة \(\{n\} إعلان\)\.'/.test(i18n),
    'agent.tsx / src/i18n.tsx: when nothing is left the user must be told so in Arabic, with the true count');
}
// EXECUTED (logic owned by verify-result-cap-honesty.ts; asserted here only where THIS feature reads it):
// the exhausted state is exactly the state in which the button must be gone and the all-shown line shown.
{
  const done = resultCounts({ trueTotal: 19, shown: 19, fetched: 19, serverMore: false });
  check('19 matched / 19 shown → no "load more" left, and the honest line is the ALL line stating 19',
    done.hasMore === false && done.endKind === 'all' && done.endTotal === 19,
    `hasMore=${done.hasMore} endKind=${done.endKind} endTotal=${done.endTotal}`);
  const mid = resultCounts({ trueTotal: 635, shown: 10, fetched: 635, serverMore: false });
  check('635 matched / 10 shown → "load more" is still genuinely offered',
    mid.hasMore === true && mid.endKind === 'more');
  // CONTRACT CHANGE (owner 2026-08-29): the lifetime browse cap is gone — paging continues to the
  // last real match. The honesty half is what this check still owns: 635 stays the stated total.
  const paging = resultCounts({ trueTotal: 635, shown: 100, fetched: 635, serverMore: false });
  check('635 matched / 100 shown → paging CONTINUES (no lifetime cap), and 635 stays the stated total',
    paging.hasMore === true && paging.endKind === 'more' && paging.endTotal === 635 && paging.endShown === 100,
    'the batch size may never stand in for the eligible total, and the browse must reach all 635');
}

// ── 7. THE LAST CARD OF A ROUND STILL ADVANCES (the round cap must not create a terminal primary) ─
// A round now ends on a COUNT (AF_ROUND_MAX_QUESTIONS). The tempting implementation — "the 4th card
// knows it is last, so label its primary «عرض النتائج»" — is the exact 2026-08-23 defect
// (verify-af-primary-advances-not-shows.ts). It stays impossible because the cap is discovered by the
// NEXT presentGuided, after a perfectly ordinary confirm-and-advance, and ends through finishGuided.
check('the round cap ends the round through the shared terminator, not through the card',
  /const askedThisRound = steps\.filter\(\(st\) => st\.keys != null && !isScopeQuestionId\(st\.question\.id\)\)\.length;\s*\n\s*if \(askedThisRound >= AF_ROUND_MAX_QUESTIONS\) \{ finishGuided\(token\); return; \}/.test(agent),
  'agent.tsx (presentGuided): the cap must be a presentGuided exit calling finishGuided — never a flag handed to the question card');
check('a confirm still advances one question (the primary is never terminal)',
  /const onAgeConfirm = \(keys: string\[\]\) => \{ void commitGuidedStep\(keys\); \}/.test(agent),
  'agent.tsx: see verify-af-primary-advances-not-shows.ts — «متابعة · N نتيجة» must commit WITHOUT the finish flag');
check('the question card is never told where it sits in the round',
  !/AF_ROUND_MAX_QUESTIONS/.test(codeOnly(read('src/components/AdvancedQuestionCard.tsx'))),
  'src/components/AdvancedQuestionCard.tsx: one shared card that never branches on position or question id (design contract §1)');

console.log(failures === 0
  ? '\n✓ old turns keep their cards and lose their controls; the receipt records only what was committed; every turn still tells the truth about its own count\n'
  : `\n✗ ${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
