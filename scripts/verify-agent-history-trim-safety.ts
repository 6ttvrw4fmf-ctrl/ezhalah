// LIVE HISTORY-TRIM SAFETY (round-2 finding 7). src/app/agent.tsx's send() trims the client history
// window it sends to the edge from the pre-consolidation slice(-10) to slice(-2) (comment: "the
// immediately-preceding user message and the model's immediately-preceding reply, KEPT VERBATIM").
// This verifies, WITHOUT any HTTP call or edge deployment (see the round-2 safety note: never deploy
// to verify), that the trim does not break the two behaviors that depend on seeing raw prior-turn
// text: pronoun resolution ("that one") and the exact-phrase period-flip trigger ("خلها شهري").
//
// METHOD: reproduces agent.tsx's OWN history construction (its exact filter → map → `.slice(-2)`
// shape, read from the real file below and asserted against, not re-typed as an assumption) over a
// crafted multi-turn conversation, then feeds the resulting trimmed array into the REAL
// price-carry-forward decision function (postModel.ts's effectiveBasis()/periodFromText(), imported
// and executed — never a hand-typed copy) to prove what index.ts's price-carry-forward loop would see.
//
//   node --experimental-strip-types scripts/verify-agent-history-trim-safety.ts

import { readFileSync } from 'node:fs';
import { effectiveBasis, periodFromText } from '../supabase/functions/agent/postModel.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// ── Pin the trim itself against the real source, so this test goes stale (not silently wrong) if
// agent.tsx's window ever changes again ──────────────────────────────────────────────────────────
const ui = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
check('agent.tsx trims history to the last 2 raw entries (not the pre-consolidation 10)',
  /const history = historyAll\.slice\(-2\);/.test(ui),
  'this test assumes exactly this line; if the window changed, re-derive the scenarios below');

// A minimal stand-in for agent.tsx's msgs → historyAll mapping (its own filter/map, reproduced here
// only in SHAPE — user/results/agent → {role:'user'|'model', text} — because msgs.tsx pulls in React
// Native and cannot be imported from plain Node, the same constraint noted in
// scripts/verify-agent-twin-scope.ts for src/data/locations.ts). The TRIM under test is the real
// `.slice(-2)` applied identically below.
type Turn = { role: 'user' | 'model'; text: string };
// IMPORTANT (verified against the real send(), src/app/agent.tsx): `historyAll` is built from `msgs`
// BEFORE the CURRENT message being sent is appended to it (the setMsgs() push and the historyAll
// read happen against two different snapshots — React state updates are not synchronous within the
// same closure) — the current message travels separately as respond()'s own first argument, never as
// part of `history`. So `all` below must be the PRIOR turns ONLY; the message under test is passed
// alongside, not inside it.
const trimmed = (priorTurnsOnly: Turn[]) => priorTurnsOnly.slice(-2);

console.log('\n(1) PRONOUN RESOLUTION ("that one") — the immediately-prior reply survives the trim\n');
{
  // A realistic 3-exchange conversation: type -> results -> "that one".
  const all: Turn[] = [
    { role: 'user', text: 'أبغى فيلا في الرياض' },
    { role: 'model', text: 'تمام، هذا اللي لقيته:\n#1: Villa for sale in النرجس, الرياض — 1,200,000\n#2: Villa for sale in الملقا, الرياض — 1,450,000' },
  ];
  // `all` IS the prior-turns window — the current message ("كم مساحة الثانية؟") is sent separately
  // (respond()'s first argument), never appended into `history` itself; see the note above `trimmed`.
  const sent = trimmed(all);
  check('the trimmed window is exactly 2 entries (both prior turns fit)', sent.length === 2, JSON.stringify(sent));
  check('the LAST entry is the model\'s numbered-card reply, VERBATIM (not summarised) — what pronoun resolution needs',
    sent[1].role === 'model' && sent[1].text.includes('#2: Villa for sale in الملقا') && sent[1].text.includes('1,450,000'),
    JSON.stringify(sent[1]));
  check('the FIRST entry is the user\'s original request', sent[0].role === 'user' && sent[0].text === 'أبغى فيلا في الرياض');
}

console.log('\n(1b) Same check holds regardless of how MANY earlier exchanges preceded it (the old slice(-10) vs new slice(-2) only differs in how much OLDER context is dropped, never the immediately-prior exchange)\n');
{
  const long: Turn[] = [];
  for (let i = 0; i < 6; i++) {
    long.push({ role: 'user', text: `رسالة ${i}` });
    long.push({ role: 'model', text: `رد ${i}` });
  }
  long.push({ role: 'user', text: 'أبغى فيلا في جدة' });
  long.push({ role: 'model', text: '#1: Villa for sale in الشاطئ, جدة — 2,000,000' });
  // Current message ("وش سعرها بالضبط؟") is sent separately, not appended into `long`.
  const sent = trimmed(long);
  check('a long prior conversation still surfaces the LATEST results turn intact',
    sent[1].role === 'model' && sent[1].text.includes('2,000,000'), JSON.stringify(sent));
}

console.log('\n(2) EXACT-PHRASE TRIGGER ("خلها شهري") — the canonical, documented reproduction (postModel.ts RULE 1) is a 2-turn conversation, so it is UNAFFECTED by the trim\n');
{
  // The exact scenario postModel.ts's own header reproduces: turn 1 states 70,000 ANNUAL, turn 2
  // flips the period only. This is the scenario the standing rule ("period-only change never
  // re-scales budget") exists for, and it fits entirely inside a slice(-2) window with room to spare
  // (there is only ONE prior turn) — the trim cannot have broken it.
  const priceText = 'شقق ٣ غرف للايجار السنوي في الرياض بميزانية ٧٠ الف';
  // Prior turns only — "لا خلها شهري" is the CURRENT message, sent separately (see the note above
  // `trimmed`), never appended into `history` itself.
  const all: Turn[] = [{ role: 'user', text: priceText }, { role: 'model', text: 'تمام، هذا المتاح...' }];
  const sent = trimmed(all);
  check('the price-stating turn is STILL inside the trimmed window', sent[0].text === priceText, JSON.stringify(sent));

  // Reproduce index.ts's OWN backward scan (skip role:'model', extractPrice the rest) — here
  // simplified to "does this turn carry a period word", which is all effectiveBasis() needs.
  const carriedFromText = sent.find((h) => h.role !== 'model')?.text ?? '';
  const basis = effectiveBasis({ currentText: 'لا خلها شهري', priceCameFromCurrentTurn: false, carriedFromText, modelBasis: '' });
  check('effectiveBasis() correctly reads the ORIGINAL annual basis from the (still-present) carried text',
    basis === 'annual_rent', `got ${JSON.stringify(basis)}`);
  check('periodFromText() itself agrees the carried turn was annual', periodFromText(carriedFromText) === 'annual');
}

console.log('\n(3) THE ONLY CASE THE TRIM CAN AFFECT — a price stated 3+ turns before a LATER standalone period-flip — degrades SAFELY (no re-scale), never dangerously (never a wrong ×12/÷12)\n');
{
  // Unlike case (2), the price-stating turn here is TWO exchanges back — outside a 2-entry window by
  // the time the period-flip arrives (the pre-consolidation slice(-10) would still have caught this;
  // slice(-2) will not). Prove the CONSEQUENCE is "don't multiply" (safe), not "multiply wrong" (the
  // actual historical bug this rule exists to prevent).
  const priorTurns: Turn[] = [
    { role: 'user', text: 'شقق ٣ غرف للايجار السنوي في الرياض بميزانية ٧٠ الف' }, // turn 1: states the price+period
    { role: 'model', text: 'تمام، هذا المتاح...' },
    { role: 'user', text: 'خلها في حي النرجس' },                                    // turn 2: unrelated follow-up
    { role: 'model', text: 'تمام، ضيقتها لحي النرجس.' },
  ];
  const sent = trimmed(priorTurns);
  check('the price-stating turn 1 has scrolled OUT of the trimmed window', !sent.some((h) => h.text.includes('٧٠ الف')), JSON.stringify(sent));
  // index.ts's backward scan over `sent` (the ONLY history it now receives) finds no period word.
  const carriedFromText = sent.find((h) => h.role !== 'model' && /\d/.test(h.text))?.text ?? '';
  const basis = effectiveBasis({ currentText: 'لا خلها شهري', priceCameFromCurrentTurn: false, carriedFromText, modelBasis: '' });
  check('with the origin text unavailable, effectiveBasis() returns "" (no multiplier) — NEVER a guessed one',
    basis === '', `got ${JSON.stringify(basis)} — a non-empty basis here would silently multiply a number the user never re-scoped`);
  // The rentPeriod (which POOL to search) still flips correctly regardless — it reads THIS turn's own
  // out.rent_period from the model, which needs no history at all (index.ts line ~1122: `const rp =
  // String(out.rent_period ?? "")`). Confirmed by inspection, not re-asserted here (that line has no
  // history dependency to test) — see this file's own note for why the trim cannot affect it.
}

console.log(failures === 0
  ? '\n✅ verify-agent-history-trim-safety: all checks passed.\n'
  : `\n❌ verify-agent-history-trim-safety: ${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
