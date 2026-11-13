# Advanced Filter — «الاستراحات والريف», residential land and the commercial groups (owner-locked 2026-11-01, built 2026-11-02)

**Canonical record of the owner's locked chip lists** for every group after Apartments & Villas, copied from the owner's
handoff (LOCKED 2026-11-01) and built in one run on 2026-11-02 («do it all … confirm they are all live … you cannot
combine commercial with residential»). Everything the first two groups obey (`docs/ops/ADVANCED_FILTER_APARTMENTS_GROUP.md`:
THE CONTRACT, THE ROOT, intersection never union, a chip exists only where its COUNT path exists, UNKNOWN never becomes
NO, Skip = no filter, a chip at 0 hides itself) applies unchanged. Changing a chip, a question or its order is a product
decision (`docs/ops/AGENT_AUTHORITY.md` RED list).

Code: `src/lib/afCohorts.ts` — `GROUP_LISTS` (the box with NO type picked), per-type `COHORT_CARDS` / `COHORT_QUESTIONS`,
`scopeLegs()` (the one place that decides which lists a scope must certify against: the Apartments short-stays POOL,
a GROUP box, or type × deal). Questions: `src/data/advancedFilters.ts` (34 new cards, generated from one table —
`CARD_IDS`). Chips: `src/lib/afChips.ts`, evidence `src/lib/afEvidence.ts`. Database: migration
«countryside_group_advanced_filter_chips» (58 text facts + camels_horses, palm_fruit_trees) and
«commercial_group_advanced_filter_chips» (the commercial facts + pool_gym); the free word reader learned every word in
PR «feat/af-words-all-groups». Guard: `scripts/verify-af-remaining-groups-cards.ts`.

## Rules that shape these lists (owner 2026-11-01)
- **Commercial is never mixed with residential**: the Filter home picks ONE category, so no scope can span both.
- **One payment question on every rent list**, «💳 Rent now, pay later / split payments», ONE chip since 2026-11-12
  (owner: «merge … we cannot guarantee»): «تقسيط أو دفعات شهرية» matches the site's own installment box OR the ad's
  words «دفعات / دفع شهري» (a union by owner decision — the one exception to «intersection never union», migration
  20261112111809); under the logos the note that the lister says instalments or monthly payments, through one of
  these providers or another way, and Ezhalah cannot guarantee it. Hidden where the chip is at 0. (Two ANDed chips
  2026-11-02 → 2026-11-12.)
- **No «Nearby» / «suitable for» chips** (the seller's opinion; the map shows what is near). «On a main road» is a fact
  about the plot and stays.
- **Short stays**: the Apartments & Co-living types stay ONE pool (owner 2026-10-31); Villa, Chalet, Rest house, Camp and
  the countryside group box have their own short-stay lists (owner 2026-11-01). No type question on short stays.
- **The group box with no type picked** opens the group's own list (`GROUP_LISTS`); a picked type opens its own.

## «الاستراحات والريف» (Rest House, Chalet, Camp, Farm, Agriculture Plot)
| scope | questions |
|---|---|
| Group · short stays | bathrooms → 🏊 Water (pool, heated pool, kids' pool, water slide, jacuzzi & sauna, sea view) → 🎮 Games (football pitch, sports court, billiards, PlayStation, inflatable games, cinema/smart TV, sound system) → 🌳 Outdoors (grill, fire pit, بيت شعر, mandi pit, garden, outdoor seating, tent, dunes view) → 🔑 Comfort (majlis, kitchen, Wi-Fi, self check-in, parking, private entrance, women's section, two sections) |
| Group · annual rent | installments → bathrooms → 🏠 Space (majlis, women's section, two sections, بيت شعر, kitchen, events hall) → 🌳 Outdoors (pool, jacuzzi, garden, grill, football pitch, kids' games, fire pit) |
| Group · buy | street width → 💧 Water & land (well, water tank, electricity, sewage, fence, irrigation, palm & fruit trees, animal pens) → ✨ Fun (pool, jacuzzi, majlis, بيت شعر, garden, football pitch, grill, kids' games, events hall) → 📄 Land & papers (electronic deed, warranty, corner plot) |
| Chalet · short stays | bathrooms → 👥 Who (families, youth, events, newlyweds) → Water → Games → Outdoors (grill, fire pit, بيت شعر, mandi, garden, outdoor seating) → Comfort (+ privacy) ; rent / buy = the group lists |
| Rest house · short stays | bathrooms → Who → 🎮 Water & games → Outdoors (+ trees) → Comfort (+ annex) |
| Rest house · annual rent | installments → bathrooms → Who → Space (+ annex, events hall, privacy) → Outdoors (pool, jacuzzi, football, sports court, kids' games, fire pit, garden, grill, mandi) |
| Rest house · buy | street width → Space → Fun → Water & land (well, tank, sewage, fence, trees) → Land & papers (deed, corner, warranty) |
| Camp · short stays | bathrooms → Who → 🔥 Camp life (بيت شعر, tent, outdoor seating, fire pit, mandi, grill, dunes) → ✨ Fun (quad bikes, camels & horses, football, kids' games, cinema screen, sound system) → Comfort (kitchen, toilets, majlis, two sections, privacy, AC, lighting) |
| Farm · buy | street width → 💧 Water & power (well, artesian well, tank, irrigation, electricity, solar) → 🌴 Crops (palms, fruit trees, fodder & crops, greenhouses, producing) → 🐑 Animals (pens, poultry, horses & stable, camels) → 🏡 Buildings (house/villa, rest house, majlis, pool, workers' housing, storage, بيت شعر) → 📄 Land & papers (fence, main road, deed) |
| Farm · annual rent | installments (hidden at 0) → Water & power (well, electricity, tank) → 🌴 Farm (palms, fruit trees, horses, pens) → Buildings (house, rest house, majlis, storage, pool) |
| Agricultural land · buy | street width → Water & power (well, artesian, electricity, tank, fence) → Land & papers (main road, corner, deed, good soil, palms) ; rent: installments → street width → 🧱 Land (electricity, main road, fence, corner) |

## Residential land
Buy: street width → facing (sun tip) → 📐 Plot (corner, 3+ streets, ready to build, raised, residential + commercial, on a
main road) → ⚡ Services (all services, electricity, water, sewage, asphalt, street lights, 🚧 no services yet) → 📄 Papers
& deal (deed, approved plan, direct from owner, inside a project, floors allowed, grant land). Rent: installments → street
width → Plot (corner, residential + commercial, main road). The 🚧 «No services yet» chip is the raw-land rule's chip; the
«Raw land» double-listing itself is a later index-level step.

## Commercial
| scope | questions |
|---|---|
| Retail & Workspace (group) · rent | payment → street width → 📍 Location (main street, frontage, corner, in a mall, in a tower) → 🏢 Space (mezzanine, storage, toilet, pantry, glass front, furnished) → ⚙️ Services (parking, elevator, AC, internet, own meter, cameras, civil defense) → 📄 Business (license, food allowed, takeover, first tenant) ; buy: street width → Location → 🏢 Space & papers |
| Office · rent | payment → 🏢 Office kind (private, co-working, tower, mall) → 🛋️ Ready to work (furnished, meeting room, reception, pantry, toilet, storage) → ⚙️ Building (parking, elevator, AC, central AC, internet, security, cameras) → Location → Business ; buy = group |
| Shop · rent | payment → street width → Location → Space (+ high ceiling) → Services → Business ; buy: street width → Location → Space & papers (+ takeover) |
| Showroom · rent | payment → street width → Location → Space → ⚙️ Services & business ; buy = group |
| Industrial & Logistics (group = Warehouse) · rent | payment → street width → 🏗️ Building (high ceiling, hangar, insulated, cold storage, AC, mezzanine, concrete floor) → 🚛 Trucks & loading (yard, dock, gate, truck access, crane, racks) → Services (office, toilet, workers' housing, electricity, heavy power, civil defense, cameras) → 📍 Location & papers ; buy: street width → Location → Building → 📄 Papers |
| Workshop · rent | payment → street width → 🔧 Space & services → 📍 Location & business (+ car-service ready) ; buy: street width → Location → 🏗️ Building & papers |
| Factory · rent | payment → street width → 🏭 Building → 📍 Location & safety ; buy: street width → Location → Building |
| Buildings & Facilities (group = Commercial building) · rent | payment → street width → 🏬 Inside the building (shops, offices, apartments, staff housing, restaurant/café, car wash, market) → Location ; buy: street width → What's inside → 💰 Investment (earning income, license, new) → Location |
| Hotel | (payment on rent) → street width → 🛎️ Hotel (stars, rooms & suites, restaurant, pool & gym, elevator, parking) → 💰 Deal (earning income, license) |
| Gas station | (payment on rent) → street width → ⛽ On site (car wash, market, oil change, restaurant, pumps, mosque) → 💰 Deal & location |
| Commercial & industrial land (group) · buy | street width → facing → Plot (corner, 3+ streets, main road, ready to build, 🚧 no services) → Services (all services, electricity, sewage, asphalt) → Papers & deal (deed, approved plan, direct owner, building rules, earning income, inside a project) ; rent: payment → street width → Plot (+ fence) → Services (+ inside a project, building rules) |

Street-width rungs: the questions offer the rungs the counts carry (15 · 20 · 25 · 30 m+); the owner's 10 / 40 / 60 m+
rungs for land join when their counts exist.

## Live verification
ezhalah.com, as a user, AR + EN: each group box with no type, one type per group, the mixes inside a category (never
across categories), chip counts compared with `apartment_guided_counts_ar` for the same scope.
