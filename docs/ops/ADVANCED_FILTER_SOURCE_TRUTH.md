# Advanced Filter — source truth is the only truth (PERMANENT, owner rule 2026-08-09)

> Sits under **`docs/ops/EZHALAH_DATA_ARCHITECTURE_GOAL.md`**, which states the wider goal: a new
> listing must never enter Ezhalah half-understood. This document is the detailed tri-state law.

**Status: PERMANENT. This rule does not expire and is not overridden by any routine prompt, agent
instruction, or convenience argument. It applies to EVERY platform, not just aqar.**

The Annual Rent → Apartment → Advanced Filter path is production-critical. It is the path where a
user tells us exactly what they need and we answer with a filtered set. If a single value in that
set is invented, the user is not filtering — they are being lied to with a progress bar.

## 1. The pipeline, and what must survive each hop

```
SOURCE  →  SCRAPER  →  RAW DATA  →  CANONICAL BACKEND  →  SEARCH INDEX  →  ADVANCED FILTER  →  USER
```

The value the user sees must be the value the source published. Every hop is lossless or it is a
bug. Two failure modes are equally forbidden:

- **Fabrication** — inventing a value the source never published.
- **Trapping** — a value the source DID publish that stops somewhere upstream (raw scraper table,
  an unparsed JSON blob, a canonical column no view exposes) and never reaches the user.

## 2. The tri-state law

Every Advanced Filter attribute is **three-valued**, never two:

| Source says | We store | Filter behaviour |
|---|---|---|
| yes / `1` / `true`  | `true`  | matches "has it" |
| no / `0` / `false`  | `false` | matches "doesn't have it" |
| **doesn't publish the field** | **`NULL`** | **unknown — excluded from both, never silently counted as "no"** |

**Never guess. Never infer "no" from missing data. Never fabricate.**

`NULL` is a correct, honest answer. A confident `false` that the source never stated is a data
corruption incident, not a default.

### The seller's sentence — Rule B (owner, 2026-10-25: «We trust the sellers sentence»)

The ad's own words are the seller speaking, and the Advanced Filter now hears them **beside** the site's
own field (the "box"), not only where the box is missing. For each of the 20 Advanced Filter amenity
columns (`public.text_facts_af_columns()`):

| the site's own field (box) | the ad's text | served |
|---|---|---|
| NULL / no such field | names it, or explicitly negates it | **the text** |
| false / unticked | explicitly names it | **true** — the sentence wins |
| true | silent | true (the box) |
| true | explicitly negates it | **CONFLICT → `NULL`**, listed for Quality & Repair (`ops_text_facts_conflicts`) |
| false | silent | false (the box) |

What did not change: **every text value carries its quote** (the ad's exact words; a DB `CHECK` refuses
one without), prepared-only («مصعد مؤسس», «تأسيس مصعد») and nearby («قريب من …») never produce a value,
and the 9 word groups the 2026-10-25 report left for the owner stay out of the reader. Facts with no
filter column yet (majlis, roof, warranty, …) live in `listing_facts` only.

**How it is wired — overlay, never overwrite.** The scrapers still write only the box into the
`*_listings` tables, and `normalize.prose_amenities(text, skip=<structured columns>)` still never writes
prose into a structured column: the box must stay the site's own answer, or Rule B could not tell the
two apart, and every crawl would rewrite it anyway. The reader's answers live in
`public.listing_text_facts` (one row per ad read, its `src_hash`, a re-read replaces it), and the two
search-index writers (`sync_search_listings_ar`, `sync_listing_rich_attrs`) serve
`af_rule_b(box, text)`. An ad whose text changed stops applying on the next hourly pass
(`text_facts_mark_stale`). Kill switch: `ops_feature_flags.af_text_facts_overlay` (off = box-only on the
next pass). Migrations 20261025203351 / 20261025205008 / 20261025205450; the run behind it:
`docs/ops/reports/FACTS_WORDS_VECTOR_TEST_2026-10-25.md`.

**Rule B for numbers (owner, 2026-10-25, handoff decision #1: «yes for street width»).** A number the
seller wrote fills a **blank** box only; a number the site published is never replaced, and two different
numbers are listed for Quality & Repair (`ops_text_facts_width_differs`), never served. Today the one
numeric key is `street_width_m` (`public.text_facts_af_num_columns()`): the overlay stores it as a JSON
number 4..150 with its quote, `listing_text_facts_af.street_width_m` serves it behind its own kill switch
`ops_feature_flags.af_text_facts_street_width`, and `sync_search_listings_ar` writes
`af_rule_b_num(box, text) = coalesce(box, text)`. The reader already refuses a corner plot, «يحدها 2 شارع»,
two widths or two bearings, so one ad hands over at most one width. Building age is **not** in: the owner
asked for a 500-ad sample first (the text is often «جديد» / «شبه جديد», not a number). Measured at the
switch: 73,662 quoted widths, 28,787 blank boxes filled, 3,528 differ from the box (listed). Barrier:
`scripts/verify-text-facts-rule-b.ts` «Rule B for numbers».

**Majlis — the first filter question born from the stored text facts (owner, 2026-10-26, handoff decision #3).**
`search_listings_ar.majlis` is the 21st amenity token (`p_amenities` `majlis`, chip «مجلس» / labelKey
«Majlis room», `cnt_majlis` in the guided counts, `amenity:majlis` in the sweep and the truth table,
`af_field_registry` row). Its box is the site's own majlis COUNT (`listing_rich_attrs.majlis` =
`majlis_rooms > 0`, aqar/wasalt `reception_rooms_majlis`, 7,328 ads, never 0 — a positive-only box); the
text side is the reader's `majlis` fact (91k ads) through the same overlay (`text_facts_af_columns()`
now 21 keys), behind its own switch `ops_feature_flags.af_text_facts_majlis`. Served = `af_rule_b(box, text)`.
Migrations 20261026011638 / 20261026012051 / 20261026013134; the clause mirror digest is 62539dd9….
Related facts the reader SAVES but does not serve (no column yet): roof, warranty, storage, annex, boundaries,
`corner_plot` (a corner / on two streets — never two_entrances; 2026-10-26).

**Why the August case law below no longer forbids this.** The 2026-08-09 rule («if the platform publishes
the field structurally, prose must not be consulted at all — a structured `null` outranks any prose hit»)
was written against a *keyword matcher*: «موقف سيارة» / «مواقف» → `true`, which could not tell «مصعد» from
«لا يوجد مصعد», nor "the source said no" from "the source said nothing". The reader behind Rule B is a
four-outcome reader (named / explicitly negated / prepared-only / nearby, the last two stored as nothing)
that keeps the ad's exact words as proof: 99.8 % agreement with the LLM reader on 10,558 ads, 1.7 %
false-yes on the last 120 random hand-checked rows. The parking case below stays as history and as the
reason the box is never overwritten.

**Prose on the scraper side** (the rules below) is unchanged: a scraper may produce three values from
prose only for a field with NO structured counterpart anywhere on the platform (owner, approved in chat
2026-10-24):

| The ad's own words | Stored |
|---|---|
| name it («مصعد», «مطبخ راكب», «مفروشة») | `true` |
| an **explicit negation tied to the token** — before it («لا يوجد مصعد», «بدون مصعد», «غير مفروشة», «عدم وجود مصعد», «لا تأتي الشقة مفروشة») or as the answer to the token used as a label («مفروشة: لا», «مواقف السيارات: غير متوفرة») | `false` |
| silence, prepared only («تأسيس مصعد»), not installed («مطبخ غير راكب», «المكيفات غير راكبة», «مصعد غير مركب» — anywhere in the ad, it outranks a plain mention; coordinator for the owner, 2026-10-25), nearby («قريب من …»), partly, «غير محدد», or two statements that disagree | `NULL` |

These are the four outcomes of `normalize.amenities_from_text` (2026-09-20: yes / no / prepared /
nearby, with prepared and nearby both stored as `NULL`), and the one reader every prose-only site uses
is `normalize.prose_amenities(text, skip=<the site's structured columns>)`. A negation that is not tied to
the token (a «لا» somewhere else in the sentence) is never a `false`. The reader is pinned by
`scripts/verify-labelled-no-is-not-a-yes.ts`. Prose is still a last resort, documented at the mapping site.

**Case law — aqar `parking` (2026-08-09; history — the keyword matcher it judged was retired by Rule B,
the lesson that the box must be read from the source payload still stands).** `parking` was derived from the patterns «موقف سيارة» /
«مواقف» for ~25,159 active rows. A later fix asserted "aqar publishes NO parking field at all" and
made the column permanently `NULL`. **Both were wrong.** aqar publishes
`listing.extended_details.special_parking` as a native JSON boolean. A 24-page live sample found
19 of 20 stored values disagreed with the source — including one row stored `false` where aqar
published `true`. The premise "the source doesn't publish it" must be proven by reading the source
payload, never inferred from the field's absence in the part of it we happen to parse.

## 3. Protected fields

These must be carried end-to-end, tri-state, for every platform that publishes them:

property age · bathrooms · furnished · elevator · kitchen · parking · floor number · direction ·
street width · RNPL / installments

### RNPL / EJARI «إيجار الآن وادفع لاحقاً» — capture the whole offer

`rent_now_pay_later = true` alone is **not** capture. When the source publishes them, store:

- availability (tri-state),
- the annual rent,
- the **installment / payment amount exactly as published**,
- the payment frequency (monthly / quarterly / …).

**Never calculate the installment ourselves.** `annual ÷ 12` is a fabrication even when it looks
right. If the source publishes an installment figure, that figure is the stored value at any
magnitude — plausibility windows that discard published numbers are a defect (see
`PRICE = SOURCE`). If the source publishes no figure, store `NULL`.

## 4. Guards that must exist and stay green

Any change touching an Advanced Filter field ships with regression protection proving

> **source value = scraped value = canonical backend value = search-index value = Advanced Filter
> behaviour**

Detectors must catch, per platform per field:

- **coverage drops** — a field that was populated and suddenly is not,
- **all-true / all-false fields** — a boolean with no variance is a parser stuck on a constant,
- **`NULL` → `false` conversions** — unknown silently becoming a negative anywhere in the chain,
- **suspicious parsing changes** — population rate moving sharply without a source change,
- **source fields that stop reaching the canonical backend** — trapping.

Guards must exercise **newly scraped listings**, not only historical rows. A parser can be correct
on the rows it already wrote and broken on the next one it writes.

## 5. Definition of done

A fix is finished only when all of the following are true, in order:

1. the parser reads the source's structured field (proven against a live page, not a fixture alone);
2. existing rows are repaired from source evidence — and where re-reading the source is not
   feasible, fabricated values are reverted to `NULL`, never left standing;
3. permanent safeguards are in place and would fail on the old code;
4. fresh ingestion is tested end-to-end on a newly scraped listing;
5. the canonical backend, the search index, and every relevant Annual Apartment Advanced Filter
   option are verified;
6. the result is checked back against the original source page;
7. any required application change is deployed to `https://ezhalah-app.vercel.app` and verified in
   production.

> **Do not call it finished simply because the filter SQL passes. It is finished only when the
> original source agrees with what the user receives.**

## 6. When the source is ambiguous

Stop and ask. Do not pick the reading that produces more rows. An honest zero and an honest
`unknown` are always acceptable results; a confident invented value never is.
