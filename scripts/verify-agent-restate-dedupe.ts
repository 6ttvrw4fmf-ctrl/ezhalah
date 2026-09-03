// Regression guard for the duplicate-restate-sentence bug (live-tested 2026-08-30).
//
// The bug: a GUEST listings reply could read "تمام، فهمت أنك تبحث عن «...». تمام، فهمت أنك تبحث عن
// «...». أبشر..." — the same opening sentence twice. src/data/agent.ts's respond() unconditionally
// prepended withRestate()'s canned "got it, you're searching for X" line to every guest listings
// reply, but the edge system prompt's "WHEN YOU SEARCH" rule ALSO tells the model to restate on
// every listings reply — so the model's own reply sometimes already opened with equivalent phrasing.
//
// The fix: respond() now skips the prepend when alreadyRestates(backend.reply) is true. This pins,
// against the REAL extracted function (never a hand-copied duplicate — see
// scripts/lib/extractRealAgentRestate.ts):
//   1. a model reply that ALREADY restates → alreadyRestates() true → no duplicate.
//   2. a model reply that does NOT restate → alreadyRestates() false → withRestate's line still added
//      (guests still get the fast search-first echo when the model didn't already give one).
//   3. the call site in respond() actually gates on this exact function (not dead code).
//
//   node --experimental-strip-types scripts/verify-agent-restate-dedupe.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { loadRealAlreadyRestates, callSiteWiresAlreadyRestates } from './lib/extractRealAgentRestate.ts';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

const { alreadyRestates } = await loadRealAlreadyRestates();

// ── Case 1: model reply ALREADY restates → must be detected, so the prepend is skipped ──
const ALREADY_RESTATED_AR =
  'تمام، فهمت أنك تبحث عن «شقة 3 غرف في الرياض بحد أقصى 2,000,000 ريال». أبشر، جاري البحث عن أفضل الخيارات المتاحة.';
const ALREADY_RESTATED_AR_FAHIM_ONLY = 'فهمت انك تدور على فيلا في جدة، أدوّر لك الحين.';
const ALREADY_RESTATED_EN =
  'Got it — you\'re looking for a 3-bedroom villa in Riyadh under SAR 2,000,000. Searching now.';
const ALREADY_RESTATED_EN_UNDERSTOOD = 'Understood, you are searching for an apartment in Jeddah. One moment.';

check('AR "تمام، فهمت أنك تبحث عن" opener detected', alreadyRestates(ALREADY_RESTATED_AR));
check('AR "فهمت انك تدور على" (no تمام lead) detected', alreadyRestates(ALREADY_RESTATED_AR_FAHIM_ONLY));
check('EN "Got it — you\'re looking for" opener detected', alreadyRestates(ALREADY_RESTATED_EN));
check('EN "Understood, you are searching for" opener detected', alreadyRestates(ALREADY_RESTATED_EN_UNDERSTOOD));

// ── Case 2: model reply does NOT restate → must NOT be flagged, so withRestate still runs ──
const NOT_RESTATED_AR = 'هذي أفضل النتائج المتاحة اللي طابقت بحثك، تقدر تفتح أي إعلان لمزيد من التفاصيل.';
const NOT_RESTATED_AR_STEER = 'أبشر، وش تدور عليه اليوم؟'; // small-talk steer — has "تدور" but no "فهمت"
const NOT_RESTATED_EN = 'Here are some properties that match your search criteria in Riyadh.';

check('AR reply with no restate opener is NOT flagged', !alreadyRestates(NOT_RESTATED_AR));
check('AR small-talk steer ("تدور" without "فهمت") is NOT flagged', !alreadyRestates(NOT_RESTATED_AR_STEER));
check('EN reply with no restate opener is NOT flagged', !alreadyRestates(NOT_RESTATED_EN));

// ── Case 3: wiring — respond() must actually gate withRestate() on this real function ──
const agentSrc = readFileSync(new URL('../src/data/agent.ts', import.meta.url), 'utf8');
check('respond() guest-listings branch calls alreadyRestates() to gate withRestate()',
  callSiteWiresAlreadyRestates(agentSrc));
// The unconditional old call must be gone, not just shadowed by a new one further down.
check('the old unconditional prepend is gone',
  !/if \(backend\.kind === 'listings' && !loggedIn\) backend\.reply = withRestate/.test(agentSrc));

console.log('');
if (failed) {
  console.log(`✗ ${failed} check(s) failed.`);
  process.exit(1);
}
console.log('✓ all restate-dedupe checks passed.');
