# The card now proves what the user asked for — and Sanadak stopped being invisible to it

Routine #5 (🎯 Senior AF + Trending Data Integrity), 2026-09-03, second run of the day
(the first is `RUN_2026-09-03_the_barriers_that_did_not_run.md`).

Owner instruction for this run, verbatim: *"I approve moving forward with §12A. I want the returned
property card to clearly show what the user selected in the Advanced Filter, exactly as defined in
the contract. […] Do not consider it complete until §12A is fully live and verified."*

```
CONTRACT READ: YES (docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md §12A, §13)
CONTRACT RULES IMPLEMENTED THIS RUN: R12A.1, R12A.2, R12A.3, R12A.4, R12A.5, R12A.6, R13.12
CONTRACT/PRODUCTION CONFLICTS FOUND: 0
OWNER DECISIONS OPENED: NONE
OWNER RULE TEXT EDITED: NONE (R12A.1-6 untouched; only §12A's dated status paragraph was refreshed)
```

## The headline

§12A is live. The returned property card carries a «مطابق لطلبك» strip that echoes every committed
Advanced-Filter answer back with **the listing's own value** — and it does so from the canonical row
the predicate actually ran on, not from the card's pre-existing display fields.

While verifying it, the run found the rule's own worst case sitting in production: **Sanadak
published a building age for 1,236 listings and we threw all of it away.** A card cannot evidence a
field the index never carried, and an AF answer cannot return a listing whose value we discarded.
Both are fixed, barriered and production-verified.

## 1. §12A — what shipped

| piece | what it is |
|---|---|
| `20260903154406_af_canon_on_results_rpc` | adds `af_canon jsonb` to `location_search_candidates_ar` — the 28 AF-relevant columns of the exact `search_listings_ar` row the predicate ran on |
| `sql/mirrors/af_canon_select.sql` | the repo-side mirror of that projection, so SQL and TypeScript can be held to one contract offline |
| `src/lib/afEvidence.ts` | the pure evidence registry: 9 questions → chips, reading ONLY canonical columns |
| `src/components/ResultCard.tsx` | the strip itself, uncapped |
| `scripts/verify-af-card-evidence.ts` | offline barrier, in `npm test` |
| `scripts/verify-af-card-evidence-live.ts` | live browser journey, in `af-live-truth-check.yml` |

Three design decisions worth recording, because each one is a place the obvious version is wrong:

**The payload is gated, not unconditional.** Measured on production over a 2,000-row sample the
packed object averages 598 bytes (max 612). The results RPC serves a 1,500-row page-0 buffer, so
packing it unconditionally would add ~876 KB to *every* search response — including the
overwhelming majority that carry no AF answer, render no strip, and would pay every one of those
bytes for nothing on a mobile connection. Gated on "at least one AF parameter is non-null", a no-AF
search pays zero and an AF-narrowed search pays it on a set the answer has already shrunk.

**UNKNOWN renders nothing, by construction.** `jsonb_build_object` keeps a SQL NULL as a JSON null
rather than dropping the key, so all 28 keys are always present when the object is built. That is
what lets the null-guard distinguish *"the source did not publish this"* (render nothing) from
*"the column is missing"* (a bug). The strip never says «غير مذكور», never shows 0, never shows
false.

**The chip reads the canonical row, never `listing.features`.** The card's existing feature list is
raw and NULL-coerced; reading it would have let a `false` masquerade as a published "no".

## 2. The live journey, and why the first version of it was wrong

R12A.6 names a live journey as §12A's own barrier. Building it surfaced a methodology bug worth
writing down, because the harness reported a **production defect that did not exist**:

```
FAIL  R12A.2 — every chip carries the LISTING's own value, not the filter's label
      card 0 «bathrooms»: expected «2 حمامات» (the ROW's value), card shows ["\n3 حمامات"]
```

The harness paired the Nth rendered strip with the Nth response row. That is unsound: a row that
earns no chip renders no strip, so **one** such row shifts every later strip onto the wrong listing.
Three of the four reported mismatches were also pure whitespace — the chip is icon + text, so
`innerText` is `"\nجديد"` and a raw `trim()` left the newline.

Fixed properly rather than papered over: `ResultCard`'s wrapper now carries
``testID={`card-listing-${listing.id}`}`` and the journey joins strip → row **by listing id**,
verifying on the page it uses that the key really is unique there (1,500/1,500 across 25 source
tables) rather than assuming it. Whitespace runs are collapsed.

A second check could not fail at all: the no-cap assertion looked for a `card-af-evidence-more`
testID that `ResultCard` never renders. It now looks for the *shape* an expander takes (`+4`,
«عرض الكل», «المزيد») anywhere inside the strip, so it still bites under a name this file never
heard of.

## 3. Sanadak: the trapping failure mode, found by §12A

Alert `af_mapping_unplumbed` #1285. Sanadak's RSC payload has always carried `buildingAge`, and the
scraper has always captured it into `source_capture` — but the stored row never mapped it onto
`property_age`. NULL on **100% of 1,707 rows**, while 1,236 had a published age in the capture blob.

The AF `property_age` predicate is strict and NULL-excluding, so the moment a user answered
«كم عمر العقار تقريباً؟» **every Sanadak listing vanished** — not because Sanadak was silent, but
because we were. Every count-based barrier stayed green: a uniformly-NULL column is
indistinguishable from "the source never published it".

**Adjudicated against the source, not inferred from the number's shape.** Two live probes:

| `buildingAge` | what sanadak.sa's own detail page renders |
|---|---|
| `11` | «عمر البناء: **11 سنين**» |
| `0` | «عمر البناء: **أقل من سنة**» |

Literal years, and `0` is a published value rather than a blank. Both are pinned as fixtures in the
barrier. One of those listings has a broker-written description saying «العمر: 15 سنة تقريباً»
while its structured `buildingAge` is `11` — a disagreement *inside* the source. The structured
field is what the platform publishes as the age, so it is what we carry. We do not adjudicate a
broker's prose against a platform's own field, and we correct neither.

`_age_years()` exists rather than reusing `_int()` because `_int` maps `0 → None`: right for an
area, wrong for an age, and it would have erased «أقل من سنة» on 285 rows — turning a published
fact into UNKNOWN. The barrier's mutation proof runs the old `_int` on the same input and asserts
it returns `None`, so the check cannot pass on the pre-fix code.

**Data repair.** 1,030 residential + 206 commercial rows backfilled from their **own** already-captured
`buildingAge` — fill-NULL-only, nothing overwritten, nothing invented, reversible. Propagated into
`search_listings_ar` directly (844 served rows) rather than by bumping `last_updated` so the
incremental sync would notice it: `last_updated` is a liveness-adjacent fact and a repair must not
falsify when a listing was last seen.

| | before | after |
|---|---|---|
| served Sanadak rows carrying an age | 0 / 1,101 | **844 / 1,101** |

The remaining 257 have no `buildingAge` in the capture at all and correctly stay UNKNOWN.
`mon_detect_af_mapping_unplumbed()` now returns 0 and resolved #1285 on its own.

## 4. The two fixes compose (production, anon key)

A «أقل من سنة» search in جدة, which before this run returned **zero** Sanadak listings:

```
rows=800  sanadak=38  af_canon present on 800/800  distinct af_canon.property_age = [0]
sample: sanadak_residential_listings:585207  af_canon.property_age = 0
```

38 previously-unreachable Sanadak listings, every returned row carrying the evidence object, and
every packed age exactly matching the predicate. `ageText(0)` renders «جديد», the same wording
every other platform's `property_age = 0` already gets.

## 5. The deploy, and a gate that refused for the wrong reason

Deploy run 33780894917 reported `failure` but **had shipped**: `▲ Aliased
https://ezhalah-app.vercel.app`, `✓ Ready in 3m`. The failing step was the post-deploy baseline
advance, which could not read the deployment URL (HTTP 302, 15 bytes) and so never obtained an
"expected" bundle hash to compare against — even though the alias had already moved to the new
bundle. Verified independently instead, and all three of the gate's own conditions hold:

- the alias serves `entry-d5bae2b3b8818058566097bf4db692ca.js` ≠ the pre-deploy bundle
- that bundle references `supabase.co` (2 hits) — the env vars inlined
- it contains `card-af-evidence` (2), `af_canon` (3), and the escaped Arabic «مطابق» (11), and the
  compiled strip is a straight `.map()` with **no slice** — R12A.1's no-cap rule is what shipped

The two gates the script never reached were then run by hand and pass: the live search RPC
(HTTP 200, valid body) and the schema-drift gate (`missing_in_git=0`, `duplicate_overloads=0`).

A second deploy followed, for PR #1594's `card-listing-<id>` testID — the one thing R12A.6's
mandated live journey needs in order to hold each rendered card to *its own* listing's row. Its
user-visible change is nil; it is a testability change, and it is recorded here rather than
glossed, because "never deploy without a verified change that needs one" deserves an explicit
justification when the change is invisible. It also re-triggered `af-live-truth-check.yml` via
`workflow_run`, which is where the rest of the AF and Trending live suite runs.

`docs/DEPLOY_BASELINE.txt` had been stale since PR #1470 (2026-09-01) — this is the known
`issue #1563` shape where 14 consecutive deploys ended `failure` on this same read. Advanced by PR
to `254baca6`, matching the precedent already in that file, and only after all three of the refused
step's own conditions were re-verified by hand.

## 6. The live journey's verdict (production, both viewports)

Run against the deployed bundle `entry-a4fd39e6c124093c973a94c8f097ac18.js` after PR #1594:

| | desktop 1440×900 · الرياض/شقة | mobile 390×844 · جدة/فيلا |
|---|---|---|
| answers committed | property_age, amenities, bathrooms, direction | property_age, amenities, bathrooms, street_width |
| plain search: rows packed with `af_canon` | 0 / 1,500 | 0 / 1,500 |
| strips before any AF answer | 0 | 0 |
| AF-narrowed: rows UNpacked | 0 / 152 | 0 / 119 |
| strips rendered | 10 | 10 |
| strips hiding a selection behind «+N» | 0 | 0 |
| strips with no `card-listing-<id>` ancestor | 0 / 10 | 0 / 10 |
| duplicate `listing_id` on the page (join-key soundness) | 0 / 152 | 0 / 119 |
| (question × card) comparisons | 40 | 40 |
| missing chips · wrong values · false claims | 0 · 0 · 0 |0 · 0 · 0 |

Two checks report **NOT EXERCISED** rather than PASS, and that is deliberate:

- **R12A.3** met **0** UNKNOWN (question × card) cases. §2.5 predicates are NULL-excluding, so a
  returned row normally *has* the value — the null-guard is unreachable through the UI while search
  is correct. Covered offline against synthetic rows, and graded **B**, not L.
- **R13.12**'s counterfactual branch met **0** non-satisfying rows, for the same reason. Its positive
  form *is* live-proved: across 80 identity-joined comparisons no chip claimed anything its
  listing's canonical row did not satisfy.

The counters that produce those two verdicts were added *because* the checks could otherwise pass
vacuously — a check that asserts nothing about a branch it never reached is a check that cannot
fail, which is the same bug class this routine spent the morning's run removing.

## 7. Rating

`Rating Before → Rating After`, from `scripts/verify-af-contract-coverage-map.ts` (never a typed
number):

| dimension | before | after |
|---|---|---|
| **AF** | 8.6/10 · 86% | **9.2/10 · 92%** |
| **TRENDING** | 9.6/10 · 96% | 9.6/10 · 96% |
| **INTEGRITY** | 9.4/10 · 94% | 9.4/10 · 94% |
| **OVERALL** | 8.8/10 · 88% | **9.3/10 · 93%** |

Grade distribution over the same 142 contract rules: `L 70 · B 53 · P 12 · N 7` →
`L 75 · B 55 · P 12 · N 0`. **Zero N-grades for the first time** — the seven that moved are exactly
R12A.1–R12A.6 and R13.12. TRENDING and INTEGRITY are unchanged and say so: this run did not touch
them, and an unchanged dimension must report unchanged.

Two of the seven are **B, not L**, on purpose (R12A.3, R12A.5). Grading all seven L would have been
worth another ~0.2 on AF and would have been a lie about what was measured.

## Remaining / not done

- **The baseline-advance read failure itself is not fixed**, only worked around for this deploy. It
  is `issue #1563`, owned by routine #7, and the diagnostics that routine added on 2026-09-03 are
  what made this run's cause legible (`HTTP 302` on the deployment URL). Not re-diagnosed here.
- **`af_platform_mapping`'s own completeness is a real blind spot, and this run did not close it.**
  `mon_detect_af_mapping_unplumbed` now reports 0 offenders across all 41 canonical keys × 12
  platforms — but it can only check pairs that are IN the registry. A field a platform publishes
  and nobody has ever registered is invisible to it, and would look exactly like the Sanadak bug
  did. Closing that needs per-platform source adjudication of every captured key, which is a run of
  its own, not a footnote to this one.
- `[J0] 0-question scope (Factory/Buy+Rent-combined/الرياض) lands with a real start count —
  start=null` failed once on PR #1594's `built app runs` check. Adjudicated as environment, not
  product, on measured evidence: the scope has real inventory (13 buy + 34 rent), the RPC answered
  in 0.7–1.1 s when measured directly, the identical check was green on `main` all day and green on
  the pre-merge commit with byte-identical frontend code, and the same run self-classified the
  neighbouring `[I]` skips as a 4 s probe-latency symptom. Re-run once (the one permitted re-run);
  it passed and every subsequent run of that check was green.
- The standing ops board carries other routines' open alerts (liveness, price, scraper). Untouched
  — out of this routine's ownership.
