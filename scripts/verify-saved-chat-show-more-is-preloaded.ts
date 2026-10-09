// «عرض المزيد» IN A SAVED CHAT NEVER WAITS FOR A FETCH STARTED AT TAP TIME (owner 2026-10-07: «it loads so
// long, this should never happen»). A reopened chat keeps only its first cards, so the open path must start
// the next page at once and loadMore must consume it (same conversation, same offset, success only).
import { readFileSync } from 'node:fs';
import { serializeChat, restoreChat } from '../src/lib/chatTranscript.ts';

const src = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');

function wiring(a: string): string[] {
  const bad: string[] = [];
  if (!/setMsgs\(restored\.msgs as unknown as ChatMsg\[\]\);\n\s*\{[\s\S]{0,600}?prefetchNextPage\(restored\.msgs as unknown as ChatMsg\[\], /.test(a)) bad.push('restoring a saved transcript does not pre-load the next page');
  if (!/setMsgs\(snapMsgs\);\n\s*prefetchNextPage\(snapMsgs\);/.test(a)) bad.push('reopening a legacy snapshot chat does not pre-load the next page');
  const helper = /const prefetchNextPage = [\s\S]*?\n  \};\n/.exec(a)?.[0] ?? '';
  if (!/loadMoreListings\(q, offset, last\.result\.rotationSeed\)/.test(helper)) bad.push('the pre-load does not ask for the exact page the tap would (query, offset, the set\'s own seed)');
  if (!/afFirst\.catch\(\(\) => null\)\.then\(\(\) => loadMoreListings\(/.test(helper)) bad.push('the page pre-load no longer waits for the Advanced Filter probe (two heavy calls at once slow both: #3420)');
  if (!/prefetchNarrowing\(r\.query, asked\)/.test(helper)) bad.push('a reopened chat no longer starts the «تحديد أكثر» probe first');
  if (!/epoch: conversationEpochRef\.current/.test(helper)) bad.push('the pre-load is not tied to its conversation');
  const lm = /const loadMore = async [\s\S]*?\n  \};\n/.exec(a)?.[0] ?? '';
  if (!/pre\.epoch === epoch && pre\.offset === pageOffset \? await pre\.p : null/.test(lm)) bad.push('loadMore does not consume the pre-loaded page (or trusts it across chats / offsets)');
  if (!/if \(!page \|\| page\.failed\) page = await loadMoreListings\(q, pageOffset, m\.result\.rotationSeed\);/.test(lm)) bad.push('a failed or missing pre-load no longer falls back to a live fetch');
  // Reopens EXACTLY as left (owner 2026-10-07): the cards the user had on screen come back with no tap.
  if (!/prefetchNextPage\(restored\.msgs[^\n]*\n\s*restoringDone = restoreLeftState\(restored\.msgs as unknown as ChatMsg\[\]\);/.test(a)) bad.push('a reopened chat no longer brings back the cards the user had on screen');
  const rl = /const restoreLeftState = async [\s\S]*?\n  \};\n/.exec(a)?.[0] ?? '';
  if (!/if \(conversationEpochRef\.current !== epoch\) return;/.test(rl)) bad.push('the restore can write into a chat the user already left');
  if (!/if \(!page \|\| page\.failed\) return;/.test(rl)) bad.push('a failed restore page is treated as data');
  if (!/Math\.min\(r\.restoreTo, mergedLen\)/.test(rl)) bad.push('the restore no longer re-reveals up to what the user had on screen');
  if (!/const revealIsTerminal = r\.restoreCompleted === true && to >= r\.restoreTo;\n\s*if \(revealIsTerminal\) setCompleted\(true\);/.test(rl)) bad.push('a finished chat no longer reopens finished');
  // NEVER BLANK, NEVER A VANISHING BUTTON (owner 2026-10-07/08): the chat lands at once, its row waits behind
  // a loading line while the cards come back, then lands again.
  if (!/landAtLatest\(\);\n\s*await restoringDone;\n\s*if \(conversationEpochRef\.current !== epoch\) return;\n\s*landAtLatest\(\);/.test(a)) bad.push('a reopened chat is no longer shown at once (it waits for the restore before landing)');
  if (/savedOpenGateRef|SAVED_OPEN_MAX_WAIT_MS/.test(a)) bad.push('the open is gated on the restore again (a blank screen while cards load)');
  if (!/setRestoringId\(last\.id\);\n\s*const page = await pre\.p;\n\s*if \(conversationEpochRef\.current !== epoch\) return;\n\s*setRestoringId\(null\);/.test(a)) bad.push('the restoring turn is not marked while its cards come back');
  if (!/if \(restoringId === m\.id\) \{[\s\S]{0,200}testID="results-restoring"/.test(a)) bad.push('a restoring turn shows its buttons/closing line before its cards are back');
  return bad;
}

// EXECUTED: the transcript remembers how many cards were on screen (and whether the chat had finished).
function transcript(n: number, revealed: number, completed: boolean): any {
  const listings = Array.from({ length: n }, (_, i) => ({ source: 'aqar', id: String(i) }));
  return serializeChat({ msgs: [{ id: 'u', role: 'user', text: 'x' }, { id: 'r', role: 'results', text: 's', result: { listings, hasMore: false, pageOffset: 500 } }],
    revealCount: { r: revealed }, afReceipt: {}, guidedPills: null, completed });
}
function remembers(ser: typeof serializeChat): string[] {
  const bad: string[] = [];
  // 2026-10-08: a chat is saved WHOLE up to the display cap, so a reopen needs no fetch at all.
  const back = restoreChat((ser === serializeChat) ? transcript(500, 500, true) : null);
  const r = back?.msgs.find((m: any) => m.role === 'results') as any;
  if (r?.result?.listings?.length !== 500) bad.push(`a 500-card chat is saved with ${r?.result?.listings?.length} cards, not all 500`);
  if (r?.result?.restoreTo !== undefined) bad.push('a chat saved whole still carries a restore target (it would refetch for nothing)');
  if (back?.completed !== true) bad.push('a finished 500-card chat forgets it was finished');
  const small = restoreChat(transcript(40, 40, false))?.msgs.find((m: any) => m.role === 'results') as any;
  if (small?.result?.listings?.length !== 40 || small?.result?.restoreTo !== undefined) bad.push('a small chat is not saved as it was');
  return bad;
}

let failed = 0;
const check = (label: string, bad: string[]) => { if (bad.length) failed++; console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${label}${bad.length ? '\n        ' + bad.join('\n        ') : ''}`); };
const mustCatch = (label: string, bad: string[]) => { if (!bad.length) failed++; console.log(`${bad.length ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); };

console.log('\nSaved chat «عرض المزيد» is pre-loaded at open (owner 2026-10-07)\n');
check('wiring', wiring(src));
check('transcript remembers what was on screen (executed)', remembers(serializeChat));
mustCatch('a blank screen until the restore ends', wiring(src.replace('      landAtLatest();\n      await restoringDone;', '      await restoringDone;')));
mustCatch('buttons shown while cards are still coming back', wiring(src.replace('if (restoringId === m.id) {', 'if (false) {')));
mustCatch('a restoring turn never marked', wiring(src.replace('    setRestoringId(last.id);\n', '')));
mustCatch('a reopened chat that forgets the cards on screen', wiring(src.replace(/\n\s*restoringDone = restoreLeftState\(restored\.msgs as unknown as ChatMsg\[\]\);/, '')));
mustCatch('a restore that writes into a chat the user left', wiring(src.replace(/(const restoreLeftState[\s\S]*?)if \(conversationEpochRef\.current !== epoch\) return;/, '$1')));
mustCatch('a finished chat reopening unfinished', wiring(src.replace('const revealIsTerminal = r.restoreCompleted === true && to >= r.restoreTo;', 'const revealIsTerminal = false;')));
mustCatch('a restored chat that waits for the tap again', wiring(src.replace(/prefetchNextPage\(restored\.msgs as unknown as ChatMsg\[\], /, 'void (')));
mustCatch('the page pre-load racing the Advanced Filter probe', wiring(src.replace('afFirst.catch(() => null).then(() => loadMoreListings(', 'Promise.resolve().then(() => loadMoreListings(')));
mustCatch('a reopened chat that skips the «تحديد أكثر» probe', wiring(src.replace('prefetchNarrowing(r.query, asked)', 'void 0')));
mustCatch('a snapshot chat that waits for the tap again', wiring(src.replace(/\n\s*prefetchNextPage\(snapMsgs\);/, '')));
mustCatch('loadMore ignoring the pre-loaded page', wiring(src.replace('pre.epoch === epoch && pre.offset === pageOffset ? await pre.p : null', 'null')));
mustCatch('a pre-load trusted across conversations', wiring(src.replace('pre.epoch === epoch && pre.offset === pageOffset', 'pre.offset === pageOffset')));
mustCatch('a failed pre-load shown as «no more»', wiring(src.replace('if (!page || page.failed) page = await', 'if (!page) page = await')));
console.log(failed ? `\n${failed} FAILED` : '\nAll saved-chat pre-load assertions passed');
process.exit(failed ? 1 : 0);
