// BARRIER: falling off the sidebar's 50-entry DISPLAY cap must never delete the server copy.
//
// WHY THIS EXISTS (ops_incident #297, routed to routine-6 by routine-8's regression hunt).
// `src/store.tsx`'s debounced push effect derived deletions as a SET DIFFERENCE — every id in the
// sync baseline that was missing from the current `history` list:
//
//     const gone = [...base.keys()].filter((id) => !seen.has(id));
//     if (gone.length) void deleteChats(gone);
//
// `seen` is built from `historyRef.current`, which the 50-entry cap has ALREADY trimmed. So the
// diff reads "this chat is not on screen" as "the user deleted this chat", and those are different
// claims the moment anything but a deletion can take a chat off screen. Three routine paths do:
//
//   · hold 50 synced chats and start a 51st — `[next, ...rest].slice(0, 50)` drops the oldest id;
//   · sign in where local ∪ server exceeds 50 — the merge slices the union;
//   · a server row whose meta the merge skips as malformed — the id never enters the list at all.
//
// In each, the id is still in the baseline, so 1,200 ms later `deleteChats` removed it from
// `user_chats` — permanently, silently, on every device, with no user action. A DISPLAY CAP WAS
// PERFORMING A DATA DELETION.
//
// THE FIX IS A CHANGE OF ORACLE, NOT A CONDITION. Deletion is now intent-driven: only
// `deleteHistory()` and `clearHistory()` put ids into the pending set, and `chatsToDelete()`
// propagates only those. The displayed list is not a parameter of that function AT ALL — which is
// what makes "eviction cannot delete" true by construction rather than by a guard someone can
// later relax. This barrier pins both halves: the decision itself, and the store still routing
// through it instead of re-deriving a diff.
//
//   node --experimental-strip-types scripts/verify-chat-eviction-is-not-a-deletion.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liftSymbols } from './lib/liftSymbols.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

// LIFTED, NOT IMPORTED, AND NEVER COPIED. src/lib/chatSync.ts imports `@/lib/...`, which Node's ESM
// loader rejects, so the module cannot be imported directly here. Lifting the REAL declaration out
// of the REAL file keeps this barrier a statement about shipped code — a hand-copied duplicate is a
// test that passes while production breaks (feedback_never-test-a-copy-of-production-code).
const chatsToDelete = (await liftSymbols(
  join(ROOT, 'src/lib/chatSync.ts'),
  [{ header: 'export function chatsToDelete(' }],
  ['chatsToDelete'],
)).chatsToDelete as (
  serverHolds: ReadonlySet<string> | ReadonlyMap<string, unknown>,
  requested: Iterable<string>,
) => { toDelete: string[]; forget: string[] };

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (label: string, run: () => boolean) => {
  let caught = false;
  try { caught = run(); } catch { caught = true; }
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  failures++;
  console.error(`FAIL  (mutation) MISSED ${label}`);
};

// ── A. THE MEASURED CASE: the 51st chat evicts the oldest ────────────────────────────────────────
// 50 synced chats on the server; the user starts a 51st, so `chat-00` leaves the displayed list.
// Nothing was deleted by anyone, so nothing may be deleted on the server.
const fifty = Array.from({ length: 50 }, (_, i) => `chat-${String(i).padStart(2, '0')}`);
{
  const serverHolds = new Map(fifty.map((id) => [id, 'meta'] as const));
  const { toDelete, forget } = chatsToDelete(serverHolds, /* requested */ []);
  check('A1. the chat evicted by the 50-cap is NOT deleted from the server',
    !toDelete.includes('chat-00'), `toDelete=${JSON.stringify(toDelete)}`);
  check('A2. nothing at all is deleted when the user asked for nothing',
    toDelete.length === 0, `toDelete=${JSON.stringify(toDelete)}`);
  check('A3. and nothing is forgotten either — there was no request to forget', forget.length === 0);
}

// ── B. THE OTHER TWO EVICTION PATHS ──────────────────────────────────────────────────────────────
// A sign-in merge whose union overflows 50, and a server row the merge skipped as malformed. Both
// leave the id in the baseline and out of the list; neither is a deletion.
{
  const serverHolds = new Set([...fifty, 'overflowed-by-merge', 'skipped-as-malformed']);
  const { toDelete } = chatsToDelete(serverHolds, []);
  check('B1. a row dropped by the merge overflowing 50 is not deleted',
    !toDelete.includes('overflowed-by-merge'), JSON.stringify(toDelete));
  check('B2. a server row skipped as malformed is not deleted — it is unreadable, not unwanted',
    !toDelete.includes('skipped-as-malformed'), JSON.stringify(toDelete));
}

// ── C. A REAL DELETE STILL PROPAGATES ────────────────────────────────────────────────────────────
// The fix must not turn into "deletions stop working", which would be the same bug with the sign
// flipped: the sidebar would clear locally and the server copies would come back on the next sync.
{
  const serverHolds = new Set(fifty);
  const { toDelete } = chatsToDelete(serverHolds, ['chat-07']);
  check('C1. a chat the user deleted IS removed from the server',
    toDelete.length === 1 && toDelete[0] === 'chat-07', JSON.stringify(toDelete));
}
{
  // clearHistory(): every held id is requested at once.
  const serverHolds = new Set(fifty);
  const { toDelete } = chatsToDelete(serverHolds, fifty);
  check('C2. clearing the history deletes every held chat, not a subset',
    toDelete.length === 50, `deleted ${toDelete.length} of 50`);
}

// ── D. BOOKKEEPING: a request the server cannot satisfy is forgotten, not retried forever ────────
{
  const serverHolds = new Set(fifty);
  const { toDelete, forget } = chatsToDelete(serverHolds, ['chat-03', 'never-synced']);
  check('D1. a delete for an id the server never held is forgotten rather than queued forever',
    forget.length === 1 && forget[0] === 'never-synced', JSON.stringify(forget));
  check('D2. …while the held one is still deleted', toDelete.includes('chat-03'), JSON.stringify(toDelete));
  // A duplicate request must not become two deletes.
  const dup = chatsToDelete(serverHolds, ['chat-03', 'chat-03']);
  check('D3. a duplicated request deletes once', dup.toDelete.length === 1, JSON.stringify(dup.toDelete));
}

// ── E. THE STORE STILL ROUTES THROUGH IT ─────────────────────────────────────────────────────────
// A pure function nothing calls is decoration, and the defect was precisely a diff computed inline.
// So the source is checked for the SHAPE that caused it, not merely for the fix's presence.
const store = readFileSync(join(ROOT, 'src/store.tsx'), 'utf8');
check('E1. the push effect asks chatsToDelete() for its deletions',
  /chatsToDelete\s*\(/.test(store), 'store.tsx no longer calls chatsToDelete');
check('E2. no id set is derived from "in the baseline but not displayed" any more — that IS the bug',
  !/\[\s*\.\.\.\s*base\.keys\(\)\s*\]\s*\.filter\(\s*\(?\s*id\s*\)?\s*=>\s*!\s*seen\.has\(/.test(store),
  'the set-difference deletion is back in store.tsx');
check('E3. only deleteHistory and clearHistory record deletion intent',
  (store.match(/pendingDeleteRef\.current\.add\(/g) || []).length === 2,
  `found ${(store.match(/pendingDeleteRef\.current\.add\(/g) || []).length} places adding deletion intent — expected exactly 2`);

// ── MUTATION PROOFS ──────────────────────────────────────────────────────────────────────────────
// Executable, against the real exported decision: a version that took the displayed list back into
// account is the pre-fix behaviour, and this barrier must go red on it.
mustCatch('the pre-fix oracle: deleting everything in the baseline that is not displayed', () => {
  const baseline = new Set([...fifty, 'evicted-by-cap']);
  const displayed = new Set(fifty);                       // the cap trimmed 'evicted-by-cap'
  const preFix = [...baseline].filter((id) => !displayed.has(id));   // the exact old expression
  // The old oracle deletes the evicted chat; the shipped one, asked for nothing, deletes nothing.
  const shipped = chatsToDelete(baseline, []).toDelete;
  return preFix.includes('evicted-by-cap') && !shipped.includes('evicted-by-cap');
});
mustCatch('a shipped decision that ignored intent and deleted the whole baseline', () => {
  const baseline = new Set(fifty);
  return chatsToDelete(baseline, []).toDelete.length !== baseline.size;
});
mustCatch('a shipped decision that dropped real deletions on the floor', () =>
  chatsToDelete(new Set(fifty), ['chat-11']).toDelete.includes('chat-11'));

check('F1. this barrier is discovered and run by `npm test`',
  npmTestRuns(ROOT, 'verify-chat-eviction-is-not-a-deletion'));

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
