# Advanced Filter — the Villas & Houses group (owner-locked 2026-11-01, built 2026-11-02)

**Canonical record of the owner's locked chip lists for the «Villas & Houses» group** (Villa, Duplex; تاون هاوس rides
Duplex, بيت and قصر ride Villa) of «🎯 دقّق مع الذكاء الاصطناعي» / «🎯 Refine with AI», copied from the owner's
handoff (LOCKED 2026-11-01 sections) and approved for build on 2026-11-02: «what I gave you, but the rules — 2.5 %,
what Skip means, everything — same as the others». ONE pair of lists at GROUP level, shared by every type in the box,
so the box with no type picked opens the full interview. Changing a chip, a question or its order is a product
decision (`docs/ops/AGENT_AUTHORITY.md` RED list). Everything the Apartments group obeys
(`docs/ops/ADVANCED_FILTER_APARTMENTS_GROUP.md`: THE CONTRACT, THE ROOT, intersection never union, a chip exists
only where its COUNT path exists, UNKNOWN never becomes NO, Skip = no filter) applies unchanged and is not restated.

Code: `src/lib/afCohorts.ts` (`VILLA_BUY_CARDS`, `VILLA_RENT_CARDS`, `COHORT_CARDS.Villa` = `COHORT_CARDS.Duplex`,
`COHORT_QUESTIONS.Villa` / `.Duplex`), the three villa cards in `src/data/advancedFilters.ts` (`outdoors`, `smart`,
`papers`) and the per-scope bathrooms ladder (`bathroomLadder()`), chip voices in `src/lib/afChips.ts`, evidence in
`src/lib/afEvidence.ts` (`either()` for the merged chips). Guard: `scripts/verify-af-villas-group-cards.ts`
(executes the plans, mutation-proven). Database: migration `20261102055240` (7 text facts, 5 merged tokens,
`cnt_bath5` / `cnt_bath6`); the free word reader learned the 7 words in PR #9904.

## The lists (villa ads on 2026-11-02: Buy 62,621 / annual Rent 11,753)

**🏡 Villa BUY — 7 questions, Skip everywhere:** 🏗️ age → 🚿 bathrooms (3+ · 4+ · 5+ · 6+) → 📏 street width
(15 · 20 · 25 · 30 m+) → 🧭 direction (with the sun tip) → the three cards. No installments (0 ads accept), no
furnished question. Dropped from the cards because almost every villa has them: kitchen, AC, laundry room, storage.

| card | chips (owner's order) |
|---|---|
| 🏠 Space | majlis · 👩 women's majlis · 🍽️ مقلط · maid room · driver room · annex · roof · elevator |
| 🌳 Outdoors & fun | pool · garden & yard · grill · 🍳 outdoor kitchen · 🏕️ outdoor diwaniya · 💦 waterfall · garage · 🛁 jacuzzi & sauna |
| 🧱 Build, safety & papers | warranty · sewage · 💧 water tank & well · separate meters · electronic deed · basement · two entrances · car entrance · 📹 cameras & smart home |

**🏡 Villa RENT (yearly) — 7 questions, Skip everywhere:** 💳 installments (4.5k accept, with the provider logos) →
🚿 bathrooms (2+ · 3+ · 4+ · 5+) → 🏗️ age → the four cards. Street width and direction are NOT asked on rent (owner
2026-11-01: renters care less; both stay on Buy).

| card | chips (owner's order) |
|---|---|
| 🔑 Comfort | kitchen · AC · furnished · parking · car entrance · private entrance · laundry room |
| 🏠 Space | majlis · women's majlis · مقلط · maid room · driver room · annex · roof |
| 🌳 Outdoors | pool · garden & yard · grill · 💧 garden irrigation · garage · storage · balcony |
| ✨ Extras & smart | elevator · gym · jacuzzi & sauna · 🎾 sports court · smart home & entry · central gas · cameras |

**Merged chips match when EITHER fact is true** (`garden_yard`, `jacuzzi_sauna`, `cameras_smart_home`,
`water_tank_well`, `smart_home_entry`: derived predicate tokens, no column of their own). **New words** the free
reader learned (PR #9904): مجلس نساء / مجلس حريم · مطبخ خارجي · ديوانية خارجية · شلال · بئر / بير · نظام ري / ري
آلي / ري بالتنقيط · ملعب تنس / اسكواش / كرة سلة / كرة قدم (never «ملعب أطفال», never a nearby pitch). Their chips
show counts as the hourly reader (:01 UTC, since 2026-11-03) reads the ads; a chip at 0 hides itself.

**Duplex** (850 Buy / 76 Rent ads, 0 accept installments) shares both lists verbatim. A chip with 0 ads in the user's
scope hides itself; a question below the usefulness gates (`MEANINGFUL_NARROWING_FRACTION`, `MIN_TOTAL_TO_SHOW`) is
not asked — the lists say what MAY be asked, the counts say what IS.

## How it combines (the same engine, no villa special case)

- **Group box, no type:** Villa ∩ Duplex = the full lists above (they are identical). Verified by execution.
- **Villa with Buy + Rent together:** the engine keeps the Buy (primary) layout and only the chips both lists carry —
  age · bathrooms (3+ · 4+ · 5+) · Space (majlis, women's majlis, مقلط, maid room, driver room, annex, roof, elevator)
  · Outdoors (pool, garden & yard, grill, garage, jacuzzi & sauna) · car entrance pooled into the last card. The
  owner's handoff names the same set; the only difference is that «cameras & smart home» (Buy) and «cameras» /
  «smart home & entry» (Rent) are different tokens, so neither survives the mix.
- **Villa + Apartment on Buy:** only chips BOTH Buy lists carry (majlis, maid room, driver room, roof, elevator ·
  pool, garage · warranty, separate meters, basement…), in the villa layout; street width is dropped because
  Apartment never asks it; the bathrooms ladder falls back to 1+ … 4+ because the scope is not villas-only.
- **Short stays + Villa:** short stays stay ONE pool (owner 2026-10-31), so the short-stays cards apply whatever the
  type; the handoff's «Short stays → Villa» 3-question draft is NOT built (not locked).
- **Ask order:** Buy-only scopes use `BUY_ASK_ORDER` (age first), rent and mixed scopes `GROUP_ASK_ORDER`
  (installments first), exactly as the apartments group.

## Not built (needs its own owner yes)

Townhouse re-typing («villa» ads that call themselves تاون هاوس → served as تاون هاوس) and the single «🏘️ Duplex &
Townhouse» button; the short-stays villa questions.

## Live verification (NOTHING IS LIVE UNTIL USED LIKE A REAL USER)

After each deploy walk ezhalah.com as a user: Filter → Buy → الرياض → «الفلل والبيوت» (no type) → search → «🎯 دقّق
مع الذكاء الاصطناعي» → age · bathrooms 3+…6+ · street width · direction · 🏠 · 🌳 · 🧱 with counts; then Rent the same
way; then Villa + Apartment on Buy; compare one chip's count with `apartment_guided_counts_ar` for the same scope and
open a result card on its source site.
