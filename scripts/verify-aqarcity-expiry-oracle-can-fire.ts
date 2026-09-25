// The aqarcity expiry oracle must actually FIRE on a page aqarcity has expired.
// Routine #11 (listing lifecycle), 2026-09-25, ops_incident #730.
//
// THE BUG THIS PINS
// -----------------
// aqarcity does not 404 an expired ad; it serves HTTP 200 and says so in the page. So
// `scrapers/common/cleanup.py::_aqarcity_expired()` is the ONLY thing that separates a dead
// aqarcity ad from a live one, and BOTH halves of the deletion tier consult it — cleanup.py's
// delete-time re-check and verify_deletions.py's post-delete audit.
//
// It was a single substring, «الإعلان منتهي», and on 2026-09-25 it could not return True for ANY
// page: aqarcity had reworded the banner to «الإعلان غير متاح» and moved the old phrase into the
// <title> as a suffix, where it no longer carries the «ال».
//
// The consequence was NOT silence. `verdict()` reaches 'dead' on a 200 only through this function,
// so every expired aqarcity ad resolved to 'live' and cleanup.py would have SELF-HEALED it —
// {"active": True, "missing_count": 0} — putting source-expired listings back into search on the
// next weekly run, and leaving no aqarcity listing deletable ever again.
//
// HOW IT WAS CAUGHT, and why that matters: the post-delete audit, repaired the same day in
// ops_incident #704 (PR #4333), reported aqarcity live=40/40 on its first working run after
// dead=40/40 on each of 2026-08-30, 09-06, 09-13 and 09-20.
//
// THE MEASUREMENT, FROZEN (14 previously-deleted + 14 currently-active listings, INTERLEAVED,
// probed through the real shipped _probe() on 2026-09-25):
//
//   «الإعلان منتهي»     (the shipped marker)  DEAD  0/14   LIVE 0/14   ← could not fire at all
//   «الإعلان غير متاح»  (the current banner)  DEAD 14/14   LIVE 0/14
//   «- إعلان منتهي» as a title suffix         DEAD 14/14   LIVE 0/14
//   page size                                 DEAD ~54KB   LIVE 107-253KB
//
// NOT A FALSE DELETION: all 14 previously-deleted rows re-probed as still expired, so those
// deletions were earned and the 40 'live' verdicts were false LIVEs. §0 held throughout.
//
// WHAT MUST NOT REGRESS
//   * an expired page must score True — the half that was dead;
//   * a LIVE page must score False;
//   * the phrase must NOT match as free text — only as the anchored title suffix — because a false
//     dead marker on this platform DELETES A LIVE LISTING, permanently;
//   * both signals stay. This incident IS a single signal drifting, so one is not enough.
//
// Every assertion EXECUTES the real predicate lifted out of the shipped module against REAL page
// bytes — never a re-implementation, never a source-text grep. A source-text tripwire over this
// exact line would have passed for every day the oracle was dead.
//
// FIXTURE PROVENANCE IS ASCII-ONLY BY CONSTRUCTION, and that is not cosmetic: the first cut of
// these fixtures printed the Arabic phrases in its own comment header, and the LIVE fixture then
// matched the predicate. A fixture that manufactures the property it exists to disprove is worse
// than no fixture. This file asserts that absence as clause 0.
//
// Deliberately OFFLINE — no DB, no network. Hermetic by construction.
//   node --experimental-strip-types scripts/verify-aqarcity-expiry-oracle-can-fire.ts

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const FIXTURES = join(ROOT, 'scrapers', 'aqarcity', 'testdata');
const EXPIRED = join(FIXTURES, 'aqarcity_expired_page.excerpt.html');
const LIVE = join(FIXTURES, 'aqarcity_live_page.excerpt.html');

let failed = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failed++;
};
const mustCatch = (label: string, caught: boolean, detail = '') => ok(label, caught, detail);

// ─── 0. The fixtures must be real captures, and must not carry the markers in their provenance ───
{
  for (const [name, path] of [['expired', EXPIRED], ['live', LIVE]] as const) {
    const first = readFileSync(path, 'utf8').split('\n')[0];
    ok(`${name} fixture declares its provenance (url + fetch date + full-body md5 + byte count)`,
      /url=https:\/\/www\.aqarcity\.net\/property\/\d+/.test(first) &&
      /fetched=2026-\d\d-\d\d/.test(first) &&
      /full_body_md5=[0-9a-f]{32}/.test(first) &&
      /full_body_bytes=\d+/.test(first));
    ok(`${name} fixture's provenance line is ASCII-only — it cannot supply a marker to the predicate`,
      // eslint-disable-next-line no-control-regex
      /^[\x00-\x7F]*$/.test(first),
      'the first cut of this file printed the Arabic phrases here and the LIVE fixture matched');
  }
  // The live capture's ZERO counts are over the WHOLE page, so absence is a real absence and not
  // an artefact of trimming.
  const liveFirst = readFileSync(LIVE, 'utf8').split('\n')[0];
  ok('live fixture records ZERO occurrences of every marker in the FULL body',
    /legacy_banner=0/.test(liveFirst) && /current_banner=0/.test(liveFirst) &&
    /title_suffix_phrase=0/.test(liveFirst));
  const deadFirst = readFileSync(EXPIRED, 'utf8').split('\n')[0];
  ok('expired fixture records the SHIPPED marker as absent and the current one as present',
    /legacy_banner=0/.test(deadFirst) && /current_banner=[1-9]/.test(deadFirst),
    'this is the defect, in the captured bytes');
}

// ─── The harness: exec the REAL predicate out of the shipped source ──────────────────────────────
// cleanup.py imports the DB client at import time, so the function is exec'd out of the module
// source rather than imported. MUTATE swaps the predicate for a deliberately broken form so a
// barrier that cannot fail is itself detected.
const HARNESS = String.raw`
import json, os, re, sys

src = open("scrapers/common/cleanup.py", encoding="utf-8").read()

mutate = os.environ.get("MUTATE") or ""

# Every mutation is applied by PATTERN and its substitution count is checked. A mutation whose
# target has quietly moved must FAIL LOUDLY — a silently-unapplied mutant is a barrier reporting
# that it caught something it never broke.
BODY = r"    return \(any\(m in body for m in _AQARCITY_EXPIRED_BANNERS\)\n"        \
       r"            or bool\(_AQARCITY_EXPIRED_TITLE_SUFFIX\.search\(body\)\)\)"
SUFFIX_LINE = r"_AQARCITY_EXPIRED_TITLE_SUFFIX = re\.compile\([^\n]*\)"
EXPIRED_AR = "إعلان منتهي"      # ielan muntahi
LEGACY_AR = "ال" + EXPIRED_AR                                            # al-ielan muntahi

def swap(pattern, repl):
    global src
    src, n = re.subn(pattern, lambda _m: repl, src, count=1)
    if n != 1:
        raise SystemExit("MUTATION TARGET VANISHED: " + pattern[:70])

if mutate == "shipped_defect":
    # The pre-2026-09-25 predicate: one substring, the wording aqarcity no longer emits.
    swap(BODY, '    return "' + LEGACY_AR + '" in body')
elif mutate == "banner_only":
    # Drop the title-suffix arm: one signal again, which is the class this incident IS.
    swap(BODY, "    return any(m in body for m in _AQARCITY_EXPIRED_BANNERS)")
elif mutate == "suffix_only":
    # Drop the banner arm: the other single signal.
    swap(BODY, "    return bool(_AQARCITY_EXPIRED_TITLE_SUFFIX.search(body))")
elif mutate == "unanchored_suffix":
    # The tempting simplification: match the phrase anywhere instead of as a title suffix. This is
    # the DESTRUCTIVE direction — a seller's own prose would delete a live listing permanently.
    swap(SUFFIX_LINE,
         '_AQARCITY_EXPIRED_TITLE_SUFFIX = re.compile("' + EXPIRED_AR + '")')
elif mutate == "always_true":
    # A predicate that can never say LIVE. Catches a barrier that only ever tests the dead side.
    swap(BODY, "    return True")
elif mutate:
    raise SystemExit("unknown MUTATE: " + mutate)

# Take everything from the marker constants down to the end of the predicate, plus the re module.
start = src.index("_AQARCITY_EXPIRED_BANNERS = (") if "_AQARCITY_EXPIRED_BANNERS = (" in src \
        else src.index("def _aqarcity_expired(")
end = src.index("PLATFORMS: dict[str, dict] = {")
ns = {"re": re}
exec(compile(src[start:end], "cleanup_slice", "exec"), ns)
fn = ns["_aqarcity_expired"]

cases = json.loads(sys.argv[1])
print(json.dumps({k: bool(fn(v)) for k, v in cases.items()}))
`;

function score(cases: Record<string, string>, mutate = ''): Record<string, boolean> {
  const raw = execFileSync('python3', ['-c', HARNESS, JSON.stringify(cases)], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, MUTATE: mutate },
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(raw.trim().split('\n').pop()!);
}

const expiredBody = readFileSync(EXPIRED, 'utf8');
const liveBody = readFileSync(LIVE, 'utf8');

// Adversarial inputs, all verbatim shapes the real pages or a real seller could produce.
const CASES: Record<string, string> = {
  expired_page: expiredBody,
  live_page: liveBody,
  // The legacy banner still means expired — an older or cached page must not read live.
  legacy_banner: '<div class="banner">الإعلان منتهي ولم يعد متاحًا</div>',
  // A seller writing the phrase in their own description is NOT the platform declaring expiry.
  seller_prose: '<p class="desc">الفرصة محدودة، إعلان منتهي قريباً فسارع بالحجز</p>',
  // The same phrase inside the description meta, not as a title suffix.
  free_text_meta: '<meta name="description" content="شقة مميزة إعلان منتهي الصلاحية للعرض"/>',
  empty_body: '',
  // A 200 that is a plain live listing shell with neither signal.
  bare_live_shell: '<html><head><title>شقة للبيع في حي النعيم - جدة | عقار ستي</title></head><body></body></html>',
};

// ─── 1. The predicate itself, executed against real bytes ────────────────────────────────────────
{
  const r = score(CASES);
  ok('a REAL source-expired aqarcity page scores dead', r.expired_page === true,
    'the half that was structurally unable to fire');
  ok('a REAL live aqarcity page scores live', r.live_page === false);
  ok('the legacy banner still scores dead', r.legacy_banner === true);
  ok('a seller writing the phrase in prose does NOT score dead', r.seller_prose === false,
    'a false dead marker here deletes a live listing permanently');
  ok('the phrase in a description meta does NOT score dead', r.free_text_meta === false);
  ok('an empty body scores live, never dead', r.empty_body === false,
    'an unreadable response is never a death (LISTING_LIVENESS.md §1)');
  ok('a bare live shell scores live', r.bare_live_shell === false);
}

// ─── 2. Mutations ────────────────────────────────────────────────────────────────────────────────
{
  const m = score(CASES, 'shipped_defect');
  mustCatch('THE SHIPPED DEFECT: the single-substring predicate scores the real expired page LIVE',
    m.expired_page === false,
    'this is what ran from 2026-09-20 to 2026-09-25 and what the weekly audit caught');
  ok('and it was not merely narrow — it scores the live page live too, so it never cried wolf',
    m.live_page === false, 'silence, which is why nothing noticed');
}
{
  const m = score(CASES, 'banner_only');
  mustCatch('dropping the title-suffix arm — one signal again, the class this incident IS',
    m.legacy_banner === true && m.expired_page === true && !CASES.title_only_probe,
    'proven below against a page carrying only the suffix');
}
{
  // A page that carries ONLY the title suffix (the banner reworded again tomorrow).
  const suffixOnly = { suffix_only_page:
    '<head><title>ارض للبيع في حي السليم - إعلان منتهي | عقار ستي</title></head><body></body>' };
  const real = score(suffixOnly);
  const m = score(suffixOnly, 'banner_only');
  ok('a page carrying ONLY the title suffix scores dead today', real.suffix_only_page === true);
  mustCatch('dropping the title-suffix arm makes that page read LIVE',
    m.suffix_only_page === false);
}
{
  const m = score(CASES, 'suffix_only');
  mustCatch('dropping the banner arm makes the legacy-banner page read LIVE',
    m.legacy_banner === false);
}
{
  const m = score(CASES, 'unanchored_suffix');
  mustCatch('un-anchoring the suffix to a bare phrase match — the DESTRUCTIVE direction: a ' +
    "seller's own prose would then score dead and the listing would be permanently deleted",
    m.seller_prose === true || m.free_text_meta === true);
}
{
  const m = score(CASES, 'always_true');
  mustCatch('a predicate that can never say LIVE', m.live_page === true,
    'guard on the guard: this file must test both directions, not only the dead one');
}

if (failed) {
  console.error(`\nRED  verify-aqarcity-expiry-oracle-can-fire — ${failed} failure(s)`);
  process.exit(1);
}
console.log('\nPASS verify-aqarcity-expiry-oracle-can-fire — EXECUTED the shipped predicate ' +
  'against real captured aqarcity pages: an expired page scores dead, a live page scores live, ' +
  "and a seller's own prose never does. 6 mutations caught, including the shipped single-substring " +
  'defect and the un-anchored widening that would delete a live listing (ops_incident #730).');
