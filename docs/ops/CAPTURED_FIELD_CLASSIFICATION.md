# Captured fields — what becomes a filter, what becomes card evidence, what stays UNKNOWN

**Owner rule, 2026-09-06. PERMANENT.** Recorded here in the session it was given, per AGENTS.md
("owner-granted engineering/product decisions belong in this repo, not just in an agent's own
memory"). It settles `ops_incident` #87 and governs every future cross-layer census entry.

> **Do not automatically make a captured field filterable.** Review each field against real source
> semantics and the Advanced Filter product contract:
>
> - if it is **truthful, useful for narrowing, and certifiable across the applicable cohorts**, it
>   may become an Advanced Filter field;
> - if it becomes a certified Advanced Filter field, it **MUST also have truthful property-card
>   evidence when selected**;
> - if it is useful **only as listing information**, it may be card evidence without becoming a
>   filter;
> - if its **meaning or source semantics are uncertain, or it adds no useful product value**, leave
>   it unplumbed / UNKNOWN rather than guessing.
>
> **Never make a field filterable merely because we happen to capture it.**

This sits under `ADVANCED_FILTER_SOURCE_TRUTH.md` (the tri-state law and "when the source is
ambiguous, stop and ask") and adds the product half that document does not state: capture is
necessary for a filter, and nowhere near sufficient.

## The four verdicts

| Verdict | Meaning |
|---|---|
| **FILTER + EVIDENCE** | certified AF field; a card chip when selected is mandatory, not optional |
| **EVIDENCE ONLY** | shown on the card where the source published it; no predicate |
| **UNPLUMBED** | deliberately neither — recorded with the reason, so it is not re-litigated |
| **ROUTED** | a real question that is not this classification's to answer |

A field is only assessed as a filter if it clears **all four**: structured source truth · coverage
in its applicable cohorts · genuine discriminating power · more than one platform.

**Discriminating power is the test most often skipped.** A field that is populated but nearly
single-valued is not a choice. The repo already refuses on exactly that basis — `afCohorts.ts`:
*"Room/RentAnnual — RNPL known 95% but only 5% yes → floor gate would hide it everywhere;
deliberately not offered rather than pretending it is a real choice."*

## The 2026-09-06 classification — all 17 census fields

Coverage is share of the 203,233-row searchable index. Semantics read from the LIVE
`listing_rich_attrs` view definition (`pg_get_viewdef`), never inferred from the column name.

| # | Field | Coverage | Source semantics (as read) | Verdict |
|---|---|---|---|---|
| 1 | `installment_available` | 88,778 (43.7%) | **`<platform>.rent_now_pay_later AS installment_available` on every branch — a pure alias.** 88,778 both-known, **0 differ, ever** | **NOT A CENSUS ENTRY** — already filterable (`p_amenities` token `rnpl`) and already rendered (RnplBanner). Census corrected 17 → 16 |
| 2 | `installment_amount` | 15,377 (7.6%) | the RNPL companion `ADVANCED_FILTER_SOURCE_TRUTH.md` §3 requires ("the installment amount exactly as published"); never present without `rnpl = true` | **EVIDENCE ONLY — already satisfied.** Rendered today by `RnplBanner monthly=` (`ResultCard.tsx:283`). Not a filter: aqar-only, and "installment ≤ X" is a budget question the price filter answers |
| 3 | `living_rooms` | 34,659 (17.1%) | `sane_count(halls)` (aqar «الصالات»), plus two other platforms — a real structured field | **THE ONE FILTER CANDIDATE — Villa cohorts only.** See below |
| 4 | `latitude` | 100,304 (49.4%) | `ar_data.location.lat` and equivalents, 17 platforms — real geo | **ROUTED to the owner.** A coordinate is not an AF chip; it is the input to map/radius search, a new product surface, and our location model is the owner-owned Region → City → District |
| 5 | `longitude` | 100,304 (49.4%) | as above | **ROUTED** with `latitude` |
| 6 | `postal_code` | 67,508 (33.2%) | `additionalAttributes[zipCode]` — real | **UNPLUMBED.** 3,363 distinct codes; nobody searches property by postal code, and Region/City/District already answers location. Noise on a card |
| 7 | `frontage_count` | 20,382 (10.0%) | `additionalAttributes[propertyFacade]`, mapped **only** «ثلاثة شوارع»→3 and «أربعة شوارع»→4; **every other value → NULL** | **UNPLUMBED + capture defect ROUTED.** 99.8% of stored values are "3" not because most properties front three streets but because one- and two-street properties — surely the majority — are silently dropped. Honest (NULL, not fabricated) but severely partial: "3+ frontages" is meaningless when 1 and 2 cannot be represented |
| 8 | `rega_license_status` | 19,685 (9.7%) | `regaVerifiedInfo[].fields[status]` (wasalt), «حالة ترخيص الإعلان» (aqarcity) — a real REGA ad-licence status | **EVIDENCE ONLY (proposed).** **Every populated row says "active"** — «نشط» 91.9% + «فعال» 8.1%, the same meaning in two platforms' wording. A predicate over a single-valued field narrows nothing, and `p_has_license` over `license_number` already exists. Genuine trust signal on a card; the two spellings must be normalised first |
| 9 | `majlis_rooms` | 5,252 (2.6%) | `reception_rooms_majlis` («المجالس») — real structured field | **EVIDENCE ONLY (proposed).** 2.6% is far under any usable floor — the repo already refused Residential-Building bathrooms at 1% |
| 10 | `deed_location_text` | 2,394 (1.2%) | free-form deed location prose, 1,089 distinct | **UNPLUMBED.** Not a dimension; duplicates the location already shown, and deed prose is the wrong thing to surface |
| 11 | `furnishing_level` | 2,356 (1.2%) | real 3-value enum: غير مفروش 91.0%, مفروش بالكامل 6.5%, مفروش جزئيا 2.4% | **UNPLUMBED.** `furnished` is already a certified AF field; the only thing this adds is the middle state — ~57 listings fleet-wide — while creating a contradiction risk against the certified boolean |
| 12 | `parking_count` | 2,112 (1.0%) | real count; 81.6% are "1" | **UNPLUMBED.** 1% coverage, near single-valued, and `parking` is already certified |
| 13 | `total_floors` | 1,802 (0.9%) | real; wasalt only | **UNPLUMBED.** One platform, 0.9% |
| 14 | `kitchen_status` | 290 (0.14%) | real enum: راكب 71.4%, لا يوجد 16.2%, راكب بدون أجهزة 8.6%, تأسيس 3.8% | **UNPLUMBED.** Genuinely informative, but a chip on 1 listing in 700; `kitchen` boolean already certified |
| 15 | `ac_type` | 284 (0.14%) | real enum: سبليت 54.6%, مركزي 12.7%, مخفي 9.9%, … | **UNPLUMBED.** Same floor; `air_conditioner` already certified |
| 16 | `parking_type` | 85 (0.04%) | real enum: تحت الأرض 56.5%, خارجي مظلل 27.1%, خارجي 16.5% | **UNPLUMBED.** 85 rows, one platform |
| 17 | `installment_count` | **0** | column exists; nothing writes it | **UNPLUMBED + ROUTED as a capture question.** §3 says the RNPL offer includes its payment frequency. Zero rows is not evidence the sources omit it — per the permanent rule, *a missing captured field is NOT evidence that the source omits it* |

## `living_rooms` — the only field that reaches the filter bar, and only for Villa

Measured per cohort, 2026-09-06:

| cohort | rows | known | known % | platforms | share that are "1" |
|---|---|---|---|---|---|
| **فيلا / إيجار** | 5,842 | 2,795 | **47.8%** | 3 | 25.1% |
| **فيلا / بيع** | 28,344 | 7,056 | **24.9%** | 3 | **15.0%** |
| دور / إيجار | 3,285 | 1,915 | 58.3% | 2 | 71.5% |
| دور / بيع | 12,435 | 3,236 | 26.0% | 2 | 66.1% |
| شقة / بيع | 41,222 | 9,767 | 23.7% | 3 | **86.4%** |
| شقة / إيجار | 54,273 | 8,950 | 16.5% | 3 | **87.1%** |

Villa clears every gate: coverage comparable to already-certified fields (direction 50%, kitchen
34%, elevator 29%, bathrooms 26%), three platforms, and a genuine spread — only 15–25% sit on the
most common value, so each rung narrows.

**Apartment must NOT get this question.** 86–87% of known apartment values are "1": it looks
well-covered and is almost single-valued, which is a question with one real answer. That is the
`afCohorts.ts` RNPL/Room precedent exactly.

Certifying it is **routine #5's** work (AF + Trending owns the surface): an RPC predicate, a cohort
entry, an `af_canon` evidence key, the mandatory card chip, and the barriers. It is not landed here
— adding an AF field is new product semantics, which AGENTS.md places behind owner approval, and
this classification is the recommendation, not the implementation.

## What this classification did NOT do, deliberately

**No card chips were shipped.** The owner's rule says a non-filter field *may* be card evidence —
permission, not instruction — and a new chip is visible product surface requiring a frontend deploy.
`rega_license_status` and `majlis_rooms` are therefore recorded as **proposed** EVIDENCE ONLY, for
the owner to accept or decline, not shipped unilaterally.

**Nothing was made filterable to use up a capture.** Twelve of the seventeen stay deliberately
unplumbed, each with its reason above, so the next census does not re-litigate them.
