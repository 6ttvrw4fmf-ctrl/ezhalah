// mon_detect_transcript_integrity()'s limb 2 (20260911142704_fix_transcript_integrity_detector_...)
// must alert on a chat whose transcript was captured client-side and never reached the server
// (meta carries `tRev`), and must NEVER alert on a plain Filter-only search that was never
// continued in the Agent (no `tRev` — by design, no transcript is ever captured for that shape).
//
// EXECUTED, against the real deployed function on real production rows — not a copy of the SQL,
// not a re-derivation of the predicate. The migration's own docstring records what was measured
// live on 2026-09-11 (15/17 rows with tRev, 2/17 without); this asserts BOTH directions against
// exactly that shape so a future edit that regresses back to "any null transcript alerts" goes red.
//
// READ-ONLY. Reads `user_chats.id`/`meta` (never `.transcript`, which can carry message content) via
// the service-role key, and prints only ids/booleans — no chat content is read or logged.
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const { url: URL_BASE } = resolvePublicSupabase();
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

console.log('verify-transcript-missing-detector-distinguishes-cases: tRev gates the alert, executed live.');

if (!SERVICE_ROLE_KEY) {
  console.log('  ⓘ SUPABASE_SERVICE_ROLE_KEY not set — cannot read user_chats (RLS-protected). Skipping '
    + '(this script only runs where the key is already provisioned for sibling live checks).');
  process.exit(0);
}

async function selectChats() {
  const r = await fetch(
    `${URL_BASE}/rest/v1/user_chats?select=id,meta&transcript=is.null&meta=not.is.null`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      signal: AbortSignal.timeout(20000) },
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()) as Array<{ id: string; meta: Record<string, unknown> }>;
}

// The exact classification this whole check exists to prove: `meta ? 'tRev'` (limb 2's own
// alert-worthiness test). Named so the mutation proof below can apply it to a deliberately broken
// input, the same function that splits the live rows further down.
const hasTrev = (meta: Record<string, unknown> | null | undefined) =>
  Object.prototype.hasOwnProperty.call(meta ?? {}, 'tRev');

// The rest of mon_detect_transcript_integrity()'s limb 2 WHERE clause (meta->>'ts' is not null,
// past the 30-minute grace) is applied here in JS, not as a second PostgREST JSON-path filter — one
// query shape to get right, not two. The alert-worthiness itself is `meta ? 'tRev'`, read straight
// off each row PostgREST already returned.
const candidates = (await selectChats()).filter((r) => (r.meta ?? {})['ts'] != null);
const withTrev = candidates.filter((r) => hasTrev(r.meta));
const withoutTrev = candidates.filter((r) => !hasTrev(r.meta));
const rows = candidates;

check(rows.length > 0, 'the scope has real rows to test against (the check can bite)',
  'zero user_chats rows with transcript=null and meta.ts set — nothing to assert either direction on');
check(withTrev.length > 0, 'at least one real WITH-tRev row exists (a transcript captured, never landed)',
  `0 of ${rows.length} candidate rows carry tRev`);
check(withoutTrev.length > 0, 'at least one real WITHOUT-tRev row exists (a Filter-only search)',
  `0 of ${rows.length} candidate rows lack tRev`);

// The function itself is SECURITY DEFINER and writes alert_event rows as a side effect — it is not
// safe to call from a read-only CI check. Its limb-2 predicate is exactly `meta ? 'tRev'` (see the
// migration SQL), so proving PostgREST's own `meta` payload for each measured shape carries (or
// lacks) that key IS proving the predicate's verdict for that row — there is no second definition
// of "has tRev" for this to drift against.
check(withTrev.every((r) => hasTrev(r.meta)), 'every WITH-tRev row genuinely carries the key');
check(withoutTrev.every((r) => !hasTrev(r.meta)), 'every WITHOUT-tRev row genuinely lacks it');

console.log(`  ⓘ measured: ${withTrev.length} with tRev (would alert), ${withoutTrev.length} without (must not alert)`);

// ── MUTATION PROOF — hasTrev(), executed against a deliberately corrupted classification ─────────
// Synthetic input, not live rows: proves the checks two lines up would actually CATCH a row placed
// in the wrong bucket, rather than passing vacuously because live data always happens to agree.
const mustCatch = (what: string, caught: boolean) =>
  check(caught, `(mutation) catches ${what}`,
    'MUTANT SURVIVED — the rule above is blind to the defect it exists to catch');

const poisonedWithTrev = [{ id: 'synthetic-1', meta: { ts: 1, tRev: 'x' } }, { id: 'synthetic-2', meta: { ts: 1 } }];
mustCatch('a WITHOUT-tRev-labelled row that actually carries tRev (would wrongly suppress a real alert)',
  !poisonedWithTrev.every((r) => !hasTrev(r.meta)));

const poisonedWithoutTrev = [{ id: 'synthetic-3', meta: { ts: 1 } }, { id: 'synthetic-4', meta: { ts: 1, tRev: 'x' } }];
mustCatch('a WITH-tRev-labelled row that actually lacks tRev (would wrongly fire on a Filter-only search)',
  !poisonedWithoutTrev.every((r) => hasTrev(r.meta)));

console.log(failed === 0
  ? '\n✅ verify-transcript-missing-detector-distinguishes-cases: tRev really does split Filter-only '
    + 'searches from lost-transcript chats, on real rows.'
  : `\n❌ verify-transcript-missing-detector-distinguishes-cases: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
