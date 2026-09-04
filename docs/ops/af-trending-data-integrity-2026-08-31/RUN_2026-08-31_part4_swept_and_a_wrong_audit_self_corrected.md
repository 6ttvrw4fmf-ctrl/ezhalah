# Part 4 swept to completion — and a wrong audit corrected in the same run (2026-08-31)

Routine #5 (🎯 Senior AF + Trending Data Integrity). PR [#1410](https://github.com/6ttvrw4fmf-ctrl/ezhalah/pull/1410).

```
CONTRACT READ: YES (docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md, 0be0a1d)
```

## 1. The audit that stands — Part 4 swept to completion for the first time

The standing `D4` gap said the platform × AF-field source-fidelity sweep "has never been run to
completion in one run." It has now.

**50 served source tables × 41 AF fields = 2,050 cells**, every cell classified:

| class | cells | meaning |
|---|---|---|
| DIRECT | 954 | a same-named upstream column exists → compared row-by-row (**1,122,084 field-values**) |
| DERIVED | 122 | index populated from a different upstream shape (JSON, parser, extra-attrs) |
| ABSENT | 974 | index all-NULL for that platform × field — nothing to compare |

**0 mismatches. 0 fabrications.** aqar — the largest platform at 84,698 rows — wholly clean.

Method note for the next run: the sweep is one dynamic single-scan query per table, executed
server-side via `query_to_xml(q, false, false, '')` (tableforest **false**, or the XML will not
parse) and filtered to non-clean cells, so the generated SQL never has to come back into context.
Doing all 50 tables in one statement exceeds the 60s MCP cap — chunk by row count.

The ABSENT space was swept too, by intersecting each platform's `additional_info` keys with the AF
field names, which is where the DIRECT oracle is blind.

### Residual signals, each adjudicated rather than assumed

| signal | verdict |
|---|---|
| 3 wasalt rows, all amenities NULL | new listings awaiting rich-attr enrichment (`last_updated` NULL) — known lag, already watched |
| gathern `furnished` | literal `true` on **all 29,389** active rows, zero variance. Index NULL is the honest state. Propagating a constant would fabricate a per-listing attribute at scale. **Left withheld** |
| erapulse `furnished`/`pool`/`garden` | same no-variance shape, 2/1/1 rows. **Left withheld** |
| jurash `floor_number` | published in JSON with **real variance** (2, 2, 3, 3); `listing_extra_attrs` hard-codes `NULL::integer` for its block → 4 production_ready rows never reach the index. **Genuine, recorded OPEN**, not fixed — see §4 |
| 7 rows withholding a `property_age` | **I called this a bug. It was not.** See §2 |

## 2. The correction — what I got wrong, and what caught it

The first commit concluded `listing_age_resolved` was a hand-maintained `UNION ALL` that had
"forgotten" four platforms, and appended four blocks to it directly. Both halves were wrong.

**1. The view is generated.** `rebuild_age_producer()` builds it from the `age_source_registry`
table (strategies `canonical_column` / `jsonb_text` / `from_extra_attrs`). Editing the view directly
is the same antipattern `AGENTS.md` forbids for the four AF eligibility RPCs. The next rebuild
overwrote my edit within minutes — **exactly as it should have**. Production was never left in the
hand-edited state; the mechanism that reverted me is the one working correctly.

**2. The four platforms are deliberately withheld, not forgotten.** `aldarim_commercial` and
`mizlaj_commercial` are registered `trusted = true` but score `age_source_health()` verdict
**`too_small`** (`n_aged = 2`), and the generator admits `canonical_column` sources only at
`verdict = 'ok'`. A platform with two aged rows is not yet a trustworthy age source. *Weird does not
mean wrong* — the gate was right and the audit was wrong.

**Why I missed it:** I read the view's *rendered* definition (`pg_get_viewdef`) and reasoned about
its shape without ever asking whether something generates it. The rendered text of a generated
object looks exactly like a hand-written one. **Standing lesson, now in the ledger
(`listing_age_resolved.is_generated`): before concluding that an enumeration "forgot" an entry,
search for a `rebuild_*` producer first.**

**The detector shipped in commit 1 was wrong too.** It keyed on *absent from the VIEW*, which
conflates *undecided* with *decided-no*, so it would have raised a permanent false P2 against the
gate that was working correctly. A barrier that manufactures a false alarm is worse than no barrier.

## 3. What survives, corrected

There is a real gap, but narrower than claimed: **`eastabha_residential_listings` and
`erapulse_commercial_listings` publish plausible ages (3 rows) and appear in `age_source_registry`
not at all** — withheld by *silence* rather than by *decision*. Nobody has ever judged whether those
platforms' age fields mean what we think they mean.

`mon_detect_age_resolver_platform_gap()` (migration `20260831114938`, rostered in
`mon_run_all_detectors()`) now keys on absence from the **registry** and raises exactly those two.
Health-gated and explicitly-untrusted exclusions stay correctly silent.

Adjudicating those two needs a **live source read** — per `AGENTS.md` permanent rule #2, a missing
captured field is never evidence the source omits it. That is a source-truth decision, so the alert
is raised and left open rather than quietly resolved.

## 4. Still open (not fixed, deliberately)

- **`age_resolver_platform_gap` P2** — the two unadjudicated platforms above. Needs a live source
  probe + an `age_source_registry` row. Source-truth decision.
- **`jurash.floor_number`** — 4 rows, provable real variance, trapped by a hard-coded
  `NULL::integer` in `listing_extra_attrs`. Same class as the age case but a **different**
  generator. Given today's lesson, the build path behind `listing_extra_attrs` must be checked for
  a producer *before* anything is edited. Recorded OPEN in the ledger.
- **`af_field_stuck_no_variance` P2** (satel `air_conditioner`, sanadak `maid_room`) — unchanged.
  satel.sa remains unreachable from this container (probed again: HTTP 000, egress-blocked), and
  rule #2 forbids asserting "the source publishes no negative" without a live probe.

## 5. Live production journeys — all green

| journey | advertised | results header | anon-REST `total_count` |
|---|---|---|---|
| J1 desktop — Buy/Residential, الرياض | 37,005 | 37,005 | 37,005 |
| J2 desktop — + beds=3, price 500k–1.5M | 7,794 | — | 7,794 |
| J3 desktop — جدة district الصفاء | 1,699 | 1,699 | 1,699 |
| J4 **mobile** 390×844 — rent-only annual, الدمام | 2,111 | — | 2,111 |

Trending visible list = RPC **6/6 exact** in every case. Narrowed trending carried `p_beds_exact`,
`p_price_min`, `p_price_max` into both the trending call and the landed search request. District
rows `rows_without_count = 0` in both cities (no false fallback counts). J3's request carried
`p_districts=["الصفاء","حي الصفا"]` — the documented `match_values` merge. AF opened in the
«الوكيل الذكي» flow and its count RPCs (`apartment_guided_counts_ar`,
`property_age_option_counts_ar`) carried the full state.

## 5b. Merge and the drift guard

Merged as PR #1410 through the mandated gate (`scripts/safe-pr-merge.ts 1410 --expect-files …`):
all three required checks SUCCESS (Full verification suite, Production-target lock + no-bypass,
Taxonomy + location index), `mergeable=MERGEABLE`, `mergeStateStatus=clean`, file list unchanged
since creation. Merge commit `9792c6d`.

**Why it was merged rather than left open.** Applying `20260831113443` to production put this
routine's own name on the main-branch migration drift guard — run 763 (2026-08-31 11:42) reported
`1 migration(s) applied to prod but MISSING FROM GIT: 20260831113443`. The mirror files existed, but
on the branch; the guard measures `main`. `AGENTS.md` makes mirroring the applying engineer's
responsibility, and this routine's authority covers self-merging "migrations recording already-
applied operational changes" on green CI. Verified cleared afterwards on `main`:

```
✓ migration-drift-vs-production: 0 missing_in_git, 0 missing_in_prod,
  0 duplicate versions, 0 duplicate overloads (873 live migrations)
```

The drift workflow is still red on a DIFFERENT condition that is not this routine's:
`verify-migration-content-parity` on three 2026-08-30 seam-authored migrations
(`ai_cost_health_reasoning_token_detector`, `ai_usage_costed_source_column_drift_fix`,
`agent_calls_per_message_telemetry_and_detector`), all classified **0 CODE-level, 3 comment-only
(P2, benign)** by the class-split PR #1407 shipped the same day. Already alerted as
`migration_content_parity` P2 and owned by routine #7 (systems seam). Recovering their files
verbatim is theirs to do, not mine to guess at.


## 5c. Round 2 — owner approved acting on the parked items (2026-08-31)

**Why the score could not simply be raised.** Measured first, so effort went where it was worth
something: adding barriers to the two testable weight-2 `P` rules is worth **+0.04** overall; even
moving *every* `P` to `B` (impossible — most are rationale/cross-reference lines) reaches only
9.109. The mass sits in **B → L**: 71 rules the code asserts that no journey had proved in
production *this run*. Live-testing 10 reaches 8.99, 20 reaches 9.13, 40 reaches 9.38. That is what
Part 5 mandates, so that is what was done.

**`erapulse_commercial` age — adjudicated by live probe.** erapulse.sa is reachable from this
container (eastabha.com, jurash.com and satel.sa are not). Listing 648093 publishes «العمر (سنة)»
as a structured stat beside «المساحة (م²)», payload `"age":1`; our stored `property_age = 1` matches
exactly, re-confirming for the commercial half the block cleared for erapulse_residential on
2026-07-29. Registered `trusted`. **Changes nothing served today, deliberately** — `age_source_health()`
still scores it `too_small` (n_aged=1) and the generator admits only at `verdict='ok'`. The registry
records the ADJUDICATION; the health gate keeps deciding ADMISSION. The detector now names only
`eastabha_residential`, which is genuinely undecided because its source is unreachable.

**`jurash floor_number` — un-trapped.** jurash publishes `pt_floor` natively; `run.py` captures it
verbatim with real variance (2, 2, 3, 3); `listing_extra_attrs` hard-coded `NULL::integer` for both
jurash branches. This time the FIRST question asked was whether the view is generated — it is not
(only `rebuild_af_filter_rpcs` and `rebuild_age_producer` exist), so a direct edit is correct. That
is §2's lesson applied. Scoped to the two jurash branches, using the view's own regex-guarded idiom.
Measured: rows unchanged at 197,768, `floor_number` 11,509 → 11,513, all four **in the index and
production_ready**.

**Ten rules B → L, proved in a real browser.** A full AF round, with the narrowing chain measured:

| step | question | picked | AF projected count |
|---|---|---|---|
| Q1 | تفضل تدفع الإيجار على دفعات؟ | يقبل التقسيط | 10,316 → **3,193** |
| Q2 | كم عمر العقار تقريباً؟ | ١٠ سنوات فأكثر (356) | 3,193 → **356** |
| Q3 | كم دورة مياه تفضل؟ | +٤ (8) | 356 → **8** |
| end | — | round closed after 3 questions | «كل النتائج المطابقة (**8 إعلان**)» |

Each option's advertised count became the next projected count, and the final count equalled the
listings actually delivered. Moved to L: R13.4 (all three halves — no auto-open, no auto-advance,
no popup), R4.1.2, R8.3.1, R8.1.3, R13.7, R9.3.1, R8.2.3, R8.3.2, R1.6.2, R14.2.2.

The age question's options also summed exactly to the cohort: 1,604 + 393 + 590 + 234 + 356 = 3,177,
plus «16 إعلان لم يذكر هذه المعلومة» = **3,193**. Unknown is reported, never folded into an option.

**Deliberately NOT claimed.** R9.1.1 / R6.3.2 / R6.3.3 (pill rendering) stay at B — the predicate
demonstrably commits (the count moves and holds) but the harness could not positively identify a
removable-pill affordance, and two labels failed to match on a leading-space bug of my own.
Mid-round absence proves nothing: §6.3 describes what the round's END renders. R5.4.3 stays B: it
"passed" on loose evidence (the scraper caught listing cards, not options). Both recorded OPEN in
the ledger for a targeted pill journey next run.

## 6. Harness notes (additive to 2026-08-30)

1. **Playwright is NOT in the repo** — this container has no `node_modules`. Import it from
   `/opt/node22/lib/node_modules/playwright/index.js`. The 2026-08-30 note pointing at
   `/home/user/ezhalah/node_modules/...` is retired.
2. **The city input has no placeholder.** Drive the Filter controls by index:
   `input[0]` city · `input[1]` district (`placeholder="اختر المدينة أولاً"`) · `[2]/[3]` area
   min/max · `[4]/[5]` price min/max · `[6]` phone. Targeting `getByPlaceholder('أي مدينة؟')` times
   out — that string is a label, not a placeholder.
3. **A long-running SQL call keeps going after the MCP 60s timeout.** `sync_search_listings_ar()`
   timed out the client twice and completed server-side both times. Verify by re-reading state
   before concluding it did not run.
4. **`query_to_xml` needs `tableforest = false`** to produce a parseable document.
5. `npm test` stops early here on `verify-abeea-identity-supersession.ts` —
   `ModuleNotFoundError: No module named 'curl_cffi'`, a missing Python dep in the agent image,
   pre-existing and unrelated to any AF work. Run the AF verifiers directly; CI runs the full suite.

## FINAL REPORT

```
CONTRACT READ: YES (docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md, 0be0a1d)
CONTRACT RULES SPOT-AUDITED THIS RUN: D1-D5, R14.1.1-R14.1.3, R14.2.1-R14.2.4, R14.3.1-R14.3.2
CONTRACT/PRODUCTION CONFLICTS FOUND: 0
OWNER DECISIONS OPENED (contract-change requests): NONE

AF SYSTEM RATING: 9/10                     (judgement, not a measurement)
ENGINEER PERFORMANCE RATING: 7/10          (judgement: the sweep and the self-correction were
                                            right; shipping a wrong root cause and a false-alarm
                                            barrier before checking for a generator was not)
ADVANCED FILTER HEALTH: 8.8/10 → 8.9/10
TRENDING CITIES HEALTH: 9.2/10 → 9.3/10
TRENDING DISTRICTS HEALTH: 9.2/10 → 9.3/10
AF DATA INTEGRITY: 8.9/10 → 9.4/10
OVERALL AF + TRENDING HEALTH: 8.8/10 → 9.0/10

NEW PRODUCT CONTRACT USED FOR RATING: YES
RULES LIVE-TESTED THIS RUN: 56/135       (grade L)
RULES BARRIER-PROTECTED: 61/135          (grade B)
RULES WITH INSUFFICIENT COVERAGE: 18/135 (grades P + N)

REAL BROWSER JOURNEYS: 8
AF JOURNEYS: 4 (recon + interview + pill probe + full round)
TRENDING CITY JOURNEYS: 3
TRENDING DISTRICT JOURNEYS: 2
CITIES TESTED: 4 (الرياض · جدة · الدمام · الخبر observed)
REGIONS TESTED: 3 (الرياض · مكة المكرمة · الشرقية)
AF FIELDS TESTED: 41/41 (index-fidelity sweep) · 2 exercised in the live AF interview
INTENT→UI MISMATCHES: 0
UI→REQUEST MISMATCHES: 0
REQUEST→RPC MISMATCHES: 0
RPC→DB MISMATCHES: 0
COUNT MISMATCHES: 0
STALE COUNTS: 0
INELIGIBLE RESULTS: 0
DUPLICATES: 0
UNKNOWN/FALSE VIOLATIONS: 0
BUGS FOUND: 2 genuine (registry silence · jurash floor_number) + 1 retracted
BUGS FIXED: 1 data defect (jurash floor_number, production-verified); 1 barrier gap closed; 1 source adjudicated by live probe
BUGS REMAINING: 1 (eastabha — source unreachable)
BARRIERS ADDED/STRENGTHENED: 1 (mon_detect_age_resolver_platform_gap, rostered)
MUTATION-PROVEN: YES (0 → 1 → 0, rolled back)
MERGED: YES (PR #1410, merge commit 9792c6d, via scripts/safe-pr-merge.ts)
DEPLOYED: N/A (no frontend change)
PRODUCTION VERIFIED: YES

BUGS FOUND: 2
BUGS FIXED: 1
BUGS REMAINING: 1
BARRIERS ADDED: 1
MUTATIONS KILLED: 1/1
TESTS: PASS (targeted; npm test blocked in-container by a missing Python dep, unrelated)
MERGED: YES
DEPLOYED/APPLIED: YES (2 migrations applied; net production state = designed state)
PRODUCTION VERIFIED: YES
SENTRY CHECKED: YES
SENTRY CONNECTION WORKING: YES
OPEN P0/P1 IN SCOPE: 0
TRUE SCORE: 9.0/10
10/10 ACHIEVED: NO

ALL GOOD: NO
```

**Blocker to 10/10 after round 2 — one, category (f), external dependency:**

1. `age_resolver_platform_gap` P2 — `eastabha_residential_listings` publishes 2 ages and has never
   been adjudicated. eastabha.com is egress-blocked from this container (probed: HTTP 000), and
   `AGENTS.md` permanent rule #2 forbids deciding it without a live read. Its sibling
   `erapulse_commercial` was closed this run precisely because erapulse.sa *was* reachable.

The remaining distance to 10/10 is not defects — it is coverage. 61 rules are B (code-asserted) and
18 are P, and most of those P grades are rationale or cross-reference lines that are P by nature.
Each B rule is worth +0.15 when a journey proves it live; the honest path is more production
journeys, not a larger number.
