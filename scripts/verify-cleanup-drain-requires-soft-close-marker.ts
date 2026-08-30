// Regression guard (2026-08-30, Senior Production run #71 follow-up, owner-directed) for the
// mass-REACTIVATION trap sitting under the aqar/wasalt cleanup backlog.
//
// THE TRAP THIS EXISTS TO PREVENT
// -------------------------------
// `cleanup:aqar` and `cleanup:wasalt` abort every run on the anomaly breaker (~4,925 / ~4,416
// eligible vs a floor of 300). The obvious-looking unblock is to reach for the sanctioned bounded
// drain — `scrapers/common/cleanup.py run(..., bounded_cap=N)`, already exposed as a `bounded_cap`
// workflow input on aqarcity-cleanup.yml and used for the aqarcity backlog on 2026-08-16. Wiring
// that same input into aqar-cleanup.yml / wasalt-cleanup.yml is a two-line change and looks safe.
//
// IT IS NOT SAFE TODAY, AND IT FAILS IN THE DESTRUCTIVE DIRECTION'S MIRROR IMAGE.
//
// aqar does not 404 a closed ad. It serves HTTP 200 with a «مغلق» badge and strips the `offers`
// node out of the JSON-LD — the soft-closed state that `scrapers/aqar/liveness.py looks_closed()`
// was written for on 2026-08-04, two-factor on purpose (badge markup AND missing offers), measured
// 17/17 on closed pages and 0/77 on live ones. That liveness fix is what began accumulating this
// backlog: closed ads now correctly go inactive, age past 30 days, reach 3 strikes, and become
// cleanup-eligible.
//
// But cleanup's own dead-marker for aqar/wasalt, `_aqar_wasalt_markers`, matches only the eight
// DEAD_MARKERS *phrases* — and NONE of them appears on a soft-closed page. Measured live from a
// cloud session on 2026-08-30 over 29 real deletion candidates (14 oldest-first + 15 random, across
// aqar_residential AND aqar_commercial): 29/29 returned HTTP 200 with looks_closed()==true and
// 29/29 were classified LIVE by the cleanup marker. Zero disagreement, zero exceptions.
//
// So a bounded drain unblocked today would not delete those rows — `verdict()` would call every one
// of them 'live' and cleanup's self-heal branch would REACTIVATE them, pushing thousands of closed
// ads back into production search. The anomaly gate aborting is currently the only thing standing
// between that backlog and a mass reactivation, which is exactly why "just raise anomaly_floor"
// was the wrong instinct and was refused.
//
// THE INVARIANT
// -------------
// A platform's cleanup workflow may expose `bounded_cap` ONLY IF that platform's registered
// dead-marker can actually recognise how that platform retires a listing. For a source that
// SOFT-closes (HTTP 200 + a state signal, rather than a 404), the marker must reference that
// platform's soft-close predicate. Enabling the drain and teaching the marker are then one
// reviewed change instead of two innocuous-looking ones, and the trap cannot be armed by halves.
//
// This guard is deliberately NOT a test that `_aqar_wasalt_markers` understands looks_closed()
// today — it does not, that gap is a live finding awaiting an owner retention decision, and a
// barrier that fails on `main` would block every unrelated PR. It pins the SAFE PAIRING instead:
// the gap is fine while the drain is unreachable, and the drain may become reachable only once the
// gap is closed.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const WF_DIR = join(ROOT, '.github', 'workflows');

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

console.log('verify-cleanup-drain-requires-soft-close-marker: a bounded drain may only be reachable');
console.log('  for a platform whose dead-marker can see how that platform actually retires a listing.');

// Platforms whose source SOFT-retires (200 + a state signal, never a 404), and the token that must
// appear in cleanup.py's dead-marker for that platform before its drain may be exposed.
// Adding a platform here is how a future soft-closing source joins the invariant.
const SOFT_RETIRING: Record<string, { token: string; why: string }> = {
  aqar: {
    token: 'looks_closed',
    why: 'aqar serves 200 + «مغلق» badge with no offers node (scrapers/aqar/liveness.py looks_closed)',
  },
  wasalt: {
    token: 'looks_closed',
    why: 'wasalt shares aqar’s marker via _aqar_wasalt_markers, so it inherits the same blind spot',
  },
  aqarcity: {
    token: 'الإعلان منتهي',
    why: 'aqarcity soft-expires with a 200 + «الإعلان منتهي» banner (_aqarcity_expired)',
  },
};

const cleanupSrc = readFileSync(join(ROOT, 'scrapers', 'common', 'cleanup.py'), 'utf8');

/** The body of the dead-marker function registered for `platform` in cleanup.py's PLATFORMS. */
function deadMarkerBodyFor(platform: string): string | null {
  const entry = new RegExp(`"${platform}"\\s*:\\s*\\{[^}]*?"dead_marker"\\s*:\\s*(\\w+)`, 's').exec(cleanupSrc);
  if (!entry) return null;
  const fnName = entry[1];
  // Grab the def and everything up to the next top-level def/assignment.
  const fn = new RegExp(`\\ndef ${fnName}\\b[\\s\\S]*?(?=\\n(?:def |PLATFORMS|[A-Z_]+\\s*[:=]))`, '').exec(cleanupSrc);
  if (!fn) return null;
  // Strip docstrings and comments before the token check. A marker whose EXECUTABLE body no longer
  // tests for the state, but still names it in a comment, must not be able to satisfy this guard —
  // that exact mutation passed an earlier draft.
  return fn[0]
    .replace(/"""[\s\S]*?"""/g, ' ')
    .replace(/'''[\s\S]*?'''/g, ' ')
    .replace(/#[^\n]*/g, ' ');
}

/** Platforms whose cleanup workflow exposes a `bounded_cap` dispatch input. */
function platformsExposingBoundedCap(): string[] {
  const out: string[] = [];
  for (const f of readdirSync(WF_DIR).filter((n) => /-cleanup\.ya?ml$/.test(n))) {
    const src = readFileSync(join(WF_DIR, f), 'utf8');
    // An input named bounded_cap under workflow_dispatch.inputs — not a mere mention in a comment.
    if (/^\s{4,}bounded_cap\s*:/m.test(src)) out.push(f.replace(/-cleanup\.ya?ml$/, ''));
  }
  return out;
}

const exposing = platformsExposingBoundedCap();
check('at least one cleanup workflow was parsed', readdirSync(WF_DIR).some((n) => /-cleanup\.ya?ml$/.test(n)),
  `found: ${readdirSync(WF_DIR).filter((n) => /-cleanup\.ya?ml$/.test(n)).join(', ') || 'NONE'}`);

for (const platform of exposing) {
  const spec = SOFT_RETIRING[platform];
  if (!spec) {
    // A 404-only platform (or one not yet classified) may expose the drain freely — but it must be
    // a deliberate classification, not an omission, so say so out loud.
    check(`${platform}: exposes bounded_cap and is not registered as soft-retiring`, true,
      'no soft-close predicate required');
    continue;
  }
  const body = deadMarkerBodyFor(platform);
  check(`${platform}: dead-marker is resolvable from the PLATFORMS registry`, body !== null);
  if (body === null) continue;
  check(
    `${platform}: exposes bounded_cap, so its dead-marker MUST recognise its soft-retired state`,
    body.includes(spec.token),
    body.includes(spec.token)
      ? `marker references ${spec.token}`
      : `marker does NOT reference ${spec.token} — ${spec.why}. Exposing the bounded drain while ` +
        'the marker is blind to this state makes every eligible row re-probe as LIVE, and cleanup ' +
        'REACTIVATES anything it reads as live. Teach the marker in the SAME change that exposes ' +
        'the drain.',
  );
}

// The other half of the pairing: a soft-retiring platform whose marker is still blind must not be
// reachable. This is what actually holds the aqar/wasalt line today.
for (const [platform, spec] of Object.entries(SOFT_RETIRING)) {
  const body = deadMarkerBodyFor(platform);
  if (body === null) continue;
  const blind = !body.includes(spec.token);
  if (blind) {
    check(
      `${platform}: dead-marker is blind to its soft-retired state, so the drain must stay unreachable`,
      !exposing.includes(platform),
      exposing.includes(platform)
        ? 'bounded_cap IS exposed while the marker cannot see a closed ad — this is the mass-reactivation trap'
        : 'bounded_cap not exposed (correct while the marker is blind)',
    );
  }
}

// The drain itself must still exist and still be gated the way its docstring promises — a future
// refactor that quietly drops the cap composition would make this whole guard meaningless.
check('cleanup.run() still accepts bounded_cap', /def run\([^)]*bounded_cap/s.test(cleanupSrc));
check('bounded mode still hard-caps against max_delete_per_run and the anomaly threshold',
  /caps\s*=\s*\[bounded_cap,\s*pol\["max_delete_per_run"\],\s*math\.floor\(thresh\)\]/.test(cleanupSrc));
check('bounded mode still applies the fraction guard cap when it applies',
  /if frac_applies:\s*\n\s*caps\.append\(math\.floor\(frac_cap\)\)/.test(cleanupSrc));

console.log(
  failures === 0
    ? '\n✅ verify-cleanup-drain-requires-soft-close-marker: all checks passed.'
    : `\n❌ verify-cleanup-drain-requires-soft-close-marker: ${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
