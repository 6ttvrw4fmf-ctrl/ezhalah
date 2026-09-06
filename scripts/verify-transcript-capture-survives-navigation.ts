#!/usr/bin/env -S node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
/**
 * verify-transcript-capture-survives-navigation — auto-discovered barrier (scripts/run-tests.mjs).
 *
 * A SAVED CHAT MUST NEVER RE-RUN ITS SEARCH. Reopening one renders the conversation that was left,
 * instantly, from its transcript (owner 2026-08-14 and again 2026-09-05: "these are saved already,
 * why does the search happen again").
 *
 * HOW IT BROKE. agent.tsx stages the newest state in `pendingCaptureRef`, and every path that
 * abandons the view — opening another chat, New Chat, navigating, pagehide — calls
 * flushPendingCapture() to write it. But the staging line sat BELOW `if (busy) return`, so while a
 * turn was in flight nothing was ever staged, and the flush had nothing to write. Leave a chat while
 * its search is still running and that entire turn is lost; reopen it and, with no transcript and no
 * snapshot, openStatic falls through to a live re-search with the loader.
 *
 * MEASURED on the owner's account before the fix: of 10 chats, 1 had NO transcript and 3 had
 * 284–1052 byte stubs where healthy ones are 14–23KB.
 *
 * WHY STAGING MID-TURN IS SAFE, and this is the load-bearing fact: serializeChat DROPS `status`
 * messages, so a flush during a search cannot persist a frozen «searching» bubble. That was the only
 * thing the busy guard protected, and the serializer already guarantees it. The guard remains on the
 * debounced WRITE, where it belongs — so a drip-revealing turn still writes once, not once per card.
 */
import { readFileSync } from 'node:fs';
import { serializeChat, restoreChat } from '../src/lib/chatTranscript.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

const listing = { id: 'l1', title: 'شقة', price: 100, platform: 'aqar' } as any;
const midTurn = {
  msgs: [
    { id: 'u1', role: 'user', text: 'شقق للبيع في حي الرمال' },
    { id: 's1', role: 'status', phase: 'searching', summary: 'جاري البحث' },   // in flight
    { id: 'r1', role: 'results', text: 'لقينا 40', result: { listings: [listing], total: 40, hasMore: true } },
  ],
  revealCount: { r1: 10 }, afReceipt: {}, guidedPills: null,
} as any;

// ── 1. EXECUTED: the serializer is what makes a mid-turn flush safe ──────────────────────────────
const t = serializeChat(midTurn);
check('a mid-turn state still serializes (there IS something to flush)', !!t);
const roles = (t?.msgs ?? []).map((m: any) => m.role);
check('the in-flight «status» message is dropped, so no frozen loader can be restored',
  !roles.includes('status'), roles.join(','));
check('the user bubble and the results turn both survive',
  roles.includes('user') && roles.includes('results'), roles.join(','));
const back = t ? restoreChat(t) : null;
check('what is stored restores to a real conversation, not an empty one',
  !!back && back.msgs.length === 2);
check('the revealed-card count survives, so the chat reopens where it was left',
  (back?.revealCount as any)?.r1 === 10);

// ── 2. the staging must happen BEFORE the busy guard ─────────────────────────────────────────────
const src = readFileSync('src/app/agent.tsx', 'utf8');

/** Every way the capture effect can stop surviving navigation. Pure, so it can be re-broken below. */
export function auditCapture(agentSrc: string): string[] {
  const effect = agentSrc.slice(agentSrc.indexOf('const lastCapturedRef'),
    agentSrc.indexOf('// A refresh/close inside the debounce window'));
  const stageAt = effect.indexOf('pendingCaptureRef.current = { id, t, j }');
  const guardAt = effect.indexOf('if (busy) return;');
  const bad: string[] = [];
  if (stageAt < 0) bad.push('nothing is staged in pendingCaptureRef — flushPendingCapture can never write a turn');
  if (guardAt < 0) bad.push('the busy guard is gone — the debounced write would fire once per revealed card');
  if (stageAt > -1 && guardAt > -1 && stageAt > guardAt)
    bad.push('the busy guard sits ABOVE the staging: leaving mid-search stages nothing and loses the whole turn');
  if (!/\}, \[busy, msgs, revealCount, afReceipt, guidedPills, completed\]\);/.test(agentSrc))
    bad.push('`completed` is missing from the capture deps — a finished chat can reopen with a live composer');
  if ((agentSrc.match(/flushPendingCapture\(\)/g) ?? []).length < 4)
    bad.push('an abandon path no longer flushes before leaving');
  if (!/restoreChat\(t\)/.test(agentSrc)) bad.push('reopening no longer prefers the stored transcript');
  return bad;
}

// ── MUTATION PROOF (executable — the audit is watched failing, not assumed to work) ───────────────
const mustCatch = (label: string, broken: string[]) =>
  check(`mutation caught: ${label}`, broken.length > 0, 'the audit passed deliberately broken source');

mustCatch('the busy guard moves back above the staging (the exact shipped bug)',
  auditCapture(src.replace('pendingCaptureRef.current = { id, t, j };\n    if (busy) return;',
                           'if (busy) return;\n    pendingCaptureRef.current = { id, t, j };')));
mustCatch('the staging is deleted, so a flush has nothing to write',
  auditCapture(src.replace('pendingCaptureRef.current = { id, t, j };', '')));
mustCatch('the busy guard is deleted, so the write fires once per revealed card',
  auditCapture(src.replace('if (busy) return;\n    const timer', 'const timer')));
mustCatch('`completed` drops out of the capture deps',
  auditCapture(src.replace(', guidedPills, completed]);', ', guidedPills]);')));
mustCatch('reopening stops preferring the stored transcript',
  auditCapture(src.replace('restoreChat(t)', 'null')));
check('the audit passes on the real, unmodified source', auditCapture(src).length === 0,
  auditCapture(src).join('; '));

for (const problem of auditCapture(src)) check(problem, false);


// ── 3. the reopen path itself: transcript first, snapshot second, re-search only as a last resort ─
const openSaved = src.slice(src.indexOf('const openSaved = async'), src.indexOf('const openStatic = async'));
check('reopening prefers the stored transcript', /restoreChat\(t\)/.test(openSaved));
check('reopening hydrates from the server when this device no longer holds it',
  /hydrateTranscript\(entryId\)/.test(openSaved));
check('a restored chat returns WITHOUT running a search', /landAtLatest\(\);\s*\n\s*return;/.test(openSaved));
const openStatic = src.slice(src.indexOf('const openStatic = async'));
check('a saved snapshot renders with no network and no loader',
  /if \(snapshot\) \{[\s\S]{0,400}?return;/.test(openStatic));

if (failed) {
  console.error(`\n${failed} check(s) FAILED — a saved chat could re-run its search`);
  process.exit(1);
}
console.log('\nOK — a turn survives navigation, and a saved chat reopens without searching.');
