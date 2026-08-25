// Permanent guard: FILTER → SEARCH → STOP → SAME FILTER (owner, 2026-08-18).
//
// "The key rule is: if the search was started from the Filter, Stop means cancel the search
//  entirely and return to that Filter state. It should feel like the search never completed."
//
// Required, verbatim from the spec:
//   1. Immediately cancel the active search/request/stream.
//   2. Return the user to the Filter page.
//   3. Restore the exact Filter state they had immediately before pressing Search.
//   4. Do NOT show partial search results.
//   5. Do NOT treat the cancelled search as completed.
//   6. Do NOT leave the user on an empty Agent/results screen.
// AND, separately, for a search that started in the AI chat instead of the Filter:
//   Stop simply stops that AI operation in the appropriate ChatGPT-like way — stay in chat.
// AND: cancellation must be REAL — abort the network request(s), never just navigate away while
//   the old request keeps running; a cancelled request must never later write into the UI or history.
// AND: do not change normal browser Back behavior while doing this.
//
// THE ARCHITECTURE THIS RELIES ON (verified by reading the code, not assumed):
//   - The Filter screen (index.tsx) already rehydrates city/district selections from the shared
//     `query` app-context on return — proven live in the 2026-08-04/08-14 rehydration fixes this
//     barrier's neighbours (verify-city-rehydration.ts etc.) already pin. That mechanism is REUSED
//     here, not rebuilt: agent.tsx's param-consuming effect already writes `query` context verbatim
//     from `?filter=` (setQuery(() => q)) BEFORE the search starts, and nothing between then and a
//     Stop press ever touches `query` context again — so router.replace('/') is the whole fix for
//     requirements 2 and 3, PROVIDED nothing else races it. This barrier's job is to keep it that way.
//   - router.replace('/') (never .push) is the EXACT navigation the تصفية tab already uses — reusing
//     it, rather than inventing a second Home navigation, is what keeps Back behavior unchanged.
//
//   node --experimental-strip-types scripts/verify-filter-stop-cancels-and-restores.ts  (in `npm test`)
import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

const agent = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
const remote = readFileSync(new URL('../src/data/remote.ts', import.meta.url), 'utf8');
const store = readFileSync(new URL('../src/store.tsx', import.meta.url), 'utf8');

// 1) ORIGIN TRACKING — only a Filter-started run may ever behave differently from a chat run, and
//    the tag must be set at the ONE place a Filter search begins, not inferred from anything else.
check('the Run type carries an origin + a real AbortController',
  /type Run = \{[^}]*origin:\s*'filter'\s*\|\s*'chat'[^}]*ac:\s*AbortController/.test(agent));
check('sendFilter is the ONLY call site that tags a run \'filter\'',
  (agent.match(/makeRun\('filter'\)/g) ?? []).length === 1
  && /sendFilter[\s\S]{0,600}makeRun\('filter'\)/.test(agent));
check("every OTHER makeRun() call site is untagged (defaults to 'chat') — chat/refine turns never claim 'filter'",
  [...agent.matchAll(/(?<!\.)\bmakeRun\(([^)]*)\)/g)]
    .filter((m) => !m[0].includes("'filter'"))
    .every((m) => m[1].trim() === ''));

// 2) STOP dispatches on origin, and the filter branch runs BEFORE the generic chat-stop code (so it
//    can never fall through to also showing the "I've stopped the search" bubble on a Filter turn).
const stopFn = agent.slice(agent.indexOf('const stop = () => {'), agent.indexOf('const promptSignupSoon'));
check('stop() reads run.origin captured before runRef is cleared', /const wasFilterOrigin = run\?\.origin === 'filter'/.test(stopFn)
  && stopFn.indexOf('wasFilterOrigin = run?.origin') < stopFn.indexOf('runRef.current = null'));
// The real stop-in-place bubble text (as opposed to a comment that merely quotes the same phrase,
// e.g. the pre-existing "must NOT claim ... or hide CTAs" note above) — anchored on the actual
// rendered-string call shape so it can't be fooled by prose mentioning the same words.
const bubbleTextIdx = stopFn.search(/text:\s*tr\("I've stopped the search/);
check('the filter branch is reached BEFORE the generic "I\'ve stopped the search" bubble',
  bubbleTextIdx > 0 && stopFn.indexOf('if (wasFilterOrigin)') < bubbleTextIdx);
check('the filter branch returns (never falls through to the chat-stop message)',
  /if \(wasFilterOrigin\) \{[\s\S]{0,2200}?return;\s*\n\s*\}/.test(stopFn));

// 3) Requirements 1-6, read directly off the filter branch. `code` strips `//` line comments so a
//    check like "no setQuery call" isn't fooled by this branch's own prose explaining the design
//    (which necessarily mentions setQuery when describing why it's absent).
const filterBranch = (stopFn.match(/if \(wasFilterOrigin\) \{([\s\S]{0,2200}?)return;\s*\n\s*\}/) ?? [, ''])[1];
const code = (s: string) => s.replace(/\/\/[^\n]*/g, '');
check('1. cancels the active run for real: run.cancelled + run.ac.abort() before the branch runs',
  /run\.cancelled = true;/.test(stopFn) && /run\.ac\.abort\(\)/.test(stopFn));
check('2. returns to the Filter page via router.replace(\'/\')', /router\.replace\('\/'\)/.test(filterBranch));
check("2b. that is the SAME navigation «تصفية» itself uses — one Home path, not a second one invented here",
  (agent.match(/router\.replace\('\/'\)/g) ?? []).length >= 2);
check('3. never re-navigates with a filter/seed param attached (no restored search re-executes)',
  !/router\.replace\('\/',\s*\{/.test(filterBranch) && !/router\.replace\(\{\s*pathname:\s*'\/'/.test(filterBranch));
check('3b. does not overwrite query context on the way out (nothing here calls setQuery)',
  !/setQuery/.test(code(filterBranch)));
check('3c. clears lastFilterRef/lastSeedRef so an identical resubmitted filter is not silently swallowed',
  /lastFilterRef\.current = undefined/.test(filterBranch) && /lastSeedRef\.current = undefined/.test(filterBranch));
check('4/5. never renders partial results or a completion message on this path (no results/agent bubble appended)',
  !/role:\s*'results'/.test(filterBranch) && !/text:\s*tr\(/.test(filterBranch));
check('5b. the conversation is erased, not frozen/annotated as a completed turn', /setMsgs\(\[\]\)/.test(filterBranch));
check('6. never leaves busy=true (no infinite spinner) once this path is taken', /setBusy\(false\)/.test(filterBranch));

// 4) The chat path is UNCHANGED — same message, same screen, no navigation.
const chatBranch = stopFn.slice(stopFn.indexOf('setStopped(true)'));
check("chat-originated Stop keeps the existing stop-in-place message and does NOT navigate",
  /I've stopped the search/.test(chatBranch) && !/router\.replace/.test(chatBranch));

// 5) CANCELLATION IS REAL, not just "stop waiting on it" — traced end to end from the Stop button
//    down to the actual HTTP layer, and independently down to the write-guard that survives a race.
check('bounded() accepts an external AbortSignal and forwards it into the SAME controller the timeout uses',
  /async function bounded[\s\S]{0,120}signal\?:\s*AbortSignal/.test(remote)
  && /signal\.addEventListener\('abort', onExternalAbort\)/.test(remote)
  && /ctrl\.abort\(\)/.test(remote));
check('an already-aborted signal aborts immediately, before the network call even starts',
  /if \(signal\.aborted\) ctrl\.abort\(\);/.test(remote));
check('fetchRawByIds checks the signal between chunked requests, not only at the start',
  /for \(let i = 0; i < ids\.length; i \+= ID_CHUNK\) \{\s*\n\s*if \(signal\?\.aborted\)/.test(remote));
check('fetchListingsForQuery threads the SAME signal into both the main RPC call and the raw-card fetch',
  /opts\?\.signal/.test(remote) && /fetchRawByIds\(q, tbl, ids, signal\)/.test(remote)
  && /supabase\.rpc\('location_search_candidates_ar'[\s\S]{0,400}\), RPC_TIMEOUT_MS, signal\)/.test(remote));
check('runQuery accepts a signal and passes it all the way down',
  // signature gained a trailing chatId (conversation identity, owner 2026-08-25) — signal position unchanged.
  /runQuery: \(q: SearchQuery, record\?: boolean, signal\?: AbortSignal, chatId\?: string \| null\)/.test(store)
  && /fetchListingsForQuery\(q, \{ signal \}\)/.test(store));
check('recordHistory/setSearchCount are gated on !signal?.aborted — a cancelled run can NEVER write, even on a late-resolving race',
  /if \(record && !signal\?\.aborted\) \{[\s\S]{0,600}?setSearchCount/.test(store)
  && /if \(record && !signal\?\.aborted\) \{[\s\S]{0,600}?recordHistory/.test(store));
check('every live search-triggering runQuery() call in agent.tsx passes run.ac.signal (chat turns get real cancellation too)',
  // each live call now also names its conversation (ensureChatId — owner 2026-08-25); the signal
  // still rides every one of the 4, which is what this check exists to hold.
  (agent.match(/runQuery\([^)]*run\.ac\.signal, ensureChatId\(\)\)/g) ?? []).length === 4);
check('the ONE runQuery call that must NOT pass a signal (history replay — no new run exists) still passes record=false',
  /runQuery\(q, false\); \/\/ viewing a saved chat/.test(agent));

console.log(failed ? `\n${failed} FAILED` : '\nAll filter-stop checks passed');
process.exit(failed ? 1 : 0);
