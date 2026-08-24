# AF + Trending Data Integrity — Run 2026-08-24

**Rating: 9.4/10 (94%) → 9.7/10 (97%).** No AF or Trending *behaviour* changed, and none needed to:
every interaction, count and click-through tested this run was exact. What changed is that a barrier
which had been reporting "clean" on a cohort it could not see now sees it — and the 8,183 attribute
assertions Ezhalah had invented are gone.

The rating moves because the defect is closed end to end: barrier extended and mutation-proven, all
8,183 fabricated values cleared to UNKNOWN under owner authorization, propagated to the search index,
and confirmed on the live Advanced Filter card. It is not a 10 because Villa's own `true` values were
never source-proven — see §5.

---

## 1. The finding — the fabricated-amenity barrier was blind to a cohort inside one column

**What a user experiences.** The Advanced Filter chips «غرفة خادمة» / «غرفة سائق» promise a maid's
or driver's room. Measured live this run on the user-truth path (anon REST, RLS respected),
Riyadh / إيجار سنوي / شقة offers `cnt_maid_room = 298` and `cnt_driver_room = 21`. On aqar, outside
villas, **aqar never published that attribute at all**. Twelve plots of *land* are indexed as having
a maid's room.

**Root cause.** `mon_detect_fabricated_unpublished_amenity()` (2026-08-20) is the right barrier and
is on the roster. Its evidence table is keyed by `(source_table, column_name)` only — a column is
published or it is not, for the whole table. aqar breaks that assumption: `maid` / `driver` live on
the **Villa ad form and no other residential form**. So the barrier reads
`aqar_residential_listings.maid_room` as published (true, for villas) and is *structurally unable*
to see the non-Villa cohort underneath it.

**Why the values persist.** They are residue of a prose rule the parser retired on 2026-08-23, and
they cannot self-heal. `_amenities()` correctly returns `None` for an absent key, and
`_unknown_must_not_overwrite_known()` deliberately **drops** a `None` so the stored value survives —
that rule is right and must stay. The consequence is that re-crawling forever will not clear them.

This also corrects an assumption carried in `RUN_2026-08-23c` §5, which read the stuck
apartment/floor cohort as re-capture coverage still catching up. It is not: rows re-captured after
the fix still carry the true, because the drop-a-`None` rule means a re-capture cannot move them.

### Evidence — 76 live pages, 0 fetch failures, both directions

Fetched through production's own oracle: `_listing_json` AST-lifted verbatim out of
`scrapers/aqar/enrich_residential.py`, so the probe cannot drift from what the scraper reads.

| sample | n | carry a `maid`/`driver` key |
|---|---|---|
| apartment/floor rows **we store as true** | 30 | **0** |
| random apartment/floor, unconditioned on stored value | 16 | **0** |
| **land** rows we store as true | 20 | **0** |
| **villa rows we store as `false`** — positive control | 10 | **10/10**, `maid:0, driver:0`, matching our stored false exactly |

The stored data agrees independently: `Villa` is the only `property_type` carrying a single `false`
(2,454 maid / 3,192 driver). Every other type has trues and **zero** falses.

| cohort | maid true | driver true |
|---|---|---|
| Apartment | 4,049 | 1,204 |
| Floor | 1,814 | 403 |
| Building | 247 | 116 |
| Rest House | 30 | 63 |
| Room | 0 | 210 |
| Commercial / Residential / Agricultural **Land** | 14 | 18 |
| House | 8 | 7 |
| **total** | **6,162** | **2,021** |

### Fix — extend the barrier, do not add a second one

Per the barrier rule, the existing detector gained a dimension rather than a duplicate:

* probe evidence gains `cohort_column` + `cohort_mode` (`all`/`in`/`not_in`) + `cohort_values`;
  a `NULL` cohort keeps whole-table semantics byte-for-byte, so every existing row is unaffected
* the detector honours it — `source_table` / `column_name` / `cohort_column` catalog-validated and
  interpolated with `%I`, cohort **values** bound as a parameter, never interpolated
* the aqar residential maid/driver verdict recorded with its positive control

No roster change needed: the detector was already registered, which is exactly why extending beat
duplicating.

### Mutation proof (all rolled back)

| case | result |
|---|---|
| as recorded | **raises**, 8,183 rows, both columns named |
| `values_published = 1` | **0** — evidence-gated, not hardcoded |
| cohort `in ('Villa')` vs `not_in ('Villa')` | **11,947 vs 6,162** — the cohort filter is load-bearing |
| unknown cohort column | **0** — skipped, never guessed |

### Data repaired — 57 assertions, row-level proof only

Bounded to the **51 listings whose live page this run fetched and parsed individually**, with the
before-state written to `ops_amenity_defabrication_evidence` *before* the write. Values go to
**NULL (UNKNOWN), never to `false`** — aqar did not say "no", it said nothing. Villa's 2,454
source-backed falses are untouched, guarded in the statement itself.

**Production verified.** The 12:14 `sync-search-listings-ar` carried the repair to the user-visible
index: the 57 assertions went **57 → 0** in `search_listings_ar`, and
`mon_detect_fabricated_unpublished_amenity()` re-ran itself through the companion migration, so its
open alert moved **8,183 → 8,126** rather than reporting the state that motivated the repair.

None of the 51 listings happened to sit in the Riyadh / إيجار سنوي / شقة cohort, so that card's
`cnt_maid_room` is still 298 — the repair is real and propagated, it just did not touch the one chip
measured earlier. Searchable inventory still carries **4,713 maid + 1,544 driver** fabricated trues
on non-Villa aqar rows; that is the user-facing size of what remains.

### Owner-authorized cohort repair — COMPLETE

The owner approved the bulk repair on 2026-08-24 with explicit limits: do not broaden beyond what
is source-proven, preserve Villa, never write `false`, never write `true`, UNKNOWN stays UNKNOWN.

**Completing the sample first changed the metric, not the answer.** The original probe counted
*key presence*. Sampling the four property types it had not covered (Building, Rest House, Room,
House — 24 more pages) turned up a case that shows why key presence is the wrong test: **House
carries the `maid`/`driver` keys on 6/6 pages and their value is `null` on 6/6.** A present-but-null
key is not a published value — the same shape already recorded for `aqar_commercial.parking` ("key
appears on ~21% of pages but ALWAYS null"), and the reason House stays *in* scope rather than being
carved out of it. Re-scored on published VALUE:

| segment | pages | published a maid/driver value |
|---|---|---|
| non-Villa (apartment, floor, land, building, rest house, room, house) | 90 | **0** |
| Villa — positive control | 10 | **10/10** (`maid:0, driver:0`, matching our stored false) |

100 live pages total, 0 fetch failures.

**Dry run before the write.** Cohort `coalesce(property_type,'') <> 'Villa'`: **7,316 rows**,
**8,126 field values** — 6,124 maid + 2,002 driver, every one `true`, not a single `false`. Zero
rows have a NULL `property_type`, so the cohort predicate and the detector's own predicate select
exactly the same set.

**Trigger safety proven before the write.** The table carries three `BEFORE UPDATE` triggers
(`trg_aqar_parse`, `trg_aqar_reject_price_artifact`, `trg_redact_user_visible_pii`). A rolled-back
300-row rehearsal updated through all three and changed **0** other columns.

**The migration aborts itself if it exceeds its promise.** It snapshots every other column of every
affected row and raises — rolling the whole thing back — if any unrelated column moves, if any Villa
value moves, or if the cohort does not reach zero.

| check | result |
|---|---|
| rows repaired | 7,316 |
| maid values cleared | 6,124 |
| driver values cleared | 2,002 |
| fabricated values remaining in cohort | **0** |
| Villa values changed | **0** (11,947 maid / 8,001 driver non-null before and after; 2,454 / 3,192 falses intact) |
| unrelated fields changed | **0** |
| detector open alerts | **0** — `fabricated_unpublished_amenity` self-resolved via `mon_resolve_key` |
| search index synced | YES — the 13:14 `sync-search-listings-ar` |

**Production verified, user-facing.** Riyadh / إيجار سنوي / شقة, the cohort measured before the
repair:

* «غرفة خادمة» **298 → 26**; «غرفة سائق» **21 → chip gone entirely** — with the fabricated values
  cleared the option can no longer narrow usefully, so the engine correctly retires it.
* Tapped the maid chip in the live browser: footer 26 = advertised 26 → committed headline **26** →
  final RPC `p_amenities=['maid_room']` total **26**. Chain intact.
* Every other chip unchanged (kitchen 4,350 · elevator 1,810 · AC 2,876 · private entrance 811 ·
  furnished 1,060 — identical to the pre-repair reading), which is the user-facing confirmation that
  nothing unrelated moved.

The residual 26 maid / 4 driver in that cohort are **not aqar**: 18 + 8 from wasalt and sanadak, and
the driver values from wasalt and aqaratikom. Those platforms were never in this scope and carry
their own separately adjudicated source semantics (sanadak `driver_room` was verified PASS on
2026-08-23). Aqar rows remaining in the cohort: **0**.

---

## 2. Everything else tested was exact

Real browser (Chromium, production bundle, trusted input events), desktop 1366×900 and mobile
390×844. Chromium could not complete TLS through this container's egress proxy
(`ERR_CONNECTION_RESET` on every allowed host), so each browser request was relayed server-side and
fulfilled back into the page. The page still ran the real React app with real events; the relay is
what made the exact request/response capture below possible.

### Advanced Filter (Part 1)

| behaviour | result |
|---|---|
| single tap = select only | ✅ stays on the question, footer becomes the option's count exactly |
| double tap, single-select = confirm + advance **one** | ✅ age `3_5` → bathrooms, chip 1,736 = advertised |
| double tap, multi-select = toggle, never advance | ✅ matches `AdvancedQuestionCard.pick()` |
| «متابعة» advances exactly one | ✅ |
| Skip applies no predicate, does not change the count | ✅ 10,616 → 10,616; and 274 → 274 across 5 consecutive skips (Abha) |
| Back restores the question **and** the answer | ✅ chip still 1,736; confirm re-advanced to the same next question |
| multi-amenity is AND, not OR | ✅ elevator 299 + kitchen 826 → **293**; final RPC `p_amenities=[elevator,kitchen]`, total 293 |
| option count = what Search returns if picked | ✅ 1,736 advertised → 1,736 headline → 1,736 RPC |
| scope-step options sum to the scope | ✅ 10,616+3,580+14+1,257+1,383 = 16,850 = header |
| Arabic only, no English leak | ✅ 0 English text nodes in app chrome; every English string found sat inside a source-written listing description |
| min-useful-questions gate | ✅ Residential Land opens on exactly 2 useful questions (street width, direction) |

One case worth recording so it is not re-raised as a bug: Rest House / Buy opens on the scope step
«أي نوع عقار تحديدًا؟» and, if that step is **skipped**, the interview closes immediately. Answering
it instead (استراحة, 476 → 404) unlocks three more useful questions. The scope prefix is a
prerequisite of the pool, not a ranked peer of it, and deliberately does not pass the usefulness
gate — so this is the design working, not a leak.

### Trending Cities (Part 2)

Full filter state carried in every probe: `p_types`, `p_beds_exact`, `p_area_min/max`,
`p_price_min/max`, `p_deal`, `p_category`. Visible rows equalled the RPC exactly in every case.

| journey | visible = RPC |
|---|---|
| Buy / Residential, unnarrowed | ✅ 36,994 / 20,474 / 6,971 / 5,724 / 5,305 / 3,107 |
| + group الفلل والبيوت | ✅ 11,459 / 3,808 / 3,155 / 2,654 / 1,003 / 550 |
| + bedrooms 4 | ✅ 1,387 / 220 / 180 / 178 / 79 / 77 |
| + area 300–600 + price 800k–3M | ✅ 471 / 118 / 83 / 58 / 53 / 37 |
| mobile 390×844 | ✅ 6/6 |

### Trending Districts (Part 3)

| journey | result |
|---|---|
| Riyadh, villas, 4 beds, 800k–3M | ✅ scope counts (3,791/700/673) correctly replaced by live counts (273/83/67) |
| **click-through** حي طويق | ✅ advertised **21** = headline **21** = RPC **21** = independent DB set-math **21** |
| **click-through** الخبر / حي البحيرة, mobile | ✅ advertised **123** = headline **123** = RPC **123** = DB **123** |
| rows beyond the trending six | ✅ Jeddah, typed «ال»: 16 rendered rows, 31 live-count RPCs — no row fell back to a scope count |
| non-Riyadh | ✅ Jeddah, Khobar, Abha |

The independent oracle is raw set-math over `search_listings_ar` and never calls the AF/count RPC.
User-truth was re-checked through anon REST (RLS respected), which returned exactly what the browser
rendered: `cnt_selected 10,616 · maid 298 · driver 21 · elevator 1,810 · kitchen 4,350`.

---

## 3. Two observations, neither a defect

**(a) Duplicate city names deep in the Trending list.** `top_cities_by_deal_ar` returns
البدائع twice (60 and 12), القويعية twice (59 and 7), بيش twice (79 and 6), and a few more. These are
distinct `city_id`s in different regions that share an Arabic name, and each row carries its own
`region_ar`. None reaches the visible top-6 today, so no user sees two identical rows — but a
narrowing that promoted both would render them indistinguishably. Recorded, not changed: the
taxonomy is the taxonomy, and disambiguating a displayed city label is a product decision.

**(b) The harness, not the product, failed two first attempts.** A typed-city journey clicked the
read-only district field instead of the city field, and one journey selected «إيجار» on top of an
already-selected «شراء» and got combined mode. Both were harness errors, corrected and re-run; they
are recorded here so neither is misread later as a product finding.

---

## 5. Residual question — Villa's own `true` values are unproven, and deliberately untouched

Villa is excluded from the repair because aqar genuinely publishes `maid`/`driver` on the Villa ad
form — proven by 10/10 control pages whose published `maid:0, driver:0` matched the `false` we
already stored. That proof covers Villa's **falses**. It does **not** cover Villa's 9,493 maid and
4,809 driver **trues**: the control sample was drawn from rows stored as `false`, so no page in it
could confirm a stored `true`.

There is good reason to expect they are fine — Villa is the one cohort where the source answers at
all, and it carries a healthy two-sided split rather than the one-directional signature that gave
the non-Villa cohort away. But "expected to be fine" is not evidence, and this file should not imply
it is. Nothing was done about it: the owner's authorization was explicitly scoped to the non-Villa
cohort and said not to broaden it, so confirming Villa's trues is a probe for a future run, not a
change for this one.

---

## 4. Status vocabulary

| item | status |
|---|---|
| AF interaction contract (10 behaviours) | **VERIFIED** — live, desktop + mobile |
| Trending Cities full-filter-state inheritance | **VERIFIED** — 5 journeys, UI = RPC exact |
| Trending Districts advertised = click-through = DB | **VERIFIED** — 2 click-throughs against an independent oracle |
| Cohort-blind fabricated-amenity barrier | **FIXED + VERIFIED** — extended, mutation-proven, live and correctly red |
| aqar non-Villa maid/driver, 51 probed listings | **FIXED + VERIFIED** — 57 assertions cleared on row-level source proof |
| aqar non-Villa maid/driver, remaining 8,126 | **FIXED + VERIFIED** — owner-authorized; 7,316 rows, detector 0, index synced, live AF card confirmed |
| Villa's own `true` values | **UNPROVEN — untouched** (§5), out of the authorized scope |

**ALL GOOD: YES** for everything in scope. Every AF, Trending and count behaviour tested was exact;
the fabricated-attribute class is closed end to end and its barrier is green on its own evidence
rather than on a waiver. The one thing left is a question, not a defect: Villa's own `true` values
have never been source-proven (§5), and confirming them was outside the authorized scope.
Deployments: **0** — no `src/` change required one.
