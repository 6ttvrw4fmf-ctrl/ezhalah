// The aqar soft-close oracle must actually FIRE on a page aqar has closed.
// Routine #3 (data integrity), 2026-09-25.
//
// THE BUG THIS PINS
// -----------------
// `scrapers/aqar/liveness.py::looks_closed()` is the only thing standing between a closed aqar ad
// and permanent searchable life: aqar does not 404 a closed ad, it serves HTTP 200. On 2026-09-25
// the oracle could not return True for ANY page. Its factor 1 searched for server-rendered markup
// around «مغلق»; aqar had moved the listing page to client-side rendering, so the banner is painted
// by JS from the payload and no badge markup reaches the HTML. What does reach it is an i18n label
// bundle shipped to EVERY page — live ones included — carrying «مغلق» as a dictionary VALUE
// (`listing_status.closed`, `closed_banner.title`). So the word-presence pre-check passed on live
// pages and the badge regex failed on closed ones: the detector was structurally unable to fire.
//
// The consequence was not silence, it was a false positive in the dangerous direction. A page that
// fails looks_dead() falls through to the ALIVE branch, which writes last_verified_alive_at via
// direct_alive_patch(). Rows 874 and 882 were affirmatively certified ALIVE on the morning of
// 2026-09-25 while aqar served them `closed:true` with price, area, content and create_time all
// null. aqar states in that same bundle what the flag means: a closed ad
// «يظهر هذا الإعلان في صفحة حسابك فقط (لا يظهر على الخريطة أو عند البحث)».
//
// Measured that day: 6/6 source-confirmed closed ads scored badge_match=false; 4 of 75 random
// active rows (5.3%) were closed-at-source and still served.
//
// WHAT MUST NOT REGRESS
//   * a closed page must score True — the whole point, and the half that was dead;
//   * a LIVE page must score False, even though it also carries «مغلق» in the i18n bundle;
//   * BOTH factors must be required: a page carrying `closed:true` beside a published offers node
//     is contradictory and must NOT be killed on one signal. (0 such pages in the 75 sampled, but
//     the two-factor design is what keeps a single drifting signal from causing a false kill.)
//   * the i18n label «مغلق» as a STRING must never satisfy factor 1 — only the boolean does.
//
// Every assertion below EXECUTES the real function lifted out of the shipped module — never a
// re-implementation, never a source-text grep. A source-text tripwire is exactly what let the
// previous factor 1 sit dead for weeks while reading as covered.
//
// Fixtures are real excerpts of real aqar pages fetched 2026-09-25 (provenance in each file's
// first line), trimmed to keep the decisive content INCLUDING the i18n bundle, which is the
// adversarial part.
//
// Deliberately OFFLINE — no DB, no network. Hermetic by construction.
//   node --experimental-strip-types scripts/verify-aqar-soft-close-oracle-can-fire.ts

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const FIXTURES = join(ROOT, 'scrapers', 'aqar', 'testdata');

const CLOSED = readFileSync(join(FIXTURES, 'aqar_soft_closed_page.excerpt.html'), 'utf8');
const LIVE = readFileSync(join(FIXTURES, 'aqar_live_page.excerpt.html'), 'utf8');

let failed = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failed++;
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Lift the REAL looks_closed() out of the shipped module. The module imports the DB client at
// import time, so the predicate is exec'd out of the source rather than imported — the bytes under
// test are the bytes that ship. MUTATE lets the harness swap factor 1 or factor 2 for the broken
// form, so a barrier that cannot fail is itself detected.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const HARNESS = String.raw`
import json, os, re, sys

src = open("scrapers/aqar/liveness.py", encoding="utf-8").read()

mutate = os.environ.get("MUTATE")
if mutate == "old_badge_factor1":
    # The pre-2026-09-25 factor 1: the badge branch ALONE, with the word pre-check that gated it.
    src = src.replace(
        "    if not (_CLOSED_FLAG_RE.search(body) or _closed_badge(body)):\n        return False",
        "    if 'مغلق' not in body:\n        return False\n"
        "    if not _closed_badge(body):\n        return False")
elif mutate == "drop_badge_branch":
    # Retiring the badge instead of keeping it beside the flag.
    src = src.replace(
        "    if not (_CLOSED_FLAG_RE.search(body) or _closed_badge(body)):\n        return False",
        "    if not _CLOSED_FLAG_RE.search(body):\n        return False")
elif mutate == "drop_factor2":
    src = src.replace(
        "    has_offer = '\"offers\"' in body or '\"price\"' in body\n    return not has_offer",
        "    return True")
elif mutate == "accept_string_flag":
    # Factor 1 keyed on the KEY rather than the boolean — the i18n label would satisfy it.
    src = src.replace(
        "_CLOSED_FLAG_RE = re.compile(r'\\\\?\"closed\\\\?\"\\s*:\\s*true')",
        "_CLOSED_FLAG_RE = re.compile(r'\\\\?\"closed\\\\?\"')")

if mutate and src == open("scrapers/aqar/liveness.py", encoding="utf-8").read():
    # A mutant whose replacement silently matched nothing is a mutation proof that proves nothing.
    print(json.dumps({"__error__": "MUTATE=%s changed no source" % mutate}))
    sys.exit(0)

ns = {"re": re, "os": os}
seg = src[src.index("_CLOSED_FLAG_RE = "):src.index("# Deactivating on the repaired factor 1")]
exec(seg, ns)
i = src.index("def looks_closed")
j = src.index("\ndef ", i + 5)
exec(src[i:j], ns)

bodies = json.loads(sys.stdin.read())
print(json.dumps({k: bool(ns["looks_closed"](v)) for k, v in bodies.items()}))
`;

const run = (bodies: Record<string, string>, mutate?: string): Record<string, boolean> => {
  const out = execFileSync('python3', ['-c', HARNESS], {
    cwd: ROOT,
    input: JSON.stringify(bodies),
    encoding: 'utf8',
    env: { ...process.env, ...(mutate ? { MUTATE: mutate } : {}) },
    maxBuffer: 32 * 1024 * 1024,
  });
  const parsed = JSON.parse(out.trim().split('\n').pop() as string);
  if (parsed.__error__) {
    console.log(`  FAIL harness — ${parsed.__error__}`);
    failed++;
    return {};
  }
  return parsed;
};

// A page that carries aqar's closed flag AND a published offers node. Contradictory, and therefore
// the case that proves two-factor is really two-factor rather than factor 1 wearing a hat.
const CONTRADICTORY = CLOSED + '\n<script type="application/ld+json">{"offers":{"price":"850000"}}</script>';

// «طلب تسويق» — an OPEN ad that simply withholds its price. It has no offers node, so factor 2
// alone would kill it; only factor 1 reading the boolean `false` spares it. This is the cohort the
// oracle's docstring has promised to spare since 2026-08-04 (21 of 150 sampled pages that day), and
// the reason factor 1 must key on aqar's state flag rather than on the absence of a price.
const MARKETING_REQUEST = CLOSED.replace('\\"closed\\":true', '\\"closed\\":false');

// The pre-2026-09-25 server-rendered form, the shape
// scrapers/common/tests/test_aqar_soft_close_detection.py pins. It is kept beside the structured
// flag rather than replaced by it: its absence from today's pages is a measurement, not a promise
// that it can never appear again (a cached page, another render path, another aqar surface).
// `scrapers/common/cleanup.py` imports this same predicate, so both consumers ride on it.
const BADGE_ONLY = '<div class="listing"><span class="badge badge-danger">مغلق</span><h1>شقة</h1></div>';
// «مغلق» as bare description text beside a published price — a live gated compound. Neither factor
// may fire on it.
const GATED_COMPOUND = '<script type="application/ld+json">{"@type":"RealEstateListing",'
  + '"offers":{"price":850000}}</script><p>الوصف: مجمع سكني مغلق بحراسة</p>';

console.log('aqar soft-close oracle — the real predicate, executed\n');

const BODIES = {
  closed: CLOSED, live: LIVE, contradictory: CONTRADICTORY, marketing: MARKETING_REQUEST,
  badge: BADGE_ONLY, gated: GATED_COMPOUND,
};

const base = run(BODIES);

ok('a source-confirmed CLOSED page scores closed', base.closed === true,
   'this is the half that was dead: it scored false for every page');
ok('a LIVE page scores open despite carrying «مغلق» in its i18n bundle', base.live === false);
ok('closed flag + published offers node is NOT a kill (both factors required)',
   base.contradictory === false);
ok('an OPEN «طلب تسويق» ad with no offers node is spared', base.marketing === false,
   'the marketing-request exemption promised since 2026-08-04 is broken');
ok('the «طلب تسويق» case is really distinct from the closed one',
   MARKETING_REQUEST !== CLOSED, 'fixture lacks the escaped closed flag — case is vacuous');
ok('the OLD badge form still scores closed — it is kept beside the flag, not replaced',
   base.badge === true,
   'retiring the badge breaks test_aqar_soft_close_detection.py and cleanup.py, which share this predicate');
ok('«مغلق» as description text beside a published price is not closed', base.gated === false);

// Both fixtures must really contain the adversarial i18n label, or the live assertion above is
// vacuous — it would be proving nothing about a page that never mentioned «مغلق» at all.
ok('closed fixture carries the «مغلق» i18n label', CLOSED.includes('مغلق'),
   'fixture trimmed too far to be adversarial');
ok('live fixture carries the «مغلق» i18n label', LIVE.includes('مغلق'),
   'fixture trimmed too far to be adversarial');
ok('live fixture publishes an offers node', LIVE.includes('"offers"') || LIVE.includes('"price"'));
ok('closed fixture publishes no offers node',
   !LIVE.includes('__none__') && !CLOSED.includes('"offers"') && !CLOSED.includes('"price"'));

// ─────────────────────────────────────────────────────────────────────────────────────────────
// MUTATION PROOF. Each mutant must change a verdict this file asserts, or the assertion is
// decoration.
// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log('\nmutation proof\n');

const MUTANT_BODIES = BODIES;

const m1 = run(MUTANT_BODIES, 'old_badge_factor1');
ok('reverting factor 1 to the badge ALONE stops the oracle firing on a real closed page',
   m1.closed === false,
   'the mutant still fired — this guard would not have caught the original defect');

const m1b = run(MUTANT_BODIES, 'drop_badge_branch');
ok('retiring the badge branch breaks the form the pytest barriers pin', m1b.badge === false,
   'the badge assertion is not actually load-bearing');

const m2 = run(MUTANT_BODIES, 'drop_factor2');
ok('dropping factor 2 turns the contradictory page into a kill', m2.contradictory === true,
   'the two-factor assertion is not actually load-bearing');

// Keying factor 1 on the KEY rather than the boolean cannot hurt a page that publishes offers —
// factor 2 still spares it. It hurts exactly the «طلب تسويق» cohort, which has no offers node and
// is spared only because the flag reads false. That is the assertion this mutant must break.
const m3 = run(MUTANT_BODIES, 'accept_string_flag');
ok('keying factor 1 on the "closed" KEY rather than the boolean kills an OPEN «طلب تسويق» ad',
   m3.marketing === true,
   'the marketing-request assertion is not actually load-bearing');

console.log(failed === 0
  ? '\n✓ aqar soft-close oracle fires on closed pages, spares live ones, and needs both factors'
  : `\n✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
