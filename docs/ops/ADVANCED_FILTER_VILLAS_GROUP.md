# Advanced Filter — the Villas & Houses group (owner-approved 2026-11-02)

**Canonical record of the owner's approved chip lists for the «Villas & Houses» group** (Villa, Duplex; تاون هاوس
rides Duplex, بيت and قصر ride Villa) of «🎯 دقّق مع الذكاء الاصطناعي» / «🎯 Refine with AI». The owner's words:
«that group first, not the property type» — ONE pair of lists at GROUP level, shared by every type in the box, so
the box with no type picked opens the full interview. Changing a chip, a question or its order is a product
decision (`docs/ops/AGENT_AUTHORITY.md` RED list). Everything the Apartments group obeys
(`docs/ops/ADVANCED_FILTER_APARTMENTS_GROUP.md`: THE CONTRACT, THE ROOT, intersection never union, a chip exists
only where its COUNT path exists, UNKNOWN never becomes NO) applies here unchanged and is not restated.

Code: `src/lib/afCohorts.ts` (`VILLA_BUY_CARDS`, `VILLA_RENT_CARDS`, `COHORT_CARDS.Villa` = `COHORT_CARDS.Duplex`,
`COHORT_QUESTIONS.Villa` / `.Duplex`). Guard: `scripts/verify-af-villas-group-cards.ts` (executes the plans,
mutation-proven). No new word, column, token or migration was needed: every chip below already had its word-reader
fact, its `cnt_<token>` in `apartment_guided_counts_ar` and its `p_amenities` arm from the apartments work.

## The lists (counts = villa ads carrying the fact on 2026-11-02; Buy 62,621 / annual Rent 11,753)

**🏡 Villa BUY — 7 questions:** 🏗️ age → 🚿 bathrooms → 🛣️ street width → 🧭 direction (sun tip) → the three cards.
No installments (0 villa-for-sale ads accept), no furnished question.

| card | chips (owner's order) |
|---|---|
| 🔑 Comfort | kitchen 39k · majlis 31k · dining majlis 19k · maid room 20k · driver room 10k · elevator 10k · car entrance 19k |
| 🏠 Space | roof 17k · laundry room 16k · annex 13k · yard 12k · storage 10k · two entrances 3k · pool 3k |
| 🧱 Build | separate meters 17k · warranty 9k · sanitation 29k · insulation 1.5k · grill 2.7k · garden 3.2k · basement 0.9k |

**🏡 Villa RENT (yearly) — 7 questions:** 💳 installments (4.5k accept) → 🚿 bathrooms → 🏗️ age → the four cards.

| card | chips (owner's order) |
|---|---|
| 🔑 Comfort | kitchen 7.3k · AC 4k · majlis 5.3k · maid room 4.5k · car entrance 3.6k · furnished 1.5k · parking 2.1k |
| 🏠 Space | roof 3.1k · dining majlis 3.2k · laundry room 2.7k · yard 2.7k · storage 1.7k · driver room 1.7k · annex 1.4k |
| 🏡 Extras | pool 0.8k · garden 0.9k · grill 0.8k · balcony 0.8k · garage 0.8k · fiber 0.5k · elevator 0.7k |
| 🛡️ Safety | separate meters 3.1k · guard 248 · cameras 222 · smart entry 94 · kids play area 151 · gym 393 · own bathroom 743 |

**Duplex** (850 Buy / 76 Rent ads, 0 accept installments) shares both lists verbatim. A chip with 0 ads in the
user's scope hides itself; a question below the usefulness gates (`MEANINGFUL_NARROWING_FRACTION`,
`MIN_TOTAL_TO_SHOW`) is not asked — the lists say what MAY be asked, the counts say what IS.

**Not included (owner):** rating, Wi-Fi, bills included, self check-in — short-stay things, near zero on villas.
Short stays (Gathern + Aqar Monthly) keep their own one-pool cohort whatever the type.

## How it combines (the same engine, no villa special case)

- **Group box, no type:** Villa ∩ Duplex = the full lists above (they are identical). Verified by execution.
- **Villa + Apartment on Buy:** only chips BOTH Buy lists carry, in the villa layout (kitchen, majlis, maid room,
  driver room, elevator · roof, storage, two entrances, pool · separate meters, warranty, garden); street width is
  dropped because Apartment never asks it.
- **Villa with Buy + Rent together:** the chips in all three villa lists (buy, annual, short stays) — majlis, roof,
  laundry room, pool, elevator — plus bathrooms.
- **Ask order:** Buy-only scopes use `BUY_ASK_ORDER` (age first), rent and mixed scopes `GROUP_ASK_ORDER`
  (installments first), exactly as the apartments group.

## Live verification (NOTHING IS LIVE UNTIL USED LIKE A REAL USER)

After each deploy walk ezhalah.com as a user: Filter → Buy → الرياض → «الفلل والبيوت» (no type) → search → «🎯 دقّق
مع الذكاء الاصطناعي» → the questions and chips above with counts, then Rent the same way; compare one chip's count
with `apartment_guided_counts_ar` for the same scope and open a result card on its source site.
