// "Only ask the city if there is something [to find]" (owner, 2026-09-11).
//
// Requirements without a location get exactly ONE location question (see
// scripts/verify-agent-decide-turn.ts). This barrier covers the follow-on rule: before that
// question is ever shown, the client checks whether the OTHER stated requirements match anything
// at all, anywhere — and skips straight to the honest zero-match message if not, rather than
// asking for a city that could never help.
//
// Real logic, not a copy: imports and EXECUTES src/lib/agentLocationProbe.ts directly (zero-
// dependency by design — see that file's header) — never a regex over source text for the actual
// decision (buildLocationProbeQuery / replyAfterLocationProbe). The wiring into src/app/agent.tsx
// (which fields it's called with, that it runs before setMsgs) IS asserted by shape, since that
// file pulls in react-native and cannot be executed directly from plain Node — see "A COMMENT IS
// NOT A CODE PATH": a source-text check on a static, easily-broken shape is fine as long as the
// decision it's guarding is proven by real execution here.
//
//   node --experimental-strip-types scripts/verify-agent-location-probe.ts  (in `npm test`)
import { readFileSync } from 'node:fs';
import { buildLocationProbeQuery, replyAfterLocationProbe } from '../src/lib/agentLocationProbe.ts';

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// ── buildLocationProbeQuery: strips every location field, keeps everything else verbatim ────────
{
  const q = {
    location: 'جدة', locationMatch: { kind: 'city', city: 'جدة' }, districts: ['حي الروضة'], regionPin: 'مكة',
    type: 'شقة', amenities: ['pool'], priceInput: '500000', deal: 'Rent',
  };
  const probeQ = buildLocationProbeQuery(q);
  check('location cleared to empty string (resolveSearchScope reads this as "no location given")',
    probeQ.location === '');
  check('locationMatch cleared', probeQ.locationMatch === undefined);
  check('districts cleared', probeQ.districts === undefined);
  check('regionPin cleared', probeQ.regionPin === undefined);
  check('every non-location field survives untouched (type/amenities/price/deal — what the RPC actually matches on)',
    probeQ.type === 'شقة' && Array.isArray(probeQ.amenities) && probeQ.amenities[0] === 'pool'
    && probeQ.priceInput === '500000' && probeQ.deal === 'Rent');
  check('the original object is never mutated (a fresh object is returned)', (q as any).location === 'جدة');
}

// ── replyAfterLocationProbe: the three real outcomes of a probe ─────────────────────────────────
{
  const ASK = 'في أي مدينة تبحث؟';
  const ZERO = 'عذراً، ما لقينا نتائج مطابقة لطلبك حالياً. جرب استخدام الفلتر لتوسيع البحث.';

  check('genuine zero anywhere ([]) → skip the question, show the honest zero-match message',
    replyAfterLocationProbe(ASK, ZERO, []) === ZERO);
  check('a FAILED fetch (null) is NOT a zero — never claim "nothing matches" on our own network hiccup, ask as normal',
    replyAfterLocationProbe(ASK, ZERO, null) === ASK);
  check('real inventory exists somewhere (non-empty) → ask the question as normal',
    replyAfterLocationProbe(ASK, ZERO, [{ id: 1 }]) === ASK);
  check('an empty array is a REAL zero even with falsy-looking length — not mistaken for null',
    replyAfterLocationProbe(ASK, ZERO, []) !== ASK);
}

// ── mutation proofs — each guard must FAIL on its own defect ─────────────────────────────────────
const mustCatch = (label: string, brokenResult: boolean) => check(`(mutation) ${label}`, brokenResult);
{
  // M1: a broken version that collapses a FAILED fetch (null) into the same bucket as a genuine
  // zero ([]) — exactly the "A FAILED FETCH IS NOT AN EMPTY ANSWER" defect class.
  const brokenCollapsesNullToZero = (probeListings: unknown[] | null) =>
    (!probeListings || probeListings.length === 0) ? 'ZERO' : 'ASK';
  mustCatch('M1 caught: a broken version that reads null the same as [] (real fn keeps null → ASK, never claims a zero on our own network failure)',
    brokenCollapsesNullToZero(null) === 'ZERO' &&
    replyAfterLocationProbe('ASK', 'ZERO', null) === 'ASK');

  // M2: a broken version that never swaps to the zero-match message at all (the question policy
  // is decorative — "only ask if there is something" never actually skips the ask).
  const brokenAlwaysAsks = (a: string, _z: string, _p: unknown[] | null) => a;
  mustCatch('M2 caught: a broken version that always keeps asking, even on a confirmed nationwide zero',
    brokenAlwaysAsks('ASK', 'ZERO', []) === 'ASK' &&
    replyAfterLocationProbe('ASK', 'ZERO', []) === 'ZERO');

  // M3: a broken version that forgets to clear `districts` — the probe would stay scoped to
  // whatever district the model half-parsed, so a real nationwide zero could misreport as "found".
  const brokenIgnoresDistricts = (q: Record<string, unknown>) => ({ ...q, location: '', locationMatch: undefined, regionPin: undefined });
  mustCatch('M3 caught: a broken builder that forgets to clear districts (would keep the probe district-scoped, not nationwide)',
    (brokenIgnoresDistricts({ location: 'x', districts: ['a'] }) as any).districts !== undefined &&
    buildLocationProbeQuery({ location: 'x', districts: ['a'] }).districts === undefined);
}

// ── Wiring shape (source-text, deliberately weak — the real decision is proven above by execution) ─
{
  const agent = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
  check('agent.tsx imports the real functions (not a re-implementation)',
    /import \{ buildLocationProbeQuery, replyAfterLocationProbe \} from '@\/lib\/agentLocationProbe';/.test(agent));
  check('the probe is gated on turn.locationQuestion (never runs on an ordinary reply or the unsearchable statement)',
    /if \(turn\.locationQuestion && turn\.query\) \{/.test(agent));
  check('fetchListingsForQuery is called directly (not store.tsx\'s runQuery) so null vs [] survives',
    /const probe = await fetchListingsForQuery\(buildLocationProbeQuery\(turn\.query\), \{ signal: run\.ac\.signal \}\);/.test(agent));
  check('a cancelled run never writes the probe result into the UI',
    /const probe = await fetchListingsForQuery[\s\S]{0,80}if \(run\.cancelled\) return;/.test(agent));
  check('the resolved reply (not the raw turn.reply) is what actually renders',
    /text: reply, typing: true \} : x\)\),\s*\n\s*\);\s*\n\s*\}$/m.test(agent) || /role: 'agent', text: reply, typing: true/.test(agent));
}

console.log(failed ? `\n${failed} FAILED` : '\nOK — the city question is only ever asked when something could actually match');
process.exit(failed ? 1 : 0);
