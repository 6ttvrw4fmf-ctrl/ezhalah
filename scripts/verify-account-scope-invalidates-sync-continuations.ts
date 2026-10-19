// A SIGNED-IN SESSION IS NOT AN ACCOUNT KEY — executed against the real store, not read.
//
// THE DEFECT (ops_incident #693, found by routine #8, fingerprint
// hunter-2026-09-25:incomplete_fix:account-key-is-not-a-session-scope).
// src/store.tsx's server-sync guards — "have I already merged for this account?", "is the push armed
// yet?" — were keyed on `historyKey(user.sub)` ALONE. An account key is identical before and after a
// sign-out, so those guards answered "same account" to a question that meant "same session":
//
//   · an in-flight `loadChatMetas()` (bounded at 15s, plus a 1.2s retry and a second 15s) resolving
//     AFTER sign-out re-checked `serverMergedRef`, which sign-out never reset, PASSED, and wrote the
//     previous account's 50 chat metas into the live history state of the GUEST session that
//     replaced it;
//   · "merge once per account" really meant "merge once per account PER PAGE LOAD" — signing out and
//     back into the SAME account in one tab skipped the server pull entirely, so a chat created on
//     another device since the last pull stayed missing from the sidebar until a full reload
//     (against the owner 2026-08-25 rule that conversations survive "logging back in on any device").
//
// EIGHTH RECURRENCE of one class — an async continuation writing state that belongs to a context the
// user has already left (ops_incident #211/#271/#319/#341/#599/#648/#692/#693) — and the THIRD time
// its own repair was a hand-maintained list: #319's fix was `resetConversationState()`, which #599
// then measured to be a subset of what needed resetting. So this barrier pins a fix that is NOT a
// longer list: a scope token carrying a sequence number that advances on every account transition,
// with every guard comparing against the LIVE token at continuation time (the #648 lesson). §C is
// the load-bearing half — it fails if anyone tries to solve the next instance of this class by
// adding a ref to signOut() instead.
//
// WHY IT EXECUTES. The three barriers this class already has are each scoped to the module the
// instance was found in — verify-conversation-state-never-inherited.ts to src/app/agent.tsx,
// verify-suggestion-writes-carry-their-cohort.ts to src/app/index.tsx,
// verify-synced-name-writes-carry-their-name.ts to the buildSyncedName() call sites — and none of
// them can see src/store.tsx's sync effects. §A therefore runs the REAL effect source, sliced out of
// src/store.tsx and driven through a minimal render/effect harness, so this asserts about the lines
// that ship rather than a restatement of them ([[feedback_never-test-a-copy-of-production-code]]).
//
//   node --experimental-strip-types scripts/verify-account-scope-invalidates-sync-continuations.ts

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liftSymbols } from './lib/liftSymbols.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const STORE = join(ROOT, 'src/store.tsx');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (label: string, caught: boolean, detail = '') =>
  check(`MUTATION — ${label}`, caught, detail);

const tick = () => new Promise((r) => setTimeout(r, 0));

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Slicing the real region. Line-based and anchored at both ends, for the reason liftSymbols states:
// a brace walker desynchronises on this file. Both anchors are unique, and a miss throws rather than
// silently lifting the wrong text.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
const SRC = readFileSync(STORE, 'utf8');
const FIRST = '  const accountScopeRef = useRef<string | null>(null);';
const LAST = '  }, [history, user]);';

function syncRegion(): string {
  const lines = SRC.split('\n');
  const starts = lines.filter((l) => l === FIRST).length;
  if (starts !== 1) throw new Error(`expected exactly one ${JSON.stringify(FIRST)}, found ${starts}`);
  const start = lines.indexOf(FIRST);
  const end = lines.indexOf(LAST, start);
  if (end < 0) throw new Error(`no ${JSON.stringify(LAST)} after the scope token in src/store.tsx`);
  return lines.slice(start, end + 1).join('\n');
}

const REGION = syncRegion();

// The REAL deletion policy, lifted (src/lib/chatSync.ts imports `@/lib/...`, which Node's ESM loader
// rejects, so it cannot be imported here — same reason verify-chat-eviction-is-not-a-deletion.ts
// lifts it).
const chatsToDelete = (await liftSymbols(
  join(ROOT, 'src/lib/chatSync.ts'),
  [{ header: 'export function chatsToDelete(' }],
  ['chatsToDelete'],
)).chatsToDelete as (
  holds: ReadonlySet<string> | ReadonlyMap<string, unknown>, requested: Iterable<string>,
) => { toDelete: string[]; forget: string[] };

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The harness. `useRef` is memoised by call order and `useEffect` re-runs on a changed dep list and
// flushes after the render — the two React behaviours the region's correctness actually depends on.
// Everything else is inert scaffolding: the only logic under test is the region's own text.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
const PRELUDE = `
type HistoryItem = any;
const __g: any = (globalThis as any);
const rig = () => __g.__storeRig;
const hooks: any[] = [];
const effects: any[] = [];
let hookIdx = 0, effIdx = 0;
const pending: Array<() => void> = [];
const useRef = (init: any) => {
  const i = hookIdx++;
  if (hooks[i] === undefined) hooks[i] = { current: init };
  return hooks[i];
};
const useEffect = (fn: any, deps: any[]) => {
  const i = effIdx++;
  const rec = effects[i] ?? (effects[i] = { deps: undefined, cleanup: undefined });
  const same = rec.deps !== undefined && rec.deps.length === deps.length
    && deps.every((d: any, k: number) => Object.is(d, rec.deps[k]));
  if (same) return;
  rec.deps = deps;
  pending.push(() => { if (typeof rec.cleanup === 'function') rec.cleanup(); rec.cleanup = fn(); });
};
const supabase = { __stub: true };
const historyKey = (sub: string) => 'history:' + sub;
const historyRef = { current: [] as any[] };
const loadChatMetas = () => rig().loadChatMetas();
const setHistory = (u: any) => {
  const g = rig();
  const next = typeof u === 'function' ? u(g.history) : u;
  g.history = next;
  historyRef.current = next;
  g.historyWrites.push(next);
};
const syncKeyOf = (it: any) => JSON.stringify({ id: it.id, ts: it.ts, order: it.order ?? null });
const mergeOne = (local: any, server: any) => (local ? { ...local, ...server } : server);
const chatNeedsPush = (it: any, base: Map<string, string>) => base.get(it.id) !== syncKeyOf(it);
const chatMetaOf = (it: any) => it;
const pushableTranscript = (_it: any) => null;
const upsertChat = async (id: string, _m: any, _t: any) => { rig().upserts.push(id); return true; };
const deleteChats = async (ids: string[]) => { rig().deletes.push(...ids); return true; };
const chatsToDelete = (...a: any[]) => __g.__chatsToDelete(...a);
// Timers are queued rather than fired, so the test decides when the debounce and the pull retry
// elapse. Both use 1200ms, so one queue serves both.
const setTimeout = (fn: any, _ms?: number) => { rig().timers.push(fn); return rig().timers.length; };
const clearTimeout = (h: any) => { if (h) rig().timers[h - 1] = null; };

export function render(user: any, authChecked: boolean, history: any[]) {
  hookIdx = 0; effIdx = 0;
  historyRef.current = history;
`;

const EPILOGUE = `
  const flush = pending.splice(0);
  for (const f of flush) f();
}
`;

type Rig = {
  history: any[]; historyWrites: any[][]; upserts: string[]; deletes: string[];
  timers: Array<null | (() => void)>; pulls: Array<(rows: any) => void>; pullCalls: number;
  loadChatMetas: () => Promise<any>;
};

const newRig = (): Rig => {
  const r: Rig = {
    history: [], historyWrites: [], upserts: [], deletes: [], timers: [], pulls: [], pullCalls: 0,
    loadChatMetas: () => {
      r.pullCalls++;
      return new Promise((resolve) => { r.pulls.push(resolve); });
    },
  };
  (globalThis as any).__storeRig = r;
  (globalThis as any).__chatsToDelete = chatsToDelete;
  return r;
};

let builtCount = 0;
async function buildRender(regionText: string): Promise<(u: any, a: boolean, h: any[]) => void> {
  const dir = mkdtempSync(join(tmpdir(), 'ezhalah-scope-'));
  const out = join(dir, `store-region-${builtCount++}.mts`);
  writeFileSync(out, PRELUDE + regionText + EPILOGUE);
  const mod = await import(out);
  return mod.render as (u: any, a: boolean, h: any[]) => void;
}

const A = { sub: 'acct-a' };
const B = { sub: 'acct-b' };
const metasOf = (ids: string[]) =>
  ids.map((id) => ({ id, meta: { ts: 1, order: 1, query: { location: 'الرياض' }, title: id } }));

// One scripted walk, run against the real region and again against the mutant, so the two verdicts
// are produced by the same driver and differ only in the guard.
async function walk(render: (u: any, a: boolean, h: any[]) => void) {
  const r = newRig();
  // 1. Signed in as A. The pull is issued and left in flight.
  render(A, true, []);
  await tick();
  const pullsBeforeSignOut = r.pullCalls;
  // 2. Sign out. The guest session replaces A's.
  render(null, true, []);
  await tick();
  // 3. A's pull resolves — 50 metas belonging to an account nobody is signed into any more.
  r.pulls[0]?.(metasOf(Array.from({ length: 50 }, (_, i) => `a-chat-${i}`)));
  await tick(); await tick();
  const leakedToGuest = r.historyWrites.length > 0;
  // 4. The SAME account signs back in, in the same tab.
  render(A, true, []);
  await tick();
  const repulledOnReturn = r.pullCalls > pullsBeforeSignOut;
  // 5. That pull resolves and must land — "write nothing, ever" is not a fix.
  r.pulls[r.pulls.length - 1]?.(metasOf(['fresh-from-another-device']));
  await tick(); await tick();
  const freshLanded = r.historyWrites.some((w) => w.some((it: any) => it.id === 'fresh-from-another-device'));
  return { leakedToGuest, repulledOnReturn, freshLanded, rig: r };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// §A — EXECUTION against the region as it ships.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
const real = await buildRender(REGION);
{
  const w = await walk(real);
  check('§A1 a pull that outlived its session does not write into the guest that replaced it',
    !w.leakedToGuest,
    `history was written ${w.rig.historyWrites.length}x after sign-out: ` +
    `${JSON.stringify(w.rig.historyWrites[0]?.slice(0, 2) ?? null)}`);
  check('§A2 signing back into the SAME account in one tab re-pulls the server metas',
    w.repulledOnReturn,
    `loadChatMetas call count never advanced (${w.rig.pullCalls})`);
  check('§A3 the pull that belongs to the live session still lands', w.freshLanded);
}

// §A4 — an account SWITCH is the same transition, and the abandoned account's rows must not reach it.
// Each scenario gets its OWN module instance: `hooks` and `effects` live at module scope exactly as
// React's do, so a scenario sharing one with an earlier scenario would be resuming that session
// rather than starting one — and would quietly assert about a render that never happened.
async function switchWalk(regionText: string) {
  const render = await buildRender(regionText);
  const r = newRig();
  render(A, true, []);
  await tick();
  render(B, true, []);
  await tick();
  // A's pull resolves while B is on screen.
  r.pulls[0]?.(metasOf(['a-chat-0', 'a-chat-1']));
  await tick(); await tick();
  return {
    sawA: r.historyWrites.some((w) => w.some((it: any) => String(it.id).startsWith('a-chat-'))),
    writes: r.historyWrites,
  };
}
{
  const s = await switchWalk(REGION);
  check('§A4 an account switch discards the previous account\'s in-flight pull', !s.sawA,
    `account A rows reached account B's history: ${JSON.stringify(s.writes)}`);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// MUTATION — put the account-key guards back and watch §A go red. This is the defect exactly as it
// shipped: the scope minted from the account key, the continuation re-checking the ref it stamped,
// and the push armed by the account key.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  let mutant = REGION
    .replace('    const scope = accountScopeRef.current;\n    if (!scope) return;\n',
             '    const scope = historyKey(user.sub);\n')
    .replace('if (!rows || accountScopeRef.current !== scope) return;',
             'if (!rows || serverMergedRef.current !== scope) return;')
    .replace('if (syncReadyRef.current !== accountScopeRef.current) return;',
             'if (syncReadyRef.current !== historyKey(user.sub)) return;');
  check('MUTATION setup — all three guards were actually reverted',
    mutant !== REGION
      && !mutant.includes('accountScopeRef.current !== scope')
      && mutant.includes('const scope = historyKey(user.sub);'),
    'the region text moved; re-anchor the mutation before trusting this file');
  const mutated = await buildRender(mutant);
  const w = await walk(mutated);
  mustCatch('§A1 — the account-key guard lets an abandoned pull write into the guest session',
    w.leakedToGuest,
    'the reverted guard did NOT leak; §A1 would pass on the defective code and proves nothing');
  mustCatch('§A2 — the account-key guard skips the pull on a same-account sign-in',
    !w.repulledOnReturn,
    'the reverted guard still re-pulled; §A2 would pass on the defective code');

  // §A4 needs its own mutant. The account-key guard happened to hold for an account SWITCH (the ref
  // it re-checked had been re-stamped by the incoming account), which is precisely why the defect
  // survived eight months of that case working — so reverting the guard proves nothing about §A4.
  // Deleting the continuation's re-check is what §A4 exists to notice.
  const unguarded = REGION.replace(
    'if (!rows || accountScopeRef.current !== scope) return;', 'if (!rows) return;');
  check('MUTATION setup — the continuation re-check was actually removed', unguarded !== REGION);
  const s = await switchWalk(unguarded);
  mustCatch('§A4 — a continuation with no re-check writes the abandoned account\'s rows', s.sawA,
    'removing the re-check did not leak; §A4 cannot fail and asserts nothing');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// §B — ONE MINT SITE, discovered rather than listed. Every account-scoped guard in the sync region
// must compare the scope token; a ref keyed on the bare account key is the defect returning under a
// new name. A ref added tomorrow is covered by this without anyone registering it.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
const mintSites = (text: string) =>
  text.split('\n')
    .map((l, i) => [l, i] as const)
    .filter(([l]) => !l.trimStart().startsWith('//') && /historyKey\s*\(/.test(l));

{
  const sites = mintSites(REGION);
  check('§B the sync region derives the account key in exactly one place — the scope token',
    sites.length === 1 && sites[0][0].includes('accountScopeRef.current ='),
    `historyKey() appears on ${sites.length} code line(s) in the sync region:\n      ` +
    sites.map(([l]) => l.trim()).join('\n      ') +
    '\n      Every guard here must compare accountScopeRef.current, not an account key: an account ' +
    'key is the same before and after a sign-out (ops_incident #693).');

  const withNewRef = REGION.replace(
    '  const serverMergedRef = useRef<string | null>(null);',
    '  const serverMergedRef = useRef<string | null>(null);\n' +
    '  const syncFooRef = useRef<string | null>(null);\n' +
    '  if (syncFooRef.current !== historyKey(user.sub)) syncFooRef.current = historyKey(user.sub);');
  const mutantSites = mintSites(withNewRef);
  mustCatch('§B — a new ref keyed on the bare account key is caught',
    !(mutantSites.length === 1 && mutantSites[0][0].includes('accountScopeRef.current =')),
    'a second account-key guard passed §B; the discovery predicate does not actually discover');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// §C — THE FIX IS NOT A LIST. The load-bearing half. Three times now this class has been repaired by
// writing down what to reset, and twice the list was a subset of what needed resetting (#319 → #599,
// and #693 itself). Scope safety here must hold with signOut() and deleteAccount() unchanged, so
// naming a sync ref in either of them is a regression of the REPAIR STRATEGY even when the line
// itself looks harmless — and `pendingDeleteRef` in particular must NOT be cleared there, because a
// deletion the user asked for and the server has not yet confirmed is intent, not stale state.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
const SYNC_REFS = ['serverMergedRef', 'syncReadyRef', 'syncBaselineRef', 'pendingDeleteRef'] as const;

function bodyOf(header: string, terminator: string): string {
  const lines = SRC.split('\n');
  const start = lines.findIndex((l) => l.startsWith(header));
  if (start < 0) throw new Error(`§C: no line starts with ${JSON.stringify(header)}`);
  const end = lines.indexOf(terminator, start + 1);
  if (end < 0) throw new Error(`§C: no terminator ${JSON.stringify(terminator)} after ${header}`);
  return lines.slice(start, end + 1).join('\n');
}

const namedIn = (body: string) =>
  SYNC_REFS.filter((r) => body.split('\n').some((l) => !l.trimStart().startsWith('//') && l.includes(r)));

{
  const signOutBody = bodyOf('      signOut: () => {', '      },');
  const deleteBody = bodyOf('      deleteAccount: async () => {', '      },');
  check('§C sign-out needs no sync-ref reset list', namedIn(signOutBody).length === 0,
    `signOut() names ${namedIn(signOutBody).join(', ')}. Scope safety comes from accountScopeRef, ` +
    'which advances on every account transition on its own. A ref that needs resetting here means ' +
    'a guard is keyed on something other than the scope token — fix the guard, not the list ' +
    '(ops_incident #319 → #599 → #693).');
  check('§C delete-account needs no sync-ref reset list either', namedIn(deleteBody).length === 0,
    `deleteAccount() names ${namedIn(deleteBody).join(', ')}`);

  const mutantSignOut = signOutBody.replace('        historyLoadedRef.current = null;',
    '        historyLoadedRef.current = null;\n        serverMergedRef.current = null;');
  mustCatch('§C — a reset line added to signOut() is caught',
    namedIn(mutantSignOut).length > 0,
    'the reset-list detector did not see a sync ref added to signOut()');

  const mutantIntent = signOutBody.replace('        historyLoadedRef.current = null;',
    '        historyLoadedRef.current = null;\n        pendingDeleteRef.current.clear();');
  mustCatch('§C — clearing the user\'s queued deletions on sign-out is caught',
    namedIn(mutantIntent).includes('pendingDeleteRef'),
    'pendingDeleteRef could be cleared on sign-out without this barrier noticing');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// §D — this file runs. Asked of the registry, never string-matched against package.json (AGENTS.md,
// "How `npm test` finds its checks", rule 3).
// ─────────────────────────────────────────────────────────────────────────────────────────────────
check('§D npm test discovers this barrier',
  npmTestRuns(ROOT, 'verify-account-scope-invalidates-sync-continuations'));

console.log(failures === 0
  ? '\nOK — an account key is not a session scope; the sync continuations revalidate.'
  : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
