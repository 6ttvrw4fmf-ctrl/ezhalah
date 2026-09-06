// EVERY PLATFORM THAT GAINED AN ORACLE THIS ROUND, EXECUTED — signal by signal, under the law.
//
// WHAT THIS IS FOR
// ----------------
// `scripts/verify-http-liveness-law.ts` proves the shared law cannot be relaxed. It says nothing
// about whether a given platform's `_signal` describes that platform. This file does the other
// half: it imports each shipped `_signal` and runs it against the shapes that platform was
// MEASURED on, plus the shapes the contract says must never kill.
//
// The split matters. A platform signal is a claim about a source, and the only thing that makes it
// true is measurement against real rows with interleaved known-alive controls. Those measurements
// are recorded in each scraper's oracle comment; this file pins the BEHAVIOUR they imply, so a
// later edit that quietly changes what the signal means goes red instead of shipping.
//
// WHY EXECUTED. AGENTS.md: every one of the five defects of 2026-09-04 had a barrier over the exact
// line and every one of those barriers was a source-TEXT tripwire that stayed green for as long as
// the defect was live. So nothing here greps. It imports the real modules and calls the real
// functions, and it reads the prune wiring from each module's SYNTAX TREE, so a docstring that
// mentions `prune_unseen` can never be mistaken for a call site.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  const suffix = ok || !detail ? '' : ' — ' + detail;
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + what + suffix);
  if (!ok) failed++;
};

console.log('verify-absence-oracles-are-measured: each platform signal, executed under the law.');

const HARNESS = String.raw`
import json, os, sys, ast, importlib
sys.path.insert(0, os.getcwd())
import scrapers.common.http_liveness as L

MUT = os.environ.get("MUTATE")

PLATFORMS = ["jazwtn", "mizlaj", "nowaisiry", "souq24", "eastabha"]
out = {}
SIGNALS = {}
for name in PLATFORMS:
    m = importlib.import_module("scrapers.%s.run" % name)
    sig = m._signal
    if MUT:
        target, find, repl = json.loads(MUT)
        if target == name:
            import inspect, textwrap
            src = textwrap.dedent(inspect.getsource(m._signal))
            if find not in src:
                print(json.dumps({"error": "mutation target not found in %s: %r" % (name, find)}))
                sys.exit(0)
            ns = dict(m.__dict__)
            exec(compile(src.replace(find, repl), "<mutant>", "exec"), ns)
            sig = ns["_signal"]

    SIGNALS[name] = sig
    BODY = "<html><title>x</title>" + "y" * 5000 + "</html>"
    def d(status, body=BODY, moved=False, _sig=sig):
        r = L.decide(status, body, moved, _sig)
        return None if r is None else r[0]

    # The contract's UNKNOWN shapes, through THIS platform's signal and the law together.
    never = {k: d(s) for k, s in
             (("net", None), ("401", 401), ("403", 403), ("407", 407), ("408", 408),
              ("429", 429), ("500", 500), ("502", 502), ("503", 503), ("504", 504))}
    never["empty200"] = d(200, "")
    never["empty404"] = d(404, "")

    row = {
        "never": never,
        "gone_404": d(404),
        "gone_410": d(410),
        "redirect_404": d(404, BODY, True),
        "plain_200": d(200),
        "redirect_200": d(200, BODY, True),
    }

    # The prune wiring, from the SYNTAX TREE — a docstring is not a call site.
    tree = ast.parse(open(m.__file__, encoding="utf-8").read())
    sites = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) \
           and node.func.attr == "prune_unseen":
            kw = {k.arg for k in node.keywords if k.arg}
            sites.append("verify_gone" in kw)
    row["prune_sites"] = len(sites)
    row["prune_all_wired"] = bool(sites) and all(sites)
    row["uses_shared_law"] = isinstance(getattr(m, "_probe", None), L.LivenessProbe)
    out[name] = row

# eastabha: the listing's OWN status ribbon must decide, and the related-listings carousel must not.
import scrapers.eastabha.run as ea
OWN_TERMINAL = '<div class="slider-property-status horizontalstatus ribbon-wrapper-x">تأجرت</div>'
OWN_SOLD     = '<div class="slider-property-status x">تم البيع</div>'
OWN_CATEGORY = '<div class="slider-property-status x">فيلا للبيع</div>'
CAROUSEL     = '<div class="ribbon-inside تم-البيع">تم البيع</div>'
def ea_d(status, body, moved=False):
    # SIGNALS["eastabha"], not ea._signal: under MUTATE the mutant lives in SIGNALS, and reading the
    # pristine module attribute here would make every eastabha mutation survive by construction.
    r = L.decide(status, body, moved, SIGNALS["eastabha"])
    return None if r is None else r[0]
out["eastabha"]["own_terminal_rented"] = ea_d(200, OWN_TERMINAL)
out["eastabha"]["own_terminal_sold"]   = ea_d(200, OWN_SOLD)
out["eastabha"]["own_category_only"]   = ea_d(200, OWN_CATEGORY)
out["eastabha"]["carousel_only"]       = ea_d(200, CAROUSEL)
out["eastabha"]["carousel_plus_live"]  = ea_d(200, OWN_CATEGORY + CAROUSEL)
out["eastabha"]["vocab_is_shared"]     = list(ea.GONE_STATUS_AR)

# souq24's id parser: strict, because a loose one probes another platform's page.
import scrapers.souq24.run as sq
out["souq24"]["pid_ok"] = sq._pid_of("SQ24-1278")
out["souq24"]["pid_bad"] = [sq._pid_of(x) for x in ("SQ24-", "1278", "RG1278", "", None, "SQ24-1a")]

print(json.dumps(out))
`;

type Row = {
  never: Record<string, string | null>;
  gone_404: string | null; gone_410: string | null; redirect_404: string | null;
  plain_200: string | null; redirect_200: string | null;
  prune_sites: number; prune_all_wired: boolean; uses_shared_law: boolean;
  pid_ok?: number | null; pid_bad?: (number | null)[];
};
type Result = Record<string, Row> & { error?: string };

const run = (mutate?: [string, string, string]): Result => {
  const out = execFileSync('python3', ['-c', HARNESS], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, ...(mutate ? { MUTATE: JSON.stringify(mutate) } : {}) },
  });
  return JSON.parse(out.trim().split('\n').pop() as string) as Result;
};

const PLATFORMS = ['jazwtn', 'mizlaj', 'nowaisiry', 'souq24', 'eastabha'] as const;

// What each platform was MEASURED to do. Changing a row here is changing a claim about a source,
// which needs a fresh measurement — not a convenient edit.
const MEASURED: Record<string, { gone: string[]; notGone: string[] }> = {
  // 29/31 dead rows 404; 40/40 controls 200 and not redirected. A redirect is UNKNOWN here.
  jazwtn: { gone: ['gone_404', 'gone_410'], notGone: ['redirect_200', 'redirect_404', 'plain_200'] },
  mizlaj: { gone: ['gone_404', 'gone_410'], notGone: ['redirect_200', 'redirect_404', 'plain_200'] },
  nowaisiry: { gone: ['gone_404', 'gone_410'], notGone: ['redirect_200', 'redirect_404', 'plain_200'] },
  // 14/14 dead rows answered 200 REDIRECTED; 40/40 controls 200 not redirected. The redirect IS
  // the signal on this one source, and only on it.
  souq24: { gone: ['gone_404', 'gone_410', 'redirect_200'], notGone: ['plain_200'] },
  // 39/41 dead rows carried a terminal ribbon; 0/45 controls did. A bare 200 says nothing.
  eastabha: { gone: ['gone_404', 'gone_410'], notGone: ['redirect_200', 'redirect_404', 'plain_200'] },
};

const holds = (r: Result): string[] => {
  const h: string[] = [];
  for (const p of PLATFORMS) {
    const row = r[p];
    if (!row) continue;
    for (const [k, v] of Object.entries(row.never)) if (v !== 'gone') h.push(`${p}:never:${k}`);
    for (const k of MEASURED[p].gone) if ((row as any)[k] === 'gone') h.push(`${p}:gone:${k}`);
    for (const k of MEASURED[p].notGone) if ((row as any)[k] !== 'gone') h.push(`${p}:notgone:${k}`);
  }
  const ea = r.eastabha as unknown as Record<string, unknown> | undefined;
  if (ea) {
    if (ea.own_terminal_rented === 'gone') h.push('eastabha:own-rented');
    if (ea.own_terminal_sold === 'gone') h.push('eastabha:own-sold');
    if (ea.own_category_only !== 'gone') h.push('eastabha:category-not-a-removal');
    if (ea.carousel_only !== 'gone') h.push('eastabha:carousel-not-mine');
    if (ea.carousel_plus_live !== 'gone') h.push('eastabha:carousel-beside-live-not-mine');
  }
  return h;
};

const base = run();
check(!base.error, 'every wired scraper imports and its signal runs', base.error ?? '');
if (base.error) { console.log('\n❌ verify-absence-oracles-are-measured: harness failed.'); process.exit(1); }

const TOTAL = holds(base).length;

for (const p of PLATFORMS) {
  const row = base[p];
  check(!!row, p + ': present');
  if (!row) continue;
  for (const [k, v] of Object.entries(row.never)) {
    check(v !== 'gone', `${p}: ${k} can never be a death`,
      `returned ${JSON.stringify(v)} — the contract calls this shape UNKNOWN`);
  }
  for (const k of MEASURED[p].gone) {
    check((row as any)[k] === 'gone', `${p}: ${k} IS this source's measured removal signal`,
      `returned ${JSON.stringify((row as any)[k])} — an oracle that never kills leaves dead ` +
      'inventory searchable forever, which is the other way this fails');
  }
  for (const k of MEASURED[p].notGone) {
    check((row as any)[k] !== 'gone', `${p}: ${k} is NOT a removal on this source`,
      `returned ${JSON.stringify((row as any)[k])}`);
  }
  check(row.uses_shared_law,
    `${p}: goes through the shared law, not a local copy of it`,
    'its _probe is not a http_liveness.LivenessProbe — a private copy of the law can be weakened ' +
    'without any of the law barriers noticing');
  check(row.prune_sites > 0, `${p}: still calls prune_unseen (this barrier is not vacuous)`);
  check(row.prune_all_wired, `${p}: EVERY prune_unseen call site carries verify_gone`,
    'an unguarded second prune path deactivating on absence beside the good one is the exact ' +
    'shape already recorded on gathern and dealapp');
}

// eastabha: the carousel trap, pinned. A whole-document substring search for «تم البيع» matched
// LIVE pages (1 of 4 measured), and every one of those matches belonged to a DIFFERENT listing in
// the related-listings carousel. Only `slider-property-status` belongs to THIS listing.
const ea = base.eastabha as unknown as Record<string, unknown>;
check(ea.own_terminal_rented === 'gone', 'eastabha: this listing OWN ribbon reading تأجرت IS a removal');
check(ea.own_terminal_sold === 'gone', 'eastabha: this listing OWN ribbon reading تم البيع IS a removal');
check(ea.own_category_only !== 'gone',
  'eastabha: a CATEGORY ribbon (فيلا للبيع) is not a removal — the status taxonomy mixes type labels in');
check(ea.carousel_only !== 'gone',
  'eastabha: a تم البيع in the related-listings CAROUSEL is not about this listing',
  'this is the exact false positive a whole-document substring search produces on live pages');
check(ea.carousel_plus_live !== 'gone',
  'eastabha: …not even when the carousel marker sits beside this listing OWN live ribbon');
check(Array.isArray(ea.vocab_is_shared) && (ea.vocab_is_shared as string[]).length === 2,
  'eastabha: the gone vocabulary has ONE definition, shared with the API path (GONE_STATUS_AR)',
  'a second copy would let the prune oracle and the capture path drift apart about what gone means');

check(base.souq24.pid_ok === 1278, 'souq24: SQ24-1278 parses to its pid', String(base.souq24.pid_ok));
check((base.souq24.pid_bad ?? []).every((x) => x === null),
  'souq24: every malformed ad_number yields no pid rather than a guessed one',
  JSON.stringify(base.souq24.pid_bad));

// ─────────────────────────────────────────────────────────────────────────────────────────────
// MUTATION PROOF — real defects introduced into each shipped signal and executed.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const mustCatch = (what: string, mutate: [string, string, string]) => {
  const r = run(mutate);
  if (r.error) { check(false, '(mutation) ' + what, r.error); return; }
  check(holds(r).length < TOTAL, '(mutation) catches ' + what,
    'MUTANT SURVIVED — every assertion above still held with the defect present');
};

// The original defect in its purest form, per platform: call everything gone.
for (const p of PLATFORMS) {
  mustCatch(`${p} treating a non-answer as a removal`,
    [p, '    if path_changed:', '    if True:\n        return "gone"\n    if path_changed:']);
}
// The removal signal stops working: dead inventory stays searchable forever.
for (const p of ['jazwtn', 'mizlaj', 'nowaisiry']) {
  mustCatch(`${p} losing its 404 removal signal`,
    [p, '    if status in (404, 410):\n        return "gone"', '    if False:\n        return "gone"']);
}
// souq24's redirect signal is the one that is easy to delete by "tidying up" toward the others.
mustCatch('souq24 losing the redirect that IS its removal signal',
  ['souq24', '    if path_changed:\n        # Sent away from this ad', '    if False:\n        # Sent away from this ad']);
// eastabha reading the whole document instead of its own element — the carousel trap, restored.
mustCatch('eastabha reading the related-listings carousel as this listing status',
  ['eastabha', "    own = [s.strip() for s in _OWN_STATUS_RE.findall(body or \"\")]",
   "    own = [\"تم البيع\"] if \"تم البيع\" in (body or \"\") else []"]);
// …and eastabha losing its terminal-status signal entirely.
mustCatch('eastabha losing the sold/rented ribbon that IS its removal signal',
  ['eastabha', '    if any(s in GONE_STATUS_AR for s in own):', '    if False:']);
// …and the inverse: a platform adopting souq24's redirect rule without measuring it.
mustCatch('jazwtn adopting a redirect-means-gone rule it never measured',
  ['jazwtn', '    if path_changed:\n        return None', '    if path_changed:\n        return "gone"']);

console.log(failed === 0
  ? '\n✅ verify-absence-oracles-are-measured: every signal says only what its source was measured to say.'
  : '\n❌ verify-absence-oracles-are-measured: ' + failed + ' check(s) failed.');
process.exit(failed === 0 ? 0 : 1);
