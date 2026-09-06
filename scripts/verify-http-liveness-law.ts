// UNKNOWN IS NOT DEAD — the shared law, executed against every shape the contract names.
//
// WHAT THIS GUARDS
// ----------------
// scrapers/common/http_liveness.py holds the three-valued law for every HTML-page platform that
// gained a `verify_gone` oracle. Before it existed, each platform carried its own copy of the law
// next to its own source semantics — and those are different kinds of thing. The signal is
// per-platform and must be MEASURED (aqargate flips a WordPress status, raghdan 404s, sanadak
// soft-404s with a 200 shell, souq24 redirects off the listing path). The law is universal: a 403
// is not a death on any platform, ever. N copies of the law is N chances to weaken it, and a
// weakened copy looks exactly like a correct one right up until it deletes something.
//
// So the law is enforced in one place that a caller CANNOT relax, and this file executes it.
// docs/ops/LISTING_LIVENESS.md §1 enumerates the UNKNOWN shapes; every one of them is a row below,
// asserted against a platform signal that says "gone" to absolutely everything. That adversarial
// signal is the point: if the law holds when the platform is maximally wrong, it holds.
//
// WHY EXECUTED AND NOT GREPPED. AGENTS.md: all five defects of 2026-09-04 had a barrier over the
// exact line, and every one of those barriers was a source-TEXT tripwire that stayed green for the
// entire time the defect was live — two of them pinned the defective line as correct. This file
// imports the real `decide`, `read_is_unbelievable` and `LivenessProbe` and runs them.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  const suffix = ok || !detail ? '' : ' — ' + detail;
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + what + suffix);
  if (!ok) failed++;
};

console.log('verify-http-liveness-law: the shared law cannot be relaxed by any platform.');

const HARNESS = String.raw`
import json, os, sys, inspect, textwrap
sys.path.insert(0, os.getcwd())
import scrapers.common.http_liveness as L

mut = os.environ.get("MUTATE")
if mut:
    find, repl = json.loads(mut)
    src = textwrap.dedent(inspect.getsource(L.decide))
    if find not in src:
        print(json.dumps({"error": "mutation target not found: %r" % find})); sys.exit(0)
    ns = dict(L.__dict__)
    exec(compile(src.replace(find, repl), "<mutant>", "exec"), ns)
    L.decide = ns["decide"]

BODY = "<html><title>a real listing</title>" + "x" * 4000 + "</html>"

# THE ADVERSARIAL PLATFORM: it calls everything dead. The law must still refuse every unbelievable
# read. Anything that comes back 'gone' here is a shape the law lets a wrong platform kill on.
say_gone = lambda status, body, moved: "gone"
say_live = lambda status, body, moved: "live"
say_none = lambda status, body, moved: None
def say_boom(status, body, moved): raise ValueError("parser exploded")
say_junk = lambda status, body, moved: "probably-gone"

def v(fn, status, body=BODY, moved=False):
    r = L.decide(status, body, moved, fn)
    return None if r is None else r[0]

# Every UNKNOWN shape docs/ops/LISTING_LIVENESS.md section 1 enumerates, against say_gone.
law = {
  "network_error":     v(say_gone, None, ""),
  "401":               v(say_gone, 401),
  "402":               v(say_gone, 402),
  "403":               v(say_gone, 403),
  "407":               v(say_gone, 407),
  "408":               v(say_gone, 408),
  "429":               v(say_gone, 429),
  "500":               v(say_gone, 500),
  "502":               v(say_gone, 502),
  "503":               v(say_gone, 503),
  "504":               v(say_gone, 504),
  "599":               v(say_gone, 599),
  "200_empty_body":    v(say_gone, 200, ""),
  "404_empty_body":    v(say_gone, 404, ""),
}
# The affirmative limbs the law must still PERMIT, or an oracle degrades into "never kill" and dead
# inventory stays searchable forever.
permits = {
  "404_with_body":     v(say_gone, 404),
  "410_with_body":     v(say_gone, 410),
  "200_gone_signal":   v(say_gone, 200),
  "redirect_gone":     v(say_gone, 200, BODY, True),
  "200_live_signal":   v(say_live, 200),
}
# A live reading survives a degraded run (a block cannot manufacture a live page) but not an
# unreadable one.
restorative = {
  "live_on_403":       v(say_live, 403),
  "live_on_500":       v(say_live, 500),
  # An ALIVE claim on a body we could not read is a RETRY, not a certification (and the probe rows
  # below prove an exhausted budget ends as unknown, never as live).
  "live_on_empty":     v(say_live, 200, ""),
  "live_on_no_answer": v(say_live, None, ""),
}
probe_restorative = None
# A platform with no opinion, and platforms that misbehave.
misc = {
  "no_opinion_200":    v(say_none, 200),
  "no_opinion_403":    v(say_none, 403),
  "no_opinion_404":    v(say_none, 404),
  "signal_raises":     v(say_boom, 404),
  "signal_junk":       v(say_junk, 404),
}
unbelievable = {
  "none":   L.read_is_unbelievable(None, BODY) is not None,
  "403":    L.read_is_unbelievable(403, BODY) is not None,
  "503":    L.read_is_unbelievable(503, BODY) is not None,
  "empty":  L.read_is_unbelievable(200, "") is not None,
  "ok_404": L.read_is_unbelievable(404, BODY) is None,
  "ok_200": L.read_is_unbelievable(200, BODY) is None,
}

# The whole probe, executed against an injected transport: no network, no clock.
import time as _t
_t.sleep = lambda *a, **k: None

class Stub:
    def __init__(self, seq): self.seq = list(seq)
    def get(self, url, timeout=None, allow_redirects=None):
        item = self.seq.pop(0)
        if isinstance(item, Exception): raise item
        class R:
            status_code = item[0]
            text = item[1]
            url = item[2] if len(item) > 2 else "https://x.test/listing/1"
        return R()

def probe(seq, signal=say_gone, url="https://x.test/listing/1"):
    # ONE stub for the whole probe: LivenessProbe calls session() per attempt, so handing back a
    # fresh Stub would replay attempt 1 forever and the retry path would never be exercised.
    stub = Stub(seq)
    p = L.LivenessProbe("t", signal, lambda: stub, lambda ad: url, attempts=2)
    return p.verify_gone("AD1")[0]

wired = {
  "blocked_twice":       probe([(403, BODY), (403, BODY)]),
  "timeout_twice":       probe([OSError("reset"), OSError("reset")]),
  "5xx_twice":           probe([(500, BODY), (503, BODY)]),
  "transient_then_gone": probe([OSError("x"), (404, BODY)]),
  "transient_then_live": probe([(500, BODY), (200, BODY)], say_live),
  "removed":             probe([(404, BODY)]),
  "unresolvable_ad":     L.LivenessProbe("t", say_gone, lambda: Stub([]), lambda ad: None).verify_gone("AD1")[0],
  "reason_names_the_block": L.LivenessProbe("t", say_gone, (lambda st=Stub([(403, BODY), (403, BODY)]): st), lambda ad: "https://x.test/l/1", attempts=2).verify_gone("AD1")[1],
  "redirect_detected":   probe([(200, BODY, "https://x.test/somewhere-else")], lambda s, b, moved: "gone" if moved else None),
  "no_redirect":         probe([(200, BODY, "https://x.test/listing/1")], lambda s, b, moved: "gone" if moved else None),
  # A transient failure must not spend the whole budget on one blip: attempt 1 is retried.
  "live_claim_on_empty_twice": probe([(200, ""), (200, "")], say_live),
  "live_claim_empty_then_ok":  probe([(200, ""), (200, BODY)], say_live),
  "gone_claim_blocked_then_ok": probe([(403, BODY), (404, BODY)], say_gone),
}
print(json.dumps({"law": law, "permits": permits, "restorative": restorative,
                  "misc": misc, "unbelievable": unbelievable, "wired": wired}))
`;

type R = Record<string, string | null | boolean>;
type Result = { law?: R; permits?: R; restorative?: R; misc?: R; unbelievable?: R; wired?: R; error?: string };

const run = (mutate?: [string, string]): Result => {
  const out = execFileSync('python3', ['-c', HARNESS], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, ...(mutate ? { MUTATE: JSON.stringify(mutate) } : {}) },
  });
  return JSON.parse(out.trim().split('\n').pop() as string) as Result;
};

const UNKNOWN_SHAPES = ['network_error', '401', '402', '403', '407', '408', '429',
  '500', '502', '503', '504', '599', '200_empty_body', '404_empty_body'];
const PERMITS = ['404_with_body', '410_with_body', '200_gone_signal', 'redirect_gone'];

// `holds` is the judgement, so a mutation proof can watch it shrink.
const holds = (r: Result): string[] => {
  const h: string[] = [];
  for (const k of UNKNOWN_SHAPES) if (r.law?.[k] !== 'gone') h.push('law:' + k);
  for (const k of PERMITS) if (r.permits?.[k] === 'gone') h.push('permit:' + k);
  if (r.permits?.['200_live_signal'] === 'live') h.push('permit:live');
  if (r.restorative?.live_on_403 === 'live') h.push('restore:403');
  if (r.restorative?.live_on_500 === 'live') h.push('restore:500');
  if (r.restorative?.live_on_empty === null) h.push('restore:empty-refused');
  if (r.misc?.signal_raises === 'unknown') h.push('misc:raises');
  if (r.misc?.signal_junk === 'unknown') h.push('misc:junk');
  return h;
};
const TOTAL = UNKNOWN_SHAPES.length + PERMITS.length + 6;

const base = run();
check(!base.error, 'the shared law imports and runs', base.error ?? '');

for (const k of UNKNOWN_SHAPES) {
  check(base.law?.[k] !== 'gone',
    'a platform calling everything dead still cannot kill on ' + k,
    'decide() returned ' + JSON.stringify(base.law?.[k]) + ' — this shape is about our read');
}
for (const k of PERMITS) {
  check(base.permits?.[k] === 'gone',
    'an affirmative removal is still PERMITTED on ' + k,
    'returned ' + JSON.stringify(base.permits?.[k]) +
    ' — a law that permits nothing leaves dead inventory searchable forever');
}
check(base.permits?.['200_live_signal'] === 'live', 'an affirmative ALIVE reading is permitted');

// The deliberate asymmetry: restorative writes are never gated (DELETION_SAFETY.md §2.4).
check(base.restorative?.live_on_403 === 'live',
  'an ALIVE reading survives a 403 — a block cannot manufacture a live page');
check(base.restorative?.live_on_500 === 'live', 'an ALIVE reading survives a 5xx');
check(base.restorative?.live_on_empty === null,
  'but an ALIVE claim on an EMPTY body is RETRIED, never certified — a shell may not manufacture a verification');
check(base.restorative?.live_on_no_answer === null,
  'and an ALIVE claim with no answer at all is retried, never certified');
check(base.wired?.live_claim_on_empty_twice === 'unknown',
  '…and an exhausted budget of empty bodies ends as unknown, never as live');
check(base.wired?.live_claim_empty_then_ok === 'live',
  '…while an empty body followed by a real one is correctly live (the retry is not wasted)');
check(base.wired?.gone_claim_blocked_then_ok === 'gone',
  'a block followed by a real 404 still reaches the removal — one blip must not spend the budget');

check(base.misc?.signal_raises === 'unknown',
  'a platform signal that RAISES yields unknown, never a kill');
check(base.misc?.signal_junk === 'unknown',
  'a platform signal returning a fourth value is not trusted with any of the three');
check(base.misc?.no_opinion_200 === null, 'no opinion on a believable read means retry');
check(base.misc?.no_opinion_403 === null, 'no opinion on a block means retry (then unknown)');

for (const [k, want] of Object.entries({ none: true, '403': true, '503': true, empty: true, ok_404: true, ok_200: true })) {
  check(base.unbelievable?.[k] === want, 'read_is_unbelievable is right about ' + k);
}

for (const k of ['blocked_twice', 'timeout_twice', '5xx_twice']) {
  check(base.wired?.[k] === 'unknown',
    'LivenessProbe: ' + k + " exhausts its retries as 'unknown'",
    'returned ' + JSON.stringify(base.wired?.[k]));
}
check(base.wired?.transient_then_gone === 'gone', 'LivenessProbe: a transient error then a 404 is gone');
check(base.wired?.transient_then_live === 'live', 'LivenessProbe: a transient 5xx then a live read is live');
check(base.wired?.removed === 'gone', 'LivenessProbe: a removed listing is gone');
check(base.wired?.unresolvable_ad === 'unknown',
  'LivenessProbe: an ad with no URL is unknown, never a kill on an unprobed row');
check(base.wired?.redirect_detected === 'gone',
  'LivenessProbe: a platform may treat a redirect off the listing path as its removal signal');
check(base.wired?.no_redirect === 'unknown',
  'LivenessProbe: …and does not see a redirect that did not happen');
// An UNKNOWN that does not say WHY is unfalsifiable from the record (ops_incident #84: the aqarcity
// oracle was found mapping "unparseable page" to gone, and deciding whether 254 same-day kills were
// right needed a by-hand re-probe because nothing stored said which condition had fired).
check(typeof base.wired?.reason_names_the_block === 'string' &&
      /about our access/.test(base.wired.reason_names_the_block as string),
  'an exhausted budget records WHY it is unknown, not merely that it is',
  JSON.stringify(base.wired?.reason_names_the_block));

// ─────────────────────────────────────────────────────────────────────────────────────────────
// MUTATION PROOF — real weakenings of the law, applied to the shipped source and executed.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const mustCatch = (what: string, mutate: [string, string]) => {
  const r = run(mutate);
  if (r.error) { check(false, '(mutation) ' + what, r.error); return; }
  check(holds(r).length < TOTAL, '(mutation) catches ' + what,
    'MUTANT SURVIVED — every assertion above still held with the defect present');
};

// The whole point of the module, removed: the platform's word becomes final.
mustCatch('the law no longer overriding a platform that calls a blocked read dead',
  ['    unbelievable = read_is_unbelievable(status, body or "")\n    if unbelievable:',
   '    unbelievable = read_is_unbelievable(status, body or "")\n    if False:']);
// The opposite failure: nothing may ever be killed, so dead inventory stays searchable.
mustCatch('the law refusing every removal (an oracle that can never deactivate)',
  ['return "gone", f"source confirms removal (HTTP {status})"', 'return "unknown", "mutant"']);
// A raising signal resolved instead of held.
mustCatch('a platform signal that raises being treated as a verdict',
  ['return "unknown", f"the platform signal raised {type(e).__name__}: {e}"',
   'return "gone", "mutant"']);
// A fourth value trusted.
mustCatch('a signal returning a non-verdict being trusted',
  ['return "unknown", f"the platform signal returned {said!r}, which is not a verdict"',
   'return "gone", "mutant"']);
// The live limb stops working — the restore leg silently disappears.
mustCatch('the ALIVE limb no longer certifying a served listing',
  ['return "live", f"source still serves this listing (HTTP {status})"',
   'return "unknown", "mutant"']);
// An empty body accepted as a live verification.
mustCatch('an empty body being accepted as proof of life',
  ['if status is None or not body:', 'if False:']);

// The control: an edit that changes nothing relevant must NOT read as caught.
const noop = run(['# --- law ---', '# --- law (unchanged) ---']);
check(noop.error ? true : holds(noop).length === TOTAL,
  '(control) an irrelevant edit does NOT trip the judgement',
  'the judgement goes red on any change at all, so its red carries no information');

console.log(failed === 0
  ? '\n✅ verify-http-liveness-law: no platform can turn an UNKNOWN read into a death.'
  : '\n❌ verify-http-liveness-law: ' + failed + ' check(s) failed.');
process.exit(failed === 0 ? 0 : 1);
