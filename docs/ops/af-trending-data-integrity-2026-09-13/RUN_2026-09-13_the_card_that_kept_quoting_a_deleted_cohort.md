# Run 2026-09-13 — the card that kept quoting a deleted cohort

🎯 Senior Advanced Filter + Trending Data Integrity Engineer (routine #5), 11:05–12:3xZ.

```
CONTRACT READ: YES (docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md, 2517175)
```

Four live AF checks were red on this morning's scheduled sweep (run 312, 09:36→11:04Z). All four
are mine. Three are now root-caused with a fix and a barrier; the fourth is another routine's open
P1, and today's measurement went to it rather than into a second incident.

---

## 1. `af_field_registry` described a different Advanced Filter than the one that ships (#217)

**FIXED AND PRODUCTION-VERIFIED.** Migration `20260913111514` applied 11:15Z; mirror PR
[#2537](https://github.com/6ttvrw4fmf-ctrl/ezhalah/pull/2537).

Six fields disagreed with the shipped app, measured over 213,900 searchable rows:

| field | the registry said | reality |
|---|---|---|
| `direction_ar` | hidden, «9% coverage — too thin to be useful yet» | **46.1%** (98,674); in `COHORT_QUESTIONS`, `p_directions` sent, chip rendered |
| `street_width_m` | hidden, «12.5% coverage today» | **41.8%** (89,511); same |
| `rating` | no row at all | `RATING_QUESTION` live, `p_rating_min` sent |
| `reviews_count` | no row at all | the 9.0+rc10 rung sets `reviewsMin`, `p_reviews_min` sent |
| `unit_subtype_ar` | no row at all | `UNIT_SUBTYPE_QUESTION` live, `p_unit_subtypes` sent |
| `tenant_ar` | no row at all | the opposite leak: a live predicate in `af_eligibility_clause` over 12,473 rows that **no file in `src/` sends** |

Which layer was wrong: the **registry**. No user impact — it is read by zero production functions —
but it is the repo's record of its own product, and it was wrong in both directions at once.

The `filter_tier` half is the part worth remembering. `20260811181508` defines `more_options` as
«manual «خيارات إضافية» sheet only, **never auto-asked**». `direction_ar` and `street_width_m` sat
there while the interview auto-asks both, **and no «خيارات إضافية» sheet exists anywhere in `src/`** —
the tier named a UI that was never built.

**Why the barrier was green on that half.** `registryProblems()`'s tier rule walked
`INTERVIEW_FIELDS`: five question ids written out by hand. That is the *same* blind spot routine #9
had removed from the two exposure rules one day earlier — four of the nine live questions are not on
that list, so a wrong tier on any of them was unreachable. The rule now covers the whole exposed
surface (amenity chips + every discovered question's fields), with six new mutation proofs including
a reproduction of the false green. The offline fixture had carried `filter_tier: 'more_options'` on
both rows *as its healthy baseline asserting `length === 0`* — so while that stood, this rule could
not have been written.

---

## 2. The AF round kept quoting a cohort the user had just deleted (#242, closes #187)

**FIXED, MERGED (`a6ecfcf`), DEPLOY REFUSED — see §5.** PR
[#2544](https://github.com/6ttvrw4fmf-ctrl/ezhalah/pull/2544).

Reproduced **3/3 byte-identical** on production, جدة / الفلل والبيوت / فيلا / شراء, 390×844:

1. round 1 commits عمر=جديد, مطبخ, دورات مياه ≥1, عرض الشارع ≥20 → **125 نتيجة**
2. the user deletes «جديد» from the pill row **in the open round card** (the flow the owner asked
   for on 2026-09-11, `ops_incident` #155)
3. the search widens correctly — headline **295**, anon replay 295, DB truth 295
4. **60 s later the card still reads «125 نتيجة»**, still draws **four** committed pills including
   the deleted one, and asks «وش الاتجاه اللي تفضله؟» priced on the dead set

| direction | on the card | the live set |
|---|---|---|
| شمال | 27 | **62** |
| جنوب | 27 | **49** |
| شرق | 27 | **67** |
| غرب | 19 | **47** |

Both rows captured from `apartment_guided_counts_ar` on the wire in the same run
(`cnt_total_base` 125 vs 295). Every number the user could read was understated ~2.3×, and tapping
one returned a set that did not match it — the one thing §2.5/§7 forbid outright. R9.2.1 was false
**on screen** while true on the wire.

Root cause: `removeGuidedFacet` rebuilds the query and re-searches but never tells the live round.
Fix: abandon the round, bumping `ageFlowTokenRef` **first** so an in-flight probe for the dead cohort
cannot land afterwards and repaint the card.

### …and this is what #187 actually was

`R9.2.3` had been red daily since 2026-09-11 with the note «a removed question may have stayed in the
asked carry, or this cohort's pool is genuinely exhausted», and «which of the two is NOT established».
Instrumented against production, **all three available hypotheses were wrong**:

- the carry **was** filtered correctly (`asked.filter(id => id !== removed.id)`);
- the pool was **not** exhausted — the direction question was *on screen* at the moment the check
  reported nothing was left to ask;
- and no probe failed: every count RPC answered `200` in **372–735 ms**, so the verdict was
  *measured*, not undetermined.

The offer simply cannot render while a round is open, by design (`afInterviewOwnsBrowsing`). Closing
the round restores it. The journey now carries a **probe ledger**, printed only on failure, so «a
failed probe» and «a measured nothing-narrows» can never again leave the same silent screen.

---

## 3. «عرض المزيد» is CAPPED now — the check was asserting a retired contract

**FIXED.** PR [#2545](https://github.com/6ttvrw4fmf-ctrl/ezhalah/pull/2545).

`verify-af-option-card-truth-live.ts` §4 asserted the Task-4 rule of 2026-09-11 (`revealed === total`,
`clicks === 1`). A shipped safety cap superseded it four days later: the results list is
unvirtualized, and draining الرياض/إيجار/سنوي (20,782 matches) **crashed the renderer** on
2026-09-12 (#199, P1). `DRAIN_REVEAL_MAX = 2_000` now bounds one press; if matches remain the pager
stays offered and the search is not marked finished.

Measured alone against production (no CI contention), الرياض/شراء/شقة + an amenity, eligible 6,319:
press 1 → 100 cards, press 2 → 2,100, network pages at `p_offset` 1500 then 2000. Everything else
held — no duplicates, monotone growth, every visible card inside the independent oracle, both pages
carrying the identical predicate.

`clicks === 1` was additionally **false by construction**: the loop breaks on `networkPageSeen`, not
on the button vanishing, so its own failure text («before the button/row disappeared») described
something it had never observed. That sentence nearly became a user-stranding incident report.

The check now asserts the shipped rule — reveal everything remaining **or** stop at the ceiling, and
a press that stopped at the ceiling must leave «عرض المزيد» offered — importing `DRAIN_REVEAL_MAX`
from the real module rather than re-typing it. Harness note 21 in this routine's spec corrected too.

**And the corrected check is GREEN against production** (re-run 12:1xZ, after production came back
inside its envelope), which answers the question the raw failure could not:

```
PASS  «عرض المزيد» revealed everything remaining, or stopped exactly at the safety ceiling
      revealed=2100 total=6319 clicks=2 ceiling=2000
PASS  a press that stopped at the ceiling left the pager OFFERED (nothing stranded)
```

So **nobody is stranded at 2,100 of 6,319** — the pager is still on screen and the search is not
marked finished, exactly as `DRAIN_REVEAL_MAX`'s own note promises. Worth stating plainly, because
the old assertion's failure text («before the button/row disappeared») read as if they were.

**Not settled here:** whether the accumulated mount across many presses is safe. That is #212 (P1,
routine #4, `blocked`) — an open owner decision. Today's measurement went on #212 as an observation.

---

## 4. Trending — exercised by this session, not inherited from CI

`verify-trending-live-four-way-truth.ts` run locally against production: **58 assertions, 0 failures**
across five journeys.

| journey | what it proved |
|---|---|
| الرياض · Buy · Apartment, unnarrowed | 6/6 visible city counts == Trending RPC; click-through == search RPC == independent PostgREST truth |
| جدة · Buy · Villa, price ≤ 3M (non-Riyadh) | same, plus حي الرحمانية advertised 486 == the count after clicking it |
| الرياض · Buy · Apartment, price 900k + area ≥ 120 (stacked) | both narrowings carried into the Trending call; حي المهدية 1,780 == after-click |
| **MOBILE 390×844** · الدمام · Buy · Apartment | same four-way equality; حي الشعلة 1,130 == after-click |
| AF re-entry · الرياض · Rent-Annual · Shop + property_age | the AF answer survives the Filter round-trip, Trending carries it, the type does not widen back to its group, 245 advertised == delivered == DB truth |

No stale counts, no row wider than its city total, no district advertising a number the click did not
deliver.

---

## 5. The deploy was REFUSED, and production is untouched

Run [423](https://github.com/6ttvrw4fmf-ctrl/ezhalah/actions/runs/34755685494) of
`deploy-frontend.yml`, dispatched at 11:55Z on `a6ecfcf` with a real verified change that needs one:

```
safe-deploy: REFUSED before deploying — production schema drift (see ❌ above). Nothing deployed.
missing_in_git: 20260913080703, 20260913080940, 20260913081200, 20260913082003,
                20260913082310, 20260913083220, 20260913105239, 20260913111514
```

Independently confirmed: the served bundle is `entry-f95744a5c2081e107fe18a57023320ad.js`, byte-for-byte
the same hash as at the start of this run.

**Seven of those eight are other sessions' migrations**, six of them mirrored by open PRs #2535 and
#2527. The eighth is mine, mirrored by open PR #2537. Every one needs a human merge, and until they
land **no frontend deploy can ship for anyone** — which currently holds the #242 count-honesty fix.

`#2537` was deliberately **not** self-merged. `AGENTS.md` says a PR touching `supabase/migrations/`
stays open for review and that `safe-pr-merge.ts` must not be invoked unless the answer to *"am I
allowed to merge this right now, without a human?"* is a clear yes. It was not a clear yes — this
routine's own grant lists «migrations recording already-applied operational changes», and the two
readings conflict — so the conservative one was taken and the conflict is stated here rather than
resolved unilaterally.

---

## 6. Production load, recorded not diagnosed

`ops_search_load_now()` at 12:0xZ: **mean 2,030.7 ms at 0.43 q/s, `degraded=true`** — against a
338 ms documented baseline and 192.7 ms measured at rest yesterday. `verify-af-option-card-truth-live`
paced and refused to start until it cleared, which is the harness behaving correctly.

Stated honestly: this session's own journeys were part of that traffic (five Trending journeys, four
pill-removal journeys, two option-card sweeps — all sequential, never concurrent). 0.43 q/s is far
under the 1.5 q/s safe envelope, so single-session sequential traffic should not produce a 2 s mean.
Added as an observation to `ops_incident` #22 (P1, routine #7) rather than opened as a second
incident.

---

## Health (derived — `scripts/verify-af-contract-coverage-map.ts`, 142 rules graded, L 75 · B 55 · P 12 · N 0)

The registry repair is production-verified but corresponds to no graded contract rule; the #242 fix
is merged and **not** deployed. Coverage therefore did not move, and every "after" equals its
"before". A P2 defect being found does not lower a coverage score — it is stated in words instead.

```
AF SYSTEM RATING: 9/10                     (judgement — the spec's UNKNOWN handling is exactly right)
ENGINEER PERFORMANCE RATING: 9/10          (judgement — three reds root-caused and fixed; one blocked on a gate)
ADVANCED FILTER HEALTH: 9.2/10 → 9.2/10
TRENDING CITIES HEALTH: 9.6/10 → 9.6/10
TRENDING DISTRICTS HEALTH: 9.6/10 → 9.6/10
AF DATA INTEGRITY: 9.4/10 → 9.4/10
OVERALL AF + TRENDING HEALTH: 9.3/10 → 9.3/10

NEW PRODUCT CONTRACT USED FOR RATING: YES
RULES LIVE-TESTED THIS RUN: 75/142
RULES BARRIER-PROTECTED: 55/142
RULES WITH INSUFFICIENT COVERAGE: 12/142

REAL BROWSER JOURNEYS: 12
AF JOURNEYS: 7        (5 × pill-removal جدة/فيلا mobile, 2 × option-card الرياض/شقة)
TRENDING CITY JOURNEYS: 4
TRENDING DISTRICT JOURNEYS: 4   (inside the same four)
CITIES TESTED: 3      (الرياض, جدة, الدمام)
REGIONS TESTED: 3
INTENT→UI MISMATCHES: 1   (#242 — the round card)
UI→REQUEST MISMATCHES: 0
REQUEST→RPC MISMATCHES: 0
RPC→DB MISMATCHES: 0
COUNT MISMATCHES: 1   (#242 — option counts priced on a destroyed cohort)
STALE COUNTS: 1       (the same)
INELIGIBLE RESULTS: 0
DUPLICATES: 0
UNKNOWN/FALSE VIOLATIONS: 0
BUGS FOUND: 3
BUGS FIXED: 3
BUGS REMAINING: 0 of this run's own; 5 older in queue
BARRIERS ADDED/STRENGTHENED: 4
MUTATION-PROVEN: YES  (14 new mutation proofs, each watched going red)
MERGED: YES (#2544); #2537 and #2545 open
DEPLOYED: NO — refused by the migration-drift gate, production untouched
PRODUCTION VERIFIED: PARTIAL — #217 yes (live registry read), #242 no (needs the deploy)
```

```
ALL GOOD: NO
```

Remaining blockers, with owner and §G category:

1. **Every frontend deploy is blocked** by 8 un-mirrored migrations — 7 from other sessions
   (PRs #2535, #2527 open; `20260913105239` has no PR yet), 1 mine (PR #2537). All need a human
   merge. This holds the #242 count-honesty fix out of production. **§G.2(a)** — owner/human merge.
2. **`ops_incident` #212** — whether the accumulated «عرض المزيد» mount is safe. Owner: routine #4,
   `blocked`. **§G.2(b)** — product decision.
3. **`ops_incident` #156** — `apartment_guided_counts_ar` exceeds `AGE_COUNT_TIMEOUT_MS` on
   الرياض/إيجار/سنوي with no type narrowed. Unchanged from yesterday; today's measurement on a
   city+type scope was 372–735 ms, which neither confirms nor contradicts it. **§G.2(b)**.
4. **`ops_incident` #96** — whether `living_rooms` should be offered on Villa cohorts only.
   **§G.2(b)** — product decision, untouched.
