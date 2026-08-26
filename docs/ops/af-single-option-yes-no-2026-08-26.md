# AF — a lone surviving meaningful option is a valid yes/no: the production measurement

**Date:** 2026-08-26 · **Owner instruction:** «Test this against real production cohorts first.»
**Change measured:** `MIN_OPTIONS_SINGLE` 2 → 1 in `src/lib/afRanking.ts`. Nothing else moved.
See `docs/ADVANCED_FILTER_DESIGN_CONTRACT.md` «Amendment 2026-08-26» for the rule and the reasoning.

## Method

Two sweeps against **production** (`aannarbkwcymrotzwdbo`) through the **anon key** — the exact
RLS-respecting path a real browser takes, never MCP SQL (which bypasses RLS and is not what a user
sees). Counts come from the app's OWN count RPCs, called with the app's OWN param shape
(`resolveSearchScope` + `rpcCountFilterParams` + `rpcAdvancedFilterParams`):

- `apartment_guided_counts_ar` — bathrooms / furnished / street_width / rating / unit_subtype
- `property_age_option_counts_ar` — property_age (age-agnostic, per `ageAgnostic()`)

Every verdict is computed by the app's OWN pure gates imported from `src/lib/afRanking.ts` —
`meaningful()` (the `MIN_REAL_OPTION_COUNT = 5` floor) then `optionNarrowsMeaningfully()` — never a
re-derivation. Question sets per cohort come from `COHORT_QUESTIONS`; Arabic type lists from
`CLEAN_TO_TYPE_AR`. Only SINGLE-SELECT questions are in scope: multi already behaved this way.

**Sweep 1 — cohort ENTRY state** (no answer committed yet): every certified type × Buy /
Rent-annual / Rent-monthly × 18 locations (nationwide + 17 cities, Riyadh and non-Riyadh,
residential and commercial). 702 cohort probes → **595 live single-select questions**.

**Sweep 2 — MID-INTERVIEW state**, where the owner's 940/60-of-1,000 shape actually lives: the same
grid × 16 already-committed states a real user reaches by answering ONE question first
(`bath≥2/3/4`, `age:new/10+/3-5`, `amenities elevator/parking/kitchen`, `stw≥20/25`,
`rating≥9.0`, `subtype:studio`). **9,984 probes**, 161 distinct cohorts, 16 locations.

## (a) How many real cohorts gain a question?

| sweep | live single-select questions probed | asked today | **newly asked under the fix** | still discarded |
|---|---|---|---|---|
| 1 — entry state | 595 | 562 | **23** | 10 |
| 2 — mid-interview | 9,984 probes | — | **262** | — |

262 of the mid-interview instances span **161 distinct cohorts** across 16 locations
(nationwide, الرياض, جدة, مكة المكرمة, الدمام, الخبر, المدينة المنورة, الطائف, بريدة, حائل, تبوك,
أبها, خميس مشيط, الأحساء, نجران, جازان) and all three deal/period legs
(Buy 134 · Rent-annual 107 · Rent-monthly 21), over `bathrooms` (97), `street_width` (86),
`property_age` (41), `furnished` (37), `rating` (1).

Two shapes, both fixed by the same one-line change:

- **A — the owner's exact defect** (50 of 262, plus 1 at entry): 2+ real options existed, the
  lopsided one was filtered out by `optionNarrowsMeaningfully`, one survivor was thrown away with it.
- **B — a lone real option** (212 of 262, plus 22 at entry): only one option cleared the
  `MIN_REAL_OPTION_COUNT` floor at all, and it too was discarded on arity.

## (b) What cut does the lone survivor actually deliver? — CONFIRMED EMPIRICALLY

**Zero** of the 285 newly-asked questions (both sweeps) delivers a cut below 10%.

| cut delivered | mid-interview instances |
|---|---|
| < 10% | **0** |
| 10–25% | 87 |
| 25–50% | 68 |
| ≥ 50% | 107 |

110 of the 262 land the user at ≤ `INTERVIEW_STOP_AT` outright; **none** of those 110 relies on the
`count <= INTERVIEW_STOP_AT` escape to cover a sub-10% cut. Entry-state sweep: cuts 21.4%–83.3%,
minimum 21.4%. This is by construction — the survivor had to clear `optionNarrowsMeaningfully`
before it could be a survivor — and the sweep confirms it holds on real inventory rather than
assuming it.

Largest cohorts gained (mid-interview, N ≥ 100 — 99 such instances; first 30):

| cohort | committed state | question | N | shape | options | cut |
|---|---|---|---|---|---|---|
| Apartment/Buy/ALL-KSA | bath>=3 | bathrooms | 8759 | B | real=[4+:2482] survivor=4+:2482 | 71.7% |
| Apartment/RentAnnual/ALL-KSA | bath>=3 | bathrooms | 5460 | B | real=[4+:1387] survivor=4+:1387 | 74.6% |
| Floor/Buy/ALL-KSA | bath>=2 | bathrooms | 3707 | A | real=[3+:3550,4+:2241] survivor=4+:2241 | 39.5% |
| Villa/Buy/ALL-KSA | stw>=25 | street_width | 3699 | B | real=[30m+:2175] survivor=30m+:2175 | 41.2% |
| Floor/Buy/ALL-KSA | bath>=3 | bathrooms | 3550 | B | real=[4+:2241] survivor=4+:2241 | 36.9% |
| Villa/RentAnnual/ALL-KSA | bath>=2 | bathrooms | 3537 | A | real=[3+:3440,4+:3087] survivor=4+:3087 | 12.7% |
| Villa/RentAnnual/ALL-KSA | bath>=3 | bathrooms | 3440 | B | real=[4+:3087] survivor=4+:3087 | 10.3% |
| Apartment/Buy/جدة | bath>=3 | bathrooms | 3283 | B | real=[4+:640] survivor=4+:640 | 80.5% |
| Floor/Buy/الرياض | bath>=2 | bathrooms | 2901 | A | real=[3+:2802,4+:1715] survivor=4+:1715 | 40.9% |
| Residential Land/Buy/ALL-KSA | stw>=25 | street_width | 2820 | B | real=[30m+:1862] survivor=30m+:1862 | 34% |
| Floor/Buy/الرياض | bath>=3 | bathrooms | 2802 | B | real=[4+:1715] survivor=4+:1715 | 38.8% |
| Floor/RentAnnual/ALL-KSA | bath>=3 | bathrooms | 2361 | B | real=[4+:988] survivor=4+:988 | 58.2% |
| Residential Building/Buy/ALL-KSA | stw>=25 | street_width | 2304 | B | real=[30m+:1983] survivor=30m+:1983 | 13.9% |
| Villa/RentAnnual/الرياض | bath>=2 | bathrooms | 2247 | A | real=[3+:2200,4+:1983] survivor=4+:1983 | 11.7% |
| Floor/RentAnnual/الرياض | bath>=3 | bathrooms | 1983 | B | real=[4+:810] survivor=4+:810 | 59.2% |
| Apartment/Buy/الرياض | bath>=3 | bathrooms | 1881 | B | real=[4+:441] survivor=4+:441 | 76.6% |
| Shop/RentAnnual/ALL-KSA | stw>=20 | street_width | 1774 | A | real=[25m+:1641,30m+:1572] survivor=30m+:1572 | 11.4% |
| Apartment/RentAnnual/الرياض | bath>=3 | bathrooms | 1709 | B | real=[4+:250] survivor=4+:250 | 85.4% |
| Residential Building/Buy/الرياض | stw>=20 | street_width | 1174 | A | real=[25m+:1063,30m+:1035] survivor=30m+:1035 | 11.8% |
| Apartment/RentAnnual/جدة | bath>=3 | bathrooms | 1172 | B | real=[4+:420] survivor=4+:420 | 64.2% |
| Residential Building/RentAnnual/الرياض | stw>=20 | street_width | 1119 | A | real=[25m+:1013,30m+:963] survivor=30m+:963 | 13.9% |
| Apartment/Buy/الدمام | bath>=2 | bathrooms | 1087 | A | real=[3+:1018,4+:370] survivor=4+:370 | 66% |
| Apartment/RentMonthly/ALL-KSA | bath>=3 | bathrooms | 1032 | B | real=[4+:118] survivor=4+:118 | 88.6% |
| Apartment/Buy/الدمام | bath>=3 | bathrooms | 1018 | B | real=[4+:370] survivor=4+:370 | 63.7% |
| Villa/Buy/الرياض | stw>=25 | street_width | 961 | B | real=[30m+:375] survivor=30m+:375 | 61% |
| Apartment/RentAnnual/الخبر | bath>=3 | bathrooms | 924 | B | real=[4+:294] survivor=4+:294 | 68.2% |
| Villa/RentAnnual/ALL-KSA | stw>=25 | street_width | 788 | B | real=[30m+:479] survivor=30m+:479 | 39.2% |
| Apartment/Buy/الدمام | amen:elevator | bathrooms | 680 | A | real=[1+:651,2+:642,3+:613,4+:235] survivor=4+:235 | 65.4% |
| Apartment/Buy/الخبر | bath>=3 | bathrooms | 570 | B | real=[4+:202] survivor=4+:202 | 64.6% |
| Apartment/RentAnnual/الدمام | bath>=3 | bathrooms | 563 | B | real=[4+:164] survivor=4+:164 | 70.9% |

All 23 gained at cohort ENTRY (no prior answer):

| cohort | state | question | N | shape | options | cut |
|---|---|---|---|---|---|---|
| Residential Building/RentAnnual/خميس مشيط | entry | furnished | 96 | B | survivor=غير مفروشة=16 | 83.3% |
| Shop/RentAnnual/خميس مشيط | entry | property_age | 29 | B | survivor=6-9=5 | 82.8% |
| Residential Building/RentAnnual/ينبع | entry | furnished | 37 | B | survivor=غير مفروشة=7 | 81.1% |
| Office/RentAnnual/مكة المكرمة | entry | furnished | 40 | B | survivor=غير مفروشة=8 | 80% |
| Studio/RentAnnual/ALL-KSA | entry | furnished | 32 | B | survivor=مفروشة=10 | 68.8% |
| Residential Building/RentAnnual/ينبع | entry | property_age | 37 | B | survivor=10+=12 | 67.6% |
| Apartment/RentAnnual/نجران | entry | furnished | 30 | B | survivor=مفروشة=10 | 66.7% |
| Residential Building/RentAnnual/أبها | entry | furnished | 45 | B | survivor=غير مفروشة=17 | 62.2% |
| Warehouse/RentAnnual/مكة المكرمة | entry | property_age | 26 | B | survivor=10+=10 | 61.5% |
| Residential Building/RentAnnual/جازان | entry | furnished | 32 | B | survivor=غير مفروشة=13 | 59.4% |
| Villa/Buy/نجران | entry | street_width | 34 | A | survivor=20m+=14 | 58.8% |
| Apartment/Buy/حائل | entry | property_age | 72 | B | survivor=جديد=30 | 58.3% |
| Floor/RentAnnual/الدمام | entry | furnished | 28 | B | survivor=غير مفروشة=15 | 46.4% |
| Floor/RentAnnual/المدينة المنورة | entry | furnished | 28 | B | survivor=غير مفروشة=15 | 46.4% |
| Residential Building/RentAnnual/بريدة | entry | furnished | 41 | B | survivor=غير مفروشة=22 | 46.3% |
| Shop/RentAnnual/تبوك | entry | property_age | 35 | B | survivor=جديد=20 | 42.9% |
| Office/RentAnnual/المدينة المنورة | entry | furnished | 33 | B | survivor=غير مفروشة=19 | 42.4% |
| Commercial Building/Buy/مكة المكرمة | entry | property_age | 28 | B | survivor=10+=19 | 32.1% |
| Floor/Buy/جازان | entry | property_age | 123 | B | survivor=جديد=90 | 26.8% |
| Villa/Buy/نجران | entry | property_age | 34 | B | survivor=جديد=26 | 23.5% |
| Apartment/Buy/نجران | entry | property_age | 26 | B | survivor=جديد=20 | 23.1% |
| Gas Station/RentAnnual/الرياض | entry | property_age | 27 | B | survivor=جديد=21 | 22.2% |
| Warehouse/Buy/جدة | entry | property_age | 28 | B | survivor=10+=22 | 21.4% |

## (c) Are ANY of the newly-asked questions useless or degenerate? — the honesty check

**No degenerate question appears, and none can.** Every newly-asked question's single option had
already cleared BOTH upstream gates before it could be a survivor: the absolute floor
(`MIN_REAL_OPTION_COUNT = 5` — never a 1-listing "choice") and `optionNarrowsMeaningfully`. A
lopsided-only question still dies with zero survivors; the owner's gym (100/100) still dies. Verified
in the sweep, not assumed: 0 sub-10% cuts, 0 survivors below 5.

**The honest caveat.** The weakest newly-asked questions sit exactly ON the owner's frozen 10% line,
not comfortably above it:

- `Commercial Building / Buy / nationwide`, after `stw≥25`: `street_width` «30m+» = 72 of 80 — a **10.0%** cut.
- `Villa / Rent-annual / nationwide`, after `bath≥3`: `bathrooms` «4+» = 3,087 of 3,440 — a **10.3%** cut.

These are marginal, and a reader should know that. They are marginal **because 10% is where the owner
set the line**, not because this change loosened anything: the identical 10.3%-cut option is already
asked today whenever the same question happens to have a second survivor, and the identical option as
a MULTI-select chip is already asked today with no second survivor at all. This fix removes an
arity-shaped inconsistency; it does not move the usefulness threshold. Raising
`MEANINGFUL_NARROWING_FRACTION` would be the lever for that, and the owner froze it.

**One thing this fix does NOT do:** it never makes AF open where it was closed. The `≥ 1 useful
question` gate (`MIN_USEFUL_QUESTIONS_TO_SHOW`, frozen) and the offer gate both read `rankQuestions`'
own output, so a newly-askable question can only ADD a question to a round that was already going to
happen, or turn a 0-useful scope into a 1-useful one — which is exactly what the owner asked for.

## Reproducing

The sweep harness is not committed: it is a one-shot measurement whose inputs (production inventory)
change daily, and every gate it calls is already executable from `src/lib/afRanking.ts`. The pinned,
permanent version of the same property lives in `scripts/verify-af-two-option-survival.ts` §6, which
sweeps the synthetic space and reports **4,640** two-option shapes gained, smallest `N=51,
survivor 5`.
