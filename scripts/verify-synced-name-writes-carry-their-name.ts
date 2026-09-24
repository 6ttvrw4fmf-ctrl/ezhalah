// A TRANSLITERATED NAME BELONGS TO THE NAME IT WAS COMPUTED FOR — executed, not read.
//
// THE DEFECT (found 2026-09-24 by routine #8, ops_incident fingerprint
// hunter-2026-09-24:incomplete_fix:synced-name-continuation-drops-the-name-it-was-computed-for).
// `buildSyncedName()` is a network round trip — one or two `translit` edge-function invokes — and it
// had exactly TWO call sites, one guarded and one not:
//
//   src/store.tsx (the backfill effect)   setUser(u => u && u.name === synced.name ? … : u)   ✓
//   src/components/AccountMenu.tsx:173    updateUser({ ...synced, initials: initialsOf(v) })  ✗
//
// The second is the user-facing rename. Renaming twice in quick succession leaves two continuations
// in flight, and nothing ordered them, so the SLOWER one landed last and wrote its own older value
// over the newer one. MEASURED by lifting the real `persistName` and resolving the two continuations
// out of order (§A): the user last typed خالد and the store ended up holding
//     { name: أحمد, nameAr: أحمد, nameEn: translit(أحمد), initials: أ }
// — the display name AND the avatar initial reverted to a name the user had already replaced, in the
// header, the sidebar and the account menu at once, with nothing re-running to correct it.
//
// Same class as ops_incident #211/#271/#319/#341/#599/#648 — an async continuation writing state
// that belongs to a context the user has already left — and PART 4.3 shape 1 (partial): the class
// was understood and guarded at one call site of one shared function while its sibling was left
// open. Neither existing barrier could see it: verify-conversation-state-never-inherited.ts (#599)
// discovers only inside src/app/agent.tsx, and verify-suggestion-writes-carry-their-cohort.ts (#648)
// only inside src/app/index.tsx for ensureCity*/ensureDistrict* shapes. This is a third module and a
// third context — the signed-in user's identity.
//
// THE FIX is the one PART 4.3 shape 1 prescribes: the guard moved INTO the single writer both call
// sites route through (`applySyncedName` in src/store.tsx) instead of being re-typed per caller. A
// caller cannot forget a guard it does not have to write.
//
// THE SECOND AXIS, which is why fixing the first alone would have DISPLACED the symptom rather than
// removed it (§G.9 condition 7): `persistDisplayName()` fired two independent `auth.updateUser`
// requests whose ARRIVAL order at the server is not ordered either, so user_metadata could keep the
// older name and `mapSupabaseUser` rebuilt it on the next load — the name reverting on a refresh
// after the screen had already shown the new one. §D pins the serialisation that fixes it.
//
//   node --experimental-strip-types scripts/verify-synced-name-writes-carry-their-name.ts

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STORE = join(ROOT, 'src/store.tsx');
const ACC = join(ROOT, 'src/components/AccountMenu.tsx');
const AUTH = join(ROOT, 'src/lib/auth.ts');

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
// §C first — THE GUARD ITSELF. Lifted from src/store.tsx, so every later section is asserting about
// the function that actually runs on the device rather than a restatement of it.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
type Synced = { name: string; nameEn?: string; nameAr?: string; initials?: string };
type User = Record<string, unknown> & { name?: string };

const liftGuard = async (src = STORE) => {
  const { applySyncedName } = await liftSymbols(
    src,
    [{
      header: '  const applySyncedName = useCallback((synced: BilingualName & { initials?: string }) => {',
      endsWith: /^  \}, \[\]\);$/,
    }],
    ['applySyncedName'],
    // Inert scaffolding: the lifted body's only real dependency is setUser, which is routed to a
    // recorder on globalThis. useCallback is identity here — the guard is not a React concern.
    `type BilingualName = { name: string; nameEn?: string; nameAr?: string };\n` +
    `const useCallback = (f: any, _d?: unknown) => f;\n` +
    `const setUser = (fn: any) => { const g = (globalThis as any).__nameRig; g.user = fn(g.user); };\n`,
  ) as { applySyncedName: (s: Synced) => void };
  return applySyncedName;
};

const rig = () => (globalThis as any).__nameRig as { user: User | null; backend: string[] };
const setRig = (user: User | null) => {
  (globalThis as any).__nameRig = { user, backend: [] as string[] };
};

{
  const applySyncedName = await liftGuard();

  // A patch whose name is no longer the current one is DROPPED …
  setRig({ name: 'خالد', nameAr: 'خالد', initials: 'خ' });
  applySyncedName({ name: 'أحمد', nameAr: 'أحمد', nameEn: 'translit(أحمد)', initials: 'أ' });
  check('§C a synced patch for a name the user has replaced is dropped',
    rig().user?.name === 'خالد' && rig().user?.initials === 'خ',
    `user is now ${JSON.stringify(rig().user)}`);

  // … and a patch for the CURRENT name still lands. Without this, "never write anything" would pass
  // as a fix, and the bilingual backfill the feature exists for would be silently dead.
  setRig({ name: 'خالد', nameAr: 'خالد', initials: 'خ' });
  applySyncedName({ name: 'خالد', nameAr: 'خالد', nameEn: 'Khalid', initials: 'خ' });
  check('§C a synced patch for the CURRENT name is still applied',
    rig().user?.nameEn === 'Khalid',
    `user is now ${JSON.stringify(rig().user)}`);

  // A signed-out user is not written to at all.
  setRig(null);
  applySyncedName({ name: 'خالد', nameEn: 'Khalid' });
  check('§C a resolved patch does not resurrect a signed-out user', rig().user === null);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// §A — EXECUTION. The REAL persistName from AccountMenu.tsx, with the two continuations resolved out
// of order. `applySyncedName` in its prelude is the REAL guard lifted above, never a copy of it
// ([[feedback_never-test-a-copy-of-production-code]]).
// ─────────────────────────────────────────────────────────────────────────────────────────────────
const PERSIST_NAME_HEADER = '  const persistName = (v: string) => {';

const liftPersistName = async (src = ACC) => {
  const { persistName } = await liftSymbols(
    src,
    [{ header: PERSIST_NAME_HEADER, endsWith: /^  \};$/ }],
    ['persistName'],
    // Everything here is inert except applySyncedName, which is production's, and buildSyncedName,
    // which hands back a deferred so the TEST decides resolution order.
    `const __g = (globalThis as any);\n` +
    `const applySyncedName = (p: any) => __g.__liftedGuard(p);\n` +
    `const updateUser = (p: any) => { const g = __g.__nameRig; if (g.user) g.user = { ...g.user, ...p }; };\n` +
    `const persistDisplayName = (v: string) => { __g.__nameRig.backend.push(v); };\n` +
    `const scriptOf = (v: string) => (/[\\u0600-\\u06FF]/.test(v) ? 'ar' : 'en');\n` +
    `const initialsOf = (v: string) => v.trim().charAt(0).toUpperCase();\n` +
    `const buildSyncedName = (typed: string) => {\n` +
    `  let res: any;\n` +
    `  const promise = new Promise((r) => { res = () => r(scriptOf(typed) === 'ar'\n` +
    `    ? { name: typed, nameAr: typed, nameEn: 'translit(' + typed + ')' }\n` +
    `    : { name: typed, nameEn: typed, nameAr: 'translit(' + typed + ')' }); });\n` +
    `  __g.__deferred.set(typed, { resolve: res, promise });\n` +
    `  return promise;\n` +
    `};\n`,
  ) as { persistName: (v: string) => void };
  return persistName;
};

// Two renames, the OLDER transliteration resolving LAST (a cold start or a retry behind a warm one —
// ordinary latency variance, not an exotic schedule). Returns the name left on screen.
const raceTwoRenames = async (persistName: (v: string) => void, first: string, second: string) => {
  const g = globalThis as any;
  g.__deferred = new Map<string, { resolve: () => void; promise: Promise<unknown> }>();
  persistName(first);
  persistName(second);
  for (const nm of [second, first]) {            // second resolves first, first lands after
    g.__deferred.get(nm)!.resolve();
    await g.__deferred.get(nm)!.promise;
    await tick();
  }
  return rig().user as User;
};

{
  (globalThis as any).__liftedGuard = await liftGuard();
  const persistName = await liftPersistName();

  setRig({ name: 'محمد', nameAr: 'محمد', initials: 'م' });
  const after = await raceTwoRenames(persistName, 'أحمد', 'خالد');
  check('§A the name the user typed LAST survives a stale transliteration landing after it',
    after.name === 'خالد',
    `name=${String(after.name)} (expected خالد — this is the measured defect)`);
  check('§A the avatar initial is not reverted either',
    after.initials === 'خ', `initials=${String(after.initials)}`);
  check('§A no field carries the abandoned name',
    !JSON.stringify(after).includes('أحمد'), `user=${JSON.stringify(after)}`);

  // MUTATION. Re-introduce the defect in the GUARD the real persistName routes through — an
  // unconditional apply, which is exactly what `updateUser` was — and watch §A's own assertion go
  // red. The mutant is applied to production's lifted code path, not to a restatement of it.
  const unguarded = (p: Synced) => {
    const g = rig();
    if (g.user) g.user = { ...g.user, ...p };
  };
  (globalThis as any).__liftedGuard = unguarded;
  setRig({ name: 'محمد', nameAr: 'محمد', initials: 'م' });
  const mutated = await raceTwoRenames(persistName, 'أحمد', 'خالد');
  mustCatch('an unguarded apply (the shipped updateUser) lets the stale name win',
    mutated.name === 'أحمد' && mutated.initials === 'أ',
    `mutant left name=${String(mutated.name)} — the barrier would not have caught the defect`);

  // MUTATION, other polarity: a guard that never writes must NOT read as healthy.
  (globalThis as any).__liftedGuard = () => {};
  setRig({ name: 'خالد', nameAr: 'خالد', initials: 'خ' });
  await raceTwoRenames(persistName, 'خالد', 'خالد');
  mustCatch('a writer that drops EVERYTHING fails the still-applies assertion in §C',
    rig().user?.nameEn === undefined);

  (globalThis as any).__liftedGuard = await liftGuard();
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// §B — DISCOVERY, so this is a rule about the CLASS and not about the two call sites that exist
// today. Every buildSyncedName() continuation anywhere in src/ must write through the guarded
// writer and never through a raw updateUser/setUser. No allowlist: a third caller added tomorrow is
// RED until it participates.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import { readdirSync, statSync } from 'node:fs';

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
};

// From a `buildSyncedName(` occurrence, accumulate text until parentheses balance — so a
// continuation spread over several lines is read whole rather than truncated at the first newline.
const continuationAt = (src: string, at: number): string => {
  let depth = 0, i = src.indexOf('(', at);
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) {
        // include a trailing .then(...) chain if the call itself closed first
        const rest = src.slice(i + 1, i + 400);
        const m = /^\s*\.then\s*\(/.exec(rest);
        if (m) return continuationAt(src, i + 1 + m[0].length - 1);
        return src.slice(start, i + 1);
      }
    }
  }
  return src.slice(start);
};

const callSites: { file: string; text: string }[] = [];
for (const f of walk(join(ROOT, 'src'))) {
  const src = readFileSync(f, 'utf8');
  let idx = src.indexOf('buildSyncedName(');
  while (idx >= 0) {
    // Scan CODE, not prose: an import, the function's own declaration, and a line of commentary
    // that happens to name it are none of them call sites. (This barrier's own header names it too.)
    const lineStart = src.lastIndexOf('\n', idx) + 1;
    const line = src.slice(lineStart, src.indexOf('\n', idx));
    const before = src.slice(lineStart, idx);
    const isProse = before.includes('//') || /^\s*\*/.test(line);
    const isDecl = /\bfunction\s+buildSyncedName\b/.test(line);
    if (!/^\s*import\b/.test(line) && !isProse && !isDecl) {
      callSites.push({ file: f.slice(ROOT.length + 1), text: continuationAt(src, idx) });
    }
    idx = src.indexOf('buildSyncedName(', idx + 1);
  }
}

const routesThroughGuard = (text: string) =>
  /\bapplySyncedName\s*\(/.test(text) && !/\b(updateUser|setUser)\s*\(/.test(text);

// Anti-blinding: skipping prose must not cost us the real call sites. Both known ones are named
// explicitly, so a scanner that over-skips fails here instead of reporting a clean sweep of nothing.
const files = new Set(callSites.map((c) => c.file));
check('§B both known buildSyncedName call sites are discovered (the scanner is not blind)',
  callSites.length >= 2 && files.has('src/store.tsx') && files.has('src/components/AccountMenu.tsx'),
  `found ${callSites.length} in ${JSON.stringify([...files])}`);

const offenders = callSites.filter((c) => !routesThroughGuard(c.text));
check('§B every buildSyncedName continuation writes through the guarded writer',
  offenders.length === 0,
  offenders.map((o) => `${o.file}: ${o.text.replace(/\s+/g, ' ').slice(0, 160)}`).join('\n      '));

mustCatch('§B a continuation applying the patch with a raw updateUser is rejected',
  !routesThroughGuard('buildSyncedName(v).then((s) => updateUser({ ...s }))'));
mustCatch('§B a continuation applying it with a raw setUser is rejected',
  !routesThroughGuard('buildSyncedName(v).then((s) => setUser((u) => ({ ...u, ...s })))'));
check('§B a continuation routed through the guarded writer is accepted',
  routesThroughGuard('buildSyncedName(v).then((s) => applySyncedName({ ...s }))'));

// The writer the rule names must actually exist and actually compare the name it was computed for —
// otherwise §B would be satisfied by a function that merely has the right NAME.
const storeSrc = readFileSync(STORE, 'utf8');
check('§B the guarded writer exists in the store and compares the name the patch was computed for',
  /applySyncedName\s*=\s*useCallback/.test(storeSrc) && /u\.name === synced\.name/.test(storeSrc));

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// §D — THE SECOND AXIS. The backend write is serialised, so the last value CALLED is the last value
// WRITTEN. Without this the symptom moves from the screen to the next page load (§G.9 condition 7).
// ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const g = globalThis as any;
  const { persistDisplayName } = await liftSymbols(
    AUTH,
    [
      { header: 'let nameWriteQueue: Promise<unknown> = Promise.resolve();', endsWith: /;$/ },
      { header: 'let latestIntendedName: string | null = null;', endsWith: /;$/ },
      { header: 'export function persistDisplayName(v: string): void {', endsWith: /^\}$/ },
    ],
    ['persistDisplayName'],
    // A supabase whose updateUser resolves on a delay the test chooses, recording arrival order.
    `const supabase = { auth: { updateUser: (p: any) => {\n` +
    `  const g = (globalThis as any).__authRig;\n` +
    `  const v = p.data.full_name;\n` +
    `  return new Promise((r) => setTimeout(() => { g.written.push(v); r({}); }, g.delay(v)));\n` +
    `} } };\n`,
  ) as { persistDisplayName: (v: string) => void };

  // The FIRST rename's request is slow, the second's is fast. Unserialised, the slow one arrives
  // last and the server keeps the name the user already replaced.
  g.__authRig = { written: [] as string[], delay: (v: string) => (v === 'أحمد' ? 40 : 1) };
  persistDisplayName('أحمد');
  persistDisplayName('خالد');
  await new Promise((r) => setTimeout(r, 120));
  const written: string[] = g.__authRig.written;
  check('§D the LAST name called is the last name written to the backend',
    written.length > 0 && written[written.length - 1] === 'خالد',
    `arrival order was ${JSON.stringify(written)}`);
  check('§D a value superseded before its turn is skipped, not written then overwritten',
    written.length === 1 && written[0] === 'خالد', `written ${JSON.stringify(written)}`);

  // MUTATION: the shipped fire-and-forget shape — two independent in-flight requests, no queue.
  const unserialised = (v: string, rigDelay: (s: string) => number, out: string[]) =>
    new Promise((r) => setTimeout(() => { out.push(v); r({}); }, rigDelay(v)));
  const out: string[] = [];
  const delay = (v: string) => (v === 'أحمد' ? 40 : 1);
  void unserialised('أحمد', delay, out);
  void unserialised('خالد', delay, out);
  await new Promise((r) => setTimeout(r, 120));
  mustCatch('the unserialised fire-and-forget write lets the older name arrive last',
    out[out.length - 1] === 'أحمد', `arrival order was ${JSON.stringify(out)}`);
}

console.log(failures === 0
  ? '\nOK — a synced name can only be applied to the name it was computed for, on both axes.'
  : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
