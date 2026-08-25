// Reopening a saved chat must render its SAVED results instantly — zero network, no "searching…"
// beat (owner 2026-08-14: "it should already show him the property because he already listed it.
// This is just saved."). Before this fix, openStatic() re-ran the full live search on every
// history open: the user saw a loading pass for an answer the app had already produced.
//
// Pins the four load-bearing pieces so a refactor can't silently regress to the re-search flow:
//   1. HistoryItem carries the optional result snapshot.
//   2. recordHistory attaches it at search time, truncated to the cap with gap-free paging flags
//      (truncated → pageOffset 0 + hasMore true; loadMore de-dups against the held cards).
//   3. Sidebar passes the entry id (hid) so the agent can find the snapshot.
//   4. openStatic's snapshot branch renders the final state and RETURNS before any runQuery call.
//
//   node --experimental-strip-types scripts/verify-history-instant-restore.ts   (in `npm test`)
import { readFileSync } from 'node:fs';

const store = readFileSync('src/store.tsx', 'utf8');
const agent = readFileSync('src/app/agent.tsx', 'utf8');
const sidebar = readFileSync('src/components/Sidebar.tsx', 'utf8');

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// 1. The snapshot lives on the history entry.
check('HistoryItem carries snapshot?: SearchResult', /export type HistoryItem = \{[^}]*snapshot\?: SearchResult[^}]*\}/.test(store));

// 2. recordHistory receives the result and truncates with gap-free paging flags.
check('recordHistory takes the result', /recordHistory = \(q: SearchQuery, result\?: SearchResult, chatId\?: string \| null\)/.test(store));
check('truncated snapshot restarts paging (pageOffset 0 + hasMore) for gap-free live continuation',
  /listings: result\.listings\.slice\(0, SNAPSHOT_CAP\), pageOffset: 0, hasMore: true/.test(store));
check('runQuery records the result alongside the query', /recordHistory\(q, result, chatId\)/.test(store));
check('older entries shed snapshots (storage bound)', /SNAPSHOT_ENTRIES/.test(store) && /snapshot: undefined/.test(store));

// 3. Sidebar passes the entry id so the agent can find the snapshot.
check('Sidebar passes hid with the replay route', /replay: '0', hid: c\.id/.test(sidebar));

// 4. openStatic renders the snapshot and returns BEFORE runQuery — the instant path does zero network.
const openStatic = agent.slice(agent.indexOf('const openStatic'), agent.indexOf('const sendGreeting'));
check('openStatic accepts the snapshot', /snapshot\?: SearchResult/.test(openStatic));
const snapBranch = openStatic.indexOf('if (snapshot)');
const runQueryCall = openStatic.indexOf('await runQuery');
check('snapshot branch exists and precedes the live runQuery fallback', snapBranch !== -1 && runQueryCall !== -1 && snapBranch < runQueryCall);
check('snapshot branch returns without searching', /if \(snapshot\) \{[\s\S]*?return;\s*\}/.test(openStatic) && !/if \(snapshot\) \{[\s\S]*?runQuery[\s\S]*?return;\s*\}/.test(openStatic));
check('agent looks the snapshot up by hid (openSaved fallback — transcript restore is primary, owner 2026-08-25)', /openStatic\(q, override, entry\?\.snapshot\)/.test(agent));

console.log(failed === 0
  ? '\n✓ saved chats render their saved results instantly — the re-search flow cannot silently return'
  : `\n✗ ${failed} check(s) FAILED — history restore is drifting back toward re-searching`);
process.exit(failed === 0 ? 0 : 1);
