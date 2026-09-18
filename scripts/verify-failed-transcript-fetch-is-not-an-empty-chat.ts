// A FAILED TRANSCRIPT FETCH IS NOT AN EMPTY CHAT — executed, not read.
//
// THE DEFECT (P1, ops_incident #272). `fetchChatTranscript()` in src/lib/chatSync.ts returned the
// SAME `null` for two facts that are not the same fact:
//   * "the server holds no transcript for this chat" (legacy row) → fall back to the local copy
//   * "the read failed (network / RLS / timeout)"                 → ALSO fall back to the local copy
// supabase-js NEVER THROWS, so `{ data: null, error }` resolves and no type checker and no caller
// could see the difference.
//
// WHY THAT WAS WORSE THAN A DEGRADED VIEW. src/lib/chatMerge.ts marks a carried-over local
// transcript `txStale` when the server reports newer activity, and store.tsx's `pushableTranscript`
// refuses to push a stale copy — that flag is the ONLY thing standing between a short cached
// conversation and the longer server one it would be written over. The chain:
//
//   stale local copy + failed read
//     → pickTranscript took its "server has none" branch and returned the stale copy
//     → hydrateTranscript called withFreshTranscript on it, which CLEARS txStale
//     → the copy is now pushable, and the next meta edit (star, rename, one more message)
//       upserts it over the server's newer transcript. Permanently. Silently.
//
// i.e. a transient blip disarmed the exact guard chatMerge.ts was written to provide, and destroyed
// the user's conversation. The fix is the repo's existing sentinel — PROBE_FAILED / isProbeFailure
// (src/lib/afProbe.ts), which AGENTS.md names and forbids duplicating — carried through
// pickTranscript as a `verified` bit, with `mayPromoteTranscript()` as the one predicate deciding
// write-back.
//
// WHY THIS BARRIER EXISTS IN THIS FORM. AGENTS.md: "Barriers for this class must EXECUTE the
// function against an injected failure." All five defects of 2026-09-04 had a source-TEXT tripwire
// over the exact line, and every one of those tripwires passed for the entire time the defect was
// live — two of them pinned the defective line as correct. So this RUNS the real
// `fetchChatTranscript` lifted verbatim out of chatSync.ts ([[feedback_never-test-a-copy-of-
// production-code]]) against a stub client that RESOLVES `{ data: null, error }` the way supabase-js
// really does, and runs the real pickTranscript/mayPromoteTranscript from chatMerge.ts.
//
//   node --experimental-strip-types scripts/verify-failed-transcript-fetch-is-not-an-empty-chat.ts
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liftSymbols } from './lib/liftSymbols.ts';
import { PROBE_FAILED, isProbeFailure } from '../src/lib/afProbe.ts';
import { pickTranscript, mayPromoteTranscript, mergeOne } from '../src/lib/chatMerge.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHAT_SYNC = join(ROOT, 'src/lib/chatSync.ts');
const STORE = join(ROOT, 'src/store.tsx');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// An EXECUTABLE mutation proof: apply this barrier's own predicate to a deliberately broken input
// and assert the predicate rejects it. Prose describing a mutation is not a proof, and neither is a
// literal `true` — `caught` is always a computed expression here.
// (Recognised by scripts/verify-new-barriers-are-mutation-proven.ts.)
const mutation = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) ${label}`); return; }
  failures++;
  console.error(`FAIL  (mutation) ${label} — the barrier did NOT reject the broken input`);
};

// ── The injected client. This is the ONLY thing standing in for production: a PostgrestBuilder-
// shaped thenable whose terminal `maybeSingle()` resolves (never rejects) with whatever outcome the
// test names — exactly supabase-js's real contract, which is the entire reason this class of defect
// is invisible to tsc. The logic under test is the REAL lifted fetchChatTranscript.
type Outcome = { data: unknown; error: unknown } | { abort: true };
const makeClient = (outcome: Outcome) => {
  const builder: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq', 'order', 'limit', 'abortSignal']) {
    builder[m] = () => builder;
  }
  builder.maybeSingle = async () => {
    if ('abort' in outcome) throw new DOMException('The operation was aborted.', 'AbortError');
    return outcome;
  };
  return { from: () => builder };
};

const PRELUDE = `
import { PROBE_FAILED } from '${join(ROOT, 'src/lib/afProbe.ts')}';
type ProbeFailed = typeof PROBE_FAILED;
type PersistedChat = any;
let supabase: any = null;
const setClient = (c: any) => { supabase = c; };
const ready = () => !!supabase;
`;

const lifted = await liftSymbols(
  CHAT_SYNC,
  [
    { header: 'const READ_TIMEOUT_MS =' , endsWith: /READ_TIMEOUT_MS = \d+;$/ },
    // Explicit terminator: liftSymbols' default heuristic keys on `function `, so an `async
    // function ` header falls through to the const/arrow form and never finds its `};`.
    { header: 'export async function fetchChatTranscript', endsWith: /^\}$/ },
  ],
  ['fetchChatTranscript', 'setClient'],
  PRELUDE,
);
const fetchChatTranscript = lifted.fetchChatTranscript as (id: string) => Promise<unknown>;
const setClient = lifted.setClient as (c: unknown) => void;

const TRANSCRIPT = { v: 1, msgs: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] };

// ── 1. THE DISCRIMINATION ITSELF, against the real function ──────────────────────────────────────
{
  setClient(makeClient({ data: null, error: { message: 'FetchError: network request failed' } }));
  const failed = await fetchChatTranscript('c1');
  check('a FAILED read returns PROBE_FAILED — never null', isProbeFailure(failed),
    `got ${JSON.stringify(failed)} — a failed read is indistinguishable from "the server has none"`);
  check('…and it is the REAL sentinel by identity, not a look-alike object', failed === PROBE_FAILED);

  setClient(makeClient({ data: null, error: null }));
  check('a genuine ABSENCE (no row) returns null — the server answered',
    (await fetchChatTranscript('c1')) === null);

  setClient(makeClient({ data: { transcript: null }, error: null }));
  check('a row whose transcript column is null returns null (legacy chat)',
    (await fetchChatTranscript('c1')) === null);

  setClient(makeClient({ data: { transcript: TRANSCRIPT }, error: null }));
  check('a SUCCESSFUL read returns the transcript', (await fetchChatTranscript('c1')) === TRANSCRIPT);

  setClient(null);
  check('no client at all is UNKNOWN, not an empty chat', isProbeFailure(await fetchChatTranscript('c1')));

  // A read that never settles is not an empty answer either: the await is bounded, and an aborted
  // read REJECTS rather than resolving, which must still be classified as a failure.
  setClient(makeClient({ abort: true }));
  check('an ABORTED/rejected read is PROBE_FAILED, not a silent null',
    isProbeFailure(await fetchChatTranscript('c1')));
}

// ── 2. THE CONSEQUENCE — the guard that actually prevents the data loss ──────────────────────────
// This is the half that matters: the discrimination above is only worth having if it survives the
// composition. Real mergeOne → real pickTranscript → real mayPromoteTranscript.
{
  const localShort = { v: 1, msgs: TRANSCRIPT.msgs.slice(0, 1) };
  const merged = mergeOne(
    { id: 'c1', ts: 1000, tRev: 1000, transcript: localShort },
    { id: 'c1', ts: 5000, tRev: 5000 },
  );
  check('SETUP the server reports newer activity, so the local copy is marked stale',
    merged.txStale === true);

  // THE DEFECT'S EXACT SCENARIO.
  setClient(makeClient({ data: null, error: { message: 'JWT expired' } }));
  const onFailure = await pickTranscript<any>(
    merged.transcript, !!merged.txStale,
    async () => (await fetchChatTranscript('c1')) as any,
  );
  check('FAILED read + stale local → the user still SEES their conversation (never a blank chat)',
    onFailure.transcript === merged.transcript);
  check('FAILED read + stale local → the copy is NOT verified',
    onFailure.verified === false);
  check('THE FIX: an unverified copy may NOT be promoted — txStale survives, so the stale transcript '
      + 'stays unpushable and the newer server copy is never overwritten',
    mayPromoteTranscript(onFailure) === false,
    'promoting here clears txStale via withFreshTranscript, which is what destroyed the conversation');

  // The three outcomes that MUST still promote, so the fix cannot be "never promote anything".
  setClient(makeClient({ data: { transcript: TRANSCRIPT }, error: null }));
  const onServer = await pickTranscript<any>(
    merged.transcript, !!merged.txStale,
    async () => (await fetchChatTranscript('c1')) as any,
  );
  check('server ANSWERED with a newer transcript → it wins and IS promoted',
    onServer.transcript === TRANSCRIPT && mayPromoteTranscript(onServer) === true);

  setClient(makeClient({ data: { transcript: null }, error: null }));
  const onLegacy = await pickTranscript<any>(
    merged.transcript, !!merged.txStale,
    async () => (await fetchChatTranscript('c1')) as any,
  );
  check('server ANSWERED "I have none" → the local copy is shown AND promoted (nothing to lose to)',
    onLegacy.transcript === merged.transcript && mayPromoteTranscript(onLegacy) === true);

  let asked = false;
  const trusted = await pickTranscript<any>(TRANSCRIPT, false, async () => { asked = true; return null; });
  check('a TRUSTED local copy still opens instantly without consulting the server',
    asked === false && trusted.transcript === TRANSCRIPT && mayPromoteTranscript(trusted) === true);
}

// ── 3. MUTATION PROOFS — re-introduce each half of the defect, watch this file catch it ──────────
// Executed here rather than described, per §G.9.4: a check no mutation can turn red is decoration.
{
  // MUT-1: the original line. `if (error || !data) return null` — failure collapses into absence.
  const oldFetch = async (outcome: { data: unknown; error: unknown }) => {
    const { data, error } = outcome;
    if (error || !data) return null;
    return (data as { transcript?: unknown }).transcript ?? null;
  };
  const oldOnFailure = await oldFetch({ data: null, error: { message: 'network' } });
  mutation('the pre-fix fetch (`if (error || !data) return null`) is REJECTED by assertion 1',
    isProbeFailure(oldOnFailure) === false && oldOnFailure === null);

  // MUT-2: the discrimination survives the fetch but is thrown away in pickTranscript's branch.
  const badPick = async (held: any, _stale: boolean, fetch: () => Promise<any>) => {
    const server = await fetch();
    if (server != null && !isProbeFailure(server)) return { transcript: server, verified: true };
    return { transcript: held ?? null, verified: true };   // ← collapses UNKNOWN into "none"
  };
  const mutated = await badPick({ msgs: [1] }, true, async () => PROBE_FAILED);
  mutation('a pickTranscript that collapses UNKNOWN into "none" is REJECTED by the non-promotion assertion',
    mayPromoteTranscript(mutated as any) === true
    && mayPromoteTranscript({ transcript: { msgs: [1] }, verified: false } as any) === false);

  // MUT-3: the predicate itself weakened to ignore provenance.
  const badPromote = <T,>(p: { transcript: T | null; verified: boolean }) => p.transcript != null;
  mutation('a mayPromoteTranscript that ignores `verified` is REJECTED (it promotes the unverified copy)',
    badPromote({ transcript: { msgs: [1] }, verified: false }) === true
    && mayPromoteTranscript({ transcript: { msgs: [1] }, verified: false } as any) === false);
}

// ── 3b. REACHABILITY — the guard has to be ASKED, not merely correct ─────────────────────────────
// Found while proving the fix above, and strictly the more serious half. `openSaved` in
// src/app/agent.tsx read `entry?.transcript ?? null` and called hydrateTranscript ONLY when the
// transcript was absent — never when it was present-but-STALE. So on the one path that actually
// opens a saved chat, mergeOne marked the copy stale, pickTranscript stood ready to prefer the
// server, and nobody ever asked: the user was shown the SHORTER conversation, and the first new turn
// cleared the flag (capture → withFreshTranscript) and pushed that truncated view over the server's
// longer one. A correct guard nothing consults is not a guard, and no test of chatMerge alone can
// see it — which is why this assertion is about the CALL SITE.
{
  const agent = readFileSync(join(ROOT, 'src/app/agent.tsx'), 'utf8');
  check('REACHABILITY openSaved treats a STALE held transcript as not-held, so the server is consulted',
    /const heldStale = [^\n]*txStale[\s\S]{0,200}?heldStale \? null : \(entry\?\.transcript/.test(agent),
    'openSaved short-circuits on a present-but-stale transcript — the txStale mechanism never engages');
  check('REACHABILITY …and it still hydrates when there is no local copy at all',
    /if \(!t && entryId\) t = await hydrateTranscript\(entryId\)/.test(agent));
}

// ── 4. WIRING — the fix has to be the one production actually runs ───────────────────────────────
// Deliberately secondary to the executed assertions above, and narrow: it pins only that the store
// routes write-back through the predicate, which is the one thing this file cannot execute (the
// decision lives inside a React closure over historyRef/setHistory).
{
  const store = readFileSync(STORE, 'utf8');
  check('WIRING store.tsx gates the transcript write-back on mayPromoteTranscript(...)',
    /if \(mayPromoteTranscript\(picked\)/.test(store),
    'hydrateTranscript must not re-derive the promotion rule inline — it drifts, and it cannot be executed');
  check('WIRING store.tsx propagates PROBE_FAILED out of its fetchServer callback',
    /isProbeFailure\(fetched\)[\s\S]{0,40}return PROBE_FAILED/.test(store),
    'mapping a failed read onto null inside the callback rebuilds the exact conflation');
  const sync = readFileSync(CHAT_SYNC, 'utf8');
  check('WIRING chatSync.ts bounds its reads (a read that never settles is not an empty answer)',
    /abortSignal\(/.test(sync) && /READ_TIMEOUT_MS/.test(sync));
}

console.log(failures === 0
  ? '\nA failed transcript fetch is distinguishable from an empty one, and cannot be promoted'
  : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
