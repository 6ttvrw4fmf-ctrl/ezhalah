# Ezhalah — Location System Reference

_Permanent technical + functional reference. Last updated: 2026‑06‑24. Live numbers in §10._

Ezhalah is an **Arabic‑first, neutral property‑search aggregator** for Saudi Arabia. It does not own
listings; it ingests them from ~32 Saudi platforms and lets users search them. This document explains
how **location** works end‑to‑end: where the data comes from, how a search becomes results, and the
rules the system must never break.

---

## 1. Overall architecture

Data flows in **one direction**, through five layers. Each layer has a single job.

```
Source platforms (Aqar, Wasalt, +30)
        │  scrapers fetch + normalize, every ~4h
        ▼
1) RAW scraped tables  (immutable — exactly as received: Arabic or English)
        │  UNION of 63 tables
        ▼
2) LOCATION INDEX  (listing_location_index, materialized view)
        │  matched to the Arabic catalog via the 3 maps
        ▼
3) CANONICAL STORE  (listing_location_canonical_mv — Arabic only, indexed)
        │
        ▼
4) RPC / SEARCH LAYER  (location_search_candidates)  ← the only thing the app queries for location
        │
        ▼
5) APP  (filter picker + AI chat → resolve → fetch → display, all Arabic)
```

- **GitHub location catalog** (`src/data/sa-locations.json`): the official Saudi hierarchy — **13 regions →
  cities → districts**, each with an Arabic name (and an English alias). This is the *reference dictionary*
  the system matches everything against. It is the source of truth for **what places exist**.
- **Raw scraped listing tables** (63 tables, one residential + one commercial per platform): the *bronze*
  layer. Holds each listing exactly as the scraper received it. **Never hand‑edited.** Used for audit,
  debugging, and re‑processing only.
- **Location index** (`listing_location_index`): a materialized view that UNIONs all 63 raw tables into one
  shape (id, platform, purpose, region, city, district, street, facade, …). Refreshed every 4h.
- **Canonical store** (`listing_location_canonical_mv`): the index with every location **resolved to Arabic**
  (`region`/`city`/`district` = Arabic; the raw English kept beside it as `*_raw` for audit), plus a
  `searchable` flag and a `review_reason`. **This is what search reads.** Indexed for speed.
- **RPC / search layer** (`location_search_candidates`): the single function the app calls. It filters the
  canonical store by purpose + location + platform, caps per‑platform, and returns the matching listing IDs
  **plus their Arabic location**.
- **App**: turns a user’s request (picker or chat) into a location, calls the RPC, fetches the full cards
  from the raw tables by ID, and displays everything in Arabic.

---

## 2. Search flow

There are **two ways** a user starts a search; both end in the **same engine**.

### A) Filter picker (structured)
1. User taps Buy/Rent, types a place in Arabic, picks a category/type/budget.
2. As they type, the **autocomplete** suggests places from the GitHub catalog (Arabic name + city · region).
3. On Search, the app **resolves** the typed/picked place (`resolveLocation`) to a Region, City, or District.
4. The structured query is handed to the results screen.

### B) AI / free‑text search (chat)
1. User types a sentence in Arabic (e.g. «بيت للبيع في حي العليا الرياض»).
2. The **AI agent** (Gemini edge function) reads it and returns a structured query: deal, type, and
   `location` **in Arabic** (district + city kept together; see §3).
3. If the place is genuinely ambiguous (a district that exists in several cities, with **no** city given),
   the agent **asks one short question** instead of guessing.
4. The structured query goes to the **same** results screen as the filter.

### Region → City → District resolution
The resolver always works **top‑down** and the database decides:
- **Region** named → expand to **all cities** in that region and search the whole region.
- **City** named → scope to that city.
- **District** named → scope to that district **within its city**; if the district name exists in several
  cities and no city was given, the agent asks (chat) or the app searches all and shows a notice (filter).
- A landmark / nickname / area (“North Riyadh”, “near KFUPM”) resolves **up** to its district(s)/city.

**Location Certainty Rule (AI agent — priority: accuracy > intent > search).** If the agent is **not completely
confident** which place the user means, it asks **one short question and waits** before searching — never guesses.
It asks when: the same name exists in several cities (`الروضة`, `العليا`) and no city was given; a name could be a
**district or a street** (`الملك فهد` → «حي الملك فهد أم شارع الملك فهد؟»); or a landmark exists in several places.
It searches directly only on a **single high‑confidence match**, or when the user already gave a city/region/unique
context, or when the catalog + database resolve to one unambiguous place. (A misspelling of a *single* place is **not**
ambiguity — the resolver fixes the spelling.) The filter path doesn’t converse, so for an ambiguous typed place it
searches all matches and shows a notice instead.

### Buy vs Rent routing
`purpose` (buy/rent) is part of the query. The RPC filters the canonical store by `purpose`, so Buy and
Rent are entirely separate result sets. (Gathern, a rent‑only platform, can therefore never appear in Buy.)

### How the app fetches the final listings
1. App calls **`location_search_candidates`** with `purpose`, `cities` (Arabic), `districts` (Arabic),
   optional `platforms`, a per‑platform cap (400) and a total cap (1,500).
2. The RPC returns a **newest‑first, per‑platform‑capped** set of **IDs + Arabic location**.
3. App fetches the **full cards** from the raw tables by ID (price, photos, features, URL…).
4. App **overrides** each card’s location with the Arabic the RPC returned, ranks the set (§8), and shows it.
   The card’s “open” button links to the real source listing (Aqar/Wasalt/…).

---

## 3. Arabic‑first logic

**Arabic is the canonical key for the entire database and UI. Everything stored and shown is Arabic, except
numbers** (`250000`, `120 م²`, `4 غرف`, `2026/06/24`).

- **Why Arabic is canonical.** Users are Saudi and search in Arabic; the catalog’s Arabic names are clean and
  authoritative. Critically, the scrapers’ English normalization is **lossy** — it merges distinct Arabic
  names (e.g. `الأحساء`/`الهفوف` both → “Hofuf”), so English can’t recover them. Arabic is the safe key.
- **How English *input* is handled.** The product is **Arabic‑only input**. If a user types Latin letters,
  the app does **not** translate or search it — it shows «الرجاء كتابة طلبك باللغة العربية عشان نقدر نبحث لك
  بدقة». Numbers (0‑9) never trigger this. The guard sits **above** the resolver, so the internal mapping
  layer is untouched.
- **How Arabic & English raw variants are matched.** Raw data arrives mixed: Aqar in Arabic
  (`حي العليا`), Wasalt in English (`Al-Olaya`). The **maps** convert every raw value to one canonical Arabic
  value (`حي العليا`), so a single Arabic search hits **all** spellings underneath — Arabic and transliterated
  English alike.
- **Why Arabic is trusted and English is only an alias.** The canonical columns the app reads are **Arabic**.
  English survives **only** internally — in the immutable raw tables (audit) and as a matching alias. It is
  never shown to users and never the final stored location.

---

## 4. Location hierarchy — when each field is used

| Field | Role | When USED | When IGNORED |
|---|---|---|---|
| **Region** (منطقة) | Top of the hierarchy (13) | Region search; always derived/shown | — (always present for a placed listing) |
| **City** (مدينة) | Required anchor | Every search; the listing is hidden if the city can’t be resolved | — |
| **District** (حي) | Primary refinement | District search; shown on the card when known (80% of listings) | When unknown → card shows city‑level only |
| **Street name** | Optional detail | Only on an explicit **street** query («شارع …») | Every ordinary location search |
| **Facade / direction** (اتجاه) | Optional detail | Only when the user asks about orientation | Every ordinary search |
| **Landmarks / “near X”** | Recognition aid | Only on a **proximity** query («قرب …», «بجانب …») | Every ordinary search; never the final location |

**Region → City → District is always the primary location layer.** Street, facade, and landmark/proximity are
**optional refinements on top — never a replacement.** Landmarks are a *recognition aid* (they help the system
understand a place name); they are never themselves the stored location.

---

## 5. Street / direction / landmark search

This is the text‑field search, kept deliberately conservative so it fires **only when the user actually asks**.

- **When it activates** (chat free‑text only — the filter picker never triggers it):
  - **Proximity** terms (`مسجد`, `مدرسة`, `حديقة`, `جامعة`, `شاطئ`, …) fire **only** with a clear *near* cue
    (`قرب`, `بجانب`, `يطل`, `near`…). So a place literally called “Park View” never becomes a park search.
  - **Street** names fire **only** on an explicit `شارع` / `طريق` / `street` / `road` marker.
- **Which fields are searched:** the listing’s own `street_name`, `title`, `description`, `direction`
  (facade), `project_name`, plus the district — i.e. **only what the listing itself says**.
- **How it avoids false positives:**
  - The cue‑gating above (no “near” cue → no landmark search).
  - **District‑name guard:** ~31 real districts *are* named after a street (`شارع الملك عبدالله`,
    `الطريق الدائري الغربي`). If the typed term is just part of a **district the user already picked**, the
    location filter handles it and **no** street text‑search is layered on top.
  - If few platforms publish the detail (street/facade/“near” coverage is ~34%), it says so plainly and falls
    back to the area’s listings — it never **invents** that a listing is “near X” or “faces north”.
- **Real street vs district name:** a `شارع X` that is **not** a catalog place (kind = “none”) → genuine street
  → text‑search. A `شارع X` that **is** a known district → treated as a **location**, scoped by the district
  filter, no text‑search.

---

## 6. Data sources & responsibilities

| Layer | What it is | Responsibility |
|---|---|---|
| **GitHub catalog** (`sa-locations.json`) | 13 regions → cities → districts (Arabic + English) | Defines **what places exist**; powers the picker; the dictionary every match is checked against. |
| **Raw platform data** (63 tables) | Listings exactly as scraped (Arabic or English) | The **immutable source of truth** for listing facts (price, photos, URL…). Audit / debug / re‑process only. |
| **Location index + canonical store** | Index = UNION of raw; Canonical = index resolved to Arabic | The **routing + presentation** layer. Converts raw → Arabic, flags unresolved, serves search. Derived; rebuildable. |
| **Agent notes** (`agent_notes` table) | Live AI behaviour rules, read by the edge at runtime | Steers the AI: output Arabic, keep the whole place, ask on ambiguity, never invent. Editable with **no redeploy**. |
| **Maps** (`loc_region_map`/`loc_city_map`/`loc_district_map`) | English↔Arabic + raw‑variant → canonical Arabic | The **dictionary that does the conversion**. Fix a wrong match = one row, then rebuild. |

---

## 7. Validation rules

- **`searchable`** — a listing is searchable **only** if its city resolves to the Arabic catalog. Resolved →
  shown; unresolved → hidden.
- **`location_incomplete` / `city_unresolved`** — when region+city+district are all empty, or the city can’t be
  matched (raw city = `Other`/empty), the row is flagged with a `review_reason` and **excluded** from results.
- **Review queue** — those flagged rows (currently **1,687**) are the to‑do list: real listings whose location
  we couldn’t place. They are **never guessed into a city**; they wait until fixed. (Filter `matched = false` in
  the `listings_arabic_locations` audit table to see them.)
- **Auto refresh** — `pg_cron` job 16 refreshes the index, then the canonical store, **every 4 hours**, so new
  scrapes flow through automatically.
- **Raw tables remain untouched** — all Arabic conversion happens in the **derived** layer. The scrapers keep
  writing raw; the maps re‑resolve on every refresh. A wrong match is fixed by editing a map row, **never** by
  touching raw data.

---

## 8. Result ordering

**Relevance / intent first; diversity is only a natural bonus among equally‑relevant listings — never forced,
never hiding a better listing.** Newest‑first within a relevance tier.

| Scope | Ordering |
|---|---|
| **District search** | Newest first, mixed across platforms (the area is already narrow). |
| **City search** | Newest first, spread across platforms so one source doesn’t sweep the top. |
| **Region search** | Spread across the **different cities** under that region (not just the capital), then platform, then newest. |
| **Saudi‑wide** | Spread across **regions**, then cities, then platforms; shuffled so it varies between runs and spans the Kingdom. |

- **Platform diversity** — results interleave sources (Aqar / Wasalt / …) so the first screen mixes platforms,
  but only among listings of similar relevance. It is **never** forced and never hides a better match.
- **Relevance priority** — a specific search (budget/size given) ranks the closest matches first; a broad
  search treats everything as equally relevant and leans on the spread above.
- **Only ever real listings** — nothing is padded or invented to fill a screen.

---

## 9. Non‑negotiable rules

1. **Raw tables are always the source of truth.**
2. **Arabic scraped locations are trusted.**
3. **English translations are helper aliases only** (internal + audit; never shown, never final).
4. **Never modify raw data.**
5. **Never invent locations.**
6. **Never substitute another location** unless the user explicitly asks for alternatives.
7. **Only display real listings that exist in our database.**

---

## 10. Live statistics _(as of 2026‑06‑24)_

| Metric | Value |
|---|---|
| Total listings indexed | **170,034** |
| **Searchable** (placed on the Arabic map) | **168,347** (99.0%) |
| **Review queue** (unresolved city, hidden) | **1,687** (1.0%) |
| **Buy / Rent split** | **108,243 buy** (64%) / **60,104 rent** (36%) |
| **Platforms** | **32** |
| **Regions** | **13 / 13** |
| **Cities** | **101** |
| **Districts** (distinct Arabic) | **2,136** |
| Listings with an Arabic district | ~134,800 (80%) |
| **Street‑name coverage** | **57,368** (34%) |
| **Direction / facade coverage** | **56,769** (34%) |

**Platforms by volume (top):** aqar 85,532 · wasalt 57,538 · gathern 17,139 · aqarcity 2,012 · mustqr 1,029 ·
dealapp 883 · sanadak 816 · aqarmonthly 753 · eaqartabuk 516 · aqargate 241 … (+ ~20 smaller sources).

**Listings by region:** الرياض 69,626 · مكة المكرمة 41,909 · الشرقية 26,945 · القصيم 7,968 · المدينة المنورة 7,589 ·
عسير 5,226 · جازان 3,301 · حائل 2,784 · تبوك 1,689 · الباحة 532 · الحدود الشمالية 347 · نجران 250 · الجوف 181.

---

## 11. Future milestones

### ✅ Completed (live in production)
- Arabic‑canonical location maps (13 regions, 105 cities, 1,163 districts) + canonical store + indexed RPC (~139ms).
- Arabic‑only user input (English rejected with the Arabic message; numbers exempt).
- Arabic‑only UI (locale locked to Arabic; English UI leaks removed, incl. the picker subtitle).
- Card display: fact‑based Arabic title for every listing; Aqar Arabic descriptions kept, never invented.
- Agent: outputs location in Arabic, keeps the whole place (district + city), normalizes colloquial spellings,
  and **asks** when a district is ambiguous and no city is given.
- Result ordering: region searches spread across their cities; relevance‑first with natural diversity.
- Location‑search audit passed (Region→City→District, English handling, conditional field search, never‑invent).

### ⏳ Pending (optional, ready when wanted)
- **Grow the district map** — convert more of the ~33k English‑district listings to Arabic districts (same
  confident‑match method, run wider) so more listings carry an Arabic district.
- **Picker de‑duplication** — collapse raw spelling variants («الدوحة» vs «حي الدوحة»), normalize the «حي»
  prefix, and hide malformed strings so each logical district shows once.
- **Resolve part of the review queue** — re‑map the 1,687 `Other`/unresolved rows where a real district hints
  at the city.

### ⏸ Parked — P3 (scraper milestone)
- Move the Arabic normalization **into the ~34 scrapers** so Arabic is captured **at ingest** (preserving
  distinctions the English step merges, e.g. الأحساء vs الهفوف), raw kept immutable, flag‑for‑review at source.
- Ingest‑side free‑text: synthesize the Arabic title and keep/skip descriptions at write time.

### 🔧 Optional improvements
- Curated landmark/nickname tables: cross‑check the resolved city has live inventory before committing it.
- A small analytics view over searches (top cities/districts, no‑result searches, unknown locations).
