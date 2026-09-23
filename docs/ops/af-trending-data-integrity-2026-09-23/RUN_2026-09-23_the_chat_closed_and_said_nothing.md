# Run 2026-09-23 — the chat closed, and said nothing

🎯 Senior Advanced Filter + Trending Data Integrity Engineer (routine #5), 23:1xZ–.

```
SENTRY CHECKED: YES · CONNECTION PROVEN BY A REAL READ: YES (org ezhalah / react-native;
                is:unresolved → 0 in scope; is:resolved 90d → 5 issues returned, so the
                empty unresolved set is a measurement, not a dead connector)
INCIDENT QUEUE READ: YES (10 open in routine-5-af-trending)
CLAIM: af-trending-data-integrity, claim_work_area(), 3h
```

---

## 1. A chat the Advanced Filter closed said «156 من أصل 6,441» and named nothing the user could do

**ROOT-CAUSED, FIXED, BARRIERED, MERGED (`19a3e48`) — PR
[#3802](https://github.com/6ttvrw4fmf-ctrl/ezhalah/pull/3802). `ops_incident` #598.
NOT LIVE: PROPAGATION PENDING — the deploy was refused, see §5.**

The incident had been sitting at *REPRODUCED NOT ROOT-CAUSED* since 2026-09-22 with an explicit
instruction: *instrument the three gates and read which is false; do NOT assume the harness is
wrong.* All three gates turned out to be behaving correctly. The defect was in a fourth place
nobody had listed.

Measured on production, الرياض/شراء/شقة, one committed amenity answer:

```
«عرضت لك أول 156 من أصل 6,441 إعلان مطابق.»
[data-testid="results-load-more"]  → 0 elements anywhere
[data-testid="results-narrow"]     → 0 elements anywhere
```

Every count was right. 6,285 matching listings simply had no name for how to reach them.

### The gates, instrumented per turn — the step the incident asked for

The incident listed three candidates. Walking **each results turn separately** (rather than counting
controls page-wide, which is what made the first reading ambiguous) killed two of them outright.
Production, الرياض/شراء/شقة, answering «عداد كهرباء مستقل» (6,441), read at +20s and again at +65s:

```
BEFORE  «عرضت لك أول 12 من أصل 13,623 …»   cards 12 · actionsRow 1 · loadMore 1 · narrow 1 · receipt 0
AFTER   turn 1 «… 19 من أصل 13,623 …»      cards 19 · actionsRow 0 · loadMore 0 · narrow 0 · receipt 1
        turn 2 «… 24→36 من أصل 6,441 …»    cards 24→36 · actionsRow 0 · loadMore 0 · narrow 0 · receipt 0 · pills 1
```

- **Candidate 1, `afReceipt` keyed to the NEW turn — dead.** The receipt is on the **origin** turn,
  exactly as R6.3.2 says, so `!afReceipt[m.id]` is *true* on the landed turn.
- **Candidate 3, `ageFlow.phase` non-null — dead.** The card is gone; the round's pills render on turn 2.
- **Candidate 2, `chatCompleted` — forced, not assumed.** With `afPhase = null` and no receipt,
  `resultsActionsRowVisible` returns `hasMore || canNarrowFurther` *unless* `chatCompleted`, and
  `hasMore` is true by arithmetic (36 shown of 6,441, 1,500 buffered, turn 2 *is* the newest results
  turn). A false `chatCompleted` would have rendered «عرض المزيد». It did not.

One thing the probe got wrong and is worth not repeating: its composer read
(`placeholderSaysClosed: false`) enumerated `input`/`textarea` placeholders and found only the filter
inputs. A read that cannot distinguish *not locked* from *not found* is not evidence in either
direction, and the conclusion above deliberately does not rest on it.

### The chain

| | |
|---|---|
| **1** | Owner 2026-09-20: *a completed Advanced Filter round ends the chat at ANY total* — `afRoundEndsChat = true` in `finishGuided`'s `onFetched`. `completed` is therefore true on a turn that may be showing a small fraction of its matches. |
| **2** | `resultsActionsRowVisible` returns `canNarrowFurther` alone once the chat is closed — correct — and a round that finished by **exhausting its question pool** leaves `afCanNarrow` false. Both buttons are legitimately absent. |
| **3** | `closingNoteKey` lands on `'I showed you the first {shown} of {total} matching listings.'`, the NO-OFFER variant added 2026-09-05 so a *superseded* turn would stop promising a retired button. **That variant was written for a turn in an OPEN chat**, where the newest turn below it is the forward path. In a closed chat there is no turn below. |

Nothing above is a wrong number, a widened search, or a false offer — which is exactly why every
barrier stayed green. §42 forbids offering a button that is not on screen; nothing forbade **ending
on no button and no way out**, because until the 2026-09-20 rule that state could not carry
unreached inventory.

### The fix, and the half that is easy to get wrong

`closingNoteKey` gains the one fact it was missing — whether the **chat** is closed, not this turn —
and in that state returns the owner's own sentence from the two existing terminals:

> «عرضت لك أول {shown} من أصل {total} إعلان مطابق. تبي بحث جديد؟ افتح القائمة ☰ فوق واختر «بحث».»

No number moves. The obvious over-correction — hinting ☰ on every button-less turn — would put the
line on every superseded turn of an open chat, where the newest turn below *is* the forward path.
That half is asserted, not assumed.

### Barrier

`scripts/verify-closing-note-never-promises-a-missing-button.ts` §5b, the mirror of the rule the
file was born for: the full **128-state** space enumerated (the existing 64 × `chatClosed`), *a
closed chat with matches still unreached always names a way out*, *an open chat's quiet turn is
unchanged*, the exact 156-of-6,441 state replayed through `resultCounts`, and **mutation-proven in
both directions** — the pre-fix wording caught as a dead end, the ☰-everywhere over-correction
caught as a leak.

`scripts/verify-narrow-cta-count-gate.ts` pinned the `closingNoteKey` call's **entire argument list
verbatim**, so adding an unrelated argument reddened a barrier with nothing to say about it. It now
pins the two names whose rule it actually owns.

### What this does NOT close

`#598` has a second half this run did not explain: **why only 156 of the 400-card `AF_REVEAL_MAX`
target were revealed** on a turn whose buffer held 1,500.

The obvious story is the halted-cascade shape of `ops_incident` #66 — and it is worth saying plainly
that today's measurement makes that story **less likely**, rather than leaving a plausible one
standing. The cards were still *arriving*: 24 at +20s, 36 at +65s. A cascade walking toward
`AF_REVEAL_MAX` at ~130 ms/card — about 52 seconds for 400 — read mid-flight looks exactly like
"156 of 400" with nothing halted at all. This run did not watch it reach 400, so that is an
observation and not a settled root cause. The incident stays open for it.

What that reframing does *not* soften: the closing note renders while the reveal is still walking
(which is the #66 fix working as designed), and in a closed chat it then names nothing. That is the
half this PR fixes.

---

## 2. Trending Cities and Districts: RPC == DB truth, and the honest zero holds

**CLEAN.** Four dimensions measured directly against production, with an independent count over
`search_listings_ar` as the oracle rather than the RPC's own arithmetic.

| what | result |
|---|---|
| `top_cities_by_deal_ar('بيع')`, unnarrowed | delta **0** on all 12 top cities (الرياض 46,243 · جدة 32,858 · الدمام 8,826 · مكة 7,265 · الخبر 7,240 · الهفوف 5,558 · المدينة 5,266 · بريدة 4,990 · عنيزة 3,294 · الاحساء 2,852 · جازان 2,432 · خميس مشيط 2,152) |
| same, **full filter state** (إيجار · سنوي · شقة · beds ≥ 3) | delta **0** on all 8 returned (الرياض 5,248 · جدة 2,870 · الخبر 1,491 · الدمام 983 · مكة 346 · المدينة 255 · الظهران 206 · أبها 172) |
| `district_options_ar(الرياض, …)` under that same state | delta **0** on all 12 top districts, folded over each row's own `match_values` alias set |
| **honest zero over false fallback** | drove the picker to an impossible narrowing (beds ≥ 99, where DB truth is 2 rows): 230 district rows returned, **only 2 with a non-zero count**, `sum(listing_count) = 2`, `total_in_city = 2`. The full roster with honest zeros — never the unnarrowed counts as a fallback. |

## 3. Advanced Filter option-card truth on production: 203 consecutive PASS

`verify-af-option-card-truth-live.ts` against الرياض/شراء/شقة. Every one of 12 amenity options
across 4 questions (amenities → age → baths → direction): **rendered pill == the `cnt_*` the app was
handed == an independent PostgREST oracle**, on every option. Baseline headline 13,621 == RPC ==
oracle. Skip wrote no predicate and moved no count across 8 skips. The unknown caption on the
direction card (7,367) equalled the rows with `NULL direction_ar` exactly.

---

## 4. Things measured and routed rather than acted on

**Production was degraded in this window — `ops_incident` #650, routed to routine-2.** At
23:28–23:32 UTC the search RPC mean was 3,912 ms against a ~338 ms envelope, one client query ran
3m37s, and PostgREST answered `mon_raise` with **HTTP 503 `PGRST002` "Could not query the database
for the schema cache"**. A CI web-runtime smoke could not confirm a city selection in the real built
app during the window — the real user path, not a harness-only surface. The second-order finding is
the one worth keeping: **the alert-raise step in that same job then failed with the same 503**, so
the condition that broke the check also stopped the check from reporting itself.

Contributing: six sibling routines claimed work areas within 80 seconds of each other at 23:15–23:16
UTC, and two scraper syncs were dispatched at 23:17–23:20. The fleet converged on one database at one
minute. **This is the DB-saturation-at-my-start-time observation the routine asks me to report rather
than silently absorb** — the owner may want to restagger.

**`#563` (af-live-truth-check.yml red on main since 2026-09-21 19:52Z) narrowed from "two jobs fail"
to the exact four failing steps**, read off the GitHub steps API rather than inferred: job A steps 6
(`verify-af-live-truth.ts`, 9 journeys) and 7 (`= #340`, already reproduced), job B steps 6 (`= #598`,
fixed today) and 10 (`verify-af-card-evidence-live.ts`). The two unclaimed steps were **deliberately
not adjudicated in this window**: AGENTS.md's hard rail says stop heavy testing when Supabase
degrades, and reading a live AF journey through the 23:28–23:32 window would have manufactured
exactly the false negatives #48/#127/#340 are made of.

**`#380` (three platforms publish `property_age` with no `age_source_registry` row) is BLOCKED, with
evidence rather than a shrug.** Registration needs a live source probe (AGENTS.md permanent rule 2,
and the incident's own *do not register on plausibility*). Measured from this container:
`https://ksa-aqar.com/` returns **HTTP 000** while `https://ezhalah-app.vercel.app/` returns 200 — the
egress this session has cannot reach the source. Per AGENTS.md that is a fact about the **container**,
not about ksaaqar, so it is not evidence in either direction. Re-measure from CI. Nothing registered,
nothing waived.

**Two month-old `FAIL` ledger rows re-measured, and only partly cleared.** `aqar.maid_room` /
`aqar.driver_room` `source_fidelity` had sat at FAIL since 2026-08-23. The 2026-08-23 symptom —
15,987 trues / **0 falses**, the shape that proved the parser was reading prose instead of the flat
`maid` field — is **gone**: `aqar_residential_listings` now holds 9,601 true / 9,529 false and
4,913 / 11,988. PR #987 propagated. Recorded as `PASS_PARTIAL`, **not** PASS: a full
re-adjudication needs a live aqar probe this container cannot make. Carrying the old FAIL forward
unchanged would have been equally wrong.

---

## 5. The fix is merged and CANNOT SHIP — `ops_incident` #665, routed to routine-2

**Production is untouched, and that is read from Vercel rather than inferred from a job status** (the
distinction AGENTS.md insists on): the newest production deployment is still
`dpl_5teyK95Sse9DwgCkHC7kuyaVSyCU`, sha **`929c937`**, created 2026-09-23 **07:20 UTC**. The
`deploy-frontend.yml` dispatch (run 35935705713) failed at *Deploy via the sanctioned guarded
entrypoint* and produced no deployment.

The blocker is the **global, correctly fail-closed migration-drift gate**. Six migrations were
applied to production between **23:21 and 23:47 UTC** by four other routines:

| version | PR mirroring it |
|---|---|
| `20260923232119_detector_candidate_set_guard` | [#3800](https://github.com/6ttvrw4fmf-ctrl/ezhalah/pull/3800) |
| `20260923232344_cron_collision_detector_sees_daily_jobs…` | [#3810](https://github.com/6ttvrw4fmf-ctrl/ezhalah/pull/3810) |
| `20260923232749_cron_start_instants_materialize_writer_scan` | [#3810](https://github.com/6ttvrw4fmf-ctrl/ezhalah/pull/3810) |
| `20260923233010_aqar_area_truncation_residue_repair_and_detector` | [#3808](https://github.com/6ttvrw4fmf-ctrl/ezhalah/pull/3808) |
| `20260923233458_observed_cron_cadence_must_not_outlive_a_schedule_change` | [#3809](https://github.com/6ttvrw4fmf-ctrl/ezhalah/pull/3809) |
| `20260923234716_fold_diriyah_bisha_duplicate_city_ids` | [#3813](https://github.com/6ttvrw4fmf-ctrl/ezhalah/pull/3813) |

**Every one of the six is already mirrored in an open PR.** Nobody skipped the apply-and-mirror rule;
there is no missing work, only review — and a PR touching `supabase/migrations/` is one an autonomous
run must never self-merge. So this is §G.2(d), routed to routine-2 rather than parked, and the gate
was not touched.

Worth the owner's attention as a **standing pattern, not a one-off**: the fleet applied six
migrations in 26 minutes tonight, and each one closes the deploy window for *every* session until its
review PR merges. The cost lands on whoever happens to have a user-facing fix ready — tonight, this
one — rather than on whoever applied the migration. This is `ops_incident` #131/#138 recurring as a
standing condition.

## Coverage ledger

Written this run (`af_` / `trending_` prefixes): `trending_cities.rpc_eq_db_truth.buy_unnarrowed`,
`trending_cities.rpc_eq_db_truth.rent_annual_apartment_beds3`,
`trending_districts.rpc_eq_db_truth.riyadh_rent_annual_apartment_beds3`,
`trending_districts.honest_zero_over_false_fallback`,
`af_option_card.riyadh_buy_apartment.amenity_round.pill_eq_cnt_eq_oracle`,
`af_closing_note.closed_chat.names_a_way_out`, and the two aqar re-measurements.

**Not yet covered**, and named so it is not mistaken for tested: mobile 390×844 for this run's
Trending dimensions (last touched 2026-08-23), the non-Riyadh AF option-card rotation, and
`living_rooms` on Villa cohorts (`#96`, still awaiting its full certification).

---

## Final report

```
ADVANCED FILTER HEALTH:      9.2/10 → 9.2/10   (the fix is merged, not live — nothing moves until it ships)
TRENDING CITIES HEALTH:      9.6/10 → 9.6/10
TRENDING DISTRICTS HEALTH:   9.6/10 → 9.6/10
AF DATA INTEGRITY:           9.4/10 → 9.4/10
OVERALL AF + TRENDING:       9.3/10 → 9.3/10

BUGS FOUND: 1
BUGS FIXED: 1  (merged 19a3e48; PROPAGATION PENDING, not live)
BUGS REMAINING: 0 that this routine could safely fix and did not
BARRIERS ADDED: 1 extended (§5b, 9 new checks) + 1 repaired (over-pinned call site)
MUTATIONS KILLED: 4/4
TESTS: PASS  (npm test green on CI at the merged head; 509 checks)
MERGED: YES
DEPLOYED/APPLIED: NO — refused by the global migration-drift gate (ops_incident #665)
PRODUCTION VERIFIED: NO — PROPAGATION PENDING
SENTRY CHECKED: YES
SENTRY CONNECTION WORKING: YES
OPEN P0/P1 IN SCOPE: 2  (#340 reproduced; #563 narrowed to its exact four failing steps)
TRUE SCORE: 8.5/10
10/10 ACHIEVED: NO
```

**Blockers, with category and owner — none of them a defect this routine chose not to fix:**

1. **§G.2(d) — the deploy window is closed fleet-wide.** Six other routines' migrations, all already
   mirrored in open PRs that policy keeps open for review. Owner: **routine-2-production**
   (`ops_incident` #665). This is what makes `PRODUCTION VERIFIED: NO` unavoidable tonight, and it is
   the only reason the #598 fix is not live.
2. **§G.2(f) — production was degraded at 23:28–23:32 UTC** (search mean 3,912 ms, a 3m37s query,
   PostgREST 503 `PGRST002`). Owner: **routine-2-production** (`ops_incident` #650). It reddened a CI
   check on an unrelated PR and kept a live AF/Trending journey from starting; adjudicating the two
   unclaimed `#563` steps through that window would have manufactured false negatives.
3. **§G.2(f) — no egress to the sources from this container** (`ksa-aqar.com` → HTTP 000 while
   production → 200), so `#380`'s age-source registration cannot be probed here and was neither
   registered nor waived.

**Why not 10/10:** one real defect was found and it is fixed, barriered and merged — but the owner's
supreme rule is that nothing is live until it has been used like a real user, and this run could not
reach that state. A score that ignored the un-shipped half would be the manufactured 10/10 §G.5
forbids.
