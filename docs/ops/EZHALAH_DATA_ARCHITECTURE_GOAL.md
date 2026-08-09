# Ezhalah data architecture goal (PERMANENT, owner rule 2026-08-09)

**Status: PERMANENT. This is the guiding rule for all future scraper, backend, Advanced Filter, and
data-quality work.** It sits above any individual ticket. Where a routine prompt, a convenience
argument, or a tempting shortcut conflicts with it, this document wins.

> ## A NEW LISTING SHOULD NOT ENTER EZHALAH HALF-UNDERSTOOD.
>
> If the source provides useful structured information, Ezhalah captures it, stores it, matches it,
> and makes it reusable **from day one**.

## 1. The pipeline every new listing must complete

```
SOURCE → SCRAPER → RAW DATA → CANONICAL BACKEND → MAIN FILTER MATCHING
       → ADVANCED FILTER MATCHING → SEARCH INDEX → USER
```

The permanent shape of the system is:

```
SCRAPE ONCE → SAVE SOURCE TRUTH → STRUCTURE EVERYTHING → MAIN FILTER → ADVANCED FILTER → FUTURE AI
```

Scraping a listing and saving only the basics is a defect, not a starting point. Every useful
property fact the source genuinely provides must be captured **at ingestion**, so the listing is as
structured and searchable as possible the moment it enters Ezhalah.

## 2. Fields to capture whenever the source publishes them

Location & classification
: Region · City · District · Buy/Rent · Annual/Monthly · Residential/Commercial · Property group ·
  Property type

Money & size
: Total price · Price per m² *(only if the source publishes it)* · Area/size

Layout
: Bedrooms · Bathrooms · Floor number · Total floors *(if published)*

Age
: **Exact construction/build year if published** · Property age if published

Amenities & specification
: Furnished · Elevator · Kitchen · Parking · **Number of parking spaces if published** · Gym ·
  Swimming pool · Garden · Private entrance · Annex · Maid room · Driver room · Air conditioning ·
  Direction/frontage · Street width

Commercial terms
: Tenant type · Licence information · RNPL/installments · **RNPL monthly payment amount if the
  source publishes it** · Payment schedule/frequency

…**and literally every other useful structured specification or amenity the source genuinely
provides** that can reasonably be represented in our architecture. The list above is a floor, not a
ceiling. A field a platform publishes that we have no column for is a gap to close, not a reason to
drop the fact.

## 3. SOURCE IS TRUTH

| Source says | Store |
|---|---|
| yes | `true` |
| no | `false` |
| **nothing** | **`NULL` / unknown** |

- **Never guess.**
- **Never treat "not mentioned" as "no".**
- **Never invent an exact build year from an approximate age.**
- **Never calculate or manufacture a price just because another number exists.**
- **Preserve the most precise source value available.**

### Property age — worked example

| The source says | We store |
|---|---|
| «Built in 2019» | build year = **2019** (exact) |
| «Property age = 5 years» | property age = **5 years**, and **no build year** |

Storing `2026 − 5 = 2021` as a build year is a fabrication: the source never said it. The backend
derives Advanced Filter *ranges* from whichever source-backed value exists — the derivation happens
at read time, never by writing an invented value into the row.

## 4. The Main Filter comes first

Every new listing must be matched into the existing architecture:

```
REGION → CITY → DISTRICT
DEAL → CATEGORY → PROPERTY GROUP → PROPERTY TYPE
```

plus price, area, bedrooms and the other Main Filter fields.

**Only confident matches are allowed.** Where we cannot confidently match, the value stays unknown.
An unmatched listing is an honest result; a wrongly-matched one is a lie that ranks.

## 5. Then the Advanced Filter

The Apartment Advanced Filter questions must read the **same canonical backend fields** — no
parallel source of truth, no question-specific derivation.

The question system itself is sound. What must be proven is that the **data behind each question is
correct**. For every question, verify the whole chain:

> source provides it → scraper captures it → backend stores it → search index receives it →
> the question uses it → **the returned listing truly satisfies it**

**Annual Rent Apartments is the priority.** Test the built-in questions one by one *and in
combination* through the real Filter.

> **A question does not pass because the SQL count matches. It passes only when the original source
> agrees with the listing returned to the user.**

## 6. Every platform, not just aqar

If a platform publishes a field we support and our scraper ignores it, **improve that scraper** so
the field becomes part of normal ingestion. Different sources publish different things — that is
expected and fine. We capture whatever each source genuinely provides and map it into **one
consistent Ezhalah backend architecture**.

## 7. Why this matters for the future AI Agent

**Do not build the AI Agent now.** The structured-data foundation comes first — that is the whole
point of this document.

Later, a user should be able to type naturally:

- *"I want a house in Riyadh with a gym."*
- *"I want a new apartment with a pool, elevator and parking."*
- *"Show me an apartment built after 2020 with 3 bedrooms and a gym."*

and the agent should simply translate that into the canonical fields — `gym = true`,
`build_year >= 2020`, `bedrooms = 3`. **The agent must never have to guess whether a listing has a
gym, or re-read seller prose, because the backend failed to save the fact.** Every prose fallback we
leave in place today becomes an agent-accuracy bug tomorrow.

## 8. Standing definition of done

For any work under this rule:

1. fix the gap at its **root cause**, in normal ingestion — not with a one-off backfill script;
2. add **regression protection** that fails on the old behaviour;
3. repair existing data **only where source truth can be proven** (otherwise revert fabrications to
   `NULL`);
4. **sync it through to the search index**;
5. **verify the real Filter**, against the original source pages.

Related: `docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md` (the tri-state law and the prose-is-not-a-source
rule, in detail).
