// PROVE THE FILING PATH, ON DEMAND.
//
// THE ONE LINK THAT HAS NEVER FIRED. Every other line of the guardian suite is exercised on every
// run, but openIncident() only executes when a journey FAILS — and every journey has passed since
// the suite was written. So the single most important call in the whole loop, the one that turns a
// finding into owned work, has never actually been made against production. A path that has never
// executed is not a working path; it is an assumption. scripts/verify-guardian-journeys.ts can prove
// the ARGUMENTS match incident_open()'s signature, but only a real round trip proves the
// credentials, the RLS grant, the PostgREST route and the JSON shape all agree.
//
// WHY THIS IS A SEPARATE FILE. The barrier forbids run.mjs from calling any incident lifecycle RPC
// other than incident_open, because a passing journey must never close an incident ("it stopped
// reproducing" is not "fixed, with a barrier"). Putting the self-test inside run.mjs would have
// forced that rule to become "may close, but only under these conditions" — a weaker property that
// is harder to check and easier to erode. The barrier caught exactly that when it was tried. So the
// runner keeps its blunt, checkable invariant (it cannot close anything, full stop) and the proof
// lives here. It also keeps run.mjs with exactly ONE incident_open call site, which is what makes
// the barrier's drop-a-parameter mutation proof able to fail.
//
// It files ONE synthetic P3 and closes it immediately as wont_fix, leaving an auditable row and no
// open noise. Never automatic — same shape as the deploy workflow's dry_run: an explicit way to
// prove a pipe is connected without pretending something happened.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node e2e/guardian/prove-filing.mjs

const FINGERPRINT = 'guardian:self-test:filing';

const url = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!url || !key) {
  console.error('✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set — NOTHING WAS PROVEN.');
  process.exit(1);
}

async function rpc(fn, body) {
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${fn} → HTTP ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const runRef = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : 'local';

try {
  const id = await rpc('incident_open', {
    p_fingerprint: FINGERPRINT,
    p_title: 'Guardian filing-path self-test (not a defect)',
    p_surface: 'monitoring',
    p_severity: 'P3',
    p_source: 'journey',
    p_source_ref: runRef,
    p_detail: {
      note: 'Synthetic. Proves e2e/guardian/run.mjs can reach incident_open() with real credentials.',
      opened_by: 'e2e/guardian/prove-filing.mjs',
    },
  });
  if (!id) throw new Error('incident_open returned no id');
  console.log(`✓ incident_open reached production and returned #${id}`);

  await rpc('incident_wont_fix', {
    p_id: id,
    p_reason: 'Synthetic self-test of the guardian filing path — closed immediately by the run that opened it.',
  });
  console.log(`✓ incident #${id} closed as wont_fix — the filing path is PROVEN end to end`);
  process.exit(0);
} catch (e) {
  console.error(`✗ FILING PATH BROKEN: ${String(e.message ?? e)}`);
  console.error('  A guardian journey that failed today would have found a defect and told nobody.');
  process.exit(1);
}
