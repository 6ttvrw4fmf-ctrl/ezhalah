// A REPLAYED SAVED TURN KEEPS ITS SENTENCE (ops_incident #337, routine-4, 2026-09-25).
//
// The Results-Found sentence rotates across four pools (src/data/resultsFoundRotation.ts). PR #3232
// pinned the pick per message id so a typewriter re-render (~40 Hz) cannot flip it mid-typing. The
// memo is a module-level Map keyed on that id, so the id is the ONLY thing deciding whether a turn
// the user has already read keeps its wording.
//
// `openStatic` (agent.tsx — the legacy snapshot/replay fallback for a saved chat with no transcript)
// minted both ids with `uid()`. Ids were therefore stable only WITHIN one invocation: every reopen of
// the same chat minted a new results id, missed the memo, and re-rolled the rotation. Observed twice
// on production by routine-5 on 2026-09-19 (counts preserved, wording changed under the user).
//
// This barrier EXECUTES the real picker and the real id helper — never a copy, never a grep of the
// line — and composes them into the property a user actually experiences: reopen the same saved
// conversation, get the same sentence. §4 runs the OLD behaviour against the same stubbed randomness
// and asserts it really does disagree, so the guard cannot pass vacuously.
//
//   node --experimental-strip-types scripts/verify-replayed-turn-keeps-its-sentence.ts
//   (discovered automatically by scripts/lib/testRegistry.ts — no package.json edit)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pickResultsFoundSentence } from '../src/data/resultsFoundRotation.ts';
import { replayMsgIds } from '../src/lib/replayIds.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nA replayed saved conversation keeps the Results-Found sentence it was already shown\n');

// The app's real minting shape (agent.tsx:150) — asserted below to still look like this, because the
// `hu:`/`hr:` prefixes only avoid collision while uid() keeps starting with 'm'.
let minted = 0;
const uid = () => 'm' + Date.now() + Math.round(Math.random() * 1e6) + (minted++);

// ── 1. THE ID HELPER, EXECUTED ────────────────────────────────────────────────────────────────────
const a1 = replayMsgIds('entry-abc', uid);
const a2 = replayMsgIds('entry-abc', uid);
check('the same saved conversation yields the SAME id pair across reopens',
  a1.userId === a2.userId && a1.resultsId === a2.resultsId,
  `${JSON.stringify(a1)} vs ${JSON.stringify(a2)}`);
check('userId and resultsId are distinct within one replay',
  a1.userId !== a1.resultsId, JSON.stringify(a1));

const b1 = replayMsgIds('entry-xyz', uid);
check('two different saved conversations get different ids',
  b1.resultsId !== a1.resultsId, `${b1.resultsId} === ${a1.resultsId}`);

const noEntry1 = replayMsgIds(null, uid);
const noEntry2 = replayMsgIds(undefined, uid);
check('no entry id → falls back to minting (previous behaviour, nothing durable to key on)',
  noEntry1.resultsId !== noEntry2.resultsId
  && noEntry1.userId !== noEntry1.resultsId
  && noEntry1.resultsId.startsWith('m'),
  `${JSON.stringify(noEntry1)} / ${JSON.stringify(noEntry2)}`);

check('a derived id can never collide with a minted one (uid() always begins with "m")',
  !a1.userId.startsWith('m') && !a1.resultsId.startsWith('m') && uid().startsWith('m'),
  `${a1.userId} / ${a1.resultsId}`);

// ── 2. RANDOMNESS STUB — two reopens that would pick DIFFERENT templates ──────────────────────────
// The picker's anti-repeat shifts the index only when it equals the previous pick for that pool, so
// 0 then 5 lands on two genuinely different templates with no shift and no ambiguity.
const realRandom = Math.random;
const scripted = (values: number[]) => {
  let i = 0;
  Math.random = () => values[Math.min(i++, values.length - 1)];
};
const restore = () => { Math.random = realRandom; };

// ── 3. THE USER-VISIBLE PROPERTY, composed from BOTH real symbols ─────────────────────────────────
// Reopen the same legacy chat twice. Each reopen derives its ids, then renders the sentence. The
// randomness differs between the two reopens on purpose: only the memo can keep the wording put.
const renderReplay = (entryId: string | null, count: string) => {
  const { resultsId } = replayMsgIds(entryId, uid);
  return pickResultsFoundSentence({ lang: 'ar', name: null, count, stableKey: resultsId });
};

try {
  scripted([0]);
  const first = renderReplay('entry-337', '4,118');
  scripted([0.5]); // would select a different template if the pick were re-rolled
  const second = renderReplay('entry-337', '4,118');
  restore();
  check('reopening the same saved chat renders the sentence BYTE-IDENTICALLY',
    first === second, `first:  ${first}\n      second: ${second}`);
  check('the pinned sentence still carries the exact backend count',
    first.includes('4,118'), first);
} finally { restore(); }

// A logged-in replay must be just as stable (the name pool is a different pool).
try {
  scripted([0]);
  const first = (() => {
    const { resultsId } = replayMsgIds('entry-337-named', uid);
    return pickResultsFoundSentence({ lang: 'ar', name: 'سعود', count: '134', stableKey: resultsId });
  })();
  scripted([0.7]);
  const second = (() => {
    const { resultsId } = replayMsgIds('entry-337-named', uid);
    return pickResultsFoundSentence({ lang: 'ar', name: 'سعود', count: '134', stableKey: resultsId });
  })();
  restore();
  check('the logged-in pool is stable across reopens too',
    first === second, `first:  ${first}\n      second: ${second}`);
  check('the logged-in sentence still carries the name and the count',
    first.includes('سعود') && first.includes('134'), first);
} finally { restore(); }

// ── 4. MUTATION — the OLD behaviour must FAIL this same property ──────────────────────────────────
// Executed, not asserted in prose: mint the ids the way openStatic used to and show the sentence
// really does change under the identical stubbed randomness. If this ever stops disagreeing, §3 has
// become vacuous and the guard is decoration.
try {
  scripted([0]);
  const first = pickResultsFoundSentence({ lang: 'ar', name: null, count: '9,999', stableKey: uid() });
  scripted([0.5]);
  const second = pickResultsFoundSentence({ lang: 'ar', name: null, count: '9,999', stableKey: uid() });
  restore();
  check('MUTATION — re-minting the id per reopen DOES re-word the turn (the defect is real)',
    first !== second, `both reopens produced: ${first}`);
} finally { restore(); }

// ── 5. WIRING — openStatic must use the helper, not mint those two ids ────────────────────────────
const agent = read('src/app/agent.tsx');
check('agent.tsx imports the replay id helper',
  /import\s*\{[^}]*\breplayMsgIds\b[^}]*\}\s*from\s*'@\/lib\/replayIds'/.test(agent));

const openStatic = agent.slice(agent.indexOf('const openStatic = async'));
const body = openStatic.slice(0, openStatic.indexOf('\n  };'));
check('openStatic derives its ids through replayMsgIds(chatIdRef.current, uid)',
  /replayMsgIds\(\s*chatIdRef\.current\s*,\s*uid\s*\)/.test(body));
check('openStatic no longer mints userId/resultsId with uid()',
  !/const\s+(userId|resultsId)\s*=\s*uid\(\)/.test(body),
  'a bare uid() for either id re-opens ops_incident #337');
check('the results bubble still pins the rotation to the message id',
  /stableKey:\s*m\.id/.test(agent));

// The transcript path is the reason this fix is scoped to openStatic — keep that true.
check('restoreChat still returns the PERSISTED msgs (ids preserved, not re-minted)',
  /msgs:\s*p\.msgs/.test(read('src/lib/chatTranscript.ts')));

console.log(failures === 0
  ? '\n✅ a replayed turn keeps its sentence; re-minting is proven to break it\n'
  : `\n❌ ${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
