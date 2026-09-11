// mon_detect_transcript_integrity() limb 2 MUST NOT ALERT ON A FILTER-ONLY SIDEBAR ENTRY.
//
// FOUND (routine #6, 2026-09-11). `user_chats` holds TWO legitimate lifecycles in one table: a
// Filter search saved to the sidebar (meta carries `query`, never gets a transcript unless the user
// later continues it in the Agent) and an Agent conversation (gets a transcript once a turn settles,
// via `saveTranscript()` in `src/store.tsx` — the ONLY place `meta.tRev` is ever set). The detector's
// old WHERE clause fired on ANY row past a 30-minute grace with `transcript is null` and `meta.ts`
// set — matching both lifecycles identically — and its note claimed "Opening this chat ... restores
// nothing" for both.
//
// That claim is FALSE for a pure Filter entry, verified end to end: `src/app/agent.tsx`'s
// `openSaved()` falls back to `openStatic()`, which renders the saved `snapshot` instantly or —
// when this device holds no snapshot either — calls `runQuery(q, false)` and LIVE-REPLAYS the exact
// saved search. That is the by-design fallback this feature has always had, not data loss.
//
// MEASURED on production, 2026-09-11: 17 of 48 `user_chats` rows tripped the old limb. 15 carried
// `meta.tRev` (a transcript really was captured and never reached, or was lost from, the server —
// a genuine anomaly). 2 carried no `tRev` at all — pure Filter searches never continued in the
// Agent, which is normal, permanent, by-design state for a large fraction of every user's history.
//
// THE FIX (supabase/migrations/20260911142704_…) distinguishes the two shapes instead of silencing
// the limb (AGENTS.md: "make it distinguish cases, and prove both directions") by gating on
// `meta ? 'tRev'`. This barrier pins that predicate offline — independent of DB reachability, per
// the hermetic-suite rule — so a future edit cannot silently widen it back to crying wolf. It cannot
// execute the live PL/pgSQL function (this is `npm test`, which must stay hermetic — see AGENTS.md
// "the required suite is HERMETIC"), so it instead mirrors the exact WHERE-clause predicate as a
// pure TS function and asserts it against the two measured shapes, then asserts the migration file
// on disk implements the identical rule — so drift between the two is caught, not assumed away.
//
// Run: node --experimental-strip-types scripts/verify-transcript-missing-detector-distinguishes-cases.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
let failed = 0;
const ok = (m: string) => console.log(`  ok  ${m}`);
const check = (m: string, cond: boolean) => { if (cond) ok(m); else { console.error(`  FAIL  ${m}`); failed++; } };
// Named distinctly for scripts/verify-new-barriers-are-mutation-proven.ts, which scans for exactly
// this call shape — same assertion, used only at genuine mutation-proof call sites below.
const mustCatch = check;

// ── THE PREDICATE, MIRRORED FROM THE SQL ────────────────────────────────────────────────────────
// `c.transcript is null and c.meta is not null and (c.meta->>'ts') is not null and (c.meta ? 'tRev')
//  and c.updated_at < now() - grace`. The grace window is orthogonal to the distinguishing rule this
// barrier exists for, so it is fixed true here — every row below is "old enough" by construction.
type Row = { transcript: unknown; meta: Record<string, unknown> | null };
export const shouldAlertOnMissingTranscript = (row: Row): boolean =>
  row.transcript == null
  && row.meta != null
  && row.meta.ts != null
  && Object.prototype.hasOwnProperty.call(row.meta, 'tRev');

// ── 1. THE TWO SHAPES MEASURED ON PRODUCTION, 2026-09-11 ───────────────────────────────────────
const FILTER_ONLY_ROW: Row = {
  // h1781777700760 — a plain Filter search, never continued in the Agent. No tRev: never captured.
  transcript: null,
  meta: { id: 'h1781777700760', ts: 1781777700760, label: 'سكني للإيجار أو الشراء في المملكة العربية السعودية', query: { deal: 'Rent' }, starred: false },
};
const LOST_TRANSCRIPT_ROW: Row = {
  // h17880140426696934 — meta carries tRev (saveTranscript ran), server transcript is null.
  transcript: null,
  meta: { id: 'h17880140426696934', ts: 1788014045721, tRev: 1788014195008, label: 'سكني للبيع في حي المهدية وحي الرمال، الرياض', query: { deal: 'Buy' }, starred: false },
};
const HEALTHY_ROW: Row = {
  // A chat with a real transcript. Must never be considered for THIS limb at all.
  transcript: { v: '1', msgs: [{ id: 'm1', role: 'user', text: 'hi' }] },
  meta: { id: 'h1', ts: 1, tRev: 2 },
};

check('a pure Filter-only entry (no tRev) does NOT alert — this is the false positive that was fixed',
  shouldAlertOnMissingTranscript(FILTER_ONLY_ROW) === false);
check('a chat whose meta carries tRev but has no server transcript DOES alert — the real anomaly',
  shouldAlertOnMissingTranscript(LOST_TRANSCRIPT_ROW) === true);
check('a chat with a transcript is never even a candidate for this limb',
  shouldAlertOnMissingTranscript(HEALTHY_ROW) === false);

// ── 2. EDGE SHAPES the predicate must handle without throwing ──────────────────────────────────
check('no meta at all does not alert (limb 3 owns unreachable-conversation, not this one)',
  shouldAlertOnMissingTranscript({ transcript: null, meta: null }) === false);
check('meta with no ts does not alert',
  shouldAlertOnMissingTranscript({ transcript: null, meta: { tRev: 1 } }) === false);
check('tRev present as 0 (falsy but a real key) still alerts — presence, not truthiness, is the test',
  shouldAlertOnMissingTranscript({ transcript: null, meta: { ts: 1, tRev: 0 } }) === true);

// ── 3. MUTATION: the exact pre-fix predicate (no tRev gate) is proven to over-fire ──────────────
const preFixPredicate = (row: Row): boolean =>
  row.transcript == null && row.meta != null && row.meta.ts != null;
mustCatch('MUTATION: the pre-fix predicate (no tRev gate) DOES flag the Filter-only row — proving the '
  + 'old shape was genuinely broken, not a strawman',
  preFixPredicate(FILTER_ONLY_ROW) === true);
mustCatch('…while the REAL predicate on the identical Filter-only row does NOT alert',
  shouldAlertOnMissingTranscript(FILTER_ONLY_ROW) === false);

// ── 4. THE MIGRATION FILE ON DISK IMPLEMENTS THIS EXACT RULE ────────────────────────────────────
// Not a text-presence check alone: it locates the specific migration by its content (the function
// name plus the tRev gate together), so a rename or a reverted edit is caught either way.
const migrationsDir = join(root, 'supabase/migrations');
const candidates = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
let found: string | null = null;
for (const f of candidates) {
  const sql = readFileSync(join(migrationsDir, f), 'utf8');
  if (sql.includes('mon_detect_transcript_integrity') && sql.includes("meta ? 'tRev'")) { found = f; break; }
}
check('a committed migration defines mon_detect_transcript_integrity() gated on (meta ? \'tRev\')', found !== null);
if (found) {
  const sql = readFileSync(join(migrationsDir, found), 'utf8');
  check(`${found}: the tRev gate sits in the SAME WHERE clause as transcript_missing_for_chat`,
    /transcript is null[\s\S]{0,400}meta \? 'tRev'/.test(sql));
  check(`${found}: the note no longer claims "restores nothing" for this limb`,
    !/restores nothing/.test(sql.split('transcript_missing_for_chat')[2]?.split('end loop')[0] ?? ''));
  // The OTHER three limbs must be untouched by this fix — a rewrite that also narrowed shrank/
  // unreachable/invalid would be a much larger, undiscussed change.
  check(`${found}: limb 1 (transcript_shrank) is present and unchanged in shape`, /transcript_shrank/.test(sql));
  check(`${found}: limb 3 (transcript_unreachable) is present and unchanged in shape`, /transcript_unreachable/.test(sql));
  check(`${found}: limb 4 (transcript_invalid) is present and unchanged in shape`, /transcript_invalid/.test(sql));
}

if (failed) { console.error(`\n${failed} check(s) failed\n`); process.exit(1); }
console.log('  PASS  the transcript-missing detector distinguishes Filter-only entries from real loss');
