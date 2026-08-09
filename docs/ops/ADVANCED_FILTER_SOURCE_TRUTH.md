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

### Prose is not a source field

Matching Arabic keywords in a description tells you the ad *mentions a word*. It cannot distinguish:

- «مصعد» (has a lift) from «لا يوجد مصعد» (has NO lift), and
- "the source said no" from "the source said nothing".

Therefore: **if the platform publishes the field structurally, prose must not be consulted for that
field at all — not even as a fallback.** A structured `null` outranks any prose hit. Prose may only
ever produce `true`/`NULL` for a field with no structured counterpart anywhere on the platform, and
even that is a last resort that must be documented at the mapping site.

**Case law — aqar `parking` (2026-08-09).** `parking` was derived from the patterns «موقف سيارة» /
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
