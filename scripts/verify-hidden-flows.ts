// Barrier: A FAILED STEP IS NOT A FINISHED STEP — the small flows in src/lib/flowState.ts, RUN.
//
// Owner 2026-11-10: «find all of the implicit state machines … fix everything». Each flow below used to be loose
// booleans plus an `await` nobody guarded, and each had a real bug a user could hit:
//   1. Google sign-in failed on the live site  → the visitor was signed in as a made-up «User / user@gmail.com».
//   2. The in-app ad page arrived after 12 s   → the «couldn't load» cover stayed on top of a loaded page;
//      a failed ad lookup span forever, and a database error read as «Listing not found.».
//   3. The map's read failed for a new view    → the pill kept the previous view's count.
//   4. An AI chat turn threw                   → the «searching…» row and the busy composer stayed forever.
//   5. A shared-search card failed to load     → it gave up after one try; a double tap imported the chat twice.
// And the second pass (the reviewer robot's eight findings on that work, same day):
//   6. A failed turn answered in the INTERFACE language, not the turn's; a refine that never landed left its
//      «round done» receipt, so the buttons were gone; the ad page's 12 s clock ran during the LOOKUP; a failed
//      lookup / Google sign-in was not reported; a shared link or a map view that could not be read said nothing.
//
// This file RUNS the real code (the pure functions directly, the screen handlers lifted out of their components
// with scripts/lib/liftSymbols.ts) and re-breaks each one to prove the check goes RED. No source-text matching
// decides a verdict except the last WIRING section, which only asks «does the screen still call the function».
//
//   node --experimental-strip-types scripts/verify-hidden-flows.ts   (in `npm test`, discovered by name)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { liftSymbols } from './lib/liftSymbols.ts';
import { stripCommentsAndStrings } from './lib/stripComments.ts';

const root = join(import.meta.dirname, '..');
const FLOW = join(root, 'src/lib/flowState.ts');
const AUTH = join(root, 'src/components/AuthModal.tsx');
const AGENT = join(root, 'src/app/agent.tsx');
const REMOTE = join(root, 'src/data/remote.ts');
const flowSrc = readFileSync(FLOW, 'utf8');
const authSrc = readFileSync(AUTH, 'utf8');
const agentSrc = readFileSync(AGENT, 'utf8');
const remoteSrc = readFileSync(REMOTE, 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
/** A mutation proof: the same predicate, run on deliberately broken code, must come back RED (`caught`). */
const mustCatch = (label: string, caught: boolean, detail = '') => check(`MUTATION — ${label}`, caught, detail);

/** A broken copy of a real file. Throws when the anchor is gone, so a drifted mutant can never pass as a proof. */
const mutantFile = (src: string, from: string, to: string, name: string): string => {
  if (!src.includes(from)) throw new Error(`mutation anchor missing in ${name}:\n${from}`);
  const f = join(mkdtempSync(join(tmpdir(), 'ezhalah-flows-mut-')), name);
  writeFileSync(f, src.replace(from, to));
  return f;
};

// ═══ A. THE PURE DECISIONS ═══════════════════════════════════════════════════════════════════════════════════════
type Flow = typeof import('../src/lib/flowState.ts');
const loadFlow = async (file: string): Promise<Flow> => (await import(pathToFileURL(file).href)) as Flow;

/** Every rule, as a named boolean, computed by running `f`. The real module must make all of them true. */
const rules = async (f: Flow): Promise<Record<string, boolean>> => {
  const status = { id: 's1', role: 'status' };
  const landed = { id: 's1', role: 'results' };
  const other = { id: 'u1', role: 'user' };
  const bubble = { id: 'b1', role: 'agent' };
  const run = { cancelled: false };

  const latch = { current: false };
  let ran = 0;
  let release!: () => void;
  const first = f.oneAtATime(latch, () => new Promise<string>((res) => { ran++; release = () => res('one'); }));
  const second = await f.oneAtATime(latch, async () => { ran++; return 'two'; });
  release();
  const firstValue = await first;
  const afterThrow = { current: false };
  await f.oneAtATime(afterThrow, async () => { throw new Error('boom'); }).catch(() => undefined);

  return {
    'google: a live backend that failed is «failed», never the pretend account':
      f.oauthOutcome({ error: 'x' }, true) === 'failed' && f.oauthOutcome(null, true) === 'failed' && f.oauthOutcome(undefined, true) === 'failed',
    'google: the pretend account exists only with no backend at all': f.oauthOutcome({ error: 'x' }, false) === 'preview',
    'google: a real user signs in, a redirect waits': f.oauthOutcome({ user: { id: 1 } }, true) === 'signed-in' && f.oauthOutcome({ redirected: true }, true) === 'redirected',
    'frame: a page that arrives after the timeout is shown, not covered': f.frameNext(f.frameNext('loading', 'timeout'), 'load') === 'loaded',
    'frame: a late timer or error never covers a page that loaded': f.frameNext('loaded', 'timeout') === 'loaded' && f.frameNext('loaded', 'error') === 'loaded',
    'frame: a page that never arrives becomes an error (no endless spinner)': f.frameNext('loading', 'timeout') === 'error' && f.frameNext('loading', 'error') === 'error',
    'frame: reload starts over from any state': (['loading', 'loaded', 'error'] as const).every((s) => f.frameNext(s, 'reload') === 'loading'),
    'frame clock: it does not run while the ad is still being looked up': f.frameTimerRuns('loading', false) === false,
    'frame clock: it runs for a frame on screen that is still loading, and only then':
      f.frameTimerRuns('loading', true) === true && !f.frameTimerRuns('loaded', true) && !f.frameTimerRuns('error', true),
    'map pill: a failed read is «failed» (try again), never a number and never nothing': f.pillCount('unknown') === 'failed',
    'map pill: a real read is summed, and a real zero stays zero': f.pillCount([{ n: 2 }, { n: 5 }]) === 7 && f.pillCount([]) === 0,
    'chat: a failed turn swaps its «searching» row for the failure bubble':
      JSON.stringify(f.failedTurnMsgs([other, status], 's1', bubble)) === JSON.stringify([other, bubble]),
    'chat: a reply that already landed under that id is kept':
      JSON.stringify(f.failedTurnMsgs([other, landed], 's1', bubble)) === JSON.stringify([other, landed, bubble]),
    'chat: only the turn that is still current may be failed':
      f.mayFailTurn(run, run) && !f.mayFailTurn(run, { cancelled: false }) && !f.mayFailTurn(run, null) && !f.mayFailTurn({ cancelled: true }, null),
    'chat: a cancelled turn is never failed': (() => { const c = { cancelled: true }; return f.mayFailTurn(c, c) === false; })(),
    'refine: one that never landed takes its receipt off that turn only':
      JSON.stringify(f.withoutReceipt({ a: 1, b: 2 }, 'a')) === JSON.stringify({ b: 2 }) && (() => { const r = { b: 2 }; return f.withoutReceipt(r, 'a') === r; })(),
    'shared card: it has given up only after the last retry': [0, 1, 2, 3].every((a) => !f.sharedCardGaveUp(a)) && f.sharedCardGaveUp(4),
    'shared chat: a read that FAILED with no search to open asks to try again (never a silent home page)': f.afterSharedChatRead('failed', false) === 'retry-card',
    'shared chat: a chat that was read opens; a search still opens without it; a chat that is gone stays put':
      f.afterSharedChatRead('ok', false) === 'open-chat' && f.afterSharedChatRead('ok', true) === 'open-chat'
      && f.afterSharedChatRead('failed', true) === 'open-search' && f.afterSharedChatRead('absent', true) === 'open-search' && f.afterSharedChatRead('absent', false) === 'stay',
    'shared card: retries a few times, then stops': [0, 1, 2, 3].every((a) => { const ms = f.sharedCardRetryMs(a); return typeof ms === 'number' && ms >= 1000; })
      && f.sharedCardRetryMs(4) === null && f.sharedCardRetryMs(-1) === null && f.sharedCardRetryMs(1.5) === null,
    'one at a time: a second call while the first runs does nothing': ran === 1 && second === undefined && firstValue === 'one',
    'one at a time: the gate opens again after the first finishes': latch.current === false,
    'one at a time: the gate opens again after a throw': afterThrow.current === false,
  };
};

const realFlow = await loadFlow(FLOW);
const realRules = await rules(realFlow);
for (const [label, ok] of Object.entries(realRules)) check(label, ok);

/** Break flowState.ts one way, re-run the SAME rules on the broken module, and require the named rule to fail. */
const flowMutant = async (what: string, rule: string, from: string, to: string) => {
  if (!(rule in realRules)) throw new Error(`no such rule: ${rule}`);
  const broken = await rules(await loadFlow(mutantFile(flowSrc, from, to, 'flowState.mts')));
  mustCatch(what, broken[rule] === false, `the broken copy still passed «${rule}»`);
};
await flowMutant('a failed Google sign-in falling through to the pretend account (the bug verbatim)',
  'google: a live backend that failed is «failed», never the pretend account',
  "return backendLive ? 'failed' : 'preview';", "return 'preview';");
await flowMutant('the timeout covering a page that then arrived (the bug verbatim)',
  'frame: a page that arrives after the timeout is shown, not covered',
  "if (e === 'load') return 'loaded';", "if (e === 'load') return s === 'error' ? 'error' : 'loaded';");
await flowMutant('a late timer covering a loaded page',
  'frame: a late timer or error never covers a page that loaded',
  "if (s === 'loaded') return 'loaded';", '');
await flowMutant('a failed map read keeping a number',
  'map pill: a failed read is «failed» (try again), never a number and never nothing',
  "if (rows === 'unknown') return 'failed';", "if (rows === 'unknown') return 0;");
await flowMutant('the 12 s clock running during the ad lookup (the bug verbatim)',
  'frame clock: it does not run while the ad is still being looked up',
  "return s === 'loading' && frameOnScreen;", "return s === 'loading';");
await flowMutant('the 12 s clock never running at all',
  'frame clock: it runs for a frame on screen that is still loading, and only then',
  "return s === 'loading' && frameOnScreen;", 'return false;');
await flowMutant('a refine that never landed keeping its receipt',
  'refine: one that never landed takes its receipt off that turn only',
  'delete next[msgId];', '');
await flowMutant('the shared card never admitting it gave up',
  'shared card: it has given up only after the last retry',
  'return sharedCardRetryMs(attempt) === null;', 'return false;');
await flowMutant('a shared chat that could not be read leaving a silent home page (the bug verbatim)',
  'shared chat: a read that FAILED with no search to open asks to try again (never a silent home page)',
  "return read === 'failed' ? 'retry-card' : 'stay';", "return 'stay';");
await flowMutant('the failure bubble deleting a reply that already landed',
  'chat: a reply that already landed under that id is kept',
  "!(x.id === statusId && x.role === 'status')", '!(x.id === statusId)');
await flowMutant('a cancelled turn being failed anyway',
  'chat: a cancelled turn is never failed',
  'return !run.cancelled && current === run;', 'return current === run;');
await flowMutant('an old turn failing the new one',
  'chat: only the turn that is still current may be failed',
  'return !run.cancelled && current === run;', 'return !run.cancelled;');
await flowMutant('the shared card retrying forever',
  'shared card: retries a few times, then stops',
  'attempt < SHARED_CARD_WAITS_MS.length ? SHARED_CARD_WAITS_MS[attempt] : null', 'attempt < SHARED_CARD_WAITS_MS.length ? SHARED_CARD_WAITS_MS[attempt] : 12000');
await flowMutant('a double tap running twice',
  'one at a time: a second call while the first runs does nothing',
  'if (latch.current) return undefined;', '');
await flowMutant('the gate staying shut after a throw',
  'one at a time: the gate opens again after a throw',
  'try { return await fn(); } finally { latch.current = false; }', 'const v = await fn(); latch.current = false; return v;');

// ═══ B. THE GOOGLE BUTTON, LIFTED OUT OF AuthModal AND PRESSED ═══════════════════════════════════════════════════
type GoogleBus = { result: unknown; throws: boolean; live: boolean; calls: number; done: unknown[]; steps: string[]; errs: string[]; reported: string[] };
const gg = globalThis as unknown as { __google: GoogleBus };
const GOOGLE_PRELUDE = [
  `import { oauthOutcome, oneAtATime } from ${JSON.stringify(pathToFileURL(FLOW).href)};`,
  'type AuthUser = any;',
  'const bus: any = (globalThis as any).__google;',
  'const isBackendLive: boolean = bus.live;',
  'const googleBusyRef = { current: false };',
  'const signInWithProvider = async (_p: string): Promise<any> => { bus.calls++; if (bus.throws) throw new Error("popup blocked"); return bus.result; };',
  'const done = (u: any) => { bus.done.push(u); };',
  'const setStep = (s: string) => { bus.steps.push(s); };',
  'const setOauthErr = (e: string) => { bus.errs.push(e); };',
  'const t = (k: string) => k;',
  'const reportError = (e: unknown, ctx: any) => { bus.reported.push(`${ctx.source}: ${(e as Error).message}`); };',
].join('\n');
const FALLBACK = { method: 'google', initials: 'U', name: 'User', sub: 'user@gmail.com' };
const pressGoogle = async (file: string, o: { result?: unknown; throws?: boolean; live: boolean; twice?: boolean }): Promise<GoogleBus> => {
  gg.__google = { result: o.result, throws: !!o.throws, live: o.live, calls: 0, done: [], steps: [], errs: [], reported: [] };
  const m = await liftSymbols(file,
    [{ header: '  const onGoogle = (fallback: AuthUser) => oneAtATime(googleBusyRef, async () => {', endsWith: /^  \}\);$/ }],
    ['onGoogle'], GOOGLE_PRELUDE) as { onGoogle: (f: unknown) => Promise<unknown> };
  const a = m.onGoogle(FALLBACK);
  if (o.twice) await m.onGoogle(FALLBACK);
  await a;
  return gg.__google;
};
/** The rule the user feels: on the live site a failed Google sign-in signs NOBODY in and says so. */
const failedGoogleIsHonest = (b: GoogleBus) => b.done.length === 0 && b.errs.length === 1 && b.steps.includes('main');

/** A failure we never hear about cannot be fixed: each failed sign-in is reported ONCE, with what went wrong. */
const reportedOnce = (b: GoogleBus, what: string) => b.reported.length === 1 && b.reported[0] === `AuthModal.google: ${what}`;
const RETURNED_ERR = { result: { error: 'provider disabled' }, live: true };
const THROWN_ERR = { throws: true, live: true };
{
  const b = await pressGoogle(AUTH, RETURNED_ERR);
  check('google button: live site + Google returns an error → nobody is signed in, the error is shown', failedGoogleIsHonest(b));
  check('google button: that returned error is reported once', reportedOnce(b, 'provider disabled'), JSON.stringify(b.reported));
}
{
  const b = await pressGoogle(AUTH, THROWN_ERR);
  check('google button: live site + the call throws → nobody is signed in, the error is shown', failedGoogleIsHonest(b));
  check('google button: that throw is reported once (not twice)', reportedOnce(b, 'popup blocked'), JSON.stringify(b.reported));
}
{
  const b = await pressGoogle(AUTH, { result: { user: { name: 'Real Person' } }, live: true });
  check('google button: a real Google user IS signed in (the fix is not a broken button)',
    b.done.length === 1 && (b.done[0] as { name: string }).name === 'Real Person' && b.errs.length === 0 && b.reported.length === 0);
}
{
  const b = await pressGoogle(AUTH, { result: { redirected: true }, live: true });
  check('google button: a redirect signs nobody in here, shows no error and reports nothing', b.done.length === 0 && b.errs.length === 0 && b.reported.length === 0);
}
{
  const b = await pressGoogle(AUTH, { result: { error: 'no backend' }, live: false });
  check('google button: the no-backend design preview still gets its pretend account (and is not reported as a failure)',
    b.done.length === 1 && b.done[0] === FALLBACK && b.reported.length === 0);
}
{
  const b = await pressGoogle(AUTH, { result: { user: { name: 'Real Person' } }, live: true, twice: true });
  check('google button: a double tap opens Google once', b.calls === 1 && b.done.length === 1, `calls=${b.calls} done=${b.done.length}`);
}
mustCatch('the Google button signing in the pretend «User» when the live sign-in failed (the bug verbatim)',
  !failedGoogleIsHonest(await pressGoogle(
    mutantFile(authSrc, 'const outcome = oauthOutcome(r, isBackendLive);', 'const outcome = oauthOutcome(r, false);', 'AuthModal.tsx'),
    { result: { error: 'provider disabled' }, live: true })));
mustCatch('the Google button swallowing a failure without telling the user',
  !failedGoogleIsHonest(await pressGoogle(
    mutantFile(authSrc, "    setOauthErr(t('Google sign-in isn’t available right now. Please try another method.'));\n  });", '  });', 'AuthModal.tsx'),
    { result: { error: 'provider disabled' }, live: true })));

mustCatch('a Google sign-in that returned an error going unreported',
  !reportedOnce(await pressGoogle(
    mutantFile(authSrc, "    if (!thrown) reportError(new Error(r?.error ?? 'google sign-in failed'), { source: 'AuthModal.google' });\n", '', 'AuthModal.tsx'),
    RETURNED_ERR), 'provider disabled'));
mustCatch('a Google sign-in that threw going unreported',
  !reportedOnce(await pressGoogle(
    mutantFile(authSrc, "      reportError(e, { source: 'AuthModal.google' });\n", '', 'AuthModal.tsx'),
    THROWN_ERR), 'popup blocked'));
mustCatch('a Google sign-in that threw being reported twice',
  !reportedOnce(await pressGoogle(
    mutantFile(authSrc, "    if (!thrown) reportError(new Error(", '    reportError(new Error(', 'AuthModal.tsx'),
    THROWN_ERR), 'popup blocked'));

// ═══ C. A CHAT TURN THAT THROWS, LIFTED OUT OF agent.tsx ═════════════════════════════════════════════════════════
type TurnBus = { msgs: { id: string; role: string; text?: string }[]; busy: boolean; current: unknown; reported: string[] };
const gt = globalThis as unknown as { __turn: TurnBus };
const TURN_PRELUDE = [
  `import { failedTurnMsgs, mayFailTurn } from ${JSON.stringify(pathToFileURL(FLOW).href)};`,
  'type Run = any; type ChatMsg = any; type Locale = any;',
  'const bus: any = (globalThis as any).__turn;',
  'const runRef = { get current() { return bus.current; }, set current(v: any) { bus.current = v; } };',
  'const reportError = (_e: unknown, ctx: any) => { bus.reported.push(ctx.source); };',
  'const setMsgs = (f: any) => { bus.msgs = f(bus.msgs); };',
  'const setBusy = (v: boolean) => { bus.busy = v; };',
  'const uid = () => "bubble";',
  'const locale: string = "ar";',
  'const nextVariant = (a: string[]) => a[0];',
  'const SEARCH_FAILED_EN = ["failed-en"]; const SEARCH_FAILED_AR = ["failed-ar"];',
].join('\n');
const failTurnOn = async (file: string, o: { cancelled?: boolean; replaced?: boolean; reply?: 'ar' | 'en' }): Promise<TurnBus> => {
  const run = { cancelled: !!o.cancelled };
  gt.__turn = { msgs: [{ id: 'u', role: 'user' }, { id: 'st', role: 'status' }], busy: true, current: o.replaced ? { cancelled: false } : run, reported: [] };
  const m = await liftSymbols(file,
    [{ header: '  const failTurn = (run: Run, statusId: string, err: unknown, where: string, replyLocale: Locale) => {', endsWith: /^  \};$/ }],
    ['failTurn'], TURN_PRELUDE) as { failTurn: (r: unknown, id: string, e: unknown, w: string, l: string) => void };
  m.failTurn(run, 'st', new Error('network'), 'agent.send', o.reply ?? 'ar');
  return gt.__turn;
};
/** The rule the user feels: after a turn throws, the spinner row is gone, a failure bubble is there, typing works. */
const turnIsReleased = (b: TurnBus) =>
  b.busy === false && b.current === null && !b.msgs.some((m) => m.role === 'status') && b.msgs.some((m) => m.role === 'agent' && m.text === 'failed-ar');

{
  const b = await failTurnOn(AGENT, {});
  check('chat: a turn that throws ends — no «searching» row, a failure bubble, the composer free', turnIsReleased(b), JSON.stringify(b));
  check('chat: the error is still reported (catching it must not hide it from Sentry)', b.reported.length === 1 && b.reported[0] === 'agent.send');
}
{
  const b = await failTurnOn(AGENT, { cancelled: true });
  check('chat: a turn the user stopped is left alone (no failure bubble on a Stop)', b.msgs.length === 2 && b.busy === true && b.reported.length === 1);
}
{
  const b = await failTurnOn(AGENT, { replaced: true });
  check('chat: an old turn that throws late does not end the NEW turn', b.busy === true && b.current !== null && !b.msgs.some((m) => m.role === 'agent'));
}
/** CHAT LANGUAGE AND UI LANGUAGE ARE SEPARATE: the interface in this harness is Arabic (`locale = "ar"`). */
const failedIn = (b: TurnBus) => b.msgs.find((m) => m.role === 'agent')?.text;
check('chat: an ENGLISH turn that fails says so in English, even with the interface in Arabic', failedIn(await failTurnOn(AGENT, { reply: 'en' })) === 'failed-en');
check('chat: an Arabic turn that fails says so in Arabic', failedIn(await failTurnOn(AGENT, { reply: 'ar' })) === 'failed-ar');
mustCatch('a failed English turn answered in the interface language (the bug verbatim)',
  failedIn(await failTurnOn(mutantFile(agentSrc, "text: replyLocale === 'en' ? nextVariant(SEARCH_FAILED_EN)", "text: locale === 'en' ? nextVariant(SEARCH_FAILED_EN)", 'agent.tsx'), { reply: 'en' })) !== 'failed-en');
mustCatch('the composer staying busy forever after a turn throws (the bug verbatim)',
  !turnIsReleased(await failTurnOn(mutantFile(agentSrc, "    setBusy(false);\n    runRef.current = null;\n  };\n  const runRefine = async (", "    runRef.current = null;\n  };\n  const runRefine = async (", 'agent.tsx'), {})));
mustCatch('the «searching» row staying on screen after a turn throws',
  !turnIsReleased(await failTurnOn(mutantFile(agentSrc, 'setMsgs((m) => failedTurnMsgs(m, statusId, ', 'setMsgs((m) => m.concat(', 'agent.tsx'), {})));

// ═══ C2. A REFINE THAT NEVER LANDED, LIFTED OUT OF agent.tsx AND RUN ════════════════════════════════════════════
// runRefine itself, with the search stubbed: it throws, it is stopped before any result, or it answers. The caller
// (an Advanced Filter round) put a «round done» receipt on the turn it started from; onNotLanded is how it hears
// that the round never produced anything, so the receipt comes off and that turn's buttons come back.
type RefineBus = { search: 'throws' | 'stopped' | 'answers'; notLanded: number; failed: string[] };
const gr = globalThis as unknown as { __refine: RefineBus };
const REFINE_PRELUDE = [
  'type SearchQuery = any; type GuidedFacet = any;',
  'const bus: any = (globalThis as any).__refine;',
  'const pendingRefineRef: any = { current: null }; const refineMsgIdRef: any = { current: null }; const searchingAtRef: any = { current: {} };',
  'const runRef: any = { current: null };',
  'const finalizeReveal = () => {}; const setStopped = (_: boolean) => {}; const setBusy = (_: boolean) => {}; const setMsgs = (_: any) => {};',
  'const toBottom = () => {}; const easeToMsgTop = (_a: string, _b: number) => {}; const ensureChatId = () => "chat";',
  'const applyRefinement = (q: any) => q;',
  'let n = 0; const uid = () => `id${n++}`;',
  'const makeRun = () => ({ cancelled: false, ac: { signal: null } });',
  'const runQuery = async () => { if (bus.search === "throws") throw new Error("network"); if (bus.search === "stopped") runRef.current.cancelled = true; return { query: null }; };',
  // Everything after the search has landed is the reply itself (covered elsewhere): the harness stops there.
  'const prefetchNarrowing = () => { throw new Error("reached-the-reply"); };',
  'const failTurn = (_r: any, _id: string, e: any, where: string, l: string) => { bus.failed.push(`${where}:${l}:${e.message}`); };',
  'const detectLocale = (t: string) => (/[a-z]/i.test(t) ? "en" : /[\u0600-\u06FF]/.test(t) ? "ar" : null);',
  'const locale: string = "ar";',
].join('\n');
const refine = async (file: string, search: RefineBus['search'], label = 'شقة'): Promise<RefineBus> => {
  gr.__refine = { search, notLanded: 0, failed: [] };
  const m = await liftSymbols(file, [{ header: '  const runRefine = async (', endsWith: /^  \};$/ }], ['runRefine'], REFINE_PRELUDE) as
    { runRefine: (q: unknown, d: string, v: string, l: string, o: { onNotLanded: () => void }) => Promise<void> };
  await m.runRefine({}, 'd', 'v', label, { onNotLanded: () => { gr.__refine.notLanded++; } });
  return gr.__refine;
};
{
  const b = await refine(AGENT, 'throws');
  check('refine: a search that throws tells its caller once (the receipt comes off) and the turn is failed', b.notLanded === 1 && b.failed.length === 1 && b.failed[0] === 'agent.runRefine:ar:network', JSON.stringify(b));
}
check('refine: a round stopped before any result tells its caller once', (await refine(AGENT, 'stopped')).notLanded === 1);
{
  const b = await refine(AGENT, 'answers');
  check('refine: a search that ANSWERED is never «not landed» (a real round keeps its receipt)', b.notLanded === 0 && b.failed[0]?.endsWith('reached-the-reply') === true, JSON.stringify(b));
}
check('refine: a failed refine typed in English fails in English', (await refine(AGENT, 'throws', 'apartment')).failed[0] === 'agent.runRefine:en:network');
mustCatch('a refine that threw leaving its «round done» receipt behind (the bug verbatim)',
  (await refine(mutantFile(agentSrc, '    finally { if (!landed) opts?.onNotLanded?.(); }\n', '', 'agent.tsx'), 'throws')).notLanded !== 1);
mustCatch('a stopped refine counted as landed',
  (await refine(mutantFile(agentSrc, '    if (run.cancelled) return;\n    landed = true;\n', '    landed = true;\n    if (run.cancelled) return;\n', 'agent.tsx'), 'stopped')).notLanded !== 1);
mustCatch('a refine that answered taking a real round’s receipt off',
  (await refine(mutantFile(agentSrc, '    finally { if (!landed) opts?.onNotLanded?.(); }\n', '    finally { opts?.onNotLanded?.(); }\n', 'agent.tsx'), 'answers')).notLanded !== 0);

// ═══ D. AN AD LOOKUP WHOSE READ FAILED IS NOT «NO SUCH AD» (remote.ts fetchListingById) ══════════════════════════
const LOOKUP_PRELUDE = `
type Listing = Record<string, any>;
const listSelectFor = () => 'id';
const DEEPLINK_TABLES = ['a_residential_listings', 'b_residential_listings'];
const LISTING_CACHE = new Map<number, any>();
const finalize = (rows: any[]) => rows;
let supabase: any = null;
const __setClient = (c: any) => { supabase = c; };
`;
/** A client that RESOLVES {data,error} the way supabase-js really does — it never throws. */
const client = (answer: (table: string) => { data: unknown; error: unknown }) => ({
  from: (table: string) => {
    const api: Record<string, unknown> = {};
    api.select = () => api; api.eq = () => api;
    api.limit = async () => answer(table);
    return api;
  },
});
const lookup = async (file: string, answer: (table: string) => { data: unknown; error: unknown }): Promise<'found' | 'absent' | 'failed'> => {
  const m = await liftSymbols(file, [{ header: 'export async function fetchListingById(', endsWith: /^\}$/ }],
    ['fetchListingById', '__setClient'], LOOKUP_PRELUDE) as { fetchListingById: (id: number) => Promise<unknown>; __setClient: (c: unknown) => void };
  m.__setClient(client(answer));
  try { return (await m.fetchListingById(7)) === null ? 'absent' : 'found'; } catch { return 'failed'; }
};
const allFail = () => ({ data: null, error: { message: 'timeout' } });
const oneFails = (t: string) => (t.startsWith('a_') ? { data: null, error: { message: 'timeout' } } : { data: [], error: null });
check('ad lookup: every read failed → «failed», not «no such ad»', (await lookup(REMOTE, allFail)) === 'failed');
check('ad lookup: one read failed and no table held the ad → still «failed» (the ad may live in the table we could not read)',
  (await lookup(REMOTE, oneFails)) === 'failed');
check('ad lookup: every read answered and none held it → a genuine «no such ad»', (await lookup(REMOTE, () => ({ data: [], error: null }))) === 'absent');
check('ad lookup: one read failed but another table HOLDS the ad → the ad is served',
  (await lookup(REMOTE, (t) => (t.startsWith('a_') ? { data: null, error: { message: 'timeout' } } : { data: [{ id: 7 }], error: null }))) === 'found');
mustCatch('a failed read being reported as «Listing not found.» (the bug verbatim)',
  (await lookup(mutantFile(remoteSrc, "  if (readFailed) throw new Error('listing lookup failed');\n", '', 'remote.ts'), allFail)) !== 'failed');

// ═══ E. WIRING — the screens still CALL the functions (comments and strings stripped first) ══════════════════════
const code = (rel: string) => stripCommentsAndStrings(readFileSync(join(root, rel), 'utf8'));
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const wired = (src: { browser: string; map: string; agent: string; home: string }): Record<string, boolean> => ({
  'the ad page drives its frame through frameNext (load, error, timeout, reload)': count(src.browser, /\bframeNext\(/g) >= 4,
  'the ad page has ONE frame state (no second boolean to disagree with it)': !/\bframeError\b|\bframeLoaded\b/.test(src.browser),
  'the ad page catches a failed lookup': /findListing\([^;]*?\)\s*\.then\([\s\S]*?\.catch\(/.test(src.browser),
  'the ad page REPORTS a failed lookup': /\.catch\(\(e: unknown\) => \{\s*reportError\(e, /.test(src.browser),
  'the ad page starts its 12 s clock through frameTimerRuns': /if \(!frameTimerRuns\(frame, frameOnScreen\)\) return;/.test(src.browser) && /const frameOnScreen = IS_WEB && !resolving && !!listing;/.test(src.browser),
  'an Advanced Filter round takes its receipt back when the refine never landed': /onNotLanded: \(\) => \{[^}]*setAfReceipt\(\(r\) => withoutReceipt\(r, carry\.msgId\)\)/.test(src.agent),
  'the map offers «try again» when its read failed, and shows a count only for a number':
    /retryPinsRef\.current = \(\) => \{ void load\(\); \};/.test(src.map) && /onPress=\{\(\) => retryPinsRef\.current\?\.\(\)\}/.test(src.map)
    && /typeof pinCount === /.test(src.map) && !/pinCount !== null/.test(src.map),
  'a filter change re-reads the map through the same load (so its failure gets the same «try again»)': /\}, \[pinsKey, failed, mapReady, locale\]\);/.test(src.map),
  'the home page says so when the shared card gave up': /if \(sharedCardGaveUp\(attempt\)\) setSharedFail\(/.test(src.home),
  'opening a shared chat asks afterSharedChatRead, and a failed read shows the retry card':
    /const next = afterSharedChatRead\(/.test(src.home) && /setSharedFail\(\{ code: s\.code, /.test(src.home),
  'the home page draws the «couldn’t open — try again» card with a working button': /\{sharedFail && \(/.test(src.home) && /onPress=\{retryShared\}/.test(src.home),
  'the map pill reads a fetched view through pillCount (both failed-read lines and the paint)': count(src.map, /setPinCount\(pillCount\(rows\)\)/g) >= 3 && !/setPinCount\(rows\./.test(src.map),
  'both chat entry points hand a throw to failTurn': count(src.agent, /catch \(e\) \{ failTurn\(run, statusId, e, /g) >= 2,
  'the shared card asks sharedCardRetryMs when to retry': /\bsharedCardRetryMs\(/.test(src.home),
  'opening a shared search is one-at-a-time': /oneAtATime\(openingSharedRef,/.test(src.home),
});
const realWiring = { browser: code('src/app/browser.tsx'), map: code('src/components/AppleMap.web.tsx'), agent: code('src/app/agent.tsx'), home: code('src/app/index.tsx') };
for (const [label, ok] of Object.entries(wired(realWiring))) check(`wiring: ${label}`, ok);
mustCatch('a chat entry point losing its catch',
  wired({ ...realWiring, agent: realWiring.agent.replace(/catch \(e\) \{ failTurn\(run, statusId, e, /, 'catch (e) { void (run, statusId, e, ') })['both chat entry points hand a throw to failTurn'] === false);
mustCatch('the map pill being set from a raw sum again',
  wired({ ...realWiring, map: realWiring.map.replace('setPinCount(pillCount(', 'setPinCount(sum(') })['the map pill reads a fetched view through pillCount (both failed-read lines and the paint)'] === false);
const wiringMutant = (what: string, rule: string, part: 'browser' | 'map' | 'agent' | 'home', from: string, to: string) => {
  if (!realWiring[part].includes(from)) throw new Error(`wiring mutation anchor missing in ${part}:\n${from}`);
  mustCatch(what, wired({ ...realWiring, [part]: realWiring[part].replace(from, to) })[rule] === false);
};
wiringMutant('the failed ad lookup going unreported again', 'the ad page REPORTS a failed lookup', 'browser', 'reportError(e, ', 'void (e, ');
wiringMutant('the 12 s clock starting with the lookup again', 'the ad page starts its 12 s clock through frameTimerRuns', 'browser', 'if (!frameTimerRuns(frame, frameOnScreen)) return;', '');
wiringMutant('the round keeping its receipt after a refine that never landed', 'an Advanced Filter round takes its receipt back when the refine never landed', 'agent', 'withoutReceipt(r, carry.msgId)', 'r');
wiringMutant('the map’s «try again» doing nothing', 'the map offers «try again» when its read failed, and shows a count only for a number', 'map', 'retryPinsRef.current = () => { void load(); };', '');
wiringMutant('the shared card giving up without a word again', 'the home page says so when the shared card gave up', 'home', 'if (sharedCardGaveUp(attempt)) setSharedFail(', 'if (false) setSharedFail(');
wiringMutant('the retry card losing its button', 'the home page draws the «couldn’t open — try again» card with a working button', 'home', 'onPress={retryShared}', 'onPress={undefined}');
mustCatch('the ad page growing a second frame boolean',
  wired({ ...realWiring, browser: `${realWiring.browser}\nconst [frameError, setFrameError] = useState(false);` })['the ad page has ONE frame state (no second boolean to disagree with it)'] === false);

if (failures) { console.error(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log('\nhidden flows: every rule holds, and every mutant was caught.');
