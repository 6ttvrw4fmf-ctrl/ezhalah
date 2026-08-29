# Ezhalah — Complete Architecture (Frontend + Backend)

> **Status:** canonical reference, last consolidated **2026-08-10**.
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
| **AI agent** | Supabase Edge Function named **`agent`** (DeepSeek `deepseek-v4-flash`, via `DEEPSEEK_MODEL` secret; sole provider since 2026-08-28 — Gemini removed as a clean cutover). Runtime behavior tunable via the `agent_notes` DB table (no redeploy). |

**Why Expo/React Native, not native SwiftUI (owner decision 2026-06-09):** the owner first said "decide
for me" (→ SwiftUI), then pivoted: wanted web + iPhone + Android from one codebase, live-preview while
building, and GitHub + Supabase + Vercel wired up. Expo/RN was chosen to satisfy cross-platform + live
preview in one codebase; an earlier SwiftUI build under `Ezhalah/` (design-handoff repo root) is
superseded/abandoned, kept on disk only. Don't re-ask this or re-litigate it.

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
| `interview` | Guided interview | transparentModal | Live, on-demand (see §6.3). |
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

### 6.3 `src/app/interview.tsx` — guided interview — **LIVE, on-demand (label corrected 2026-07-06)**

Not dead code, not onboarding. It's a **live modal reachable on demand**: the AI agent routes to it
whenever the user says something matching `INTERVIEW_RE` (agent.ts) — "ask me questions" / "guide me" /
"interview me" / "walk me through" — via `agent.tsx: router.push('/interview')`; the edge function can
also return `kind:'interview'`. It routes back to `/agent` with a built `SearchQuery` when finished.
It is built on **legacy English-only foundations** (English labels, `INTERVIEW_CITIES`, old `taxonomy
CATEGORY_TYPES`) — inconsistent with the Arabic-first filter/agent, but not unreachable or inert.
**Owner decision 2026-07-06: leave as-is for now** — do not rework, disable, or delete until the owner
rules on keep-as-is vs. rework-onto-canonical-Arabic-taxonomy vs. disable-the-trigger.

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

### 7.1b Google One Tap — who sees it (owner rule 2026-08-19, PERMANENT)

**"A not-signed-in user should ALWAYS get this popup from Google no matter what — even if he signed up
with an account and then deleted it. Unless he signed in through Google, or Apple when we activate it,
or his phone number if we activate it."**

The ONLY thing that may suppress the prompt on Ezhalah's side is a **real, server-validated session**
(`supabase.auth.getUser()`). Everything else prompts: never signed up, signed out, **account deleted**,
revoked token, expired session, or a token that still parses locally. The check is deliberately
**provider-agnostic** — it asks "is there a valid session", never "which method" — so Apple and phone
OTP are covered automatically the moment they are activated, with no change to `GoogleOneTap.tsx`.

Six separate bugs had each broken this (all fixed 2026-08-18, PRs #773/#776/#780/#781/#782/#783); the
worst called `cancel()` on every page load whenever a stale token was present, which Google counts as a
user dismissal and which escalates its 2h→1d→7d→30d cooldown until the prompt stops appearing at all.
Full account: project memory `google-one-tap-six-causes-2026-08-18`. Barrier:
`scripts/verify-google-one-tap.ts` (every clause pinned and mutation-tested).

**Not ours to override, and never to be claimed as fixed:** Google itself suppresses One Tap when the
browser has no Google session (so automated/incognito browsers always report `skipped`), during its
dismissal cooldowns, on opt-out, and under some privacy/third-party-cookie settings.

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
**New Chat** (→ Filter Home, `fresh` param), **search/chat history** grouped **المفضلة/Favorites**
(starred, forever) + **Recent** (60 days) with per-row Star/Delete and active-chat highlight, then
Settings / Support / About / profile row. Guest: brand + Sign up / Log in + nav links. Every history
row opens through the transcript-restore path (§7.4b).

**Drag-to-Favorites (owner 2026-08-25).** Carrying a Recent row up past the top of its bucket (>0.65
rows beyond the edge — `dragCrossIntent`/`applyStarMove` in `src/lib/sidebarReorder.ts`) stars it;
carrying a Starred row down past its bucket bottom unstars. At-the-edge drops stay position-only
reorders; an empty Favorites section renders its header as a drop target during a drag and the target
section glows while crossing. This deliberately supersedes the 2026-08-24 "drag never changes Starred"
rule for this one gesture; the ⋯-menu Star stays the tap path. Barrier:
`scripts/verify-sidebar-drag-star.ts` (pure rules executed + wiring pinned).

### 7.4b Full-conversation persistence (owner 2026-08-25, PERMANENT — «like ChatGPT»)

**A chat is the CONVERSATION, not the query.** Returning to a saved chat renders EXACTLY the
conversation the user left — every bubble, every results turn with the cards they had revealed
(«عرض المزيد» pages included), every Advanced Filter round's receipt and the cumulative pills — and it
survives refresh, browser close, and logging back in on any device. Not a reconstruction: the
transcript IS the rendered `msgs` state, captured after each settled turn (`serializeChat`,
`src/lib/chatTranscript.ts`) and restored verbatim (`openSaved` in `agent.tsx`); live actions keep
operating on the restored turns' own embedded queries and paging state.

- **Conversation identity:** `agent.tsx` owns `chatIdRef`; every recorded turn passes it and
  `recordHistory(q, result, chatId)` updates that one entry. Query-dedupe applies only to
  transcript-less legacy entries — a chat holding a conversation is never overwritten by a lookalike
  search (a repeat starts its own new chat, exactly like ChatGPT). Before this, each AF round's
  narrowed query minted a separate sidebar entry and the conversation was scattered/lost.
- **Storage tiers:** memory (all chats, in-session) → localStorage (transcripts on the
  `LOCAL_TRANSCRIPT_ENTRIES` most recently active chats, pruned only at the serialization boundary) →
  **`public.user_chats`** (all chats: `meta` jsonb + `transcript` jsonb, RLS `auth.uid()`, FK
  `auth.users ON DELETE CASCADE` so account deletion wipes conversations — PDPL). Pull merges metas
  after sign-in (newer per-entry stamp wins); push is debounced write-through; transcripts hydrate
  lazily on open (`hydrateTranscript`). Guests stay session-only (owner 2026-08-20, unchanged).
- Barrier: `scripts/verify-chat-persistence.ts` (pure contract executed + identity + sync + RLS
  pins, mutation-proven). Live proof: `scripts/verify-chat-persistence-live.mjs`.

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
`history` (max 50, **per-account** keyed by `sub`, `history:<sub>`); `trackOpen` /
`findListing`; modals; intro. Persistence: AsyncStorage + synchronous `localStorage` on web so a refresh
can't lose stars/history.

**Sidebar history — account-aware persistence (owner, 2026-08-20).** Signed-in only: a completed search
is saved under `history:<sub>`, survives refresh, and reopening restores the exact state (Normal Filter,
deal, period, city/district, type/group, price/area/bedrooms, Advanced Filter answers) from the stored
`query` + `snapshot`. Signed OUT nothing is persisted at all — **no `history:guest` bucket is written,
and any legacy one is purged** — so a refresh returns an anonymous visitor to a fresh start.
`historyLoadedRef` holds WHICH account key is hydrated, so switching accounts re-hydrates and an
in-flight read for the previous account is discarded (no cross-user leakage, no stale rows).
Entry identity is `src/lib/savedSearchIdentity.ts` — it compares ALL `SearchQuery` fields except four
display-only ones, so two searches that differ in *any* real filter (period, deal, or an Advanced Filter
answer) are separate entries. Barriers: `scripts/verify-saved-search-identity.ts`,
`scripts/verify-refresh-restores-filter-search.ts`.

**Sidebar titles (owner, 2026-08-21) — `src/lib/chatTitle.ts`, display metadata ONLY.** Each entry
carries `title`, `titleSource: 'auto' | 'manual'`, `titleUpdatedAt`. `autoTitleForQuery()` builds a
concise ChatGPT-like summary from the actual state (`شقق للإيجار في الرياض`, plus at most
`MAX_DETAILS = 3` ` · ` chips for the strongest distinctions — furnishing, bathrooms, amenities, monthly
period, price/area bounds) — never a dump of every filter; annual rent is the default and is left out.
`autoTitleForPrompt()` summarizes a chat/AI turn with **local rules only, no model call**
(«ابي شقة بالرياض قريبة من المترو وتكون تحت 5000 بالشهر» → «شقة بالرياض قرب المترو»). Signed-in users
rename inline: double-click (web) or long-press (touch) → the row becomes a `TextInput`; Enter and blur
save, Escape cancels and restores. A rename writes ONLY the three title keys — never `query`,
`snapshot`, `label`, `id`, `starred` or `ts` — and once `titleSource='manual'` no auto-title may
overwrite it (`canAutoRetitle`). Title is deliberately NOT coupled to `sameQuery()`. Barrier:
`scripts/verify-chat-title.ts` (mutation-proven).

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

**Desktop UI scale — 1:1, by owner decision (2026-08-14, PR #617):** the app is a mobile-first px
design (body 13–15, titles 18–26, 560px content column) rendered 1:1 at every viewport. A tiered
desktop `zoom` layer (1.1/1.2/1.3 by width) shipped earlier the same day (PR #611) for a "too small
on desktop" report, and the owner reversed it hours later from a MacBook: "too zoomed in — keep it
normal." **Current owner call: no desktop zoom, normal browser scale everywhere.** The full history
is documented in place in `src/app/+html.tsx`, and `scripts/verify-desktop-ui-scale.ts` (npm test)
now pins the zoom's ABSENCE (no `zoom`, no `transform:scale` substitute, no font-size % inflation,
standard viewport meta). Do not re-add any desktop scaling — or "fix" desktop sizing via
per-component font px (mobile shares those styles) — without a fresh, explicit owner ask.

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
  retirement time — see the owner-decisions ledger; the `deprecated_platforms` bookkeeping row ships in
  `supabase/migrations/20260716_batch3_retirement_bookkeeping.sql` (Batch 3). **Do not re-add without
  owner approval.**
  **alnokhba** — deprecated 2026-07-14. Source domain `alnokhba-services.com` lapsed into a
  domain-parking page: `curl` to `/properties` and `/` both return HTTP 200, but the body is a
  third-party parking placeholder (`assets.abovedomains.com/javascript/forsale.min.js`), not the
  site's listing markup. `scrape_runs` shows the last real pull was 2026-07-07 (`rows_seen=5`);
  every daily run 2026-07-08 → 2026-07-14 (7 runs) returned `ok=true, rows_seen=0` — reachable,
  but nothing to scrape, not a scraper bug. Removed from the `small-sources-sync.yml` matrix.
  DB bookkeeping (`deprecated_platforms` row) was drafted 2026-07-14 but **never applied** — it
  ships in `supabase/migrations/20260716_batch3_retirement_bookkeeping.sql` (Batch 3), after which
  the `platforms_deprecated_status` view shows it with `still_in_search=false`.
  **Historical alnokhba rows are KEPT** (not deleted) — 1 row was already `active=false` before
  this change; the other 5 active rows were backed up to
  `alnokhba_residential_listings_backup_20260714` and set `active=false` by exact id (never a
  blanket `WHERE`). `scrapers/alnokhba/` stays so historical listings keep their scraper
  provenance. **Do not re-add without confirming the domain serves real listings again.**
  **deal** — deprecated 2026-06-26 (row in `deprecated_platforms`, the oldest deprecation on
  record; the experiment itself was reverted 2026-06-24). A 2-run JSON-API experiment against
  `api.dealapp.sa` — the **same site** the healthy `dealapp` pipeline covers via its HTML/schema.org
  path — so running both would double-list dealapp.sa inventory. **36 rows retained**
  (`deal_residential_listings` 36 / `deal_commercial_listings` 0, verified live 2026-07-16), never
  user-visible: 0 active rows and 0 rows in `active_listing_ids_v2` / `search_listings_ar`.
  Freshness alerts are suppressed via the hardcoded `tablename not like 'deal\_%'` literal inside
  `check_scraper_freshness()` — the `deprecated_platforms` row is pure bookkeeping (nothing in the
  DB reads it; `platforms_deprecated_status` is a live **VIEW** over it, not a table — its
  `rows_retained`/`still_in_search` columns are computed). `scrapers/deal/run.py` is KEPT with a RETIRED
  header, and `deal` is listed in `scrapers/RETIRED_PLATFORMS.txt` so the hermetic guard test keeps
  it out of every workflow matrix forever. **Do not re-add without owner approval** — if dealapp.sa
  coverage needs the JSON API, evolve `scrapers/dealapp/` instead of resurrecting this slug.
  **muktamel** — weekly workflow (`gh-muktamel-weekly`, `cron.job` id 14) paused 2026-07-15
  (`cron.alter_job(14, active := false)`, reversible via the symmetric call). Never completed a
  single full-range crawl (every GitHub Actions run killed by its own 330-minute timeout mid-crawl,
  zero progress-log lines printed); both `muktamel_residential_listings` and
  `muktamel_commercial_listings` are already at 0 active rows, so this has no user-facing search
  impact — it only stops burning ~5.5 GH Actions compute-hours every Monday. Historical rows kept.
  **Re-enable only after the scraper itself is rebuilt** (its enumeration approach needs redesigning,
  not just a longer timeout).
  **dwelleo, semsar** — `scrapers/dwelleo/` and `scrapers/semsar/` no longer exist in this repo (code
  removed at some point). `scrape_runs` shows dwelleo ran 4 times (last 2026-06-23, 1,540 rows on
  its last successful run) and semsar ran once (2026-06-22, 72 rows) — genuine, working scrapers at
  the time, not broken stubs. **No commit message, PR, or doc entry explaining the removal was found
  in this investigation (2026-07-15).** The code deletion itself is a strong signal the removal was
  deliberate, but the *reason* is undocumented — flagged for explicit owner confirmation rather than
  assumed; historical listing rows from both are untouched either way.
- **`aqar_liveness` / `aqar_sweep` scrape_runs labels** — two old `scrape_runs.platform` values with
  a handful of `reaped: abandoned run` rows, last written mid-June. These are stale artifacts of a
  prior logging scheme, **not** evidence that Aqar liveness is broken: the real, currently-scheduled
  mechanism (`gh-aqar-liveness`, `cron.job` id 6, daily `01:00`, described above) is confirmed healthy
  — `cron.job_run_details` shows `succeeded` every day through 2026-07-15. Do not treat the dead
  `aqar_liveness`/`aqar_sweep` platform rows in `scrape_runs` as a live-alerting gap.
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
| **Wasalt hybrid liveness** | `wasalt-liveness-hybrid.yml`, jobid 32 | **RETIRED 2026-08-14** — cron job unscheduled, workflow file removed. Was disabled since 2026-07-09, superseded by enumeration-based `gh-wasalt-enum-liveness` (jobid 36, every 2 days). Verified live 2026-08-14: jobid 36 succeeded 10/10 of its last runs back to 2026-07-27 — the "longer track record" this retirement was waiting on. `scrapers/wasalt/liveness.py` is NOT removed — jobid 36 still calls it (`--mode enum-strike`); only the dead `--mode enforce` workflow entrypoint is gone. |
| **`prune_unseen()`** | shared lib (`scrapers/common/db.py`), called by every platform's own scraper on every run | Soft-inactivation only. 3 consecutive misses before `active=false` (resets to 0 the moment a listing is re-seen). THREE circuit breakers: 0-seen → skip entirely; >30% of active missing at once (collapse) → skip entirely; <80% of active re-seen (partial scrape) → skip entirely. Sharded crawls scope every guard to that shard's own slice. |
| **`mark_stale_listings_inactive(7)`** | jobid 13 daily `04:00` | **Report-only — never sets `active=false` itself** (removed deliberately; a time-based sweep cannot verify a listing is dead). Raises P2 alerts and tracks a per-table circuit breaker (`mon_stale_breaker_state`). **Fixed 2026-08-14:** its fraction checks (30% stale, 50% coverage) only exempted tables below `act >= 8` — too low to be statistically meaningful; `sadin_commercial_listings` (15 active) had its breaker falsely tripped 12 consecutive days on 5/15=33% noise despite the scraper running perfectly (94% daily coverage). Floor raised to `act >= 30`; verified live to clear the false positive while leaving `dealapp_commercial_listings`'s genuine 32.8%-stale trip (external anti-bot throttling) correctly tripped. Barrier: `scripts/verify-stale-breaker-min-population.ts`. |
| **`auto_recover_false_inactive()`** | jobid 30 daily `05:20` | Recovers rows that are `active=false` AND `missing_count=0` AND recently seen. 100% success, 7/7 days (verified 2026-08-14). |
| **Reactivate-on-seen** | on scrape | A row seen again resets `missing_count` and reactivates (see `prune_unseen()`). |
| **`scrapers/common/cleanup.py`** — owner-approved 2026-07-26, the real live hard-delete mechanism | `gh-*-cleanup` weekly, per platform | **Default-deny**: only 4 platforms registered (aqar, wasalt, gathern, aqarcity); as of 2026-08-14 only **aqarcity and gathern have `enabled=true`**. Deletes only when `active=false` + `missing_count≥3` + 30+ days inactive + a **fresh re-fetch right before deletion** confirms genuinely dead (404/410 or a proven dead-marker); ambiguous responses (403/5xx/network error/still-live) are skipped, and a still-live page **self-heals** instead of being deleted. Two mass-deletion guards (anomaly gate + 10%-of-platform scale guard) — both proven live: a gathern run aborted 2026-08-09 on "301 candidates > threshold 300". Every deletion archived to `cleanup_deletion_log` first (431 real deletions = 431 matching log rows, verified 2026-08-14). One real run reactivated 73/300 (24%) rechecked candidates instead of deleting them. |
| **`purge_inactive_listings()`** | jobid 11 | **RETIRED 2026-08-14** — cron unscheduled. Never purged a single row in its lifetime (`purged_listings_archive`: 0 rows, all-time). Disabled since ~2026-07-03 pending an owner call on retention policy; that call has since been made — `cleanup.py` (above) IS that policy. Function/archive table left in place (harmless, nothing to lose) but no longer scheduled. |

**Hard-delete tier is ON for 2 of ~34 platforms (aqarcity, gathern) via `scrapers/common/cleanup.py`**
(verified live 2026-08-14 — see the table above for the full evidence bar and real deletion counts).
Soft-inactivation (`active=false`, via `prune_unseen()` / platform liveness scripts) remains the only
live cleanup tier for every other platform. The OLDER, SQL-only `purge_inactive_listings()` (jobid 11)
this section previously described as the hard-delete path is now formally retired — it never purged a
single row in its lifetime; `cleanup.py` is the mechanism that actually replaced it, per an owner
approval (2026-07-26) that supersedes the "re-enabling requires owner approval" note this paragraph
used to end on.

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

- `query.rentPeriod` ∈ `{'monthly','annual','both'}`, default `annual`; the control shows only for Rent.
- **`'both'` (owner feature 2026-08-14) = the UNION OF TWO KNOWN PERIODS, never "no period filter".**
  `p_rent_period IS NULL` already meant "don't filter", and that also admits the rent rows whose source
  published NO period (510 live at build time) — those are neither monthly nor annual, so claiming them
  would be a derived answer. `'both'` therefore sends its own RPC token **`'كلاهما'`** whose predicate is
  exactly monthly-OR-annual (migration `20260815012506_rent_period_both_monthly_and_annual`, applied to
  all THREE readers so counts match results). Live proof at apply time: 31,859 + 43,287 = 75,146 = the
  union exactly, vs 75,656 for NULL.
  - **Monthly-only sources must be in scope for it.** `resTables` adds gathern + aqarmonthly when the
    period scope includes monthly — `'monthly'` *or* `'both'`. Omitting them on a both-search silently
    returns an annual-only pool while claiming to cover both.
  - **Price basis = ANNUAL.** The ×12 monthly scaling stays keyed on `'شهري'` alone, so a both-search
    compares the budget against `price_annual` — the only unit that spans the two periods.
  - **Results are period-interleaved** (`orderByScope(..., mixPeriods)`), nested INSIDE platform so the
    platform-outermost permanent rule (2026-07-13) is untouched. MATCH FIRST, DIVERSIFY SECOND: it only
    re-orders rows the filter already matched. Measured on a mixed-period platform distribution: first 10
    went 3→6 monthly, first 25 went 8→16, with zero rows lost or duplicated.
  - Barrier: `scripts/verify-rent-period-both.ts` (npm test), mutation-tested.
- **PERMANENT PRODUCT RULE (owner, 2026-08-19) — "both periods" is a PREFERENCE BOUNDARY, never a
  ranking/balancing target. Read this before touching anything about combined-period search.**
  When سنوي + شهري are selected together the user is saying **"I accept either rental period; match
  everything else exactly first."** It is NOT a request to prioritize one period over the other, to
  force any Monthly:Annual ratio (50/50 or otherwise), or to relax any other selected criterion
  (city/district/type/group/category/price/area/bedrooms/Advanced Filter answers) to make room for
  more of one period. The only thing period selection ever does is OR two period predicates inside
  the SAME fully-ANDed WHERE clause as every other filter — it can never compensate for a mismatch
  on anything else. Concretely: a Monthly apartment must never appear in a فيلا search; an Annual
  villa outside Riyadh must never appear in a Riyadh search; a Monthly villa outside the chosen price
  range must never appear — MATCH FIRST, full stop.
  - **Diversification is ordering only, strictly after eligibility is fixed.** The existing
    `orderByScope`/`interleaveRanked` period-interleave (`mixPeriods`, above) is a stable permutation
    of the already-matched, fixed-cardinality row set — verified by reading the implementation: it
    round-robins one row per group (platform, then period) per pass until every already-matched row
    has been placed, with no quota, no padding, and no code path that can add, drop, or duplicate a
    row. If both periods naturally occur in the eligible set, interleaving surfaces both early; if
    the eligible set happens to be 90% one period, the interleave does NOT manufacture more of the
    other — that would violate this rule. Any future change to diversity ordering must preserve
    this: reorder only, never rebalance.
  - **Trending must be computed from the FULL pre-location filter set**, not period alone — category,
    property group, exact type(s), AND both selected periods together — so that "Riyadh · 3,420" and
    a subsequent click into Riyadh with the identical filter state return exactly 3,420, every time.
    (Implemented via `top_cities_by_deal_ar`/`district_options_ar` taking the same `p_rent_period`
    token, `p_types`, and `p_category` the results RPC uses — see below.)
  - **No cross-platform deduplication exists anywhere in this codebase, for any search** (documented
    "search-engine-not-marketplace" permanent rule) — the same physical property listed by two
    platforms is two independent rows, both counted, both shown. This is pre-existing and unrelated
    to period selection; combined-period search does not introduce or worsen it. What combined-period
    search MUST guarantee (and is barrier-tested) is that its own OR-predicate cannot itself cause one
    row to be counted twice (`p_rent_period='كلاهما'` is a single WHERE-clause OR evaluated once per
    row, not a UNION of two separate fetches) and that `count(كلاهما) == count(شهري) + count(سنوي)`
    exactly for the same cohort (proven live, see above; standing barrier extends
    `mon_detect_trending_cohort_drift`).
  - A future engineer reading "both periods selected" must never reinterpret it as "show a balanced
    mix" or "prefer one period" — if a change ever needs that behavior, it is a NEW, explicit product
    decision requiring an owner call, not an extension of this rule.
- **Trending (city/district) RPCs mirror the same `p_rent_period` token as the results RPC (owner
  feature 2026-08-19, closing the multi-select gap).** `top_cities_by_deal_ar` and
  `district_options_ar` used to take `p_payment_monthly boolean` (true/false/null) — with no
  representation for "both known periods, excluding unpublished," selecting Both sent `null`, which
  is a BROADER set than `كلاهما` (it also swept in rent rows with no published period at all). Both
  RPCs now take `p_rent_period text` and reuse the exact `af_eligibility_clause()` period fragment
  verbatim, so Trending and Search share one canonical period interpretation for every scope,
  including combined. `mon_detect_trending_cohort_drift()` (pg_cron) now also probes `'كلاهما'`
  explicitly, proving Trending's combined count equals the results RPC's combined count live.
- **Period copy states the PRICE BASIS, never a lease length** (owner 2026-08-14). The old hints asserted
  "عقد من 1 إلى 11 شهراً" / "عقد لمدة 12 شهراً" — a contract term no source publishes and Ezhalah never
  captures. They now read «السعر المعروض شهري/سنوي». Pinned by the same barrier.
- **"per month" = true monthly rentals only** (the `rent_period` column). Enforced two-layer: RPC
  predicate (`p_rent_period`) + `remote.ts` (`rentPeriodParam` / `keptFiltersReq`). Monthly-only sources
  = **gathern + aqarmonthly**; rows with mixed/null periods are excluded from a monthly search.
- **Gathern price is already annualized (`price_annual`)** — do not ×12 it. (Monthly price scaling vs
  Gathern's pre-annualized price is a tracked open item, §21.)
- **Room = 1 bedroom** strict (see §4.4).

### 17a. Buy+Rent combined multi-select (owner feature, 2026-08-20)

**PERMANENT PRODUCT RULE, in the owner's own words: "When شراء + إيجار are selected together, the
user accepts either Buy or Rent; the Rent side accepts both Annual and Monthly. Match every other
requirement first, then diversify only within the valid combined set."** This is the exact same
"preference boundary, never a ranking/balancing target" principle §17's mixed-period rule already
established, extended one more dimension (Deal ∪ Period, not just Period). Read that rule first —
everything below is its Deal-axis mirror, not a new philosophy.

- `query.deal: Deal` stays `'Buy'|'Rent'` — **never** widened to a 3rd value. The Filter UI shows only
  two independent toggle buttons (no third "both" button, mirroring سنوي+شهري exactly); selecting
  BOTH sets the orthogonal `query.dealCombined?: boolean` flag instead. `deal` itself keeps the last
  concrete button pressed (used only as a tie-break/fallback for UI text) — every search/count/
  Advanced-Filter/Trending call site must check `dealCombined` **first**, before branching on `deal`.
  Frontend derives a single `effDeal = dealCombined ? null : deal` (src/app/index.tsx) and threads
  it through every Trending/pool call instead of `deal` directly (`src/data/locations.ts`'s ten pool
  functions all accept `Deal | null`).
- **NOT the same field as `bothDeals`** (an AI-chat-ONLY fallback for when the agent can't tell
  Buy from Rent from free text — client-side post-filter only, one flat unshared price cap, no
  Advanced Filter/Trending integration, and deliberately excluded from Filter-history restoration —
  see `sanitizeForFilterRestore`'s `bothDeals` comment, §7). `dealCombined` is the opposite: a
  first-class Filter-UI field with full backend wiring that **is** restored from Filter history.
- **Meaning: eligible set = Buy ∪ Annual Rent ∪ Monthly Rent.** Backend: `p_deal=null` AND
  `p_rent_period=null` together — `af_eligibility_clause()`'s existing `(p_deal IS NULL OR
  s.deal_ar = p_deal)` and period-OR predicates already produced this union with **zero changes**
  (verified live: combined=29,354 = buy(10,584)+rent-any-period(18,844) exactly, PR#817). The
  combined-mode Rent side has **no period selector** — the UI hides سنوي/شهري entirely under
  `dealCombined` and the RPC gets no period filter at all (broader than `'كلاهما'`: it also admits
  unpublished-period rent rows, matching how Buy has always worked).
- **Two INDEPENDENT price ranges, never one shared/naive range** (owner decision, asked and
  answered via the price-semantics fork §17's own "stop and ask" clause anticipates). `priceMin`/
  `priceMax` stay the Buy budget (`price_total`) — byte-identical meaning to every existing
  single-deal call shape, zero regression. New `priceMinRent`/`priceMaxRent` are the Rent budget
  (`price_annual`, annual basis — reusing the already-shipped `rentPeriod==='both'` precedent
  verbatim) and map to new RPC params `p_price_min_rent`/`p_price_max_rent`, sent only when
  `dealCombined` is true; every single-deal RPC call shape is unchanged (these two params default
  NULL and are ignored whenever `p_deal` is not null). Toggling Buy/Rent clears `priceMin`/
  `priceMax` exactly when a press flips WHICH deal that pair prices (Buy-only↔Rent-only, or
  Rent-only↔Both) — never when the meaning stays the same (Buy-only↔Both keeps meaning Buy budget) —
  same "clear + explain" precedent as the period toggle, upgraded to be meaning-aware rather than an
  unconditional clear-on-every-press.
- **Advanced Filter: 3-way intersection, never union** — `cohortAllowsCombined()` in
  `src/data/advancedFilters.ts` requires a question id to be independently certified in ALL THREE of
  a cohort's `Buy`, `RentAnnual`, AND `RentMonthly` lists (the exact `COHORT_QUESTIONS` ledger §17's
  mixed-period fix already uses, extended one leg — zero new data-profiling work). This mechanically
  excludes Buy-only questions (fail the Rent legs), Rent-only questions like `rnpl` (never in any
  cohort's Buy list), and Monthly-only signals like Gathern `rating`/`unit_subtype` (never in Buy or
  RentAnnual). A type with no certified Monthly cohort (most commercial/rural types) mechanically
  offers zero combined-mode questions. `property_age` (`AGE_QUESTION`) has its own separate gate
  (`isAgeFilterScope` in `src/lib/ageFilterTypes.ts`, never profiled against Monthly for any type)
  that also excludes `dealCombined` unconditionally — fixing `cohortAllows` alone would have left
  this exact leak open a second time, same as the mixed-period fix needed. Barrier:
  `scripts/verify-buy-rent-combined-af-gating.ts` (npm test, 10 checks).
- **Trending mirrors the same combined scope.** `top_cities_by_deal_ar`/`district_options_ar` under
  `p_deal=null` return the Buy∪Rent(any period) eligible set — `top_cities_by_deal_ar` needed a
  null-safety fix first (it had a hard `s.deal_ar = p_deal` equality that NULL can never satisfy,
  which would have silently returned ZERO combined-mode trending cities; `district_options_ar` was
  already null-safe). Live-verified: combined trending rows = 380 (was 0 before the fix).
- **Barriers (mutation-proven live, PR#817):** `mon_detect_buy_rent_combined_exactness()` — samples
  the 8 (city, category) pairs with the most inventory right now and asserts
  `af_eligible_count(p_deal:=null) = af_eligible_count('بيع') + af_eligible_count('إيجار')` exactly;
  `mon_detect_trending_combined_null_safety()` — asserts `top_cities_by_deal_ar(p_deal:=null)`
  returns rows whenever both single-deal calls do. Both wired into `mon_run_all_detectors`.
- **Result diversification is unchanged** — the existing platform/type diversity ordering applies to
  whatever the RPC returns (now mixed Buy+Rent rows) with no new deal-mixing dimension added; per
  the owner's rule this is "normal platform/result diversification only — never artificial Buy/Rent
  balancing, never forced 50/50." Live-verified: a real الرياض/شقة combined search's first 10 cards
  spanned 9 distinct platforms and all four deal/period shapes (Buy, Annual Rent, Monthly Rent,
  RNPL) with no visible skew toward either deal.
- Full state-transition matrix (Buy↔Rent↔Both both directions, city/type/category change while Both
  is active, refresh, back/forward) is the same class of test §17's mixed-period rule already
  requires — see `docs/ops/SEARCH_MATCH_QA_ENGINEER.md` §40 for the certification standard, which
  now explicitly names Buy-only/Rent-only/Buy+Rent as required coverage for any major re-certification
  of Filter/search/matching.

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

### 19.2 Live behavioral Filter barriers (scheduled, anon-key REST path — full audit 2026-08-10)

Unlike §19.1 (build-time, offline), these execute the REAL production RPCs through the same anon key
real clients use (a privileged connection could mask RLS/permission differences). Each has a dedicated
`.github/workflows/*-live-check.yml`, runs every 6h + on-demand, and turns a GitHub Actions job RED
(owner-notified) the moment production regresses — proven live-green on every one as of 2026-08-10.

| Barrier | Workflow | Script | Proves |
|---|---|---|---|
| Platform diversity | `diversity-live-check.yml` | `verify-platform-diversity-live.ts` | MATCH-FIRST → DIVERSIFY-SECOND on live rows: round-robin front, no single-platform domination, 0 dupes across Show More, objective sorts still win, every row still satisfies the filter. Live 2026-08-10: 9–13 distinct platforms lead the round-robin across Buy/Rent-annual/Rent-monthly/Commercial in Riyadh — no platform is structurally favored. |
| Trending Districts / district-suggestion dead-ends | `district-suggestion-parity-live-check.yml` | `verify-district-suggestion-parity-live.ts` | Every district `district_options_ar` reports `listing_count > 0` (i.e. every district that can appear in the "Trending districts in {city}" Top-6, `TrendingList.tsx`) actually returns `> 0` from `location_search_candidates_ar` for the same city+deal — no dead-end suggestion. Live 2026-08-10: 1,757 populated-district suggestions checked across 7 cities × 4 scopes (default/monthly/Residential/Commercial), 0 dead ends. |
| Advanced Filter count == search | `count-rpc-parity-live-check.yml` | `verify-count-rpc-parity-live.ts` | `apartment_guided_counts_ar` and `property_age_option_counts_ar` (the RPCs behind every Advanced Filter option's live count, `ADVANCED_FILTER_DESIGN_CONTRACT.md` §8) report the EXACT same total as `location_search_candidates_ar` for the same params. Added 2026-08-10 after the audit found the three RPCs' read-side defense-in-depth guard (PR #409) had only been applied to the search RPC — see migration `20260810145200_extend_readside_guard_to_count_rpcs`. |
| Strict-filter count parity | *(manual / daily audit — not yet scheduled)* | `verify-strict-filter-parity-live.ts` | `location_search_candidates_ar.total_count` equals a strict PostgREST ground-truth count for every NULL-permissive-fixed filter (floor, street width, tenant, direction families, RNPL amenity alias, annual-rent-is-source-published-only), plus the amenity-vocabulary fail-closed invariant. Live 2026-08-10: exact on all 6 (the one apparent mismatch was the ground-truth query missing the documented RNPL-folded-into-annual row — not an RPC bug). |
| Unlocated-fallback scope | *(manual / daily audit — not yet scheduled)* | `verify-unlocated-fallback-scope-live.ts` | The "unresolved-location countrywide" disjunct in all three read RPCs rescues ONLY genuinely-unlocated rows, never a located-but-price/size-withheld row (the 2026-08-10 dealapp/5696027 bug class). Live 2026-08-10: exact (`rpc == production_ready + unlocated`) for both buy and rent. |
| Normal-Filter read-side barrier | *(continuous, DB-native)* `mon_detect_filter_barrier_leaks` → P1 alert | `verify-filter-barrier.ts` (PR #409, unmerged) | `mon_filter_barrier_leaks`: 0 rows may ever have negative price/area, no city/region while `production_ready`, or a null deal, among rows the Filter can return. Live 2026-08-10: 0 leaks across 185,110 visible rows. |
| Real-browser production parity | `ui-parity.yml` | `e2e/ui-parity.spec.ts` (Playwright) | Drives the actual deployed app (`https://ezhalah-app.vercel.app`) with real clicks — Buy/Rent+Monthly/type filters, bedrooms/price/area refine, AI-mode free-text classification, city-vs-region disambiguation. Nightly + on-demand. Live 2026-08-10: 8/8 passed. |

**Full-audit finding (2026-08-10):** a targeted parity sweep (RPC total_count vs. raw `search_listings_ar`
ground truth) across every filter dimension the RPC exposes — price/area (incl. 0/null/negative/extreme/
boundary-inclusive/malformed-input cases), bedrooms, bathrooms, amenities, floor, direction, age,
new-construction, license, category, and 4 realistic multi-filter combos — was byte-EXACT in every case.
The one genuine gap found (count RPCs missing the read-side guard, above) has been fixed and is now
covered by a dedicated barrier. See migration `20260810145200_extend_readside_guard_to_count_rpcs` and
PR #425 for the fix; PRs #409/#410/#406 remain open awaiting owner review (migration-touching, per the
migration-drift-guard rule in `AGENTS.md`).

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
12. **Search history is signed-in only; sidebar titles are display metadata.** Anonymous searches are
    never persisted across a refresh. A saved entry auto-gets a concise ChatGPT-like title (local
    rules, no model call); a signed-in user renames it inline by double-click/long-press. **Renaming
    changes the title and nothing else** — never the messages, query, Advanced Filter answers, result
    snapshot, identity/de-duplication or `ts` — and a manual title is never overwritten by a later
    auto-title. §8 carries the full model. (owner, 2026-08-20 / 2026-08-21)
13. **Buy+Rent combined multi-select is a preference boundary, never a ranking/balancing target.**
    "When شراء + إيجار are selected together, the user accepts either Buy or Rent; the Rent side
    accepts both Annual and Monthly. Match every other requirement first, then diversify only within
    the valid combined set." Never widen `Deal` to a 3rd value; never reuse `bothDeals`; never mix
    Buy/Rent prices into one shared range; Advanced Filter offers only the 3-way (Buy ∩ RentAnnual ∩
    RentMonthly) intersection. §17a carries the full model. (owner, 2026-08-20)
14. **The Saudi residential proxy is ONE shared, capacity-limited resource — treat it as such.**
    (owner-approved 2026-08-23, PR #827.) Every consumer authenticates with the same
    `WASALT_PROXY_URL` secret and competes for one pool of concurrent sessions. Exceeding it does
    **not** fail cleanly: requests plateau at a ~204s connect timeout while other jobs in the same
    batch succeed in seconds, which reads as a random per-slug source block and is not one. That
    misreading cost five days on 2026-08-17 (wasalt: failure 0.1% → 66.7%, daily rows ~100k → ~3k).
    - **Both wasalt sweep matrices stay capped, and are tuned together.** `wasalt-residential-sweep`
      (20 jobs, `40 */8`) and `wasalt-commercial-sweep` (14 jobs, `45 */8`) fire five minutes apart
      into **separate** concurrency groups, so they overlap by design. Capping only one leaves the
      peak unbounded — 6+6 bounds it at 12 instead of 34. `mon_detect_proxy_contention()` watches
      the realised peak and fires if the cap is raised, bypassed, or a new consumer appears.
    - **Adding a proxy consumer means re-checking the clock, not just the cap.** The current
      consumers and their windows: wasalt sweeps 00:40/00:45, 08:40/08:45, 16:40/16:45; wasalt
      cleanup + enum-liveness 03:15–03:19 and 21:01; wasalt enrich 05:00; enrich-ar `15 */4`
      (short, ≤8.3 min); souq24 ~04:38.
    - **souq24's failure is NOT proxy contention** — measured 2026-08-23, recorded so it is not
      re-guessed: souq24 has no proxy neighbour in its window. Its signature is a 16-minute
      `harvest_ids` followed by a ~2h stall in the 8-worker fetch loop, ending in a SIGINT kill with
      zero rows. Still open; do not fold it into a proxy fix.
15. **Deletion is frozen whenever the evidence behind it is inconclusive.** (2026-08-23.)
    `cleanup.py`'s `verdict()` has always refused to delete an individual row on 403/429/5xx/network
    error. It now also aborts the **entire run** — discarding deletions it had already judged
    "dead" — once the inconclusive rate clears 30% over a ≥20-probe sample, because a source or
    proxy degrading mid-run makes every verdict in that run suspect. **Reactivations are always
    kept**: a `live` verdict needs HTTP 200 plus no dead-marker, and restoring a wrongly-inactive
    listing is the fail-safe direction. Never widen the freeze to reactivations, and never key its
    rate on `stats["skipped"]` (that counter also holds rows with no URL, which never reach a probe).

---

## 21. Open questions / decisions still pending

- **Location canonicalization residue** (not yet decided; do not touch without owner answer): composite
  labels (e.g. `امارة مكة-الطائف` mis-resolved), catalog duplicates (الهفوف, فرسان each with two
  city_ids), hamza-less catalog spellings (`ابها`, `الاحساء`), Souq24 exact-join NULLs. Search recall is
  already spelling-insensitive; these are display/grouping cosmetics only.
- **Property-type hierarchy details:** Bank / Telecom Tower grouping. (`مكاتب مشتركة` = shared offices
  was an unreachable raw type in the AI agent's free-text recognition — fixed 2026-07-23, see below.)
  **RESOLVED 2026-07-21:** `أرض زراعية` (Agriculture Plot) is now its own clean type/filter button,
  split out of Farm (owner decision — it outnumbered real Farm listings 5:1, so the merged "Farm"
  button mostly surfaced bare agricultural land, not actual farm properties).
  **RESOLVED 2026-07-23 (raw/undeveloped land):** whether generic/raw `أرض` (bare, unqualified "land" —
  the bucket `أرض خام`/`أرض بيضاء`/vacant-land listings would fall into) should be its own filter
  button. Investigated: no such term exists anywhere in the codebase or live data (0 rows for every
  candidate spelling checked); it consistently falls into `Residential Land` via the generic `أرض`
  substring/exact-match fallback, uniformly across ingestion, the taxonomy, and both AI-agent
  surfaces — not a bug, a working default. Three source platforms (Muktamel, Era Pulse, a retired
  Deal integration) distinguish raw land in their own data models before Ezhalah's ingestion collapses
  it, so real raw-land listings likely exist today, indistinguishable from ordinary residential plots.
  **Owner decision: leave as-is** — no split, no code change (project memory
  `project_rawland-classification-decision-2026-07-23`).
- **Rent scaling:** monthly price ×12 handling vs Gathern's pre-annualized `price_annual`.
- **In-app browser proxy** proven for all partners (currently Aqar-centric); reconcile the "iframe
  impossible" note.

**PRD §13 business items — DECIDED 2026-06-09 (don't re-ask these):**
1. Revenue: **CPC (pay-per-click) first**, subscriptions later. Near-term work = click tracking, not
   subscription billing.
2. REGA FAL license: **application in progress** → show a "license pending" placeholder in
   compliance/about copy (`XXXXXXXX` in About/Settings). **Still genuinely OPEN:** the real license
   number/scope — never invent one.
3. Partner data agreements (6 platforms): **none signed** — decided to build against mock/scraped data
   and enable platforms incrementally as agreements land. **Still genuinely OPEN:** actually signing
   them.
4. Listing data source: **web scraping** (carries ToS/PDPL risk — flagged in ingestion design, not a
   blocker).
5. Phone OTP: **WhatsApp Business API** (the auth screen's WhatsApp badge is correct, not a placeholder).
6. FX & units: **SAR only, m² only** — no currency conversion needed.
7. Featured/paid placement: **NONE, ever.** Results rank purely on neutral signals (recency/match/
   diversity) — reinforces §1 neutrality and §10 diversity rules.
8. Language: **Arabic-first primary** (RTL), English secondary/latent — matches §1.
9. PDPL retention: **keep search history/account data until the user deletes their account**, purge on
   deletion.

Also still genuinely open: Tokyo vs. Saudi hosting region for PDPL residency (see §2 — Supabase has no
KSA region; recommendation delivered was "don't migrate," awaiting owner call).

---

## 22. Change-management checklist (before any feature/fix)

1. Read the relevant section(s) above + the permanent rules (§20).
2. Does the change alter what the user sees or how the app behaves? → **owner approval required.**
3. Does it touch the property card contents? → **not allowed** (backend mapping instead).
4. Does it conflict with any permanent rule or a locked decision? → **STOP, tell the owner.**
5. Backend change? Preserve work, verify before+after, deploy only to `ezhalah-app`, `NOTIFY pgrst` after
   RPC/DDL.
6. Update **this document** in the same PR when a fact here changes.
