# Ezhalah — Complete Architecture (Frontend + Backend)

> **Status:** canonical reference, last consolidated **2026-07-06**.
> **Purpose:** one source of truth for how Ezhalah is built — UI structure, filter hierarchy, property
> card, search flow, backend, scraper pipeline, DB rules, matching, locations, type mapping,
> rent-period rules, and every permanent rule. Written so we never re-discover the same facts twice.

---

## 0. How to use this document (governance — READ FIRST)

These rules are set by the product owner and are **permanent**:

1. **The frontend is the source of truth for the app's structure and UX.** Screens, filter hierarchy,
   property-card layout, and search flow as they exist in the frontend code define intended behavior.
2. **The backend supports the frontend. It never changes the user experience unless the owner
   explicitly approves.** Backend/scraper/DB work may fix data, matching, performance, coverage — but
   must not alter what the user sees or how the app behaves without sign-off.
3. **Compare-before-change.** Before starting any feature or fix, check it against this document and the
   permanent rules in §20. **If it would conflict, STOP and tell the owner what conflicts** — do not
   silently change the app to make it fit.
4. **Ask, don't assume.** If you are not 100% certain about any FE/BE behavior, ask the owner first.
5. When something here is verified changed, **update this document in the same PR.**

---

## 1. What Ezhalah is

An **AI-powered, neutral property-search aggregator for Saudi Arabia**. It searches real-estate listings
across many partner platforms and shows them in one place. **It is a search engine, not a marketplace.**

**Hard product rules (never violate):**
- **Neutrality.** Never recommend a property; never say "best/better/good deal/worth it"; never give
  buying or financial advice. Show listings; the user decides.
- **Search only.** No transactions, no owned inventory, no commission.
- **Source fidelity.** Never rewrite, translate, round-trip, or invent source content (titles,
  descriptions, prices, areas, beds). The card shows scraped values verbatim.
- **Gathern is rent-only** — must never appear in Buy results (monthly furnished).
- **Arabic-first / Arabic-only** UI (RTL). English is a disabled latent code path, not user-selectable.
- **Compliance.** REGA FAL licensing + PDPL (Saudi data residency, no selling user data).

---

## 2. Stack, repositories, deploy topology

| Layer | Detail |
|---|---|
| **App** | Expo / React Native (expo-router), **web is the primary target**. TypeScript. Poppins font. |
| **App repo (frontend)** | `/Users/yusufalnashwan/Downloads/design_handoff_ezhalah/ezhalah-app` |
| **Deploy** | Vercel project **`ezhalah-app`** ONLY (`prj_CLp9Bx…`, team enzalah). `ezhalah-app.vercel.app` is the dev/testing source of truth. `ezhalah.com` is connected to the SAME project but is **not** primary until the owner says "launch". Never deploy to any other project. `push ≠ deploy`. |
| **Backend** | **Supabase** project `aannarbkwcymrotzwdbo` — Postgres + PostgREST (RPC) + Edge Functions (Deno) + `pg_cron` + Vault. Region **Tokyo** (PDPL residency is an open question). |
| **Scraper repo** | GitHub **`6ttvrw4fmf-ctrl/ezhalah`**. All scrapers + GitHub Actions workflows live here. |
| **Scraper dispatch** | `pg_cron` → `trigger_gh_workflow(wf)` → GitHub `workflow_dispatch`. **Every workflow is dispatch-only; all cadence is owned by Postgres** (so it is monitorable/pausable from the DB). PAT in Vault (exp 2027-06-22). |
| **AI agent** | Supabase Edge Function named **`agent`** (Gemini 2.5 Flash-Lite primary + Flash fallback, via `GEMINI_MODEL` secret). Runtime behavior tunable via the `agent_notes` DB table (no redeploy). |

**Regression safety (locked #1 priority):** preserve local work (commit/stash) before any risky git op;
never `git reset --hard` a dirty tree; before+after verification on every deploy; on any regression
STOP → restore → fix → continue. Checklist: `ezhalah-app/docs/DEPLOY_REGRESSION_CHECKLIST.md`.

---

## 3. Frontend — navigation & screens

**Shell (`src/app/_layout.tsx`):** a single expo-router `Stack`. Provider tree: `GestureHandlerRootView`
→ `SafeAreaProvider` → `LocaleProvider` → `AppProvider` → `StatusBar` → `Shell`. On web ≥ 900px a
**persistent Sidebar column** renders beside the stack; on mobile/native the sidebar is a tap-to-open
overlay drawer. Layout is `row-reverse` under RTL so the sidebar always pins **physically left** in
Arabic. On web hard-refresh, any deep route (except `/auth`) redirects to Home once (chat/flow state is
in-memory only).

| Route | Screen | Presentation | Role |
|---|---|---|---|
| `index` | **Home / Filter search** | fade | The structured filter search. §4. |
| `agent` | **AI chat + inline results** | none | The one conversational surface; also renders results. §6, §9. |
| `interview` | Guided interview | transparentModal | **DEPRECATED** (see §6.3). |
| `auth` | Sign-in sheet | modal, fade | §7. |
| `settings` | Settings popup | transparentModal | §7. |
| `browser` | In-app listing viewer | modal, slide-up | §7. |
| `about` | About Us | modal, slide-up | Neutrality + REGA/PDPL copy. §7. |
| `support` | Support | modal, slide-up | Contact + response time. §7. |

Root overlays: `<InfoModal/>` (Support/About popups) and `<IntroVideo/>` (first-run intro, logged-out
only, shown once).

---

## 4. Frontend — the Filter Search screen (`src/app/index.tsx`)

The single search state is `query` (a `SearchQuery` in the store). Every control mutates it via
`setQuery`. **Selecting an upstream step cascade-resets all downstream fields.**

### 4.1 Section order (top → bottom, inside the search card)

1. **Deal type** — segmented toggle `Rent / Buy`. Changing it clears price fields.
2. **Location** — floating-label text input + autocomplete dropdown (see §4.3).
3. **Category** — chips `Residential / Commercial` (single; tap again to deselect). Resets group/type/
   detail/beds/area/price on change.
4. **Property group** — chips, shown only after a Category is chosen. A group = **soft/broad intent**.
5. **Property type** — chips, shown only after a group is chosen. **Multi-select** (`query.types[]`).
   A type = **hard/exact filter**. Optional (empty = keep broad group intent).
6. **Refine your search** — shown only when the context allows beds and/or size:
   - **Bedrooms** — chips `any/1/2/3/4/5+`, **multi-select** (`query.contextBedsList[]`).
   - **Area (m²)** — From/To range boxes, shown only when **no** bedroom is selected (beds XOR area).
   - **Price (SAR)** — From/To range boxes, always shown. **HARD filter.**
7. **Rent period** — segmented `Monthly / Yearly`, shown only when Deal = Rent. Maps to
   `query.rentPeriod` (`'monthly'`/`'annual'`, default `annual`). Hidden for Buy.
8. **Search** button → `onSearch()`.

Below the card: a 6-cell grid of rotating example-prompt chips that route to the AI agent.

### 4.2 Canonical filter engine (owner decision 2026-07-06)

- **Canonical = multi-select `query.types[]` + free min/max price & area range boxes.**
- The older parallel system — single-select `query.type` with preset **price-band tabs**
  (`PRICE_BY_TYPE` / `PRICE_BY_BEDROOMS` / `priceTabsFor` in `taxonomy.ts`) and the per-type "Detail"
  step — is **RETIRED / dead legacy**. Do not build on it; it may be removed. `taxonomy.ts
  CATEGORY_TYPES` (flat old list) is likewise superseded by `propertyTypes.ts HIERARCHY`.
- **Canonical property hierarchy = `src/data/propertyTypes.ts` `HIERARCHY`** (2 macros → 8 groups →
  cleaned types). See §16.

### 4.3 Location field rules

- Suggestions from `matchLocations(v)`; the suggestion script follows the **input** script.
- **Arabic-only guard:** Latin-only input → suggestions suppressed, red Arabic hint shown, and English
  never reaches the resolver / never triggers a search.
- Picking a suggestion commits a clean label and may align app locale to the name's script (but the app
  stays Arabic — see §8).

### 4.4 Business rules visible on this screen

- **Room = single bedroom (locked 2026-07-06):** when the sole selected type is `Room`, the bedroom
  chips collapse to just `['1']` and `contextBedsList` locks to `['1']` (strict `bedrooms=1`).
- **Beds XOR area:** picking a bedroom clears area; typing area clears bedrooms.
- **`0` = no limit** for price/area (honest zero).
- **Rent-period toggle** only for Rent.
- Non-blocking Arabic helper notes for price/area (min>max, equal, 0=no-limit, one-sided).

### 4.5 Hand-off to search

`onSearch()`: Arabic-only guard → `ensureLocationIndex()` → `resolveLocation()` → assemble
`q = {…query, location: displayLoc, locationMatch, districts}` → `router.push('/agent',
{filter: JSON.stringify(q)})`. There is **no separate results screen** — Filter funnels into the agent
chat, which renders results inline. (Deliberate; single search engine — see §9.)

---

## 5. Frontend — the Property Card (`src/components/ResultCard.tsx`) — SOURCE OF TRUTH

**The card is locked. Never modify what it shows. It displays scraped values verbatim.** Fix data
problems via backend mapping only (see §16), never by editing the card.

**Layout — three sections (side-by-side on web ≥ 820px, stacked on phone):**
- **LEFT (photo):** hero photo with graceful multi-URL fallback → "no photo" placeholder; rank badge
  (`#N`); bottom source strip `SOURCE · host` with an open-in-new icon.
- **MIDDLE (info):** type + deal line (`{cleanType} for Sale/Rent`); title
  (`district, city` or `city`); city + "Saudi Arabia" + optional region chip (from URL); **price**
  (`tPrice`); optional **RNPL banner** (EJARI×ريلز, or أقساط/Aqsat for Al Hoshan) with "from SAR X/mo";
  Arabic description **only if the source text is real Arabic** (never translated/invented); a stats row
  (beds, baths, area m², property type, added-date — each drops out gracefully when absent).
- **RIGHT (features / attribution):** "Hosted on {platform}" badge + hint; a 2-column features grid
  (parking, maid room, elevator, master bedrooms, kitchen, halls, balcony, laundry, private entrance,
  A/C, fiber, water, electricity, sanitation) with "+N More Features" expander (6 visible);
  **Wasalt-only "Additional Information" panel** (usage/age/facade/street/plan no./land no., first 4 +
  "See more"). **Aqar rows have `additional_info = null` → the panel is hidden and the Aqar card is
  unchanged.**

**Card behaviors:** cards pop in staggered (`PopIn`). English-UI place names get client-side
transliteration for display only (Arabic UI passes through). `listed` date is cleaned to `DD/MM/YYYY`
or a localized "recently"; junk scraped strings are suppressed. Tapping the card opens the real source
listing (§7 browser) and fires `trackOpen` (CPC click tracking). ~33 partner platforms have logos
(`SourceBadge`); unknown source falls back to the Aqar logo.

---

## 6. Frontend — the AI agent

### 6.1 `src/app/agent.tsx` — chat + inline results

- One conversational surface. Message roles: `user`, `agent` (reply / clarify with answer chips),
  `results` (slogan + summary + intro + sort line + cards), `status` (thinking/searching, morphed in
  place).
- **Typed message** → `send()`: guest-gate check (see §7.2) → refine intercept → `recordChatTurn` →
  locale follows message language (per message, not per keystroke) → build last-10-turn history (results
  restated as numbered facts so "the 2nd one"/"cheapest" resolve without inventing) → `respond(v,…)` →
  branch on `AgentTurn.kind` (`interview` | `listings` | `message`).
- **Filter/interview** → a `SearchQuery` is passed directly and typed out as a natural-language bubble.
- **Both** paths call **`runQuery()`** from the store — the single search engine. `agent.tsx` never
  queries the DB itself.
- **Backend call:** `respond()` (in `data/agent.ts`) calls Edge Function `agent` via
  `supabase.functions.invoke('agent', { text, locale, loggedIn, order, history, landmarkHint? })`.
  Response `AgentTurn = {kind:'listings', reply, query} | {kind:'message', reply} | {kind:'interview'}`.
  On failure → bundled **offline heuristic** fallback (`parseQuery`, city/type catalogs). Actual
  listings always come from `runQuery`, not the edge function.
- **Results rendering order (strict):** slogan → summary → intro → "Ranked by closest match" → cards.
  `FIRST_PAGE = 25`, "Show all results" up to 200. Zero results → neutral suggestion, no cards.
- **Greeting:** brand word only (`ازهله`), types itself out on a fresh empty chat; example-prompt chips
  appear after (guests only), gone once a search happens.

### 6.2 Agent behavior rules (neutrality / compliance)

Never recommends/ranks/says "best"; advice queries return a decline. Neutral results copy ("I found a
few properties…"). **Max 2 clarifying questions**, then search with whatever is known. **Never invent a
location** (bare district in multiple cities, twin city, region-or-city same name, geography/proximity
cue with no city → ask, never guess; a city the user never typed is stripped). Naming **Gathern forces
Rent + monthly**. Guests are search-first; logged-in users get conversational help and search on an
explicit order. Distress input → supportive non-real-estate reply. **Authoritative model behavior lives
in the edge `agent` function + `agent_notes` DB table**, not in the client (the client only backstops
deterministically).

### 6.3 `src/app/interview.tsx` — guided interview — **DEPRECATED**

Owner decision 2026-07-06: **legacy handoff artifact, not canonical.** It uses English-only labels and
an English city list (`INTERVIEW_CITIES`, old `taxonomy CATEGORY_TYPES`), inconsistent with the
Arabic-first filter/agent. Do not build on it or treat it as intended architecture. (It still routes to
`/agent` with a built `SearchQuery` if reached.)

---

## 7. Frontend — auth, settings, sidebar, browser

### 7.1 Auth (`src/app/auth.tsx`)

**Ships all three methods (owner decision 2026-07-06):**
- **Phone → WhatsApp OTP** (primary): country picker → `sendPhoneOtp(e164)` → 6-digit code "on
  WhatsApp" → `verifyPhoneOtp`.
- **Google OAuth** — `signInWithProvider('google')`.
- **Apple** — `signInWithProvider('apple')` + Face ID path.

Gated by `isBackendLive` (`@/lib/auth`, Supabase). When the backend/provider isn't enabled it shows
self-contained visual **mocks** (fake Google/Apple accounts, timed Face ID) — that is the pre-backend
preview, not the product. `pendingMessage` replays across the auth round-trip.

### 7.2 Guest gating (owner decision 2026-07-06)

**Guests are unlimited — `gated` is hardcoded `false` and that is intended.** The only difference for
guests is their history isn't persisted. (This supersedes PRD §9's "first search free then sign-in".)

### 7.3 Settings (`src/app/settings.tsx`)

Centered popup. Exposes: **Display Name** (inline edit, bilingual auto-synced), **Account** row
(phone → Change via WhatsApp-OTP re-verify; google/apple → email locked), **Logged-in device** (inferred
from method, not real detection), **Log out**, **Delete my account** (wipes history/chat/storage). No
language / units / currency / theme toggle (Arabic-only, SAR-only).

### 7.4 Sidebar (`src/components/Sidebar.tsx`)

Docked column (web ≥ 900px) or slide-in drawer (mobile), pinned LTR in both languages. Signed-in: brand,
**New Chat** (→ Filter Home, `fresh` param), **search/chat history** grouped **Starred** (forever) +
**Recent** (60 days) with per-row Star/Delete and active-chat highlight, then Settings / Support / About
/ profile row. Guest: brand + Sign up / Log in + nav links. History rows replay a past search's filter
into `/agent`.

### 7.5 In-app browser (`src/app/browser.tsx`)

Opens the listing at its **real source**, in-app:
- **Web:** `<iframe>` → `/api/proxy?url=…` (server proxy fetches the partner page and strips
  `x-frame-options` so it embeds); dimmed modal card, spinner until load, 12s timeout → fallback
  (Reload / "Open on source" new tab); `sandbox` blocks framebusting.
- **Native:** hands off to Chrome Custom Tab / Safari View Controller (`expo-web-browser`).
`trackOpen(listing)` fires on open (CPC). Listing resolved by `id` via `findListing`.
> ⚠️ Verify the proxy/iframe path works for **all** partners, not just Aqar (the copy/localization is
> Aqar-centric). A prior note claimed "iframe impossible" — the code now uses proxy+iframe on web;
> reconcile before relying on it broadly.

---

## 8. Frontend — state, i18n, design tokens

**State (`src/store.tsx`, `useApp()`):** `query` (+ `setQuery`/`resetQuery`/`runQuery`); data source
constant `'supabase'` (no whole-table load — each search fetches only its subset); `user` (+ auth
methods, Supabase session adopt/`onAuthStateChange`); `searchCount`, `pendingMessage`, **`gated=false`**;
`history` (max 50, **per-account** keyed by `sub`, `history:<sub>` / `history:guest`); `trackOpen` /
`findListing`; modals; intro. Persistence: AsyncStorage + synchronous `localStorage` on web so a refresh
can't lose stars/history.

**i18n (`src/i18n.tsx`):** EN-key → AR dictionary. **Arabic-only in production** — `readSavedLocale()`
forces `'ar'` and deletes any saved `'en'`; `setLocale` early-returns unless `'ar'`. English is a latent
disabled path. Default `'ar'` at module load (first paint RTL). `applyDirection` sets `dir/lang` on web,
`I18nManager` on native. Value-localizers (`tPlace`, `tPrice`, `tDetailOption`, …) translate words but
keep Western digits. `isLatinOnlyInput` + `ARABIC_ONLY_MSG` reject English search input.

**Design tokens (`src/theme/tokens.ts`) — never hard-code hex/sizes in components:**
- primary `#2f7247`, dark `#1d4a37`, tint `#eef6f0`, ink `#15201b`, body `#34403a`, muted `#7b8a82`,
  paper `#fbfbfa`, surface `#ffffff`, whatsApp `#25d366`, accentLeaf `#2fb672`.
- radius chip 12 / card 16 / field 13 / sheet 22 / pill 999. space base 8 / screenTop 56 / screenSide 18.
- Font **Poppins** (400/500/600/700). Soft green-tinted `cardShadow`. Per-platform brand colors.

---

## 9. Search flow (end-to-end)

```
Filter screen (index.tsx)  ─┐
                            ├─► SearchQuery ─► store.runQuery(q)
Agent chat (agent.tsx) ─────┘        │
   └─ respond() ─► Edge 'agent' ─► SearchQuery (or offline heuristic)
                                     │
runQuery(q):  normalize (Room=1) ─► resolveLocation()/ensureLocationIndex() (if not pre-resolved)
           ─► fetchListingsForQuery(q)  [city + type + deal pushed server-side]
                 └─► PostgREST RPC  location_search_candidates_ar  (24 params)
                        └─► reads table  search_listings_ar  (denormalized Arabic search table)
           ─► buildPools(rows) ─► runSearch(q, pools)  [ranking, §10]
           ─► (if record) bump searchCount + record history
   Card render ─► findListing(id) fetches the full row from the raw per-platform table on open
```

- **Backend errors return `null`** (never a silent empty) so the UI can show "loading, try again"
  rather than a false "no results".
- **Spelling-insensitive recall:** the RPC matches `normalize_ar(city_ar) OR city_id`. `normalize_ar`
  folds hamza (أإآٱ→ا), ة→ه, ى→ي, and drops tatweel/marks.

---

## 10. Matching & ranking logic

- **Filter combination:** OR within a field (multi-select types, multi-select beds), **AND across
  fields** (deal AND type AND location AND price AND beds…).
- **Ranking priority (locked):** exact match → **platform diversity** → **type diversity** (type
  diversity only when 2+ types are selected).
- **Bedrooms:** strict exact client-side filter (do not move to DB).
- **Price/Area:** HARD filters; `0` = no limit; honest zero (valid inputs + 0 matches → show zero,
  never substitute).
- **Progressive reveal:** results reveal in batches (page of 25, up to 200).
- **Unresolved location** → included in Saudi-wide search only; excluded when a specific
  region/city/district is selected.

---

## 11. Backend — data platform & topology

- **Postgres** (Supabase) holds **raw per-platform listing tables** (67+ tables; e.g.
  `aqar_residential_listings`, `aqar_commercial_listings`, `wasalt_residential_listings`,
  `wasalt_commercial_listings`, `gathern_*`, `aqarmonthly_*`, and ~30 small-source tables). **Raw tables
  are the recoverable truth and are never rewritten** — only mapped for search.
- **Card fetch** reads a single full row from the raw table by `id` (`findListing`: session cache →
  single-row fetch).
- **Search** reads a **denormalized Arabic search table `search_listings_ar`** (all-Arabic: بيع/إيجار,
  شقة/فيلا, شهري/سنوي) via RPC `location_search_candidates_ar` — this replaced per-query view evaluation
  and cut broad search from ~27s to ~1s.
- **Commercial** listings live in separate `*_commercial` tables; `tableFor`/`isCommercialQuery` route by
  type.

---

## 12. Backend — scraper pipeline & dispatch

- **Dispatch:** `pg_cron` job → `trigger_gh_workflow('<workflow>.yml')` → GitHub `workflow_dispatch` in
  `6ttvrw4fmf-ctrl/ezhalah`. All cadence owned by Postgres.
- **Sources:** Aqar (res + com; deep page-range batching), Wasalt (res + com; Saudi residential proxy for
  cloud, enrichment via home IP), **Gathern (rent-only monthly furnished ~16k)**, **aqarmonthly** (Aqar
  DailyRenting GraphQL ~3.8k monthly furnished), Muktamel (weekly), and ~30 small sources via one matrix
  workflow `small-sources-sync.yml` (add a platform = one matrix line).
- **Retired platforms:** **toor** — retired 2026-07-06 (owner-approved). Host `www.toor.ooo` IP-blocks
  datacenter IPs *and* the Saudi residential proxy (every fetch `exc:Timeout`, 0 rows for weeks).
  Removed from the `small-sources-sync.yml` matrix (PR #33) → no longer scheduled/dispatched.
  **Historical toor rows are KEPT** (not deleted); `scrapers/toor/` and the ResultCard toor logo stay so
  existing listings still render. DB-side monitoring removal (drop from `platform_cadence`, clear
  freshness alerts, mark retired) + post-retire verification were pending a Supabase-connector outage at
  retirement time — see the owner-decisions ledger. **Do not re-add without owner approval.**
  **alnokhba** — deprecated 2026-07-14. Source domain `alnokhba-services.com` lapsed into a
  domain-parking page: `curl` to `/properties` and `/` both return HTTP 200, but the body is a
  third-party parking placeholder (`assets.abovedomains.com/javascript/forsale.min.js`), not the
  site's listing markup. `scrape_runs` shows the last real pull was 2026-07-07 (`rows_seen=5`);
  every daily run 2026-07-08 → 2026-07-14 (7 runs) returned `ok=true, rows_seen=0` — reachable,
  but nothing to scrape, not a scraper bug. Removed from the `small-sources-sync.yml` matrix.
  Recorded in `deprecated_platforms` / `platforms_deprecated_status` (`still_in_search=false`).
  **Historical alnokhba rows are KEPT** (not deleted) — 1 row was already `active=false` before
  this change; the other 5 active rows were backed up to
  `alnokhba_residential_listings_backup_20260714` and set `active=false` by exact id (never a
  blanket `WHERE`). `scrapers/alnokhba/` stays so historical listings keep their scraper
  provenance. **Do not re-add without confirming the domain serves real listings again.**
- **Ingestion sanitize (`scrapers/common/db.py`):** `_sanitize_price()` / `_sanitize_ints()` coerce
  numeric strings → int and **NULL non-numeric/bool/nan/junk** for every int column (fix 2026-07-06,
  PR #29 — a non-numeric `property_age="New"` previously failed the smallint cast and dropped the whole
  batch). **Raw value preserved** in `additional_info` / `source_capture`.
- **Capture contract:** capture the complete source once; never re-scrape for a new field; no broker PII.
  New scrapers must capture Arabic natively.
- **Proxy note:** partners that block GitHub datacenter IPs (Wasalt, Souq24, **Toor** — fixed 2026-07-06
  PR #32) route through the Saudi residential proxy (`WASALT_PROXY_URL` in the workflow env).

---

## 13. Backend — search / index / location layer

| Job | pg_cron | What |
|---|---|---|
| `sync-search-listings-ar` | jobid 28, hourly `:15` | Rebuilds `search_listings_ar` from resolver output (≤1h lag). |
| `resolve-aqar-locations` | jobid 25, every 10 min | Aqar location resolver. |
| `refresh_listing_native_location_v1` / `active_listing_ids_v2` | jobid 17, hourly | Location MVs (filter-before-cap). |
| `refresh-location-index` | jobid 16, daily `02:00` | Refreshes `listing_location_index` + `listing_location_canonical_mv` **only** — it does NOT refresh `location_index` (verified 2026-07-14: the job's live `cron.job.command` never mentions `location_index`; a full regex scan of every `cron.job.command` for `location_index` not preceded by `listing_` returns zero rows). |

**`location_index` is retired / no longer read by the app (as of 2026-07-14).** It was refreshed by
no job at all — `pg_stat_user_tables.last_autoanalyze` sat frozen at 2026-06-23 21:35 UTC while this
table's name coincidentally matched jobid 16's, which actually refreshes the two matviews above.
Autocomplete (`ensureLocationIndex()` in `locations.ts`) now reads `location_index_live` — a plain
view (see `supabase/migrations/20260714_location_index_live_view.sql`) over `listing_location_canonical_mv`,
which jobid 16 keeps current, so no new cron job was needed. `location_index` itself can be dropped in
a follow-up once this repoint has been live for a safety window.

- `search_listings_ar.city_ar` = raw scraped spelling (feeds card display via the RPC); `city_id` =
  canonical. **After any RPC DDL run `NOTIFY pgrst,'reload schema'`** or search returns null (no cards).
- **Location canonicalization = Option B (owner decision 2026-07-06):** canonicalize for search, filters,
  grouping, and autocomplete **only** — **never change the property-card displayed value** (cards keep
  the source spelling exactly). Implemented as `normLocKey()` in `remote.ts`, applied only to
  city/region/district **grouping** keys (mirrors DB `normalize_ar`); the card renders the separate raw
  `r.l.city`. No RPC change, no backfill, no card change.

---

## 14. Backend — listing lifecycle (inactivation, recovery, purge)

There are **several independent mechanisms**. The governing rule is **accuracy over cleanup — never
wrongly remove a real listing.**

| Mechanism | Where / cron | Behavior |
|---|---|---|
| **Ingestion sanitize** | on every upsert | Bad int field → NULL (not a dropped row). §12. |
| **Aqar liveness** | `aqar-liveness.yml`, jobid 6 daily `01:00` | 3-strike full-page GET; confirmed-dead only. |
| **Wasalt hybrid liveness** | `wasalt-liveness-hybrid.yml`, **jobid 32 daily `03:30`** (NEW 2026-07-06) | HEAD first; escalate to GET-confirm only when HEAD ≠ 200; **live iff GET 200 AND `propertyDetailsV3` present**; dead on 404/410 or 200-without-pdv; timeout/5xx/403 → **failed, untouched**. `missing_count += 1` on confirmed-dead; **inactive only at the 3rd consecutive confirmed-dead sweep**. **Collapse guard:** if >30% of a shard is dead, strike nothing. Cards untouched (only the `active` flag). 8-shard keyset sweep; heartbeat in `wasalt_liveness_runs`. |
| **`prune_unseen()`** | small sources | 3-strike + collapse guard (a collapsed scrape can't wipe a platform). |
| **`mark_stale_listings_inactive(7)`** | jobid 13 daily `04:00` | Time-based; **EXCLUDES aqar_residential + wasalt**. |
| **`auto_recover_false_inactive()`** | jobid 30 daily `05:20` | Recovers rows that are `active=false` AND `missing_count=0` AND recently seen AND price sane. |
| **Reactivate-on-seen** | on scrape | A row seen again resets `missing_count` and reactivates. |
| **`purge_inactive_listings()`** | jobid 11 Friday `22:00` | Hard-deletes confirmed-dead inactive rows (with age guard). **ACTIVE.** |

---

## 15. Location hierarchy & resolution

- **Hierarchy:** **Region → City → District.** Resolve any town/district **up** to its city+region.
  99-city → 13-region map. Strict `R→C/T→D`.
- **DB is the sole truth.** Picker/autocomplete shows only the clean catalog. Never infer or invent a
  place.
- **Exact-location-only:** a valid place with 0 listings returns an **honest zero** — never substitute a
  nearby place. Ambiguity → search all + notice (filter) / ask city (agent).
- **Unresolved-location** listings appear in Saudi-wide search only.
- Internal north-star key = Saudi catalog IDs (`docs/LOCATION_SYSTEM.md`). Landmarks in a Supabase
  `landmarks` table (~6.5k), client `ensureLandmarks()` cache.

---

## 16. Property-type mapping

- **Canonical taxonomy:** `src/data/propertyTypes.ts` `HIERARCHY` (2 macros → 8 groups → cleaned types),
  with `RAW_TO_CLEAN`, `CLEAN_TO_QUERY`, `extraTables`.
- **Group = soft/broad intent; type = hard/exact filter.**
- **Mapping is backend-only and invisible:** map raw scraped `property_type` → an **existing** clean
  filter option. Merge duplicates/synonyms to the same filter. **Never** modify the card, remove/redesign
  filter UI, or guess — if unsure, **show the duplicates to the owner first**.
- Palace folds into Villa at the normalization layer only (raw DB untouched).
- Long-tail raw types are mapped to existing filters (reachability ~181,369/181,370). Open hierarchy
  questions remain (see §21).
- **Coverage is enforced, not assumed:** `scripts/verify-taxonomy.ts` (deploy-blocking, §19.1) fails the
  build if any live `type_ar` is unmapped/unreachable — so a scraper adding a new type can't silently
  slip through. It also generates the `known_type_ar` allowlist that the novel-type alarm (jobid 33) uses.

---

## 17. Rent-period rules

- `query.rentPeriod` ∈ `{'monthly','annual'}`, default `annual`; the toggle shows only for Rent.
- **"per month" = true monthly rentals only** (the `rent_period` column). Enforced two-layer: RPC
  predicate (`p_rent_period`) + `remote.ts` (`rentPeriodParam` / `keptFiltersReq`). Monthly-only sources
  = **gathern + aqarmonthly**; rows with mixed/null periods are excluded from a monthly search.
- **Gathern price is already annualized (`price_annual`)** — do not ×12 it. (Monthly price scaling vs
  Gathern's pre-annualized price is a tracked open item, §21.)
- **Room = 1 bedroom** strict (see §4.4).

---

## 18. Database rules & invariants

- **Arabic is canonical** in DB and UI (except numbers). English input → one-time conversion to canonical
  Arabic via catalog (fallback only). Nothing stored in English.
- **Raw capture = recoverable truth**; corrections require DB proof that our parser broke it (the area
  backfill is the precedent). Source content may *display* as published even if English; system/filter
  values stay Arabic.
- **Stored value = filter value = card value** for every kept field (the card must match the filters).
- After any RPC/DDL change: `NOTIFY pgrst,'reload schema'`.
- Deploys are `gitDirty` (committed ≠ deployed) — verify the deployed bundle, not just the commit.

---

## 19. Monitoring & health

| Job | pg_cron | What |
|---|---|---|
| `scraper-freshness-check` | jobid 31, every 6h | `check_scraper_freshness()` vs `platform_cadence`; writes `scraper_freshness_alerts`. Metric = `greatest(max(scraped_at), max(last_seen_at))` (NOT `scraped_at` alone — that only tracks new inserts). |
| `crawl-stats-hourly` | jobid 24, hourly `:50` | `capture_crawl_stats()` snapshot-diff. |
| `location-selftest-hourly` | jobid 29, hourly `:45` | `run_location_selftest()`. |
| `novel-type-alarm` | jobid 33 | `detect_novel_property_types()` — alarms (`> 0`) on any scraped type the clean-type chain can't place. **Fixed 2026-07-09** to validate the ARABIC chain (`type_ar` via `type_label_ar` → `known_type_ar`) on both the searchable and raw surfaces, not just raw English vs `known_property_types`. `known_type_ar` is generated from `propertyTypes.ts` (see below). Source: `supabase/migrations/20260709_novel_type_alarm_arabic_chain.sql` + `sql/known_type_ar.generated.sql` (owner-applied). |

### 19.0 Dashboard-first monitoring contract (owner directive 2026-07-09)

All monitoring state + logic live in Postgres as a stable read interface — `ops_alerts_v1` (unified
alert view), `ops_health_snapshot()` (one-call health jsonb), `ops_expected_jobs` (cron meta-monitor
registry). The future backend admin dashboard consumes these directly; notification channels (the
`ops-digest.yml` GitHub-issue digest today) are thin, disposable adapters with zero logic. **Read
`docs/OPS_MONITORING.md` before adding any monitoring/alerting.** Source:
`supabase/migrations/20260709_ops_monitoring_core.sql` (branch-tested; owner-applied).

### 19.1 Search-correctness tripwires (build-time, deploy-blocking — added 2026-07-09)

Three invariants were "correct by manual maintenance" with no automated guard. They now fail the build
(`vercel.json` → `npm run verify`) via the anon REST path, so a regression can't ship. Each is proven both
positively (passes today) and negatively (a simulated break fails it).

| Tripwire | File | Asserts |
|---|---|---|
| Taxonomy coverage | `scripts/verify-taxonomy.ts` | every live `search_listings_ar.type_ar` maps to exactly one clean type (except the documented «عمارة»/Building ambiguity resolved by source-table kind); any orphan (unmapped → unreachable) blocks deploy. `--emit-sql` regenerates `sql/known_type_ar.generated.sql` — this is the wire to the novel-type alarm. |
| Gathern rent-only (§20.8) | `scripts/verify-gathern-rent-only.ts` | 3 layers: (1) DATA — 0 gathern/aqarmonthly rows tagged `deal_ar='بيع'`; (2) RPC — a Buy search pointed at those tables returns 0 (with a Rent-monthly positive control); (3) CODE — `RES_TABLES`/`COM_TABLES` exclude them and `resTables()`/`tablesFor()` only add them under the monthly-rent gate. |

**Note:** `scripts/verify-locations.mjs` (the older location tripwire) is currently NOT wired into the
build — it fails on a pre-existing `PGRST203` overload ambiguity for `location_search_candidates_ar`
(minimal-param sentinel calls can't resolve since the RPC gained a second signature). Fix belongs to the
search-RPC workstream; re-wire it into `npm run verify` once the overload is disambiguated.

**Scraper visibility rule (2026-07-06):** a green cron/workflow is **not** proof of data. Runs must fail
loudly — a scraper that fetched 0 rows when it had URLs exits non-zero and logs per-URL status (fixed for
toor). Freshness monitoring closes the "cron succeeded but wrote nothing" gap.

---

## 20. Permanent rules (the non-negotiables)

1. **Frontend = source of truth; backend supports it; never change UX without explicit owner approval.**
   Compare every change against this doc; if it conflicts, STOP and tell the owner. Ask if <100% certain.
2. **Search engine, not a marketplace.** Neutral, no transactions/inventory/commission/advice; never
   "best/better/deal".
3. **Aggregator fidelity.** Never rewrite/translate/invent source content. Card shows raw scraped values.
4. **Property card is locked.** Fix data via backend mapping only; never edit card contents; show
   duplicates to the owner rather than guess.
5. **Arabic is canonical** (DB + UI, except numbers). Arabic-only product; English is disabled latent
   code. New scrapers capture Arabic natively.
6. **Location:** DB is sole truth; strict Region→City→District; exact-location-only (honest zero); never
   invent/substitute a place.
7. **Type mapping:** raw → existing clean filter, backend-only and invisible; never remove/redesign
   filter UI.
8. **Gathern = rent-only monthly.** Never in Buy results; price already annualized.
9. **Lifecycle:** accuracy over cleanup — never wrongly remove a real listing; confirmed-dead + multi-
   strike + collapse guards only.
10. **Regression prevention (#1 ops rule):** preserve work before risky git ops; never `git reset --hard`
    a dirty tree; before+after verify every deploy; deploy only to project `ezhalah-app`.
11. **Compliance:** REGA FAL + PDPL (Saudi residency, no selling user data).

---

## 21. Open questions / decisions still pending

- **Location canonicalization residue** (not yet decided; do not touch without owner answer): composite
  labels (e.g. `امارة مكة-الطائف` mis-resolved), catalog duplicates (الهفوف, فرسان each with two
  city_ids), hamza-less catalog spellings (`ابها`, `الاحساء`), Souq24 exact-join NULLs. Search recall is
  already spelling-insensitive; these are display/grouping cosmetics only.
- **Property-type hierarchy details:** whether `أرض زراعية` (agricultural land) and `أرض` (generic land)
  should be their own filter buttons; Bank / Telecom Tower grouping. (`مكاتب مشتركة` = shared offices is
  currently the only unreachable raw type — an Office row misfiled in the residential table; ask owner.)
- **Rent scaling:** monthly price ×12 handling vs Gathern's pre-annualized `price_annual`.
- **PRD §13 business items:** revenue model (CPC-first decided), **REGA license number** (`XXXXXXXX`
  placeholder in About/Settings — needs the real number), signed partner data agreements, PDPL retention
  windows, Tokyo vs Saudi hosting region.
- **In-app browser proxy** proven for all partners (currently Aqar-centric); reconcile the "iframe
  impossible" note.

---

## 22. Change-management checklist (before any feature/fix)

1. Read the relevant section(s) above + the permanent rules (§20).
2. Does the change alter what the user sees or how the app behaves? → **owner approval required.**
3. Does it touch the property card contents? → **not allowed** (backend mapping instead).
4. Does it conflict with any permanent rule or a locked decision? → **STOP, tell the owner.**
5. Backend change? Preserve work, verify before+after, deploy only to `ezhalah-app`, `NOTIFY pgrst` after
   RPC/DDL.
6. Update **this document** in the same PR when a fact here changes.
