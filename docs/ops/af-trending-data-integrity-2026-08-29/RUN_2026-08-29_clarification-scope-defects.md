# AF + Trending Data Integrity — run 2026-08-29

Routine #5 (🎯 Senior Advanced Filter + Trending Data Integrity Engineer). Spec:
`docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md`.

```
CONTRACT READ:                YES  (docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md, 4b4643b)
BUGS FOUND:                   3   (1 live P1 · 1 stale canonical contract · 1 inflated score entry)
BUGS FIXED:                   2
BUGS REMAINING:               1   (reported with full repro, deliberately not guessed at — §3)
BARRIERS ADDED/STRENGTHENED:  2   (1 new · 1 extended)
MUTATION-PROVEN:              YES (7 mutations on the new barrier, 4 on the extended one)
MERGED:                       YES (#1255, #1256 — both through scripts/safe-pr-merge.ts)
DEPLOYED:                     YES (run 33251255416; entry-b8110a33… → entry-9256c52a…)
PRODUCTION VERIFIED:          YES (§1a — the exact broken cases, re-driven on the served bundle)
```

**ALL GOOD: NO** — one deterministic, reproduced defect remains open (§3), plus the two
source-adjudication items inherited from previous runs (§5).

---

## 1. The defect that made this run worth running

Driving ordinary **non-Riyadh** AF journeys — the thing this routine's Part 5 mandates and that had
quietly stopped being done properly — turned up a live P1 in the الوكيل الذكي flow.

The app asks its own question, then throws away the answer's subject:

```
ask     أبغى شقة للإيجار السنوي في الدمام
app     تقصد مدينة الدمام كاملة، أو حي معيّن؟
answer  المدينة كاملة
sent    p_cities = [المدينة المنورة, ينبع, العلا, أملج, بدر, الحناكية, خيبر, مهد الذهب]  → 1,155
```

against the control:

```
answer  كامل الدمام
sent    p_cities = [الدمام]                                                              → 2,600
```

Reproduced the same minute for **جدة** and **أبها**, and for the phrasing «المدينة كلها» — every one
returned the identical wrong 8-city Madinah fan-out. The generic Arabic noun «المدينة» in the answer
is re-parsed as the **city name** المدينة المنورة, and the city the app had just named is silently
discarded. Nothing in the UI says the scope changed.

**Why it is this routine's problem.** Every AF question, every option count, and every Trending row
downstream is then computed against a city 1,200 km from the one the user asked about. `INTENT = UI
= REQUEST = RPC = DB TRUTH = RESULTS` breaks at the first link, and everything after it is
faithfully wrong.

**Root cause.** `pendingScopeRef` is only ever armed for region-AND-city **twin** names (الرياض,
جازان, …). For a plain city the app remembered nothing at all about the question it had just asked,
so the next turn's parse was free to invent a city out of a generic answer.

**Fix** (PR #1255): remember the plain city the question was about, armed from the question itself
through one shared template + parser, and when the answer is a generic whole-area affirmation
carrying no place of its own, keep that city. `isGenericWholeAreaAnswer()` is strict in the safe
direction — one real word survives the token strip («كامل الدمام», «حي الشاطئ», «المدينة المنورة»)
and it returns false. It can never overwrite a city the user named; it can only refuse to forget the
one the app itself asked about.

**Barrier**: `scripts/verify-agent-whole-city-answer.ts`, mutation-proven seven ways (predicate stops
rejecting a named city · stops requiring an affirmation · ref never armed, the exact pre-fix state ·
`askedCity` gate dropped · ref never cleared · template reworded out from under the parser · location
never applied) — each red, then green.

**This also contaminated the harness.** The 2026-08-28 run's own note said to answer this question
with «المدينة كاملة». Every non-Riyadh AF journey driven that way was therefore silently exercising
Madinah, not the city named. Corrected in the harness notes below.

### 1a. Production verification — re-driven on the served bundle

Deployed via the sanctioned workflow (run 33251255416); the alias moved from
`entry-b8110a330b9aabaa5de9e5a8e2fcb683.js` to `entry-9256c52a6821b23303c2e10fa73ec76d.js`. The
exact broken cases, re-driven against production, reading the request the page actually sends:

| ask | answer | `p_cities` before | `p_cities` after | results |
|---|---|---|---|---|
| الدمام | المدينة كاملة | 8-city Madinah region | **`[الدمام]`** | 1,155 → **2,600** |
| جدة | المدينة كاملة | 8-city Madinah region | **`[جدة]`** | 1,155 → **8,410** |
| أبها | المدينة كلها | 8-city Madinah region | **`[أبها]`** | 1,155 → **472** |
| الدمام | كامل الدمام *(control)* | `[الدمام]` | **`[الدمام]`** | 2,600 → 2,600 |

The control is the important row: a city the user named is still their own, unchanged — the fix only
refuses to forget, it never overwrites.

A full AF journey re-driven on the corrected scope: Jeddah headline **8,410**, and the round's option
chips are 7,423 + 824 + 104 + 59 = **8,410 exactly**. The AF counts now belong to the city the user
asked for, which is the whole point — 8/8 rule checks pass, desktop.

## 2. The contract advertised a control the owner had deleted — and the score paid for it

Two compounding defects in the **instruments**, not the product (PR #1256).

The owner removed «تخطي الباقي» on 2026-08-28 with the «عرض النتائج» early-exit (#1216). That change
rewrote §8.3 but left **§8.4 and R11.4** describing Skip All as live — in the one document an
engineer is explicitly told to rebuild AF from, and explicitly told not to second-guess from old PRs.

Worse, `scripts/lib/afContractCoverage.ts` graded both rules **B (barrier-protected)**:

| rule | barrier cited | mentions Skip All? |
|---|---|---|
| R8.4.1 | `verify-af-cross-round-carry` | no |
| R11.4 | `verify-af-round-size` | no |

Neither barrier mentions it — they cannot, the control does not exist. The rating instrument was
awarding marks for a removed feature on barriers that never tested it: the exact score inflation the
owner rejected on 2026-08-28. The coverage-map barrier checks that a cited barrier *exists and
executes*, but not that it covers the rule's subject — that is the loophole.

Both rules are now retired with `~~strikethrough~~` + the owner date (this document's own convention
for a moved rule, per R5.4.1/R5.4.3), and both grades cite `verify-af-footer-buttons`, which really
does execute what they now say. **Derived scores unchanged** — they were accidentally right and are
now truthful.

`verify-af-footer-buttons.ts` was **extended, not duplicated** (it already owns this owner decision):
the contract's footer prose is now pinned against the card's real controls in both directions. A
retired control's name may appear only inside `~~…~~`, which is what makes "retired" machine-readable;
the three live controls must be named in §8.3 itself, scoped to that section because a document-wide
`includes()` passes on any stray mention elsewhere. Mutation-proven four ways.

## 3. STILL OPEN — Riyadh: an exact scope named twice, never committed

Deterministic, 4/4, **not fixed this run and not guessed at**.

```
ask     أبغى شقة للإيجار السنوي في الرياض      (or «...في مدينة الرياض»)
app     تقصد منطقة الرياض كاملة، أو مدينة معيّنة مثل الرياض أو الخرج؟
answer  مدينة الرياض
app     تقصد منطقة الرياض كاملة، أو مدينة معيّنة مثل الرياض أو الخرج؟   ← identical, no search
answer  مدينة الرياض
app     ما قدرت أحدد الموقع بدقة، فبحثت في نطاق أوسع
        الإقليم: منطقة الرياض · 23,628 إعلان
        p_cities = 20 cities (الزلفي, الرياض, المجمعة, الخرج, الدلم, الدوادمي, ملهم, المزاحمية,
                   الحريق, القويعية, شقراء, ثادق, عفيف, الدرعية, السليل, الغاط, رماح, العمارية,
                   الهياثم, حوطة بني تميم)
```

The user names the **city** twice and is given the **region** — the opposite of the scope they chose.
Same for a bare «الرياض» answer. This is the 2026-08-23 `agent-clarify-loop` shape recurring through
the twin/region branch, and it is a **distinct root cause** from §1 (which is the plain-city branch).

**What lowers its severity**: the app is honest about it. It renders «ما قدرت أحدد الموقع بدقة،
فبحثت في نطاق أوسع» and the summary states «الإقليم: منطقة الرياض». This is a *disclosed* widening,
not a silent wrong scope. It is still a real defect — the user did narrow, precisely, twice — and it
lands on the largest market in the inventory.

**Why it was not fixed here.** `src/data/locations.ts` cannot be imported from plain Node (it pulls
react-native, as its own comments warn), so `resolveLocation()` could not be executed offline to
determine which branch mis-fires. Shipping a guess into the same clarification machinery that two
not-yet-validated PRs were already touching would have been worse engineering than reporting it with
complete evidence. **Next run should instrument this first** — a browser-side probe of
`resolveLocation('الرياض' | 'مدينة الرياض' | 'منطقة الرياض')` against the served bundle will settle
it in one pass.

## 4. AF data integrity — the aqar repair has fully propagated

`af_data_integrity / aqar.fix_propagation` had sat **PENDING since 2026-08-23**. Closed today.

| | 2026-08-23 | 2026-08-29 |
|---|---|---|
| aqar `maid_room` (base) | 15,987 true / **0 false** / 117,734 rows | 9,447 T / **5,000 F** / 108,386 unknown |
| aqar `driver_room` (base) | — | 4,794 T / **6,448 F** / 111,591 unknown |
| aqar `maid_room` (`search_listings_ar`) | — | 7,231 T / **4,976 F** |
| aqar `driver_room` (`search_listings_ar`) | — | 3,674 T / **6,414 F** |

Real tri-state has landed end to end, the user-facing index included (newest `last_seen_at`
2026-08-29 08:13). PR #987's parser fix propagated through the 8h sweep exactly as predicted. **No
hand repair was made** — the sweep did it.

## 5. Tri-state stuck pairs — two cleared themselves, two remain

Of the four pairs standing on 2026-08-26:

| pair | then | now | verdict |
|---|---|---|---|
| wasalt `driver_room` | 0 / 74 | 590 T / 2,464 F | **CLEARED** |
| satel `kitchen` | 39 / 0 | 87 T / 4 F | **CLEARED** |
| satel `air_conditioner` | 39 / 0 | 90 T / 0 F | still stuck |
| sanadak `maid_room` | 35 / 0 | 132 T / 0 F | still stuck |

satel AC was adjudicated 1:1 faithful to source on 2026-08-28. The outstanding claim — that satel's
acType enum has no negative value — is a *source-limitation* claim, which `AGENTS.md` permanent rule
#2 forbids asserting without a live probe. **satel.sa was re-probed today and is still blocked by
egress policy** (`connect_rejected`, both apex and `www`). Recorded, not waived, not called a flake.
`alert_event af_field_stuck_no_variance` (P2, open since 08-20) correctly remains open.

## 6. Contract spot-audit — this run's rotating subset

| rule | how audited | result |
|---|---|---|
| R4.1.1 no auto-open | live, desktop + mobile | `af-card` absent until the user tapped the offer |
| R4.4.2 offer opens a round that stays open | live, desktop + mobile | Q1 rendered with chip 1,155 and 4 options |
| R2.5.1 unknown never rolled into an option | live | 973+88+69+24 = 1,154 chips + «1 إعلان لم يذكر هذه المعلومة» = 1,155 headline |
| R3.1 scope tier asked first | live | group → exact type asked before any advanced question |
| R6.3.1 new results turn, narrowed | live | 1,155 → 4 |
| R6.3.2 receipt on the prior turn | live | `af-round-receipt` present |
| R8.3.1 footer = متابعة/تخطي/رجوع, no «عرض النتائج» | live + hermetic | all three present; no early-exit in the card |
| R8.4.1 / R11.4 Skip All | live + contract | control absent — contract was stale, §2 |
| R11.1 AF stops at ≤25 | live | offer withheld at 4 results |
| R14.2.1 Trending count = click-through | live, 3 narrowed states | 9 city rows exact, incl. an AF-answer stack |
| R14.4.2 Trending usable under narrowing | live | all 3 states within the 5 s bound |

## 7. The two remaining grade-N coverage gaps — designed, not built

`verify-af-contract-coverage-map` reports `L 46 · B 69 · P 18 · N 2`. Both N-grades are real gaps,
scoped here so the next run can build them without re-deriving the design. Neither was built this
run: the two live defects above took the run's fix budget, and a half-built certification barrier is
worse than a named gap.

- **R2.1.2 — "no question ships without a ledger entry" is enforced by nothing.** Nothing
  cross-checks `COHORT_QUESTIONS` (`src/lib/afCohorts.ts`) against `docs/AF_COHORT_LEDGER.md` or
  `public.af_cohort_registry`. The registry is the stronger anchor — it is per `type_ar × deal ×
  rent_period` with the certification evidence in its `note`, and the ledger's own header calls the
  file **plus** that table "the control plane". The barrier to write is `COHORT_QUESTIONS ⊆
  af_cohort_registry (enabled)`: a cohort shipping questions with no registry row is a question the
  barrier fleet does not protect. It needs an offline snapshot mirror of the registry
  (`sql/mirrors/`) because `npm test` is hermetic — same pattern as
  `sql/mirrors/af_eligibility_clause.sql` added on 2026-08-28.
- **R5.6.1 — nothing asserts SALIENCE affects ASK ORDER only, never inclusion.** `scoreQuestion()`
  multiplies `bestSplit` by `SALIENCE[id]`, and the source comment is emphatic that this is ordering
  only — but a weight leaking into an inclusion gate would silently drop useful questions and look
  like "AF ran out of things to ask". This one is cheap and fully hermetic: for every question id,
  vary `SALIENCE` across its whole range (including 0) and assert the set of surviving options and
  the null/non-null verdict are invariant, while only `score` moves. Mutation: make `scoreQuestion`
  return null below a salience threshold.

## 8. Harness notes for the next run

Supersedes the 2026-08-28 notes where they conflict.

1. **Do NOT answer «تقصد مدينة X كاملة، أو حي معيّن؟» with «المدينة كاملة»** until PR #1255 is live —
   it searched Madinah, not X (§1). Use «كامل X» to pin the city you actually want. This is what
   silently invalidated earlier non-Riyadh journeys.
2. **Riyadh cannot currently complete an agent-flow search at the city scope** (§3). Budget for it,
   or drive Riyadh journeys through the «تصفية» Filter flow instead.
3. **The disambiguation takes 5–15 s.** Poll for «تقصد» (up to ~20 s) rather than sleeping a fixed
   2.5 s, and poll for a results turn rather than sleeping — a fixed wait reads as "no offer button"
   and looks exactly like an R4.4 defect.
4. **Playwright's Python API: `locator.last` is a property, not a method.** `cta.last()` raises
   `TypeError: 'Locator' object is not callable` mid-journey and reads as a harness crash.
5. **The mobile CI red at 03:37/03:42 today was real but is already fixed.** The centered `AuthModal`
   auto-raised on mobile and intercepted pointer events over «الوكيل الذكي» for the full 30 s. Commit
   31d42f2 (#1218, 2026-08-29 03:43 UTC) retired the auto-showing popup in favour of the draggable
   `SignInCard`; runs at 03:50, 07:11 and 08:51 are green and a clean mobile load was verified by
   hand today. Not a standing defect.
6. **`npm ci` first.** Without `node_modules`, `tsc --noEmit` fails wholesale on `expo/tsconfig.base`
   and every react import, which looks like the change broke the build. It did not.
7. `npm test` still needs `curl_cffi`, `python-dotenv`, `supabase` (install the last with
   `--ignore-installed PyJWT`).
8. **No Sentry connector is attached to this session**, so §S's scoped queue is unreadable. That is
   the owner-only setup step `docs/ops/SENTRY_ROUTING.md` already names — not something a run can
   fix from inside.
