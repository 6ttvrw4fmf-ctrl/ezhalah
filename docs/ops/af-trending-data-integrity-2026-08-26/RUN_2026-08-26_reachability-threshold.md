# AF + Trending Data Integrity — run 2026-08-26

Routine #5 (🎯 Senior Advanced Filter + Trending Data Integrity Engineer). Spec:
`docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md`.

```
AI AGENT → AF CTA:            PASS   (4/4 live journeys, twice, from CI)
ROOT CAUSE:                   no product defect — the 6/6 failure reproduced in the
                              routine's own container did NOT reproduce from a GitHub
                              runner against the same production bundle. Environment.
FILTER FLOW AF:               PASS
SKIP:                         PASS   (test fix; product was correct)
BACK:                         PASS   (test fix; product was correct)
LIVE CHECK GREEN:             YES
BUGS FOUND:                   3  (1 barrier defect · 2 stale-oracle defects)
BUGS FIXED:                   3
BARRIER ADDED:                YES  (agent-flow live check + pure rule)
MUTATION-PROVEN:              YES  (4 mutations on the new rule, 3 on the reachability pin)
MERGED:                       NO   (merge gate refused in this environment — §5)
DEPLOYED:                     NO   (no src/ change; none required one)
PRODUCTION VERIFIED:          YES
```

**ALL GOOD: YES**, with one honest correction recorded below and one unrelated item flagged.

---

## 1. The correction that matters most

An earlier alert in this run said Advanced Filter was **broken in production** from the AI-agent
flow. **That was wrong, and it was my error.** It is withdrawn.

What I had: 6/6 reproductions from this routine's container — five cohorts plus a 65-second poll,
desktop and mobile, and a timing trace showing the actions row hiding at t=5.0s and returning at
t=8.2s (which is uniquely the `plan.length < MIN_USEFUL_QUESTIONS_TO_SHOW` path).

What settled it: I built the missing agent-flow barrier and ran it against **the same production
bundle from a GitHub runner**. All four agent journeys passed, twice, in independent runs:

```
PASS  agent · Riyadh · Rent-Annual · apartments — offered-and-opened
PASS  agent · Riyadh · Buy · villas — offered-and-opened
PASS  agent · Jeddah · Buy · apartments (non-Riyadh) — offered-and-opened
PASS  agent · Riyadh · Rent-Annual · apartments (MOBILE) — offered-and-opened
```

Same bundle, same cohorts, opposite result ⇒ the variable is the environment I was driving from,
not production. This container reaches the app through an egress proxy that forces TLS 1.2 and
resets or blocks assorted subresources (`ERR_TUNNEL_CONNECTION_FAILED` throughout every session);
the repo's own live checks cannot run here at all for the same reason.

Two supporting facts, gathered before the CI result, point the same way — the data and the rules
were never at fault:

- I captured the **tap's exact RPC request and response** in production (`apartment_guided_counts_ar`,
  `cnt_total_base` 10,670, bath 4129/2950/1709/250, furnished 1046/2706, rnpl 3848) and ran the
  **real** `scoreQuestion`/`meaningful`/`minOptionsFor` over it offline: **plan = 4**
  (bathrooms 0.697, amenities 0.647, furnished 0.507, rnpl 0.433). The counts and the ranking rules
  would have opened AF.
- Driving a **local dev build of the identical source** (`git diff 22a2936..cf8bfc0 -- src/` is
  empty) reproduced a full healthy interview end to end against real data — plan of 5, counts
  narrowing 611 → 289 → 107, Skip leaving the count unchanged.

**Lesson recorded:** one environment is not production. A reproduction from this container is a
hypothesis until it is confirmed from a faithful runner, and I should have qualified the first
report that way instead of escalating it as a user-facing regression.

## 2. The barrier that was missing (kept, and worth keeping)

Even with no product defect, the investigation surfaced a real gap: **every journey in
`verify-af-live-truth.ts` reaches Advanced Filter through the FILTER flow.** The agent flow — the
entry path the harness notes actually document — had **zero** live coverage.

- `scripts/lib/afOfferAgreement.ts` — the rule, pure. Either «خلّنا نحدد الطلب أكثر» is NOT offered,
  or a question actually renders. Offered-then-nothing fails, deliberately **cause-agnostic**, so it
  survives the next rewrite of the orchestration.
- `scripts/verify-af-agent-cta-live.ts` — four live agent journeys (Riyadh rent apartments, Riyadh
  buy villas, Jeddah, mobile 390×844), wired into `af-live-truth-check.yml` as its own step under
  `if: !cancelled()` so neither half of the surface can hide the other.
- `scripts/verify-af-offer-agreement.ts` — hermetic, in `npm test`, pins the truth table, keeps the
  two diagnoses distinguishable, and carries a **SOFTENER GUARD** proving no combination of signals
  can pass without a rendered question.

**Mutation-proven**, each reverted: a `loading` flash counted as opened → 🔴; offered-but-never-opened
downgraded to a pass → 🔴; the workflow no longer invoking the live check → 🔴; the live check
silently switched to the Filter flow → 🔴; restored → 🟢.

## 3. Skip and Back — the product was right, the oracle was stale

The permanent check had been red with `before=10957 after=null` (Skip) and `expected=null got=2482`
(Back). Adjudicated as asked: **the product is correct.** #1061 deliberately blanks the count during
the pending window, and the wait predicates were *satisfied by* that null, so they sampled the blank:

| | predicate before | why it sampled a blank |
|---|---|---|
| Skip | `s.hasCard && s.q !== st.q` | never required a resolved count |
| Back | `s.chip !== baselineChip` | `null !== baseline` is **true**, so `afterSelect` captured the blank — which also made "count changed after selecting" pass for the wrong reason |

Fixes, none of which weaken the oracle — the equality assertions are untouched and a chip that never
resolves still fails explicitly:

1. the predicates require `chip != null`, and the assertions assert it;
2. Skip's and Back's waits get an explicit **25s**, because both go through the *refill* path (the
   chip must be repainted with the SAME number rather than arriving with a fresh narrowing) which
   outran the 9s default on a 10,957-row scope. CI then proved the refill is real: **`before=10957
   after=10957`**;
3. an empty option list after Back is now a named failure instead of a click on
   `[data-testid="undefined"]`, which used to spend 30s timing out on an impossible selector and
   bury the real cause.

## 4. Also fixed this run: AF reachability measured at a dead threshold

`scripts/verify-af-group-cohort-coverage.ts` rolled up "which groups can open AF" with a hardcoded
`>= 2` while `MIN_USEFUL_QUESTIONS_TO_SHOW` moved to **1** on 2026-08-24. At the real threshold
**six** of eight shipped groups can open AF, not two; the four it could not see are exactly those
with ceiling 1 (Apartments & Co-living, Villas & Houses, Retail & Workspace, Industrial & Logistics).
It also only asserted `reachable.length > 0`, so with two plot groups permanently clearing the bar
every other group could regress to zero while it stayed green. The threshold is now **read** from
`advancedFilters.ts` (anchored regex — a rename fails loudly) and the reachable **set** is pinned by
name. Mutation-proven three ways.

## 5. Trending — exact, unchanged

Cities: request carried the complete filter state; **UI = RPC = independent DB truth on all 6 rows**
(الرياض 1,415 · الدمام 220 · جدة 181 · الخبر 178 · الجبيل 79 · عنيزة 77), and the distribution moves
with the filter, so trending is recomputed rather than stale. Districts: 6 live
`location_search_candidates_ar` calls replace the scope counts, all six exact (المهدية 333 ·
النرجس 149 · العارض 127 · الرمال 85 · الجنادرية 61 · طويق 21).

## 6. Not merged, and why

PR #1127 is green and clean, and stays open. `AGENTS.md` makes `scripts/safe-pr-merge.ts` the only
sanctioned merge path; it reads PR state over GitHub **GraphQL**, which this session's gateway
refuses — verified directly: `POST https://api.github.com/graphql -> 403`. `gh` is not installed
here either, but installing it would not help: the refusal is at the gateway. Hand-reproducing a P0
merge gate over REST is routing around it, which the authority grant forbids.

## 7. Flagged, not touched

One unrelated check went red on a single journey in one run — `Residential/Buy/Apartment/Riyadh —
bathrooms: final search request was captured -> null` — and passed on the same journey in the next
run. It is a capture race in a check outside this routine's two assigned items; recorded here rather
than fixed, so it is not lost.

## 8. Harness notes for the next run

1. **This container cannot faithfully drive the app.** Its proxy forces TLS 1.2 and resets/blocks
   subresources; the repo's live checks fail here with `ERR_CONNECTION_RESET` before any journey
   runs. Confirm anything that looks like a production defect from CI (`workflow_dispatch` on
   `af-live-truth-check.yml`) before reporting it. This cost this run most of its time.
2. **District oracles must normalize the «حي» prefix**, not just expand `match_values`: the RPC label
   is `حي المهدية` while `search_listings_ar.district_ar` stores `المهدية`. An oracle keyed on the
   display label reports a false zero — it did here, on a row whose count was exactly right (333).
3. **The agent's disambiguation options are plain text, not buttons** — a real user answers by
   typing. The composer is disabled while the agent works, so a bare `fill`+Enter silently no-ops:
   wait for the message to echo into the transcript first.
4. **`playwright` in this image is build 1194 while the repo pins 1234.** Bridge it with symlinks
   under `/opt/pw-browsers` (the headless-shell layout differs: `chrome-linux/headless_shell` vs
   `chrome-headless-shell-linux64/chrome-headless-shell`). Never run `playwright install`.
5. **The local dev server is a usable oracle for orchestration questions** (`npx expo start --web`
   plus an `.env` carrying the public anon key): it runs the identical source against real
   production data, and `console.log` instrumentation there answers "which branch ran" in minutes.
   Its *agent parse* is not faithful, so use it for the interview mechanics, not for query shapes.
