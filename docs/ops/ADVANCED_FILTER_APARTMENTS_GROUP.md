# Advanced Filter — the Apartments & Co-living group (owner-locked 2026-10-31, built 2026-11-01)

**Canonical record of the owner's locked chip lists for the «Apartments & Co-living» group** (Apartment, Floor,
Room, Studio, Residential building) of «🎯 Refine with AI» (the renamed Advanced Filter), copied from the owner's
handoff of 2026-10-31. The lists below are LOCKED: changing a chip, a question or its order is a product decision
(`docs/ops/AGENT_AUTHORITY.md` RED list). Villas & houses, chalets / rest houses / camps, land and commercial are
NOT locked and are not built. Standing rules this group obeys without restating them: MATCH FIRST (AGENTS.md),
«a chip exists only where its COUNT path exists», UNKNOWN never becomes NO, Gathern + Aqar Monthly show no price.

## THE CONTRACT — what the user must get (owner 2026-10-31, binding on every part below)
1. **The user gets exactly what they chose, nothing else.** Every ad in the result satisfies EVERY chip the user
   tapped and EVERY question they answered. A chip is a hard filter, never a preference or a ranking boost.
2. **The count the user sees is the count they get.** The number on a chip, the «we found N results» line and the
   number of cards after «عرض المزيد» are the same number, from the same query. If a count cannot be computed,
   the chip is not shown (never shown with a guessed or stale number).
3. **A chip says only what the ad says.** The chip is true for an ad only when the ad's own text (or the site's
   own structured field) says it. We never infer, never assume, never fill a blank with a guess.
   UNKNOWN is never turned into YES or NO: an ad that does not mention Wi-Fi is neither «has Wi-Fi» nor
   «no Wi-Fi»; it simply is not in a «Wi-Fi» result.
4. **Pick many, Skip always.** Every chip question is multi-select. Every question has Skip, which filters
   nothing, leaves the count unchanged and moves on.
5. **Match first, then mix.** The matched set is decided once by the filters. After that, the first page is only
   re-ordered: website → deal → property type → district → photos. Mixing never adds an ad and never drops one.
6. **The card proves it.** Each card shows the matched things as small tags (🔑 Self check-in, 📶 Wi-Fi…) so the
   user can see why the ad is there. Opening the ad on the source site must show the same thing.
7. **Short stays show no price** (Gathern + Aqar Monthly, permanent rule). Nothing here changes that.

## THE ROOT — how a new listing reaches a chip, and how the AI checks it (the plumbing, be exact)
The filter is fed by a pipeline that runs every day with no human step. The building chat must keep every
stage working and must add each NEW chip to stages 2, 3 and 4.

1. **Crawl (04:22 UTC and the per-site crawls).** The scraper saves the ad with its title AND description into
   the site's own table (`<site>_residential_listings.description`; wasalt keeps it in
   `ar_data->'propertyInfo'->>'description'`). PRICE = SOURCE, PERIOD = SOURCE, text = source. A site whose new
   ads suddenly have no description is a broken scraper (`new_listing_field_drop` alarm).
2. **Free word reader (07:05 UTC, `facts-words.yml`, pg_cron `gh-facts-words-nightly`).** `scrapers/facts/words.py`
   reads every active ad never read or whose text changed (`text_facts_todo`, by `src_hash`) and writes one row
   per fact into `listing_text_facts` with the ad's own words as proof. **This is the ONLY writer of filter
   values.** Every new chip = a new fact here, with its Arabic/English phrases AND selftest phrases
   (`--selftest` must pass). Measured 2026-10-31: 327 / 327 new Gathern ads and 11 / 11 Aqar Monthly ads of
   the last 4 days were read. Keep it at 100 %.
3. **Index sync (hourly).** `sync_search_listings_ar()` merges `listing_text_facts` into `search_listings_ar`
   (Rule B overlay). The chip's column / amenity slug must exist here, or the chip has nothing to count.
4. **Counts and search (per chip).** `apartment_guided_counts_ar` computes `cnt_<chip>` inside the user's scope;
   `location_search_candidates_ar` applies the chip in `p_amenities`. Count = Search, always (contract §2).
   A chip without BOTH its count and its search slug must not be offered.
5. **Paid AI reader (07:40 UTC, `facts-extract.yml`, pg_cron `gh-facts-ai-new`).** Reads every NEW ad's text
   (and re-reads an ad whose text arrived or changed, `text_hash`, migration 20261031080211) into
   `listing_facts`. **It is a TEACHER, not a writer of filter values:** its job is to find the words the free
   reader does not know yet («دخول ذكي» written as «قفل ذكي», «نت» vs «إنترنت»). Weekly lesson:
   `ops_ai_facts_reader_gaps` → add the phrases to stage 2 → selftest → the free reader re-reads.
   Budget: `ai_facts_budget.month_usd_cap` (30 USD from Nov 1; October's 100 was an exception).
6. **The AI CHECKS the chips (the owner's rule).** Every night, for the new ads, compare stage 2 (free reader)
   with stage 5 (AI reader) per chip. Where the AI found a fact the free reader missed, that phrase goes into
   the lesson. Where they disagree on YES, a human-readable sample is written to `ops_ai_facts_reader_gaps`.
   The filter never changes from this directly; only the word lists do. (`mon-text-facts`, 11:52 UTC, alarms
   when the free reader misses ads.)
7. **Liveness.** A removed ad leaves the index through the liveness contract (`docs/ops/LISTING_LIVENESS.md`),
   so a chip never counts a dead ad.

**Daily health checks the building chat runs before any chip work:** nightly `facts-words.yml` and
`facts-extract.yml` green with lost=0 · `select * from ops_ai_facts_unread_new();` near empty · new ads of the
last 2 days have descriptions per site · month spend under cap · `facts_ai_todo_ids(... 'backlog')` ≈ 0 for ads
with text.

## HOW THE LISTS COMBINE — the rule the AI must implement (owner 2026-10-31)
The owner locks ONE list per (property type × deal). Nothing else is planned by hand. Every combination a user
can make is computed by code, never by a hand-written list:

1. **Many types selected** (Apartment + Floor, or the whole «Apartments & Co-living» box): a question is offered
   only if it is in the list of EVERY selected type, and a chip is offered only if it is in EVERY selected type's
   list for that question. Intersection, never union. (Owner rule 2026-08-20, already in `src/lib/afCohorts.ts`:
   `intersectChips()` / `cohortAllows()` — keep it and extend it to the new questions.)
2. **Many deals selected** (Buy + Annual rent, or all three with Short stays): same intersection across the deals'
   lists (`cohortAllows` 'both' mode).
3. **Types × deals together**: intersect across all of it.
4. **A chip with 0 matching ads hides itself; a question left with no live chip is skipped automatically.**
   A chip's count must equal what Search returns for that chip (count-honesty contract).
5. **Why intersection:** a chip the user taps must be true for every ad in the result. Offering «annex» on
   Apartment + Floor would make every apartment silently vanish — UNKNOWN must never become NO.
6. Worked examples the build must reproduce (test them):
   - Annual rent → Apartment + Floor: installments, bathrooms, age, then kitchen/AC/parking/elevator/furnished/
     private entrance; majlis/maid/driver/roof/two entrances/balcony; cameras/smart entry/central gas/fiber/meters.
     Gone: bills included, car entrance, annex, garage.
   - Annual rent → Apartment + Room: NO bathrooms (rooms don't know it); installments, AC, furnished, kitchen,
     bills included, private entrance, parking, cameras, fiber, elevator remain.
   - Apartment with Buy + Annual rent + Short stays: bathrooms; parking, elevator, private entrance, majlis,
     balcony, roof; cameras, pool, gym.
   - Whole group box ticked: the small shared set only (≈ 6 chips).
7. **Typed words in chat are separate from the questions:** «with Wi-Fi» or «شاليه» typed by the user still
   filters, whatever the selected scope offers as chips. We never ASK a question the scope doesn't certify.
8. Chip questions are multi-select everywhere; EVERY question has Skip (= no filter, count unchanged, next).

## LOCKED — Short stays → Apartment (إقامات قصيرة = Gathern + Aqar Monthly; rent period `monthly` in code)
No property-type question. No rating question. (Typed «شاليه» / «top rated» in chat still honoured, never asked.)
Studio, serviced apartment and room are sub-types of apartment: SAME 4 questions; a chip with 0 ads hides itself.

Skip on EVERY question (Skip = no filter on that question, count unchanged, next question).

**1. 🚽 How many bathrooms?** 1+ · 2+ · 3+ · Skip

**2. 🔑 Comfort — pick many · Skip**
🔑 Self check-in · 📶 Wi-Fi · 🧺 Washing machine · 💡 Bills included · 🛗 Elevator · 🅿️ Parking · 🚪 Private entrance

**3. 🏠 Space & safety — pick many · Skip**
🛋️ Majlis · 🌅 Balcony · 🏠 Private roof · 🔇 Soundproof · 📹 Cameras · 🧹 Cleaning service

**4. ✨ Fun — pick many · Skip**
🏊 Pool · 🏋️ Gym · 🛁 Jacuzzi · 📺 Smart TV / cinema room · 🎱 Billiards table

Then results: summary with icons, count, chosen chips as pills, cards with small tags. Results stay MATCH
FIRST, then mixed website → deal → property type → district → photos.

## Exact labels and words (Arabic / English → phrases for the free word reader)
- 🔑 دخول ذاتي / Self check-in → دخول ذاتي، دخول ذكي، نظام دخول ذكي، قفل ذكي، تسجيل دخول ذاتي، self check-in, smart lock
- 📶 واي فاي / Wi-Fi → واي فاي، وايفاي، إنترنت، انترنت، wifi, internet («نت» only as a whole word)
- 🧺 غسالة ملابس / Washing machine → غسالة، غسالة ملابس (+ existing laundry_room)
- 💡 الكهرباء والماء مشمولة / Bills included → ONLY when the ad says included: شامل الكهرباء والماء، شامل الفواتير،
  الفواتير مشمولة، الكهرباء على المالك. NEVER the plain «كهرباء / ماء» facts (they mean "connected").
- 🛗 Elevator · 🅿️ Parking · 🚪 Private entrance · 🏊 Pool · 🏋️ Gym · 🛋️ Majlis · 🌅 Balcony → existing chips
- 🛁 جاكوزي / Jacuzzi → جاكوزي، جكوزي
- 📺 شاشة ذكية / Smart TV / cinema room → شاشة ذكية، تلفزيون ذكي، غرفة سينما، سينما، بروجكتر
- 🎱 طاولة بلياردو / Billiards table → بلياردو، طاولة بلياردو
- 🧹 خدمة تنظيف / Cleaning service → خدمة تنظيف، تنظيف يومي
- 🔇 عازل صوت / Soundproof → عازل صوت، عزل صوتي
- 📹 كاميرات مراقبة / Cameras → كاميرات، كاميرات مراقبة
- 🏠 سطح خاص / Private roof → existing fact `roof`
Rule: a chip says only what the ad says. Card tags may be more specific («Free Wi-Fi», «Private pool»).

## Measured counts (AI facts on short-stay apartments 9,406 + studio 2,681 + serviced 1,965 + room 207)
self check-in ~470 · wifi ~600 · washing 143 · bills included ~150 · elevator 530 · parking 1,101 ·
private entrance 595 · pool ~215 · gym ~215 · majlis 345 · balcony 379 · jacuzzi 118 · smart TV/cinema ~140 ·
billiards 27 · cleaning 27 · soundproof 25 · cameras 125 · roof 134 · bathrooms known 99%.
Both sites: Gathern 15,280 / Aqar Monthly 3,683 ads; Aqar Monthly calls every unit شقة.

## LOCKED — Annual rent → Apartment (7 questions, 7 chips each, Skip on EVERY question)
Skip = no filter on that question, count unchanged, next question. Furnished is a chip here, not its own question.

**1. 💳 Rent now, pay later?** Yes · Skip (exists: `rnpl`)
**2. 🚽 Bathrooms?** 1+ · 2+ · 3+ · Skip (exists)
**3. 🏗️ Property age?** New · Under 5 · Under 10 · Skip (exists)
**4. 🔑 Comfort — pick many · Skip**
🍳 Kitchen · ❄️ AC · 🅿️ Parking · 🛗 Elevator · 🛋️ Furnished · 🚪 Private entrance · 💡 Bills included
**5. 🏠 Space — pick many · Skip**
🛋️ Majlis · 🧹 Maid room · 🚗 Driver room · 🏠 Private roof · 🚪 Two entrances · 🌅 Balcony · 🌳 Garden
**6. 🛡️ Safety & smart — pick many · Skip**
📹 Cameras · 💂 Guard · 🔑 Smart entry · 🏠 Smart home · 🔥 Central gas · 🌐 Fiber internet · ⚡ Separate meters
**7. ✨ Building perks — pick many · Skip**
🏋️ Gym · 🏊 Pool · 🧖 Sauna · 🧒 Kids' play area · 🧸 Nursery · 🧹 Cleaning service · 🔧 Free maintenance

New words for the free word reader (annual rent, measured 2026-10-31 on 81,134 ads):
- 📹 Cameras → كاميرات، كاميرات مراقبة (2,952 + 196)
- 💂 Guard → حارس، حراسة، أمن وحراسة، حارس عمارة، غرفة حارس، خدمة حارس (~1,500)
- 🔑 Smart entry → دخول ذكي، نظام دخول ذكي، قفل ذكي، مدخل ذكي (~2,400)
- 🏠 Smart home → سمارت هوم، نظام سمارت هوم، منزل ذكي، نظام منزل ذكي، نظام ذكي (~480)
- 🔥 Central gas → غاز مركزي (379)
- 🧖 Sauna → ساونا، غرفة بخار (~175)
- 🧒 Kids' play area → منطقة ألعاب أطفال، ألعاب أطفال (150)
- 🧸 Nursery → حضانة، حضانة أطفال (~150)
- 🧹 Cleaning service → خدمة نظافة، خدمة تنظيف (~180)
- 🔧 Free maintenance → صيانة مجانية، خدمة صيانة (~230)
- 💡 Bills included → ONLY when the ad says included (see short-stays rule); never the plain كهرباء/ماء facts
- 🏠 Private roof → existing `roof` · 🚪 Two entrances → existing `two_entrances` · ⚡ Separate meters →
  existing `separate_electricity_meter` + `separate_water_meter` (one chip, either meter)

## LOCKED — Buy → Apartment (7 questions, Skip on EVERY question)
**1. 🏗️ Property age?** New · Under 5 · Under 10 · Skip (exists)
**2. 🚽 Bathrooms?** 1+ · 2+ · 3+ · Skip (exists)
**3. 🧭 Direction?** North · South · East · West · Skip (exists) — with a one-line grey tip under it:
   AR «💡 معلومة: الواجهة الشمالية أقل تعرضاً للشمس، والجنوبية الأكثر.»
   EN «💡 Tip: a north-facing home gets the least direct sun. South gets the most.»
   (a fact, never advice; same style as «Results update as you choose»)
**4. 🔑 Comfort — pick many · Skip**
🍳 Kitchen · ❄️ AC · 🅿️ Parking · 🛗 Elevator · 🚪 Private entrance · 🏠 Private roof · 🚪 Two entrances
**5. 🏠 Space — pick many · Skip**
🛋️ Majlis · 🧹 Maid room · 🚗 Driver room · 🌅 Balcony · 📦 Storage room · 🌳 Garden · 🏢 Whole floor
**6. 🛡️ Safety & smart — pick many · Skip**
📹 Cameras · 💂 Guard · 🔑 Smart entry · 🏠 Smart home · 📞 Intercom · 🧯 Fire system · 🚗 EV charger
**7. 🧱 Build & services — pick many · Skip**
🛡️ Warranty · 💧 Private water tank · 🔥 Central gas · ⚡ Separate meters · 🌀 Central vacuum · 🏊 Pool · 🏋️ Gym

New words (Buy apartments, measured 2026-10-31 on 108,266 ads):
- 📹 Cameras → كاميرات مراقبة، كاميرات أمنية، كاميرا مراقبة (~10,000)
- 🔑 Smart entry → دخول ذكي، نظام دخول ذكي، قفل ذكي (~6,000)
- 🏠 Smart home → سمارت هوم، نظام سمارت هوم، منزل ذكي، بيت ذكي، نظام المنزل الذكي، نظام ذكي (~2,100)
- 💂 Guard → حارس، غرفة حارس، حارس للمبنى، حارس مبنى، نظام أمن (~1,000)
- 📞 Intercom → انتركوم، انتركوم سمارت، إنتركم مرئي (~390)
- 🧯 Fire system → نظام إطفاء، نظام حريق، كاشف دخان، طفاية حريق (measure first)
- 🚗 EV charger → شاحن سيارات كهربائية (85)
- 🔥 Central gas → غاز مركزي، تمديد غاز مركزي، خزان غاز طبيعي (~2,300)
- 💧 Private water tank → existing `water_tank` + خزانات مستقلة، خزانات خاصة (~19,500)
- 🌀 Central vacuum → مكنسة مركزية، مكانس مركزية (~450)
- 📦 Storage room → existing `storage` · 🏢 Whole floor → existing `floors`/دور كامل (measure first)
- 🛡️ Warranty → existing `warranty` (20,932) · 🏠 Private roof → `roof` · 🚪 Two entrances → `two_entrances`
- ⚡ Separate meters → `separate_electricity_meter` + `separate_water_meter` (one chip, either meter)

## LOCKED — Apartment with ALL THREE deals selected (Buy + Annual rent + Short stays)
Only the chips that exist in all three lists (today's intersection rule, `cohortAllows` 'both' mode):
**1. 🚽 Bathrooms?** 1+ · 2+ · 3+ · Skip
**2. 🔑 Comfort — pick many · Skip** 🅿️ Parking · 🛗 Elevator · 🚪 Private entrance · 🛋️ Majlis · 🌅 Balcony · 🏠 Private roof
**3. ✨ Extras — pick many · Skip** 📹 Cameras · 🏊 Pool · 🏋️ Gym
Not shown (belong to one or two deals only): installments, age, direction, self check-in, Wi-Fi, warranty, etc.
Typed chat words («with Wi-Fi») still apply to the ads that carry them.
🌅 Balcony is confirmed in all three single-deal lists (owner 2026-10-31).

## LOCKED — Annual rent → Floor (دور) (7 questions, pick many, Skip on EVERY question; 7,326 ads, counts 2026-10-31)
No short stays for Floor (Gathern / Aqar Monthly have 0).
1. 💳 Rent now, pay later? Yes · Skip
2. 🚽 Bathrooms? 1+ · 2+ · 3+ · Skip
3. 🏗️ Property age? New · Under 5 · Under 10 · Skip
4. 🔑 Comfort: 🍳 Kitchen (3,637) · ❄️ AC (2,072) · 🅿️ Parking (795) · 🛋️ Furnished (469) · 🚪 Private entrance (758) · 🚗 Car entrance (952) · 🛗 Elevator (606)
5. 🏠 Space: 🛋️ Majlis (2,793) · 🍽️ مقلط / Dining majlis (71) · 🧹 Maid room (1,107) · 🚗 Driver room (268) · 🏠 Private roof (620) · 🚪 Two entrances (836) · 🌳 Yard (927)
6. 🏡 Extras: 📦 Storage (627) · 🧺 Laundry room (584) · 🏠 Annex / ملحق (295) · 🚙 Garage (262) · 🔥 Grill (243) · 💧 Water tank (191) · 🌅 Balcony (320)
7. 🛡️ Safety & smart: ⚡ Separate meters (1,024) · 🌐 Fiber (118) · 📹 Cameras (92) · 🔑 Smart entry (77) · 🔥 Central gas (61) · 🏠 Smart home (16) · 🏊 Pool (41)
Owner kept Q7 as is (rated 8.5/10; thin chips may show 0 in small cities, that is accepted).
New words: 🍽️ مقلط → مقلط، مجلس طعام · 🏠 Annex → existing `annex` · 🚙 Garage → existing `garage` · 🔥 Grill → `grill` ·
🧺 Laundry room → `laundry_room` · 🌳 Yard → `yard` · 🚗 Car entrance → `car_entrance` · rest as apartment lists.

## LOCKED — Buy → Floor (دور) (7 questions, pick many, Skip on EVERY question; 26,165 ads, counts 2026-10-31)
1. 🏗️ Property age? New · Under 5 · Under 10 · Skip
2. 🚽 Bathrooms? 1+ · 2+ · 3+ · Skip
3. 🧭 Direction? North · South · East · West · Skip — with the sun tip (same text as Buy → Apartment)
4. 🔑 Comfort: 🍳 Kitchen (8,900) · ❄️ AC (1,369) · 🅿️ Parking (2,933) · 🛗 Elevator (3,140) · 🚪 Private entrance (1,849) · 🚗 Car entrance (3,885) · 🚪 Two entrances (1,501)
5. 🏠 Space: 🛋️ Majlis (9,708) · 🍽️ مقلط (224) · 🧹 Maid room (3,505) · 🚗 Driver room (519) · 🏠 Private roof (2,084) · 🌳 Yard (2,796) · 🏠 Annex (1,000)
6. 🏡 Extras: 📦 Storage (1,994) · 🧺 Laundry room (2,069) · 🚙 Garage (620) · 🔥 Grill (427) · 🌅 Balcony (1,159) · 🌳 Garden (386) · 🏊 Pool (83)
7. 🧱 Build & papers: 🛡️ Warranty (5,390) · 💧 Water tank (2,077) · ⚡ Separate meters (2,543) · 🚰 Sewage connection (1,073) · 🧊 Heat & water insulation (~120) · 📄 Electronic deed (288) · 📹 Cameras (~270)
Owner 2026-10-31: keep 📄 Electronic deed, 🧊 Insulation, 🚰 Sewage (explicitly). Smart entry / smart home left out (~200 ads).
New words: 📄 Electronic deed → existing `electronic_deed` (صك إلكتروني) · 🧊 Insulation → عزل حراري، عزل مائي، عزل مائي وحراري، عوازل ·
🚰 Sewage → existing `sanitation` (صرف صحي) · 🛡️ Warranty → `warranty` · 💧 Water tank → `water_tank` + خزانات مستقلة.

## LOCKED — 💳 «Rent now, pay later» question shows provider logos (owner 2026-10-31)
On every cohort that asks it (Annual rent → Apartment / Floor / …):
> 💳 Rent now, pay later?
> «Pay your rent monthly through one of these providers:» [Rize] [Ejari] [Tamam] [Tamara] [Tabby] (logos, NOT buttons)
> Yes · Skip
- Only Yes / Skip is selectable. The logo row is information only.
- The chip's source stays Aqar's own «إيجار بالتقسيط» checkbox (`rent_now_pay_later`, 39,890 rent ads). The card tag
  «💳 Rent now, pay later» adds the company name when the ad's text names one (measured: Rize 653, Ejari 584,
  Tamam 22 as a company — «تمام» alone is the ordinary word; Tamara 4, Tabby 4).
- Owner supplies the 5 logos at `C:\Yusuf\ezhalah\assets\rnpl-logos\` named `rize.png`, `ejari.png`, `tamam.png`,
  `tamara.png`, `tabby.png`. Logo budget rule applies: ≤ 60 KB each, ≤ 320 px, palette PNG with alpha
  (`scripts/verify-logo-weight-budget.ts`). If the folder is missing, build the question without the logo row. Label AR: «ادفع إيجارك شهرياً عبر أحد هؤلاء المزودين».
- Tamara / Tabby appear in ~4 ads each: the row means «these providers exist», never «this ad uses them».

## LOCKED — Floor with Rent + Buy selected together (intersection, 5 questions, Skip everywhere)
1. 🚽 Bathrooms · 2. 🏗️ Property age
3. 🔑 Comfort: 🍳 Kitchen · ❄️ AC · 🅿️ Parking · 🛗 Elevator · 🚪 Private entrance · 🚗 Car entrance · 🚪 Two entrances
4. 🏠 Space: 🛋️ Majlis · 🍽️ مقلط · 🧹 Maid room · 🚗 Driver room · 🏠 Private roof · 🌳 Yard · 🏠 Annex
5. 🏡 Extras: 📦 Storage · 🧺 Laundry room · 🚙 Garage · 🔥 Grill · 🌅 Balcony · 💧 Water tank · ⚡ Separate meters
Gone: installments, furnished (rent only); direction, warranty, deed, insulation, sewage (buy only); cameras, pool (thin on both).

## LOCKED — Room (غرفة) → Short stays: SAME 4 questions as Short stays → Apartment
Only 207 ads (all Gathern; Aqar Monthly 0). Chips with 0 ads hide themselves; a question with no live chip is skipped
automatically. Measured: elevator 19 · parking 17 · private entrance 9 · Wi-Fi ~12 · self check-in 6 · AC 5 · cameras 4.
No separate list to maintain. Nothing «cool» to add (owner asked, 2026-10-31).

## LOCKED — Room (غرفة) → Annual rent (4 questions, pick many, Skip everywhere; 2,145 ads: aqar 1,543, dealapp 287, haraj 132, wasalt 100)
NO bathrooms question here: bathrooms known on only 82 rooms (a STRICT question would hide 95 %).
1. 💳 Rent now, pay later? Yes · Skip (167) — with the provider-logo row
2. 🔑 Comfort: ❄️ AC (634) · 🛋️ Furnished (441) · 🍳 Kitchen (334) · 💡 Bills included (421 say it) · 🚿 Own bathroom (143) · 🚪 Private entrance (115) · 🅿️ Parking (83)
3. 👤 Who it's for: 👤 Singles / عزاب (195) · 👨‍👩‍👧 Families / عوائل (38)
4. ✨ Extras: 🌐 Fiber (41) · 📹 Cameras (33) · 🛗 Elevator (26) · 💂 Guard (~20) · 🧊 Fridge (15) · 🧺 Washing machine (12) · 🔑 Smart entry (13)
New words: 🚿 Own bathroom → دورة مياه خاصة، حمام خاص، دورة مياة خاصة · 👤 Singles → عزاب، للعزاب، عزابي ·
👨‍👩‍👧 Families → عوائل، للعوائل، عائلات · 🧊 Fridge → ثلاجة · 💡 Bills included → شامل الكهرباء / الماء / الفواتير / الخدمات ONLY.
Room → Buy: 3 ads, nothing to build.

## LOCKED — Studio (استوديو)
- 🏖️ Short stays (2,681 ads, Gathern sub-type): SAME 4 questions as Short stays → Apartment. Nothing extra found.
- 🏢 Annual rent (915 ads), 3 questions, Skip everywhere. No installments (0 ads), no age (62 known):
  1. 🚽 Bathrooms? 1+ · 2+ · Skip (known on 232; keep)
  2. 🔑 Comfort: 🛋️ Furnished (460) · 🍳 Kitchen (279) · ❄️ AC (211) · 🅿️ Parking (85) · 🛗 Elevator (81) · 💡 Bills included (say-it-only) · 🚪 Private entrance (24)
  3. ✨ Extras: 🏋️ Gym (53) · 🌐 Fiber (46) · 📹 Cameras (39) · 🏠 Private roof (26) · 🏊 Pool (20) · 🌅 Balcony (15) · 🧺 Washing machine (~20)
- 🏢 Buy (78 ads): SAME questions as Buy → Apartment; chips with 0 ads hide.

## LOCKED — Residential building (عمارة) — investor type (Buy 11,825 · Annual rent 4,986 · short stays none)
NO bathrooms question (a whole building; known on 57 / 209). NO installments (35 / 1). Skip on every question.
Two NEW question types: 🏢 «How many apartments?» (ladder 4+ · 8+ · 12+ · 20+ · Skip, from `apartments_count`) and
🏪 «Has shops on the ground floor?» (Yes · Skip, from `shops_count` ≥ 1).

**Buy → Building (7 Q):**
1. 🏗️ Property age (exists) · 2. 📏 Street width 15 m+ · 20 m+ · 25 m+ · Skip (exists; 4,283 known) · 3. 🧭 Direction + sun tip (exists)
4. 🏢 How many apartments? (3,336 known) · 5. 🏪 Has shops? (1,168)
6. 🔑 Building features: 🛗 Elevator (1,144) · ⚡ Separate meters (1,100) · 🏠 Annex (1,376) · 🅿️ Parking (747) · 🏠 Roof (658) · 🔽 Basement (573) · 🚪 Two entrances (459)
7. 🧱 Build & papers: 🚰 Sewage (1,133) · 🛡️ Warranty (636) · 🌐 Fiber (553) · 💧 Water tank (503) · 📄 Electronic deed (399) · 💂 Guard room (145) · 📹 Cameras (~140)

**Annual rent → Building (6 Q):**
1. 🏗️ Property age · 2. 📏 Street width (1,228 known) · 3. 🏢 How many apartments? (684) · 4. 🏪 Has shops? (192)
5. 🔑 Features: 🅿️ Parking (418) · 🛗 Elevator (362) · ❄️ AC (360) · 🛋️ Furnished (321) · ⚡ Separate meters (225) · 🔽 Basement (183) · 🏠 Annex (126)
6. 🧱 Services: 🚰 Sewage (458) · 🛡️ Warranty (242) · 🌐 Fiber (207) · 🏠 Roof (139) · 📹 Cameras (~106) · 🚪 Two entrances (103) · 💧 Water tank (73)

**Rent + Buy together (intersection, 6 Q):** age · street width · apartments · shops ·
Features: parking, elevator, separate meters, basement, annex, roof, two entrances ·
Services: sewage, warranty, fiber, water tank, cameras. Gone: direction, electronic deed (buy only); AC, furnished (rent only).
New words: 💂 Guard room → غرفة حارس · 🔽 Basement → existing `basement` · 🏪 shops → `shops_count` · 🏢 apartments → `apartments_count`.

## How it is built (2026-11-01)

- **One list per type × deal, in code:** `src/lib/afCohorts.ts` `COHORT_CARDS[type][deal]` holds each locked list
  above as card id → chip tokens (card ids: `comfort`, `space`, `safety`, `perks`, `build`, `extras`, `who`,
  `features`, `services`, `fun`; the building ladders `apartments` / `shops` are their own questions).
  `cardPlan(q)` computes every combination a user can make — never a hand-written list: it intersects the chip
  KEYS across every type × deal leg of the scope (a chip survives only if every leg offers it, the owner's
  intersection rule), lays the cards out in the PRIMARY leg's order, and in a MIXED scope pools the cards left with
  fewer than 4 chips together, showing a trailing small pool as «extras» (the all-three-deals example: bathrooms ·
  comfort ×6 · extras ×3 is that rule executed). A single leg returns its own list unchanged.
- **One voice per token:** `src/lib/afChips.ts` `CHIP_DEFS[token] = { labelKey, emoji }` (pure; read by
  `src/data/advancedFilters.ts` for the card options, `src/lib/afEvidence.ts` for the card's «مطابق لطلبك» chips
  and `src/lib/afSummary.ts` for the receipt emoji). `src/i18n.tsx` carries the Arabic of every labelKey.
- **Token → count → proof:** a token is a `p_amenities` slug of `location_search_candidates_ar`. Its count is
  `cnt_<token>` in `apartment_guided_counts_ar` (`GuidedCounts` in `src/data/remote.ts`), computed inside the
  user's committed scope so the chip's number equals what Search returns. The 41 column-backed values (39 booleans
  + `apartments_count`, `shops_count`) are packed into `af_canon` (mirror `sql/mirrors/af_canon_select.sql`), so
  the card can prove each chip from the row the predicate ran on. The 6 derived tokens have no column of their own:
  `separate_meters` = (separate_electricity_meter or separate_water_meter), `apts4/8/12/20` = apartments_count ≥ n,
  `has_shops` = shops_count ≥ 1 — `DERIVED_TOKEN` / `amenityReads()` / `amenityHolds()` in `afEvidence.ts` re-run
  the same predicate on the row and stay silent when an input column is null. Every themed card writes the ONE
  `q.amenities` bag (`addAmenities`), so evidence, receipt chips and re-entry carry work unchanged; the card lights
  up the picks of every amenity-bag answer (`AMENITY_BAG_IDS` in `src/components/ResultCard.tsx`).
- **The free word reader is the ONLY writer** of filter values: `scrapers/facts/words.py` → `listing_text_facts`
  → `sync_search_listings_ar()` (Rule B overlay) → `search_listings_ar.<token>`. The paid AI reader
  (`listing_facts`) teaches phrases, never writes a filter value (`docs/ops/AI_FACTS_READER.md`).
- **Migration 20261101100930** (applied 2026-11-01): the 39 boolean columns + the two counts on
  `search_listings_ar` and the overlay, the 45 tokens in `af_eligibility_clause()` (mirror
  `sql/mirrors/af_eligibility_clause.sql`) and `top_cities_by_deal_ar`, `cnt_<token>` + `cnt_apts_unknown` /
  `cnt_shops_unknown` in `apartment_guided_counts_ar`, the `af_canon` pack, the option-truth sweep rows and the
  field registry. The SQL mirrors are repo copies and are not registered in `ops_sql_mirror_expected` (both sit in
  `verify-mirror-md5-is-registered.ts` UNREGISTERED_MIRROR_BASELINE).
- **Not live until walked like a user** on https://ezhalah.com: scope → 🎯 Refine with AI → tap two chips → open a
  card → the SOURCE ad says it (AGENTS.md «NOTHING IS LIVE UNTIL YOU HAVE USED IT LIKE A REAL USER»).
