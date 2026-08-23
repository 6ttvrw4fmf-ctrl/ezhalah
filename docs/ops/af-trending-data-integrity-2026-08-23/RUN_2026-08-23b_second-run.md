# AF + Trending Data Integrity Engineer — run log, 2026-08-23 (run #2)

Spec: `docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md`. A bounded run, not a `SEARCH_MATCH_QA_ENGINEER.md`
§40-scale MAJOR certification (~200 journeys / ~5,000 RPC searches / exhaustive SQL differential) — that
scale was not attempted and must not be inferred from this log. Exact scope below.

## Carried in from run #1

- **PR #952 (duplicate refine question on double-tap) merged, live, and now PRODUCTION-VERIFIED.**
  Run #1 left it merged-but-unverified behind a flaky required check. This run drove the exact gesture
  against `https://ezhalah-app.vercel.app`: a rapid double-tap on «خلّنا نحدد الطلب أكثر» rendered
  **exactly one** refine question («أي حي تفضّل في الرياض؟»), zero duplicates; the single-tap control
  behaved identically. Nothing left open from run #1.
- Run #1 flagged "AF fell through to the legacy refine chips twice, worth a follow-up run's attention."
  **That is now root-caused** — see finding 2.

## Environment notes (this container, not the app)

Recorded so the next run does not re-derive them:

- Chromium (`/opt/pw-browsers/chromium`, build 1194 — do NOT run `playwright install`) needs
  `--ssl-version-max=tls1.2` plus `proxy={"server": "http://127.0.0.1:37915"}`; the egress gateway
  resets its TLS 1.3 ClientHello. Certificate verification stays fully on.
- The gateway's interception CAs must be imported into Chromium's own NSS store
  (`certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -i <cert>`), or navigation intermittently dies with
  `ERR_CERT_AUTHORITY_INVALID`. Split `/root/.ccr/ca-bundle.crt` and add only the six `O = Anthropic`
  certs — `certutil -A` on the whole 152-cert bundle hangs.
- `scrapers/common/http.get` (curl_cffi, browser TLS fingerprint) is reset by the same gateway. Source
  probes here used plain `curl` with a browser UA instead.

## Finding 1 — aqar maid/driver room were guessed from prose, not read from the source (FIXED)

**What the user experienced.** The Advanced Filter chips «غرفة خادمة» and «غرفة سائق» filtered on a
column Ezhalah guessed from page text instead of reading aqar's own published answer. aqar supplies
**12,543 of the search index's 13,720 `maid_room = true` rows (91%)** — those chips largely *are* this
column.

**How it was found.** By adjudicating the open `af_field_stuck_no_variance` P2 (raised 2026-08-20, still
open) against the live source rather than against plausibility.

**Root cause.** aqar publishes `maid` and `driver` as native `0/1/null` keys in its flat listing
payload — the same shape as `lift`/`ketchen`/`ac`, which `enrich_residential.py` already reads. It never
looked, so both columns fell through the prose fallback at the bottom of `_structured_amenities()`, and
that path can only emit **True-or-UNKNOWN**: a published `0` is discarded, and the phrase anywhere in the
page raises a confident `True`. Identical to the `parking` bug this same file already documents.

**Evidence — 36 live aqar pages, 0 fetch failures:**

| field | source published a value | agreed | UNKNOWN vs published 0 | UNKNOWN vs published 1 | TRUE vs published 0 |
|---|---|---|---|---|---|
| `driver` | 13 | 2 | 9 | 1 | 1 |
| `maid` | 15 | 10 | 2 | 0 | 1 |

- ad **6733365**: source `driver: 1`, stored `NULL` — a real driver room no filter can reach.
- ad **6738742**: source `maid: 0` and `driver: 0`, stored `true` on both — a fabricated attribute.

Discarding every published negative is why the columns hold **15,987 / 6,982 trues and zero falses over
117,734 rows**, which is exactly the shape the detector reported.

**Fix.** Two entries in `_STRUCTURED_AMENITY_KEYS` (PR #987). The prose loop already skips structured
columns, so a published `0` can no longer be overturned by page text, and silence still stays UNKNOWN.

**Barrier.** Extended `scrapers/common/tests/test_aqar_amenity_tri_state.py` (the file that already owns
this rule) rather than adding a parallel one: yes/no/silent per column, "a published 0 is never
overwritten by a prose hit", and **the bug class** — no column may be reachable from both a structured
key and `FEATURE_PATTERNS`. Mutation-proven: removing the mapping → 3 red; removing the prose-loop skip
→ 6 red; fixed source 14/14 green. Runs in CI via `common-location-tests.yml`.

**A second stale premise, caught by CI.** The first push of PR #987 turned `common-location-tests`
red on `test_columns_with_no_structured_counterpart_still_use_prose_as_a_positive_hint`, which
demonstrated the prose-only rule using `maid_room` on the stated premise that "aqar publishes no
maid-room key anywhere" — the *same* wrong premise that file's own header already records for
`parking`. The rule it pins is still right; only the example was wrong, so it was retargeted onto
`extension` («إمكانية التوسعة»), a genuine prose-only column, and the converse cases were added.
Lesson for the next run: run the whole `scrapers/common/tests/` directory, not just the file you
edited — the stale premise lived in a different file. Full directory now: **1068 passed**.

**Data repair.** None written. Flipping 15,987 stored `true`s without per-row source evidence is exactly
the "never modify data on plausibility" rail. aqar re-captures ~17,000 rows/day (62,983 in the last 7
days), so the corrected parser repairs the active cohort through normal operation.
**Status: FIXED + BARRIERED + MUTATION-PROVEN; data repair PROPAGATION PENDING.**

## Finding 2 — Advanced Filter is unreachable from 6 of the 8 groups the app ships (BARRIERED; taxonomy half is an OWNER decision)

**What the user experienced.** Six live browser journeys across two runs tapped «خلّنا نحدد الطلب أكثر»
on broad searches — Rent apartments Riyadh (desktop **and** mobile), Rent villas Jeddah, Buy villas, two
Buy+Rent combined — and **never** got the Advanced Filter card. Every one fell through to the legacy
district refine chips.

**Root cause — no single rule is broken; three correct rules compose:**

1. `cohortAllows()` intersects across **every** selected clean type (owner 2026-08-20);
2. an **uncertified** type (no `COHORT_QUESTIONS` entry) is an **empty cohort**, never "no constraint"
   (`afCohorts.ts:226`) — deliberately conservative;
3. `MIN_USEFUL_QUESTIONS_TO_SHOW = 2` (owner 2026-08-22).

⇒ **one uncertified type inside a shipped GROUP zeroes Advanced Filter for that whole group.**
«Villas & Houses» is exactly this: `Duplex` has no cohort entry, so the group intersects to zero even
though `Villa` alone allows six. Confirmed against live counts the same day (Jeddah / Rent / villas, 845
in scope): **all six** of Villa's questions clear `scoreQuestion()` — rnpl 440, kitchen 510, bath
503/467/448/384, unfurnished 357, street width 637/266/147/80, all eight directions ≥14 — and the
interview still cannot open.

**Measured matrix** (executed `cohortAllows`, not grepped), cohort-gated questions eligible:

| group | Buy | Rent/Annual | Rent/Monthly | Rent/both | Buy+Rent |
|---|---|---|---|---|---|
| Apartments & Co-living | 0 | **1** | 0 | 0 | 0 |
| Villas & Houses | 0 | 0 | 0 | 0 | 0 |
| Vacation & Rural | 0 | 0 | 0 | 0 | 0 |
| Residential Plots | **2** | **2** | 0 | 0 | 0 |
| Retail & Workspace | 1 | 1 | 0 | 0 | 0 |
| Industrial & Logistics | 0 | 0 | 0 | 0 | 0 |
| Commercial Buildings & Facilities | 0 | 0 | 0 | 0 | 0 |
| Commercial & Industrial Plots | **2** | 0 | 0 | 0 | 0 |

Only **2 of 8** shipped groups ever clear the 2-question floor. Six group-member types are uncertified —
`Camp`, `Chalet`, `Duplex`, `Factory`, `Service Facilities`, `Staff Housing` — and each zeroes AF for its
whole group.

**What was done (PR #989).** `scripts/verify-af-group-cohort-coverage.ts`, wired into `npm test`.
It changes **no behaviour** and adds **no cohort entries**. It ratchets the uncertified-type set (adding
a new type to a shipped group without a cohort entry fails CI — which is how Duplex/Chalet/Camp got in
unnoticed) and pins the per-group reachability matrix so any flip between "AF can open" and "cannot" is
loud on the PR that causes it. Mutation-proven three ways (uncertified-as-no-constraint; `every()`→
`some()`; a new uncertified type added to a group), each red then restored green; full `npm test`
(148 steps) passes with it wired in.

**⚠️ OWNER DECISION, deliberately not taken here.** Whether a Duplex / Chalet / Camp / Factory /
Staff Housing / Service Facilities scope *should* be asked about bathrooms, amenities, street width etc.
is a taxonomy + product call and sits on the RED list in `docs/ops/AGENT_AUTHORITY.md`. Certifying
`Duplex` alone would restore Advanced Filter for the whole «Villas & Houses» group — the largest single
win available.

**Consequence for coverage:** because the real `AdvancedQuestionCard` never opened, Skip / Back /
single-vs-double-tap / summary-vs-committed-state remain **untested live** for a second run. They are not
"passing"; they are unreached.

## Trending — live journeys (all passed)

Every row below is: intended state → visible UI → the exact RPC body the app sent → displayed count →
independent RPC total re-run over that same body → click-through.

| journey | viewport | state | result |
|---|---|---|---|
| Buy / villas group / 4 beds / ≤2,500,000 | desktop | full state in `top_cities_by_deal_ar` (`p_deal`, `p_types`, `p_beds_exact`, `p_price_max`) | الرياض UI **871** = header 871 = RPC 871 |
| same | **mobile 390×844** | same | **871 = 871 = 871** |
| same, non-Riyadh | desktop | جدة selected | advertised 119, state carried |
| Rent-only / villas / 4 beds / ≤300,000 → الرياض districts | desktop | 6 districts rendered | **6/6** advertised = independent RPC (النرجس 120, العارض 132, الرمال 91, الجنادرية 42, المونسية 42, طويق 9); click-through النرجس **120 = 120 = 120** |
| Rent-only / villas, unnarrowed → جدة districts | desktop | 6 districts rendered | **6/6** matched; click-through الزمرد **61 = 61 = 61** |
| Rent-only / villas / 4 beds / ≤300,000 → الدمام districts | **mobile 390×844** | 6 rendered, one with **no count** | 5/5 counted districts matched exactly; click-through الشعلة **3 = 3 = 3**. «حي ضاحية الملك فهد» rendered with **no number at all** — independently confirmed to hold **0** rows under that exact state, i.e. the honest-zero-over-false-fallback rule working, not a dropped fetch |
| deal scoping | — | RPC-verified | `p_deal` null = 67,663 (combined), بيع = 36,916, إيجار = 30,747; 36,916 + 30,747 = 67,663 — the UI matched the body it actually sent in every state |

Districts: `rows_without_a_count = 0` in both journeys and every count was live-narrowed — no wider
fallback presented as filtered truth. One per-district count RPC per visible row, as designed.

## Not covered in this run (explicit, not implied "fine")

- **AF interaction semantics** — Skip / Back / double-tap-advances-one / summary ≠ committed state /
  Arabic-only leaks on the real overlay: unreached, see finding 2.
- **AF field-by-field source→index fidelity** beyond maid/driver room: bathrooms, age, new construction,
  furnished, kitchen, elevator, AC, private entrance, parking, utilities, direction, street width,
  rating/reviews were exercised only through their count surfaces, not re-adjudicated against source.
- The `af_field_stuck_no_variance` alert also names **satel** (kitchen/AC 45 true / 0 false),
  **sanadak**, **wasalt** and **aqaratikom** (driver_room all-false). Only the aqar rows were adjudicated
  against source this run; the all-false shapes are the opposite (and potentially worse) direction and
  are **not** cleared.
- Trending district rows beyond the first 6 per city (spec barrier item 22) not probed live.
- No region rotation beyond الرياض / جدة / الدمام / الخبر / عنيزة / الجبيل.

## Coverage ledger

14 rows written to `ops_qa_coverage_ledger` under this routine's own prefixes (`af_data_integrity`,
`af_reachability`, `af_interview`, `af_counts`, `trending_cities`, `trending_districts`), which are
distinguishable from routine #4's rows in the same table.

## What this run shipped

| PR | scope | state |
|---|---|---|
| **#987** | `scrapers/**` — aqar maid/driver room read structurally + 3 mutation-proven barriers | **merged** (5/5 checks green) |
| **#989** | `scripts/verify-af-group-cohort-coverage.ts` + `npm test` wiring | **merged** (all checks green) |
| **#990** | this run log | docs only |

**Deployments: 0.** Nothing in either code PR touches `src/`, so no frontend deploy was required or
performed — per `AGENTS.md`, `Deployments: 0` is the correct result when no verified change needs one.

**Propagation.** `aqar-sweep.yml` is triggered every 8 hours by pg_cron jobid 2 (`5 */8 * * *`) against
the default branch, so the corrected parser is live on the next sweep. At ~17,000 rows re-captured per
day the active cohort repairs over roughly one to two weeks. The `af_field_stuck_no_variance` alert is
deliberately **left open** — it must self-resolve when real `false` values land, not be silenced by hand.
