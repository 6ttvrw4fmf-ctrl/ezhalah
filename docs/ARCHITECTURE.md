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

## Agent search controls (owner, 2026-10-15)

[AGENT_SEARCH_CONTROLS.md](ops/AGENT_SEARCH_CONTROLS.md) is the approved contract for explicit city/region/nationwide scope, source inclusion/exclusion, requested result quantities and continuation. It supersedes the Chapter 1 city-only restriction for explicit wider searches. Implementation status is recorded there; approval alone is not production verification.

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
- **Arabic-first UI with Arabic and English preferences.** Message language affects replies, never the chosen interface language.
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

**Chat language (owner, 2026-10-07):** reply in the latest user message’s language without changing the interface language, sidebar, controls, or page layout. Assistant messages stay on the assistant side; text keeps its own reading direction. Save original messages/replies verbatim. Automatic saved titles follow the latest user message and its language, including when search results arrive; manually renamed titles remain unchanged.

The empty English chat subtitle is “Describe it and Ezhalah” without punctuation; English model descriptions use ordinary sentence punctuation rather than long dashes (owner, 2026-10-14).

The header and sidebar Ezhalah name uses the theme ink, and assistant sparkle stars use the theme accent (sky/dusk redesign, owner 2026-10-24). Source artwork retains its original colors.

The AI Agent’s empty composer hint aligns left in English and right in Arabic (owner, 2026-10-07). Typed messages keep their own language direction. The entire user bubble sits on the left for English and on the right for Arabic, determined per message (owner clarification, 2026-10-13).

English property cards localize platform attribution, property-type labels and finite attribute values using the existing bilingual catalog (owner, 2026-10-13). Source reference IDs, including Arabic letters in plan numbers, remain verbatim; source images and logos remain original. Arabic card display is preserved.

English Filter submissions localize city/district display and rotate short English greetings with emojis before the request, matching the Arabic treatment. The eleven approved Arabic Filter greetings each have a natural English translation with the same emoji (owner, 2026-10-14); English must not use a smaller substitute pool. Advanced Filter selection messages also open with nine translated English courtesy/request phrases, using the same emojis and independent non-repeating rotation as Arabic (owner, 2026-10-14). Advanced Filter round receipts localize committed items and skip labels in ask order; English selections join with commas. The following searching status keeps its translated rotating lines and sparkle mark (owner, 2026-10-13).


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

Support headings, fields, descriptions and response-time bullets follow the selected reading direction. Terms of Use and Privacy Policy provide complete English translations section-for-section alongside the unchanged Arabic originals; dates, contact tokens, retention and cross-border disclosures stay equivalent (owner, 2026-10-14).

Root overlays: `<InfoModal/>` (Support/About popups) and `<IntroVideo/>` (first-run intro, logged-out
only, shown once).

---

## 4. Frontend — the Filter Search screen (`src/app/index.tsx`)

**Website logo strip width (owner, 2026-10-24):** on web, the rotating website logos span the available main-content width beside the sidebar, with the existing page gutters. The Filter form and headline retain their centered 560 px column. The shared strip also fills the AI Agent landing's available width. Mount only enough logos to cover the measured width plus one entering slot, updating when the container resizes. Logo size, spacing, speed, clock phase, and reduced-motion behavior remain unchanged; phone layouts continue to fit the viewport.

The single search state is `query` (a `SearchQuery` in the store). Every control mutates it via
`setQuery`. **Selecting an upstream step cascade-resets all downstream fields.**

**Land-category artwork (owner, 2026-10-11):** «الأراضي» uses the approved transparent adjoining-plots icon in `assets/icons/land-plots.png`, in the shared group-icon frame.

**Raw-land artwork (owner, 2026-10-11):** «أرض خام» uses the approved transparent cactus-and-stones icon in `assets/icons/raw-land.png`, without corner posts. It uses the same icon frame and selected/idle tint as the other property types.

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
8. **Search** actions → the existing `onSearch()`. Owner revision (2026-10-01): remove the persistent bottom bar because it crowds location selection. Keep a compact Search action in the form immediately after City/District, and a second «بحث بهذه الخيارات» action after the detailed filters. Both scroll naturally with the form and never overlap suggestions. Compact the hero spacing and deal/category/period tiles; keep readable inputs, explicit City/District labels and placeholders, and the district's optional label. Preserve every filter control, callback and validation rule.

The old example-prompt grid below the card was removed at the owner's request on 2026-08-16; the AI Agent keeps its own onboarding prompts.

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

**A press on a card whose listing opens INSIDE Ezhalah plays the golden buzzer + a screen-level
confetti party (owner 2026-10-17: «whenever a user clicks on a listing I want this party confetti …
on everything», then «your job is doing it for the 76 sites … the ones after I'll do it later»; «make
it attractive … my goal is sending traffic to those sites»).** Photo, body or gold button, on the laptop
photo-first card, the laptop compact row and the phone card alike: one shared `fire()` opens the ad
first, synchronously, then — only when `IS_WEB && inAppViewerHost(listingOpenUrl(listing))` — bumps the
card's `BuzzLayer` (`src/components/CardBuzzer.tsx`) and the screen-level `ConfettiOverlay`
(`src/components/ConfettiOverlay.tsx`, last child of the agent screen, above the ad sheet/pane, never
takes a tap). Cards that open a new tab or the native preview page open exactly as before, with no
party. Decoration only — reduced motion draws nothing and the ad opens even if nothing paints.
Guard: `scripts/verify-laptop-photo-card.ts`.

**Gold = opens inside Ezhalah, silver = everything else (owner 2026-10-17: «make the frame and this
golden shining like a buzzer», then «the golden frame only with the 76 … the rest silver»):** every
card wears a 3 px shining metallic ring and a shining metallic «اضغط هنا» photo strip, both
`GoldSurface` (`src/components/CardReveal.tsx`) — the gold button's own gradient shape plus its CSS
glint, one compositor keyframe per surface. `tone` is `gold` when `inAppViewerHost(listingOpenUrl(l))`
matches (the site opens instantly inside Ezhalah) and `silver` otherwise, so gold reads as "instant".
Dark text on the strip. Reduced motion: a still metal. Same guard.

**Card data is locked. Display scraped values verbatim; change presentation only with owner approval.** Fix data
problems via backend mapping only (see §16), never by editing the card.

**Photo-first layout (owner approved and requested deployment 2026-10-01):** one continuous vertical column on laptops and phones (owner scrolling revision, 2026-10-01). Center the feed at a maximum width of 640 px, filling narrower screens, with 12 px between cards; never stretch cards to fill a laptop or put adjacent results side by side. Keep the matched list, order, rank and source-link action unchanged. The large full-width photo has a permanent “اضغط هنا 👆” / “Click here 👆” label and source domain; clicking anywhere on it opens the existing original-listing destination. Put source attribution, type/deal, title, exact price, location, stats and optional rating/RNPL/evidence in a compact body. Use tightly wrapped amenities and inline additional-information pairs, with **all values visible immediately, no feature or additional-info expander**. Hide the prose description/bio (including Gathern's title-as-description fallback), as previously approved. Avoid empty fixed-height content panels and a separate large source footer. Shared platform-logo artwork and relative sizing remain consistent; scale every card logo uniformly within the compact source row. Never alter stored data, source conditions or price formatting.

**Card sections:**
- **Photo:** full-width image with graceful multi-URL fallback → “no photo” placeholder; rank badge and explicit source-link action.
- **Details:** existing type/deal, location and region, exact price and price qualifiers, optional RNPL/rating, stats and Advanced-Filter evidence. Source identity remains visible.
- **Amenities and additional information:** all existing valid entries wrap naturally, without truncating values or requiring expansion. Existing empty-state conditions remain unchanged.

**Card behaviors:** cards pop in staggered (`PopIn`). English-UI place names get client-side
transliteration for display only (Arabic UI passes through). `listed` date is cleaned to `DD/MM/YYYY`
or a localized "recently"; junk scraped strings are suppressed. Tapping the card opens the real source
listing (§7 browser) and fires `trackOpen` (CPC click tracking). All registered searchable sources have logos (`SourceBadge`). The canonical asset, transparent-frame, sizing and original-color contract is in `docs/ops/PLATFORM_PICKER_PROFILES.md`; its live audit verifies every source currently returning results.

---

## 6. Frontend — the AI agent

### 6.1 `src/app/agent.tsx` — chat + inline results

- **Model selector (owner, 2026-10-08):** a subtle label below the microphone area opens two
  Claude-style options: **شاهين 2.2 / Shaheen 2.2** (default) and **حُر 4.4 / Hurr 4.4**.
  The current-model label and mark keep their normal colours while a reply loads, with no pressed
  background highlight (owner, 2026-10-23). The control remains disabled while the agent is busy.
  Hurr is visible in light gray and disabled, like the unavailable Haiku option in the owner's reference.
  Keep the menu compact: two name/version rows with their descriptions, then a separated
  «لماذا شاهين وحُر؟ / Why Shaheen and Hurr?» link opening the centered «نماذج إزهله» story card
  (owner, 2026-10-10).
  **Approved model marks (owner, 2026-10-11):** Shaheen uses the falcon head with the small swept
  wing detail; Hurr uses the broader falcon head. Place the transparent marks beside each name:
  16 px in the current-model trigger, 22 px in the menu, and 30 px in the story headings. Use green
  for Shaheen and muted gray for unavailable Hurr. Marks are decorative, share their model's existing
  tap target, and follow the reading direction in Arabic and English; they never create an extra button.
  Arabic descriptions are «سرعة خاطفة ودقة متناهية للإجابات السريعة» and
  «قوة وتحمل فائق لأصعب المهام والمعالجات»; English descriptions are
  “Lightning-fast precision for instant answers” and “Unmatched endurance for your toughest challenges”.
  Shaheen labels the existing agent engine; Hurr has no backend route while disabled. The version
  labels are product display names and must never be passed as provider API IDs. Enabling Hurr
  requires an approved provider/model mapping.
- One conversational surface. Message roles: `user`, `agent` (reply / clarify with answer chips),
  `results` (slogan + summary + intro + sort line + cards), `status` (thinking/searching, morphed in
  place).
- **Typed message** → `send()`: guest-gate check (see §7.2) → refine intercept → `recordChatTurn` →
  reply locale follows message language without changing the interface locale → build the last two raw history turns plus the accumulated query state (results
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
- **Empty-chat welcome (owner, 2026-10-03):** centered static headline «وش العقار اللي في بالك؟»
  with smaller subtitle «قل لنا مواصفاته، وإزهله.»; no greeting typing animation or reply icon.
  It disappears on the first conversation turn. Existing composer examples, mic/send placement,
  top mode tabs, reply typing and search-loading animations remain; no additional example chips
  or Filter link. Phone and desktop use the same responsive column without desktop zoom.
 - **Opening chat Search pill (owner, 2026-10-04):** the empty AI chat also shows an outlined
  «بحث» action under the input, with a 17px magnifying glass enclosing a small angular eagle eye
  (`assets/icons/eagle-search.svg`, owner-approved 2026-10-04). The existing pill dimensions,
  label and theme colors stay unchanged. It submits the typed text through the existing
  `send()` path and is disabled for whitespace-only input. It stays while typing, disappears on
  the first sent turn, and returns only for a fresh chat. Mic/send remain on the physical right;
  Filter-origin results and restored conversations do not gain this action.
- **Conversation typography (owner request, 2026-10-03):** user turns are open text with a slim
  Ezhalah-green edge instead of rounded chat tiles. User copy is 18/31 on web and 16.5/28 on
  native using the bundled Tajawal Arabic family; agent replies are 17/30 on web and 16/28 on
  native. The eagle mark identifies Ezhalah in reply and results-intro rows instead of a generic
  sparkle. Search and persistence behavior is unchanged.
- **Composer layout (owner request, 2026-10-04):** the AI composer is a compact 620px desktop
  search field with 10px vertical padding and a 58px minimum control row. The 38px green search
  target stays clear and tappable. Input direction follows the text being typed immediately: Arabic
  stays right-aligned and Latin text left-aligned, without moving the composer itself.
- **Saved-chat mode pill:** when a saved conversation is selected from the sidebar (`replay=0`),
  the Filter / AI mode pill is not rendered, including while switching between saved chats. The
  replay predicate gates the animated wrapper synchronously so it cannot flash before effects run.
  On a fresh chat and during live search, existing mode-pill behavior is unchanged. The Ezhalah
  header title is 22px bold on the agent screen.
- **Completed Filter searches show the composer below the final message (owner, 2026-10-13),** superseding the no-composer rule for completed searches. Sending a typed follow-up switches to AI chat so the composer remains available for clarification. Filter and the AI Agent share this one
  screen; a Filter search arrives via the `?filter=` route param. The `filterOrigin` state flag is set
  `true` only in that arrival branch (reset to `false` by `startFresh()`, same lifecycle as every other
  per-conversation flag here) and gates the composer's `<View>` with `!filterOrigin || completed`.
  **The free-text input row is hidden only on unfinished Filter searches** — refine chips and
  «تحديد أكثر» (Advanced Filter) stay fully available, and so does the composer's own Stop control while
  `busy`/`revealing` (an in-flight Filter search must stay cancellable —
  `verify-filter-stop-cancels-and-restores.ts` is a separate, older owner rule this must never break;
  the FIRST version of this gate did, silently, until `web-runtime-smoke`'s own Stop journey caught it).
  The always-on listings-source disclaimer is a legal notice, not "the chat", and is never gated.
  Barrier: `scripts/verify-filter-results-no-composer.ts`.

### 6.2 Agent behavior rules (neutrality / compliance)

Never recommends/ranks/says "best"; advice queries return a decline. Neutral results copy ("I found a
few properties…"). **ONE clarifying question, about location only (owner, 2026-09-11, supersedes the
older "max 2" ceiling)** — enough info + a resolvable location searches immediately with zero questions;
missing/ambiguous location asks exactly once, then searches (or, once that one question is spent and
still unresolved, states plainly that it can't narrow the search rather than asking again or defaulting
to nationwide). See `supabase/functions/agent/decide.ts`'s `QUESTION_BUDGET_CEILING` and its
`unsearchable` result. **Never invent a location** (bare district in multiple cities, twin city,
region-or-city same name, geography/proximity cue with no city → ask, never guess; a city the user
never typed is stripped). Naming **Gathern forces Rent + monthly**. Guests are search-first; logged-in users get conversational help and search on an
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
language / units / currency / theme toggle (Arabic and English; SAR-only).

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

### 7.5 Listing viewer (`src/components/AdViewer.tsx`)

Owner-approved web behaviour (2026-10-03): Deal App and Gathern open their real pages in plain
iframes, with their own headers unchanged. No proxy, header stripping, or framing bypass is permitted.
Owner 2026-10-16: more sites open the same way, with no new design. A host joins only after a live
frame proof, which means two live ads framed like AdViewer, a top-level control load, and a calibration
where Aqar and Wasalt must fail. It must also show its ad within the speed budget on phone 4G, measured
from the GitHub runner by `e2e/viewer/speed-live.mjs` (which must list every host): 3 s until
2026-10-17, then **10 s** by owner decision («if it's below 10 seconds no problem»). A host that later
refuses framing, goes down, or goes over budget comes off the list; the guard runs every 6 hours and
after every deploy. 2026-10-17: 76 hosts on the list after every platform Ezhalah searches was re-checked (aqaralmuhaysini.com measured 9.96 s and the owner chose to keep it on; muktamel.com ~37 s stays off by owner choice).

Aqar, Aqar Monthly and the 49 owner-approved non-embeddable platforms (2026-10-04, re-checked
2026-10-17 when Abaad moved to the iframe list; exact hosts in
`IN_APP_PREVIEW_HOSTS`) use the same panel with a native `ListingPreview` of the
card's existing `Listing`, with no additional listing-data fetch. Source-ordered photos, the shared
`listingPrice` (including the stay-length note), source-stated facts and redacted description lead
to an explicit external contact link to the original ad. Both the contact label and attribution
use `t(sourceName(listing.source))`, matching the result card. Arabic prose is hidden in English
like ResultCard. No photos means no gallery box. The preview and iframe host lists are disjoint.

**Listed-now identity (owner, 2026-10-19):** the Aqar sale price comparison's
«المعروض الآن» / “Listed now” heading has NO picture for now (owner 2026-10-26 deleted the falconer-holding-a-
falcon-over-a-house drawing that stood here since 2026-10-19; leave it blank until the owner picks one).
The FILE `assets/icons/falconer-property.png` stays in the repo, referenced by nothing: preflight-verify.sh refuses any
deploy that deletes a shipped asset present in the approved baseline, and an unreferenced asset is not bundled.
Use a compact 30 px image beside the heading, mirrored placement for Arabic; the Ministry's
actual-sales heading uses the Ministry's official green-and-gold logo in the same 30 px frame
(`assets/icons/ministry-of-justice.webp`, copied unchanged from the official homepage's
`https://www.moj.gov.sa/_catalogs/masterpage/MOJPortalDesign2023/images/logo.webp`, checked
2026-10-19). Preserve its original colours and source attribution. This is branding only, not a new valuation model.

**The map:** the source's own pin when it published both coordinates («الموقع كما نشره {site}»).
When an **Aqar (buy or rent), Aqar Monthly, Wasalt, or one of the ten largest native-preview sites (sakan, abralosol, nofodh, arkaan, bossbih, ksaaqar, mustqr, aqalemhajer, alshawaf, reinvest — owner 2026-10-19)** ad published none (Wasalt added 2026-10-19, owner: «map Wasalt like Aqar»; its pin is read from the Arabic detail page, so an un-fetched ad shows the border meanwhile) (owner 2026-10-17: «show the entire
district … all around the boundaries», «just do aqar now», then «Aqar Monthly and rent, same style,
just don't include the Ministry of Justice» — other sites still show no map without a pin; the
ministry block stays Aqar-sale-only),
the page asks the same free Google embed for the district by name («حي X، City») so Google fits the
view and draws its own dashed border around the district; labelled «الموقع التقريبي» with «{site}
لم ينشر موقعاً دقيقاً», never a pin. Free either way (keyless embed / Embed API place mode). The owner
chose Google's border as Google draws it (no colour boost). Guard:
`scripts/verify-ad-map-needs-both-coordinates.ts`.
The order, decided automatically per ad (owner 2026-10-18): **pin → district border → city border
(no district) → town border** (no city in our index: the place the ad's own sa.aqar.fm link names,
`aqarTownFromUrl()`; a link naming only the country names no place, so no map). Every day
`.github/workflows/aqar-map-coverage-live.yml` runs `scripts/check-aqar-map-coverage-live.ts`, which
lifts the same functions and sorts every Aqar / Aqar Monthly ad first seen in the last 26 h into
those four paths; any new ad left with no map turns it red and raises an alert. Measured 2026-10-18:
175,619 ads all-time, 5 with no map (their links name only «المملكة العربية السعودية»).
A pin is only a pin when it is the ad's own: a point shared by ≥5 ads tagged with ≥3 districts is the
site's default (nofodh's office, sakan's city centre printed with `show_exact_location = true`,
eaqartabuk's mall — 2026-10-19). `strip_shared_default_pins()` (hourly :15, before the :22 sync, and
in the detector roster as `mon_detect_shared_default_pin`) registers such points in
`ops_default_pin_register`, strips them from the stored rows and attaches a reject trigger to that
table so a re-crawl cannot write them back; those ads fall through to the border like any pin-less ad.
**A district border is a suspected bug on OUR side until proven otherwise (owner 2026-10-21, permanent:
«whenever we have a district border, suspect a bug on our end, especially the big sites»).** Before calling
any ad pin-less, check (1) does our own stored row already hold a coordinate pair, and (2) does the source
page or API print one. The same day found three of ours: Wasalt commercial (2,070 ads — pin in `ar_data`,
view arm read `additional_info`), Aqar Monthly (~690 pins ERASED by shards that never asked for
`location`, PR #8132: a field not asked is `None`, never `{}`), and sanadak commercial / aqargate /
amlakalahsa / tuba (pins in `source_capture`, no arm read them). Two daily rostered detectors now guard it
(`20261022001318`): `mon_detect_captured_pin_not_served` (a served pin-less ad whose own row holds a
Saudi pair, minus the guards' deliberate strips; a coordinate proven NOT the ad's pin goes in
`ops_captured_pin_waiver` with evidence) and `mon_detect_pin_share_drop` (a table losing ≥50 pins and ≥3
points of pin share between daily snapshots in `ops_platform_pin_daily`).

**Map tab: the same house posted twice on ONE site is ONE pin with a card per ad (owner 2026-11-04, permanent: «they
become like 2 … but same pin … do it for everything they basically merge but show separately of course»).** Same
source_table + deal + price + area + type + bedrooms within ~100 m (DBSCAN 0.0009°) → every copy is DRAWN at the group's
most-shared spot (`map_pin_snap`, refreshed hourly by `map_pin_snap_refresh_ar()` inside `map_grid_refresh_ar()`;
`map_pins_ar`'s street-zoom branch reads it). A blank price or size matches a blank («price on request» copies), never a number; an ad with no total price is also matched on its price per metre. Nothing is hidden or deleted and the stored coordinates stay the source's own — only where the pin is drawn moves;
tapping it lists every ad. Two DIFFERENT sites keep their own spot (owner 2026-11-03: same-site copies stay, cross-site
is normal) — but see the next rule: their heads never overlap on screen. Guard: `scripts/verify-map-twins-share-one-pin.ts` (migrations `20261105060207`, `20261105063813`, `20261105070224`, `20261105071552`).

**Map tab: THE FINAL PIN RULE — one pin is one place, the same property is one card that names every site (owner
2026-11-10, permanent; it replaces «two different sites are always two ads» above).**
1. One pin = one place; different places sit side by side, never on top of each other.
2. Units in a building (apartment, studio, floor, room, office, shop): the building has one pin and each unit its own
   card — the same look on another floor is another unit. A pin whose ads are all one type and one deal titles its
   sheet «12 شقة للإيجار من 40,000» (`sameKindSummary`).
3. Whole properties (villa, house, building, land, warehouse, showroom, rest house, farm …): same pin + same type + same
   size = the same property → one card; another size is another card.
4. «Same property» needs PROOF: the same government licence number (6+ digits) and deal, or the same site with deal,
   price, size, type, rooms and a KNOWN floor all matching, or rule 3. Looking alike is never enough, an unknown floor is
   not «the same floor», and two ads carrying two DIFFERENT licences are never folded by looks (measured on حي بدر:
   two wasalt flats equal in every field were plots 475 and 476). `foldSameProperty` in `src/lib/mapPins.ts`; a card
   whose index facts failed to load is never grouped.
5. Proven the same (same licence, city and deal; 2–40 ads; within ~150 m; same size) but pinned a few metres apart by
   different agents → drawn on one pin (`map_pin_snap_refresh_ar()` pass 2).
6. The one card shows every site: the cheapest ad leads and each other ad is a link under it with its site and price
   (price through `listingPrice()`, so stay-length sites print none).
7. Nothing is ever hidden or deleted — a folded ad is always one tap away.
8. **A site's stand-in point is not a place.** One site, one exact point, ten or more DIFFERENT whole properties (type +
   size) of several kinds (three kinds, or two kinds both for sale and for rent) → those ads leave the pin and show under
   their district's «موقع غير محدد» marker (`map_stray_pin`, rebuilt hourly by `map_stray_pin_refresh_ar()` inside
   `map_grid_refresh_ar()`, so new listings follow it; ceiling 5,000 keeps the previous set). A real one-kind project
   (hundreds of land plots a developer pins at its gate) is NOT a stray point and keeps its pin. Measured at ship: 375
   ads at 9 points (aqar النرجس, bossbih and arkaan in الأحساء).
A photo check («same photos = same property») is a later step, not built. Migration `20261110202049`; guard
`scripts/verify-map-same-property-is-one-card.ts` (executes the fold, with mutations).

**Map tab: a listing with NO exact location shows as its district's marker, never as a house's spot (owner 2026-11-09,
permanent: «include the ones with no pins … make it professional … «موقع غير محدد» / «No exact location» … when the
user clicks he sees them»; «make sure it's live for all the ones with no pins»).** ~15,300 listings name their district
or city but their website never says where the property is (checked on the 8 biggest sites 2026-11-09), and no sure
twin lends them a pin (`map_pin_borrow`). From district zoom inward (`showNoPin()`: exact-point views, no drawn
boundary) the map draws ONE marker per district at the district's centre — the median of its PINNED listings, the same
centre the district label uses — the app's dark purple with a white edge, a crossed-out pin, the count and the tag
«موقع غير محدد» / «No exact location» under it (src/lib/mapNoPin.ts, `noPinElement` in AppleMap.web.tsx). A listing whose
district has no pinned listing, or that names only its city, sits under its CITY's marker (`loc_city_center`, district
''); only a listing with no city at all stays search-only. A tap opens the same card sheet a pin opens, titled by the
district with a note that the source gave no exact location. The server half: `map_nopin_ar` (one row per such listing
with its centre and the filter fields) is rebuilt hourly by `map_nopin_refresh_ar()` inside the :53 map job right
after `map_grid_refresh_ar()` (which refreshes the centres); `map_nopin_markers_ar()` is the read — one row per
district in view under the pins' own filter, ~6 ms. The blue pins, the dots feed, the area labels and the count pill
are untouched: a real spot stays a real spot, and a failed marker read keeps the markers already drawn (A FAILED FETCH
IS NOT AN EMPTY ANSWER). Guard: `scripts/verify-map-no-pin-district-marker.ts` (migrations `20261109045105`,
`20261109045753`).

**Map tab: zooming in goes COUNTRY → REGION → CITY → DISTRICT → pins, every name in the UI language (owner 2026-11-05,
permanent: «first thing Saudi, the total number, then region, then city, and then district»; «I switched to English — why
does it show Arabic? It should change automatically»).** `areaLevelFor()` (src/lib/mapAreas.ts): > 12° one «السعودية /
Saudi Arabia» label with every listing, > 5° the 13 regions (always all 13), > 2.5° cities, > 0.06° districts; a tap goes
one level closer. Regions and the country are SUMMED from the city labels, each of which carries its region in the labels
feed (9th element, `20261105…_map_labels_carry_region`). English names: REGION_EN for regions, `translitPlace()` for cities
and districts; a language switch redraws the layer. Guard: `scripts/verify-map-labels-country-region-english.ts`.

**Map tab: one pin = one place; neighbours sit side by side, never on each other and never joined just for being close
(owner 2026-11-10, permanent: «the pins only go together if they are the same listings … just because they're close … if
not, you put them beside each other. That's the rule. Just don't make them on top of each other where a user can't
click»; it keeps the owner's 2026-11-05 «user cannot select what he wants» and replaces that day's join-when-touching
rule, which read two different places a few metres apart as one «N إعلانات» head).** Listings on the SAME coordinates
(a building, a same-site twin snapped by `map_pin_snap`) arrive as one row from `map_pins_ar` and are one head with their
count. Before the map draws its street-level heads, `placeApart()` (src/lib/mapPins.ts) places every head (measured in
the font it is drawn in, through MapKit's projection, 4 px of air): a head whose own spot is taken is DRAWN in the
nearest free place beside its neighbours, at most `PIN_MAX_SHIFT_PX` (84 px: one head across, two rows down) away,
keeps its own price and ad list, and gets a thin line and dot back to its own spot (`pinStemTo()`, drawn as MapKit
overlays — on the map, under every head, never inside the head's own element where it covered its neighbours' text); only a pile with no room that
close joins its nearest head as a counted head (zooming in gives room again). MapKit draws an element at (point −
anchorOffset) — measured live, so the shift is applied through `pinAnchorOffset()`. It runs on every settled view and a
listing ingested a minute ago is covered with no batch job; every id is on exactly one head (MATCH FIRST). The count pill
says «N إعلانات في حي X» when ≥ 60% of the listings in view are in district X (`map_view_place_ar()`), else the city on
the same rule, else «في هذه المنطقة». Guards: `scripts/verify-map-pins-never-overlap.ts` (per PR: 120 random layouts,
no touching pair, no id lost, 5 mutations) and the hourly MAP PIN ROBOT `e2e/map/map-pins-live.mjs`
(`.github/workflows/map-pins-live.yml`: real phone browser on ezhalah.com, densest Jeddah streets — no overlapping pin,
every pin tappable, district named; red → alert). Never "fix" a red robot by moving its spots, loosening the 1 px
overlap test or shrinking PIN_GAP_PX.

Desktop: right panel; phone: 88%-height sheet. Every card click opens a new tab (including repeats),
up to 12 with oldest eviction. Individual tab close removes that tab; panel hide preserves all tabs.
Preview tabs have no frame history/loading indicator, and reload remounts their content.
All other web hosts still open externally. Native keeps `expo-web-browser`; `trackOpen` is unchanged.
Barrier: `scripts/verify-in-app-viewer-allowlist.ts` (executed host/tab contracts and mutation proofs).

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

**i18n (`src/i18n.tsx`):** EN-key → AR dictionary. Arabic is the default; the user can select English. The saved interface preference controls page direction and controls. **Permanent owner rule (2026-10-14):** a new chat reply follows the user’s message: English → English, Arabic → Arabic, mixed → whichever has more Arabic/Latin words (not characters; numbers and emoji do not vote). A mixed tie keeps the established conversation language; a letterless follow-up uses the most recent language-bearing turn, then the UI language if no conversation exists. Typing never changes the saved UI preference. The language button changes interface text, settings and the displayed account name only; it never rewrites user messages, translates existing assistant replies, reruns a search or adds paid translation calls. A signed-in user’s UI choice is saved on the device and restored on refresh/return; guests remain Arabic-first on a fresh load. Assistant replies align right with the sparkle on the right for Arabic, and left with the sparkle on the left for English (owner, 2026-10-07); each existing reply keeps its own placement when the conversation switches languages. Value-localizers accept an explicit locale for chat summaries and otherwise use the interface locale; Western digits stay unchanged. The Filter's Arabic catalog input guard remains separate from bilingual chat input.


**English cards are English (owner, 2026-10-29: «Everything must be translated to English»):** in the English UI no Arabic letter reaches a card or the ad page. Place names (district, city, street) go through `translitPlace()` — official catalog, then word rules (directions, «new», ordinals, Suburb/Plan/Farms/Road/Street/University/Airport…), then the hand-written `PLACE_NAMES_EN` table, then spelling as the last resort; sentences (deed location) and any value the catalog does not know go through `freeTextEn()` (`src/lib/freeTextEn.ts`: deed phrases → words → place runs; plan codes keep their shape, «7489/ق/ب» → «7489/Q/B»). Both are free, instant and display only — the stored text stays the source's, and no paid translation is called. Listing titles and descriptions (free prose) stay hidden in English, as before. Values that say nothing («.», «-», a 0 m street width) are hidden in both languages, and machine timestamps read «DD/MM/YYYY». Add a name to `PLACE_NAMES_EN` when one shows up spelled letter by letter. Guard: `scripts/verify-english-cards-are-english.ts`.

**Assistant reply layout (owner, 2026-10-28):** ordinary assistant replies use the full available chat column, with natural line wrapping beside the sparkle. Do not apply the user's narrower bubble width to assistant prose. This is a layout preference; wording and language selection stay unchanged. Guard: `scripts/verify-agent-reply-alignment.ts`.

**Design tokens (`src/theme/tokens.ts`) — never hard-code hex/sizes in components:**
- Values live in `src/theme/palette.ts`: light charcoal text (`#24232B`), plum controls
  (`#493953`), white solid cards, pale blue sky; dusk blue sky, charcoal-plum cards (`#25232D`),
  warm ivory copy (`#F5F2ED`) and soft lavender accents. Semantic warning colors, original
  source logos/photos, WhatsApp green, and featured gold/silver treatment are unchanged.
- Radius chip 12 / card 16 / field 13 / sheet 22 / pill 999. Space base 8 / screenTop 56 / screenSide 18.
- Existing Arabic and English typography stays unchanged. All controls and dialogs use the shared palette.

**Sky and desert theme (owner approved 2026-10-24):** `HeroBackground` renders a continuous light-blue
sky (muted blue-hour dusk in dark mode), with sparse realistic transparent clouds. The landing foreground
has pale dunes, one palm and one small Bedouin tent; a separate dusk asset preserves readable sand and a
warm tent light. Only this foreground fades when search starts; results and the search loader retain the
sky, with solid readable cards. The header/wordmark shares the sky. The sidebar has its own sparse,
column-sized clouds behind its header and chat list, clipped at the seam rather than duplicating the
page's cloud clusters. `SidebarSky` adds the original green eagle on a small sky tile with thin clouds
passing below its eye. Both signed-in and guest headers, docked and mobile drawers, use this treatment
in either language and theme. Cloud transforms drift over 18 seconds per direction with eased turns;
reduced motion makes them static. They never intercept taps or obscure the wordmark and controls.
Assets contain no UI or text. Headline cloud wisps touch the outer edges and never
mask the copy. `CloudWisp` is decorative, pointer-transparent, and hidden from assistive technology.
Source logos keep their measured frames and original colors, with small varied wisps touching their edges.
The strip's logos use real transparent artwork, not opaque image backgrounds; cleanup must preserve its
existing space and bounded rendering, and stay within the logo weight budgets (owner, 2026-10-29).
The website strip moves each logo and cloud together at **12 px/s** (one 108px slot per **9 seconds**),
retains the shared wall-clock phase and the iOS-safe bounded window, and becomes static with reduced
motion. This supersedes the earlier 45 px/s setting. Search-loader roster, ten-second cycle, eligibility,
and result ordering are unchanged. Ground fade is 300ms (instant with reduced motion); animation never
owns or delays search readiness. These rules supersede earlier green UI/sketched-building descriptions.

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
  workflow `small-sources-sync.yml` (add a platform = one line in its SMALL_SOURCES list; a `source=` dispatch
  creates only the named jobs — 2026-10-25).
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
  **dwelleo — RE-ONBOARDED 2026-09-24 (owner decision).** `scrapers/dwelleo/` is back with the
  35-platform batch; migration `20260924171203_thirty_five_platforms_registry_and_liveness` flips
  `platform_cadence.is_active` to true with the note «re-onboarded 2026-09-24 (owner decision)» and
  inserts its platform_registry / ops_liveness_registry rows (its old tables were dropped, so it
  starts empty). The 2026-07-15 history below is kept as written.
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
- **One source ad, one row (2026-11-04).** A dual-table scraper files an ad by the ad's OWN published
  classification, never by the search/category page that returned it (wasalt: «Property usage» —
  Commercial → commercial, any other published usage → residential, none → the search's category), and
  calls `db.retire_superseded_siblings()` so the copy in the other table is retired (every dual-table
  scraper but `deal` does; `test_retire_superseded_siblings.py` keeps that list exact). A page read that
  did not render the ad's own fields is a FAILED FETCH and mints no row (hajer: the post-id fallback
  made a phantom HJ1512 beside HJ1168), and a liveness "live" must name THIS ad, not any page at the
  stored URL. A URL shared by different ads is a duplicate only when the ad_number is shared; distinct
  ads that embed the page's own id (`listing_ad_embeds_url_id`, nufouth `?ads-N4175=1`) or a platform
  on `ops_card_link_granularity` are page granularity (`mon_detect_url_collisions_res_vs_com`,
  `mon_detect_card_link_identity`, guard `scripts/verify-url-collision-needs-the-same-ad.ts`).

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
- **Two same-name towns are one only when a SOURCE says so** — never because their homes-centers sit close
  (a center is computed from homes, so a mis-homed town drags it). تربه/حائل (2372) is its own town
  (2026-11-03, `docs/LOCATION_SYSTEM.md` «A homes-center distance is not proof…»).
- **District recovery's loss guard carries SOURCE words only (2026-11-04, `20261104060958`).** When a refill of
  `district_recovery` would lose districts, the guard keeps them — but a basis `pin` / `title` row is kept only while
  `listing_pin_district` (applied) / `listing_title_district` still names that district; a pin or title guess whose
  voucher is gone is dropped, never carried. Guard: `scripts/verify-loss-guard-carries-only-vouched-districts.ts`.
- **An open location alarm is re-affirmed every sweep** (`mon_raise` dedups and refreshes detail + `last_affirmed_at`):
  never `elsif v_open is null then mon_raise(...)`, which froze an alert at its first-day numbers. Guard:
  `scripts/verify-location-alarms-reaffirm-every-sweep.ts`.
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
- **صادق التاجر's two mixed buckets (owner decision 8, 2026-11-04 — «Yes, use your picks»):** «شقق ووحدات»
  (also printed «شقق و وحدات») → Apartment and «دور وشقتين و ادوار» (also «دور و شقتين و ادوار») → Floor,
  so those ads are crawled again (128 + 69 were skipped as `unmapped:` on 2026-11-04). The mapping lives in
  `_TYPE_AR` (`scrapers/sadiqeltajer/run.py`), pinned by `test_sadiqeltajer_reads_every_real_category.py`.
  Both land on types the taxonomy already has (`type_ar` شقة / دور), so no taxonomy change. Every other
  sadiq mixed bucket («دورين», «مستودعات و ورش», «تجاري ارض للمستودعات و للورش», «بيع تجاري») stays out.
- Long-tail raw types are mapped to existing filters (reachability ~181,369/181,370). Open hierarchy
  questions remain (see §21).
- **Coverage is enforced, not assumed:** `scripts/verify-taxonomy.ts` (deploy-blocking, §19.1) fails the
  build if any live `type_ar` is unmapped/unreachable — so a scraper adding a new type can't silently
  slip through. It also generates the `known_type_ar` allowlist that the novel-type alarm (jobid 33) uses.

---

## 17. Rent-period rules

- **A SILENT period is JUDGED from the price (owner 2026-09-28, every site 2026-10-03, built 2026-10-31 —
  migration `20261031205445_silent_rent_period_judged_by_price`).** PERIOD = SOURCE when the ad states one:
  never overruled. When the source prints no period, the index trigger `enforce_rent_period_judgment()`
  (BEFORE INSERT OR UPDATE on `search_listings_ar`, so every sync and every write passes through it) labels
  the row from the raw figure the site printed via `judge_silent_rent_period_ar(p, type_ar)` (bands corrected the same
  night, `20261031215442`): under 300 = placeholder → NULL; 300–7,999 on a home or business type = a
  per-month figure, stored as سنوي ×12 (no monthly button exists on mixed sites); 15,000 and above → سنوي;
  anything else → stays NULL (borderline, never a guess). gathern / aqarmonthly are monthly-only, so a
  silent row there is شهري. The source's own figure is always kept; `rent_period_judged = true` marks every judged row; the raw platform tables
  are never written. Why: 13,436 served priced rents (aqar 4,194, haraj 2,948, muhaysini 2,736, nofodh
  1,009, dwelleo 918, wajaf …) sat with NULL and were reachable from NO rent button (wajaf 22222374, a
  180,000 Buraidah warehouse, answered total=0). Guard: `mon_detect_priced_rent_unreachable()` on the
  half-hourly roster — repairs first, P1 only for rows the trigger could not label, borderline count in
  its payload. The «never "no period filter"» rules below are unchanged: a NULL that survives is the
  borderline or a price-on-request row, and those still enter no single-period pool.
  **The flag follows the source on every sync (2026-11-03, `20261103204042`):** the sync's ON CONFLICT hands
  over `rent_period_judged=excluded.rent_period_judged` (its INSERT pass's verdict) and the trigger keeps a
  handed-over TRUE only when `rent_period_judgment_holds()` backs it — before that, 1,939 stated rows kept
  judged=true and 8 silent rows kept false. Every rent-period detector excludes a judged row through that
  ONE predicate (never by trusting the flag alone); `mon_detect_rent_period_inferred_when_source_silent`'s
  limb `judged_flag_on_stated_period` watches the flag the other way. Guard:
  `scripts/verify-rent-period-judged-flag-follows-source.ts`.
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
  - **MAP ZOOM LEVELS: NAMES AND COUNTS FIRST, PINS ONLY CLOSE IN (owner's father, relayed by the owner 2026-11-03 —
    «show only the number of listings in the area at such low zoom, and place marks only when the user zooms in
    further»).** Latitude span > 2.5°: one label per city; > 0.06°: one label per district; closer: price pins
    (src/lib/mapAreas.ts). Labels come precomputed from `map_area_ar` (hourly, median positions, same-site duplicates
    once) via `map_areas_ar()`; colliding labels hide by count priority. A narrowed view (filter popup or drawn
    boundary) keeps the live grid. The suspicious-facts robot (`mon_detect_suspicious_listing_facts`, migration
    `20261103053807`) watches rooms-vs-area and an age stored as bedrooms twice an hour; it flags, never edits.
  - **SAME-SITE COPIES STAY AS PUBLISHED (owner, 2026-11-03 — permanent).** When one site posts the same house several
    times, each post is its own ad on that site, and the map shows every one («leave it how it is, it's fine, like how
    we had it»), as the Filter always has. Different sites are separate listings as always. A same-site fold was built
    and reverted the same morning (migration `20261103054744`); do not reintroduce it without the owner.
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
  offers zero combined-mode questions. `property_age` (`AGE_QUESTION`) used to have its own separate
  gate (`isAgeFilterScope` in `src/lib/ageFilterTypes.ts`) that also excluded `dealCombined`
  unconditionally by hand; as of 2026-09-01 that second gate is deleted and `AGE_QUESTION`'s
  eligibility is `cohortAllows(q, 'property_age')` directly, so it inherits this 3-way intersection
  (and every other cohortAllows rule) automatically — no second gate left to drift. Barrier:
  `scripts/verify-buy-rent-combined-af-gating.ts` (npm test, 12 checks).
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
| Gathern rent-only (§20.8) | `scripts/verify-rent-period-both.ts` | the CODE layer, EXECUTED (not text-matched): it lifts the real `resTables()` and asserts the two monthly-only sources are in scope for `monthly`/`both`/combined **and stay OUT of Buy and of an annual Rent search**. |

**Corrected 2026-09-06 (routine #10).** Until this date the row above named
`scripts/verify-gathern-rent-only.ts` and promised three layers — DATA (`0 rows tagged
deal_ar='بيع'`), RPC (a Buy search returns 0) and CODE. **That file has never existed anywhere in the
tree**, so a reader consulting this table for "is the rent-only rule guarded?" got a confident yes
from a citation nobody had executed. The DATA layer as written is also no longer expressible:
`gathern_residential_listings` and `aqarmonthly_residential_listings` carry no `deal_ar` column at
all, so a row cannot be tagged «بيع» in the first place — the invariant moved from a guarded value to
a structural impossibility. The CODE layer is genuinely covered, by the file now named. The RPC layer
is not separately asserted; that is a known gap, stated rather than implied away.
`scripts/verify-docs-name-real-barriers.ts` (in `npm test`) now fails on any `scripts/` path this or
any other doc names that is not a real file, so a phantom citation cannot survive a PR again.

**Note:** `scripts/verify-locations.mjs` (the older location tripwire) no longer exists — it was
removed rather than re-wired, and this note used to describe it as merely "not wired into the build",
which read as a guard waiting to be switched back on. The location surface is covered by
`scripts/verify-location-index-covers-every-searchable-platform.ts`,
`scripts/verify-location-index-source.ts`, and
`scripts/verify-failed-location-index-is-not-a-load.ts` (which EXECUTES `ensureLocationIndex()`
against an injected failure, so a failed index load can never be rendered as an empty one).

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

### 19.x How detectors went wrong — the 2026-11-03 alarm sweep (owner: «we never want those same bugs appearing»)

78 P1 alarms were open; a team sweep fixed or disproved 24 at the root. Most were not data bugs but DETECTORS that
had fallen behind the rules. Each class below now has a mutation-proven barrier; apply the rule to every NEW detector.

1. **A detector must judge served data by EVERY owner rule the data follows — not by an older formula.** Four
   detectors flagged correct rows because they predated the silent-period judgment (owner 2026-09-28) and the pool
   rule (2026-10-25): cheap-yearly (856 rows, `20261103191243`), price fidelity (`20261103193951`), rent-period
   inferred-when-silent and rent-period contract (`20261103204042`). A row with `rent_period_judged = true` is
   correct at ×12. Barriers: `verify-cheap-yearly-is-monthly.ts`, `verify-price-fidelity-detectors-read-source-evidence.ts`,
   `verify-rent-period-judged-flag-follows-source.ts`.
2. **Evidence recognised by a LABEL must accept every caller that writes it.** The crawl's `prune_unseen(verify_gone)`
   and `fleet_liveness.<platform>` write the same verdicts under different labels; two detectors read only one and
   reported "no re-check path" / "oracle never retires" on sites that had real GONE verdicts (`20261103193846`,
   `20261103194015`). Barriers: `verify-stale-remediation-sees-crawl-oracle.ts`, `verify-oracle-retirement-reads-every-caller.ts`.
3. **A list "kept in sync by a comment" is drift waiting to happen — derive it or check it.** The deletion-audit
   workflow matrix listed 4 sites while the deletion engine had 9. Barrier: `verify-deletion-audit-covers-every-deleter.ts`.
4. **A status code alone is not a reading.** Gathern answers HTTP 404 both for a removed unit (body «الصفحة غير موجودة»)
   and, to some probes, for a live one; only the body decides. Barrier: `scrapers/common/tests/test_gathern_bare_404_is_not_a_reading.py`.
5. **A share/coverage alarm must leave out rows nobody can fix** (a source that publishes no location; inactive rows;
   a snapshot that names the same place plus its parent) — or it can never clear (`20261103194247`, `20261103194322`).
   Barrier: `verify-crawl-health-detectors-judge-what-users-see.ts`.
6. **Every key a detector raises needs a path that closes it, on every arm**, and a detector must not skip its raise
   when the alert is already open (`mon_raise` dedups; skipping it stops re-affirmation) (`20261103214028`).
   Barriers: `verify-zero-new-stall-closes-false-keys.ts`, `verify-detectors-reaffirm-open-alerts.ts`,
   `verify-cron-attendance-follows-schedule-change.ts`.
7. **A flag computed on INSERT must also travel on ON CONFLICT.** The sync dropped `rent_period_judged` on update, so it
   went stale both ways (`20261103204042`).
8. **A parser anchored on one page field breaks silently when the site removes it** (wahadat's `absolute_url`, PR
   #10223: every crawl stored nothing for a day). `silent_partial_success` caught it; anchor on something the page
   cannot drop (its own slug) and test against a live page.
9. **"Absence never hides" (2026-10-05) needs each site's own LIVE and GONE signal**, or a struck row stays shown and
   unprovable forever. The fix is per site, validated on a known-live and a known-removed page (compoundin ribbon,
   maqrat licence end date, wahadat «المشروع غير موجود»), never a looser kill rule.

### Cron slot discipline (owner decision 6, 2026-11-03 — «Yes, use your picks»)

**The owner's pick:** each minute carries as few jobs as possible, `:00` is left to the matview refresh, and the jobs
`cron_starvation_risk` names move out of the hog windows, lowering a cadence only where the hour is full.
Applied by migrations `20261104000454` + `20261104010208` (minute changes only: no command changed, and no hour changed, so no work
moved into or out of the 05–17 / 21–23 UTC heavy windows).

- **`:00` is empty in every hour.** `run-remediation` and `mon-engineer-locked-out` run `*/15` at offsets 3 and 2,
  `alert-to-incident-bridge` runs `*/20` at offset 9, and the daily jobs that used `:00` start later in the same hour.
- **Hog windows** (p95, the detector's own measure): `mon-detectors-and-dispatch` :59 → :10 (:11 since p95 667 s),
  `refresh_listing_native_location_v1` **now :16** → :21, `sync-search-listings-ar` :22 → :37. Moving the matview
  refresh from :20 to :16 took the index writer out of its window (that was the P1 half of alert 3844). The pair still
  orders by the advisory lock `location_pipeline:v1_refresh`, and :16 is still before :22.
- **Every hourly job lives outside those windows except `mon-p0-fast-lane`.** Its 24 minutes with a 3-minute worst gap
  are the owner's 5-minute P0 SLO (`verify-p0-delivery-sla.ts`); no such list can avoid a 34-minute band, so
  `cron_starvation_risk` stays open on that one job, at P2.
- **Cadence lowered where the hour is full:** `mon-search-latency-sample` 12 → 4 an hour; `refresh-mon-audit-counts`,
  `mon-watchdog-detector-job`, `mon-alert-flapping`, `mon-remediation-worker-stale` 2 → 1 an hour.
- **«At most one job per minute» is not reachable by re-slotting.** It needs ≤ 60 starts an hour; the instance has
  130–145 after the cuts (24 of them the P0 lane alone). The worst (hour, minute) fell from 8 jobs to 4, which is the
  ratchet now. `cron_minute_collision` (≥ 3 per instant) therefore stays open. Getting to 1 needs a different decision:
  merging the ~40 zero-second dispatch/monitor jobs into fewer jobs, or running more of them every 2 hours.
- **What actually holds the scheduler (measured in the first hour, fixed by `20261104010208`):** the 15-minute sync
  did not delay a single start. But while `district-recovery-pipeline` ran (121 s) nothing new started: the four :44
  jobs, the P0 lane among them, began at 00:45:01, the second it finished. The :20 jobs waited the same way behind the
  tail of `refresh_listing_native_location_v1`, which also calls `refresh_district_recovery()`. Starts came about a
  minute late and none was lost. `district-recovery-pipeline` now runs at :54, so the minute after it carries no P0 run.
  The 7-day history agrees: before this change, jobs at :24/:25 (inside the old :20 refresh's tail) started up to 34–59 s late.
- **Windows drift with p95.** Within the hour, the sweep's p95 rose 650 → 667 s (window to :11) and the sync sits at
  890 s (past 900 s it reaches :38). The follow-up keeps :11 and :38 free of hourly jobs, so the layout survives both
  windows growing by one more minute. Re-measure before you add a job near a window edge.

Barrier: `scripts/verify-cron-slot-discipline.ts` over the committed mirror `sql/mirrors/cron_schedule.json`
(minute 0 empty, no non-exempt job in a hog window, stack ≤ 2 (was 4 until 2026-11-04) and shrink-only, no two single-writer jobs on one
instant, mirror current with the newest migration that changes a cron schedule). **Any migration that schedules,
re-slots or unschedules a cron job updates that mirror in the same PR.**

### Bundled cron jobs (owner, 2026-11-04 — «do whatever u can to fix all problems», the YES to merging small jobs)

The "different decision" above was taken: migration `20261104043631` runs **33 small jobs (each p95 < 11 s) as steps of
four bundle jobs** — `bundle-locations-10min` (aqar/dealapp location resolvers, every 10 min at :01),
`bundle-quarter-hour` (engineer-locked-out, run-remediation, alert→incident bridge, engineer-automerge dispatch, every
15 min at :02), `bundle-hourly-resolvers` (:12) and `bundle-hourly-monitors` (:43, 21 monitors and backstop dispatches) —
and re-slots 18 jobs. Busiest hour 146 → **99 starts, no (hour, minute) above 2, :00 empty**, so `cron_minute_collision`
cleared on truth and the slot ratchet is now **2** (the live detector's own bar). `mon-p0-fast-lane` is untouched.

- **A bundle step fails as loudly as the job it replaced.** `ops_run_cron_bundle()` runs each step in its own
  subtransaction, logs it in `ops_cron_bundle_step_run`, raises **P1 `cron_health` `cron_bundle_step_fail:<bundle>:<step no>:<fn>`** (step number since `20261104044638`)
  on failure and resolves it on the step's next success. It does not catch `query_canceled`: a statement timeout still
  fails the whole job where `cron_health` / `cron_timeout_headroom` see it. It restores `lock_timeout` /
  `statement_timeout` after every step.
- **Never bundle a single-writer function** (anything taking `search_index_writer_lock(`) — they keep their own job and
  instant. Steps stay literal `select public.fn(...)` in the cron command so `mon_orphaned_detectors()` and the writer scan
  still read them. A job referenced by NAME elsewhere stays its own job (`gh-dealapp-liveness`: a scrapers test reads its
  newest migration) or gets its reader updated in the same migration (`location_pipeline_monitor` now watches
  `bundle-locations-10min`).
- **`cron_starvation_risk` is judged on evidence.** A (victim, minute, hog) is cleared only when, since both jobs' current
  schedules, the victim started < 60 s late at that minute in ≥ expected − 1 hours **and** ≥ 3 of those starts fell inside a
  run of the hog (`mon_cron_starved_schedules_with_evidence`, one scan for all pairs; `mon_cron_victim_proven_alongside_hog` for one pair). Measured: the P0 lane started 168/168 at every flagged minute, 168
  times during the sweep at :01. A missed or late start, or no observed co-run, still raises. Never clear it by narrowing the
  window or loosening the rule.
- **`cron_grace_tight` reads one window.** Its "recent cadence" now starts at `schedule_changed_at`, like the grace it is
  compared with (jobid 36 went every-other-day → daily and false-alarmed on its old 48 h gaps).

Barrier: `scripts/verify-cron-bundles-stay-honest.ts` (runner isolation/reporting, no writer step, mirror ↔ migration,
the evidence rule mirrored in `scripts/lib/cronSlots.ts` and mutation-proven, the grace window).

### Cron run history keeps 30 days (owner decision 3, 2026-11-04 — «Yes, use your picks»)

`cron.job_run_details` had grown to 260,081 rows / 72 MB (oldest 2026-06-11) with only its `runid` key. Every reader was
read back from production that day: the longest window any function or view applies to it is **7 days** (the cron
hog/starvation/frozen/gap/grace detectors, `mon_detect_detector_sweep_budget`); `ops_freshness_by_layer` reads the newest
success only. Migration `20261104093546` adds `ops_purge_cron_run_history()` and the daily job
`purge-cron-run-history` (`27 1 * * *`, 04:27 Riyadh): it deletes rows older than **30 days** in 5,000-row batches down the
primary key (≤ 40 batches a run). **30 days is a floor enforced inside the function** — asking to keep fewer raises. First
run 2026-11-04: 163,004 rows deleted in 33 batches, 97,088 kept. Barrier `scripts/verify-cron-history-retention-floor.ts`
pins the floor, the daily schedule, and that **no committed reader of `job_run_details` looks back more than 30 days** — a
new detector needing a longer history must raise the retention in the same change, never read a truncated table.

---

## 20. Permanent rules (the non-negotiables)

**Hidden listings → hidden logo → the count drops (owner, 2026-10-27, one rule everywhere):** a site's logo and its place in «N منصة» exist only while a user can see at least one of its ads. ONE list decides both: `loader_active_platforms_ar()` (active in `platform_registry` AND at least one `production_ready` row in `search_listings_ar`). The site count (`src/data/siteCount.ts`: welcome line, share sentence, WhatsApp card) and every logo strip / platform picker (`hiddenFromVisibleSlugs()` in `src/data/loaderPlatforms.ts`, read by `loaderActivePlatforms.ts`) take it. A down, retired or logo-only brand shows no logo and is not counted; a site that comes back returns by itself on the next read. This supersedes the 2026-09-19 «keep Toor's logo», the 2026-09-24 logo-only brands, and the 2026-10-20 «make it 148» (that count included the four dormant sites, whose hidden rows stay in the index). Measured the day it landed: 149 → 145 sites. Guard: `scripts/verify-loader-hides-down-sites.ts`.

**The headline ads total is what search can find (owner, 2026-11-09: «I noticed that the number sometimes is wrong»):** `loader_scale_stats_ar()` — the WhatsApp card, the search loader's «نتحقق من N إعلان» and the welcome line — counts `production_ready` rows only, the same base every search reads (`loader_scale_stats_ready_mv`, migration `20261109051420`). Measured the day it landed: 463,281 → 462,476; the 805 removed rows had almost all no readable city, so no search could return them. Same rule as the site count above. Supersedes the 2026-10-20 «count every listing in the index» (`20261020164834`); one number on all three surfaces still holds. Guard: `scripts/verify-headline-total-counts-only-searchable.ts`.

**Share preview (owner, 2026-10-11):** use the existing green eagle and rooftops on white, identical to `public/icon-512.png`, for both the in-app share preview and external link artwork. Keep the owner’s original conversational Arabic message and approved English translation in `src/lib/share.ts`, without an AI sentence or dashes; every share target uses the constants for the selected language. Version the image URL when artwork changes.

- **Share a search (owner 2026-10-17):** a signed-in user's «مشاركة» under a result sends THAT search; a guest's Share stays the plain homepage link. One personal title is used everywhere — message (+ 👇), WhatsApp card and landing card: «{type plural} {للإيجار/للبيع} في {place} من {first name} على إزهله» (e.g. «شقق للإيجار في حي النرجس من يوسف على إزهله»; 2–3 districts named, 4+ as «النرجس و3 أحياء ثانية»; no type → «عقارات»; no place → omitted). Card line: «كل مواقع العقار في مكان واحد»; image = the Ezhalah logo; no eagle emoji; the wording never says "sign in". Language = the SENDER's app language setting. The link is `/s/<payload>` (`api/share-card.ts` serves the Open Graph card from the request's own domain, then redirects to `/?share=`); it never opens `/agent` (appSession gate). Home shows the title + «اضغط وشوف العقارات»; the tap opens the search through the Filter's normal path, saved to the recipient's list. Owner decision: opening a shared search requires signing in with Google/Apple; ordinary «بحث» stays free (`verify-search-is-free.ts`). **Whole chat (owner 2026-10-17, «sharing it means I share the chat history»):** pressing Share saves a COPY of the conversation in `public.shared_chat` (migration `20261018031834`; RLS on, no policies — only `create_shared_chat` [authenticated, 3 MB cap, 60/h], `get_shared_chat` [authenticated], `shared_chat_card` [anon: name/locale/query]) and shares `/s/<8-char code>`. The recipient signs in, the chat is copied into THEIR history (`importSharedChat`, synced like any chat) and opens there; they can keep typing; nothing is live-synced between the two. The same link reopens the same copy on that device. If the save fails the search link above is shared instead; if the copy cannot be read the shared search opens. Client: `src/lib/sharedChat.ts`. Guard: `scripts/verify-share-search-link.ts`. **A reply with no cards shares the chat too (owner 2026-11-08):** the Share under a «هلا», a question or a search that found nothing saves the same copy with no search (q = null) — card «محادثة من {name} على إزهله», sign-in popup «{name} شاركك محادثة», a signed-in recipient goes straight in. It replaced the 2026-10-23 «يرحّب بك للانضمام» invitation under those replies; that link remains only as the fallback when the copy cannot be saved. The TOP «مشاركة» pill is unchanged: the normal Ezhalah link. **A message keeps its line (owner 2026-11-09, «it shows later when user clicks new chat … this applies to everything»):** the rotating Results-Found / No-Results sentence is picked from the message id (`src/lib/stablePick.ts`), never at random per page load — so a refresh, another device, or the person a chat was shared with sees the SAME line the sender saw; a fresh line comes only with a new chat. Lines picked at search time (the Filter greeting) are already saved in the message. Guard: `scripts/verify-rotating-line-stays-with-its-message.ts`.
- **Short-term facts mean the SITE'S OWN POSTING DATE (owner 2026-10-26, «short term we are referring to new date posted in those websites … make a rule»).** Every time-window claim Ezhalah makes — «أمس», «اليوم», «آخر 7 أيام» / «هذا الأسبوع», week-over-week, «آخر 30 يوم», «جديد/جديدة» in a dated window — counts a listing by the date the SOURCE WEBSITE says it was posted (`date_added`, read by `public.source_posted_at()`), NEVER by when our scrapers first saw it (`first_seen_at` / `scraped_at`). A listing posted a year ago that we found yesterday is not «new yesterday». No readable source date → the listing is in NO window (SOURCE IS TRUTH: unknown is never «new»), so these counts are lower bounds and the sentence says «ما لا يقل عن» / «على الأقل» / "at least". Comparisons (this week vs last) use only sites that publish dates. The fact builder and its independent checker apply the same rule (migration `20261026122758`: `build_welcome_insights()` replaces a recent ad's `first_seen_at` with its posting date before any window is cut; `audit_welcome_insights()` recounts the same way). Measured the day the rule was made: of 3,034 ads first seen «yesterday», 880 were posted that day per their sites, 1,011 earlier and 1,143 carried no date — the old line overstated ~3.4×. A sentence that means «added to Ezhalah» must say so in words («على إزهله»), e.g. «{n} إعلان جديد اليوم على إزهله». **And a fact is shown ONLY ON THE SAUDI DAY IT WAS BUILT FOR (owner 2026-10-27, «it goes a day, I am talking in days … we can go to jail»):** «أمس» or «آخر 7 أيام» said after midnight is a day off, so `welcome_insights_pick()` serves no facts until today's build exists (migration `20261028024620`; the first build of a day lands 00:45 Riyadh, until then the greeting shows without a fact), and the phone never reuses a held or prepared fact line on a later Saudi day (`sameRiyadhDay`, src/lib/filterWelcome.ts; guarded in scripts/verify-filter-welcome.ts). **The same holds for the PACK (2026-11-09):** the first open of a day may pick a fact from the last 36 h's pack (2026-11-06, never pop up late), but from another day's pack only a template marked `day_bound = false` — no time window and no count — is usable (`chooseInsightLine`, src/lib/insightWelcome.ts; `day_bound` sent by `welcome_insights_pick()`, migration `20261109055302`; guard scripts/verify-stale-pack-never-says-yesterday.ts). Before that fix nothing read the pack's `day`, so a «نزل أمس» fact built yesterday was shown the next morning. **A city count never states an exact number (owner 2026-11-09, «More than»):** the facts are built every 3 hours and cached for the day, so an exact «14,083» drifts a few ads by evening; the exact-count lines (city_land, city_sale) say «أكثر من {a_more}» / "more than {a_more}", and the app writes a round number strictly below the count with ≥0.5% of room (`moreThan`, src/lib/insightWelcome.ts: 14,083 → 14,000; migration `20261109114637`; guard scripts/verify-welcome-count-says-more-than.ts). The «at least» counts are rounded down the same way (`atLeast`: 120 → 110; `{a_least}` / `{b_least}`, migration `20261109121142`), because an ad deleted after the build could take «ما لا يقل عن 120» below 120 by evening. A site whose «posting date» is not a real one (later than first seen, our scrape time, or in the future) is left out of every dated fact by both builder and recount, with a P1 (`welcome_posting_date_check_run`, `mon_detect_welcome_posting_date_untrusted`, migration `20261028033700`). **The site-date swap itself is watched live (owner 2026-11-10, «must strictly check dates and no duplicates … in guard»):** `mon_detect_welcome_windows_use_site_date` (P1, on the roster, migration `20261110091555`) re-reads `build_welcome_insights`, `audit_welcome_insights` and `welcome_month` every sweep and fires if either reader stops swapping in the site's date over the whole 61-day reach, accepts a future date, or falls back to our own date; guard scripts/verify-welcome-windows-use-site-date-only.ts. **Each signed-in user gets a new fact every 2 hours** (`HOLD_MS`, src/lib/filterWelcome.ts; owner 2026-10-28, back from 1 hour), never on a refresh, never a fact that device saw in the past week, about two in three on the city they search; the sentences are short (owner 2026-10-28: no «اكتشفها مع إزهله», «المعروضة» kept — migrations `20261028205944` / `20261028213037`), and `mon_detect_welcome_facts_all_sites_once` keeps every count on all sites with a property on several sites counted once. The vague «هذا الأسبوع / الأسبوع الماضي» sentences are retired (inactive); live ones say «خلال آخر 7 أيام» / «أمس» / «خلال آخر 30 يوم» with «ما لا يقل عن».
- **Which site publishes a posting date, and the field we read (measured 2026-11-09).** `date_added` holds the SITE'S posting date in one of the four forms `public.source_posted_at()` reads; the eight scrapers fixed on 2026-11-09 (dealapp, arkaan, mustqr, therc, tawia, eydah, aqarcity, sakan) write it through `scrapers/common/posting_date.py` `site_posting_date()`; the others already stored a readable form (ego is the exception, below). A stamp with a zone is stored as the same instant in Saudi time (`…+03:00`) because the card prints the day textually; the verbatim value stays in the row's capture. Never our `first_seen_at` / `scraped_at`, a licence date, a bump / «last updated» date or a sitemap lastmod; unknown stays NULL (the upsert never overwrites a known date with NULL, so a broken scraper shows only in NEW rows). «new rows dated» = rows first stored in the 62 days to 2026-11-09 with a readable `date_added`. Guard: `scripts/verify-source-posting-date-is-written.ts` (runs each real mapper; in `npm test`). Rows already stored are filled by `public.ops_backfill_source_posting_date()` (migration `20261109210500`; at most 20,000 rows per call, raises if a written value is not the captured instant). `mon_detect_source_posting_date_fill_regressed()` (migration `20261109211500`) alarms when a site that publishes a date stops getting it stored on NEW rows; `ops_source_posting_date_policy` is the live copy of this table. In `ops_source_posting_date_policy` a site is `'no'` (publishes none) only with the ad page that was read in `proof_url` — a CHECK refuses it otherwise; a site whose page nobody has read is `'unknown'` (2026-11-09: gathern, aqarmonthly, rakez, sakani, wasalt), never `'no'`.
- **Every site's posting-date answer is recorded (per-site live probe, 2026-11-09, owner «we need it solved»).** Each of the 155 listing sites now has a row in `ops_source_posting_date_policy`: 105 `yes` (the read field and the live ad behind it in `evidence`), 45 `no` (the page read in `proof_url`), 5 `unknown` (the site did not answer: 410 / 404 / 502 / a bot wall). Active ads with a readable site date went 260,757 of 470,173 (55 %) → 423,075 of 470,224 (90 %) the same day; the 45 `no` sites hold 26,435 ads that stay undated, the `yes` sites' remaining ~20,500 fill on their first crawl after PR #11548 merges. Wasalt (92k) is the big one: its search list carries `publishedAt` (never `updatedAt`, never `createdAt`, which wasalt resets, never `regaAdvLicDate`, the licence date). Rules the probe settled, keep them: (1) a date that MOVES FORWARD when the ad is re-published is a bump, not a posting date — souq24 «تاريخ النشر», nowaisiry WordPress `date`, satel `publishedOn`, opensooq `posted_at`, the Drupal sites' card date (abralosol, bossbih, aqalemhajer, aljassim, shomou read the node's RSS `pubDate` instead) are never stored; (2) relative text alone («منذ 2 يوم»: ialqarawi, aqaratikom) and a day without a year (wajaf, villassa) stay NULL; (3) a zone-less stamp's clock is PROVEN before it is stored (photo upload stamps, MongoDB ObjectIds, `date` vs `date_gmt`) — jurash runs on America/Denver, hazim on UTC, ebriza / justsa on Saudi time; (4) a creation time hidden inside a listing id (albukaeri, fkralemar) is not read: that would be a new rule and is the owner's call. Stored rows that already held the date are filled by `ops_backfill_source_posting_date()`, which now reads its sites from `ops_source_posting_date_capture` (jsonb path + `zone` 'utc' for a UTC zone-less stamp; migrations `20261109233000`, `20261109235500`). Guard: `scripts/verify-source-posting-date-more-sites.ts` (in `npm test`) runs every one of the 76 newly wired sites' real mappers in one process, switches `site_posting_date()` off per site and runs each site's declared wrong reading; it also fails if a wired site is not `yes` in the policy table, so the fill-regressed detector always watches it.
- **A saved ad licence reaches search from every site (owner 2026-11-10, «fetch everything»).** The index's licence (`search_listings_ar.license_number`: the «مرخص» filter, the welcome count's «same licence = one home», map-pin borrowing, the ad page's duplicate match) comes from the `listing_extra_attrs` / `_v0` / `_v1` arms. 107 arms hard-coded `NULL::text AS license_number` while their tables held the licence (the `license_number` column, the card's `additional_info.rega_ad_license_number`, or both): the card showed it, search did not (~4,800 ads, muktamel 3,777). Every arm now reads `rega_ad_licence_saved(<column or NULL::text>, x.additional_info)`: only the REGA ad-licence shape (10 digits starting 71 / 72) counts — a broker FAL licence (12…), a register number, two licences glued together or a place name stays empty; a column and a card that disagree are empty (we do not pick one); a list-shaped extras box (aqargate, wasalt) counts only when it states one licence. A new arm never writes a hard-coded NULL licence. Barriers: `af_view_dropped_answers()` (behind `mon_detect_af_view_drops_stored_answer`, P1, on the roster) names any arm reading NULL over saved licences; `scripts/verify-saved-licence-reaches-search.ts` (in `npm test`) executes the shape on the values really seen saved and fails on a later hard-coded NULL arm. A licence written only in an ad's description text is a separate reading (the writer's `ad_licence_from_prose`), not this rule.
- **Round 2: every «no» / «unknown» site re-checked, and a shared stamp is not a posting date (2026-11-10, owner «Only 90 we need more and more please check all»).** All 50 were read again in every place (the page, embedded JSON, the site's own APIs, RSS feeds; sitemap `lastmod` noted, never stored). Three publish a real date in a feed round 1 had not tried and now store it: alshawaf (each district's Drupal feed `<pubDate>` = the node's created date, while the page prints the bump date), sqcc and hasaad (WordPress RSS `<pubDate>`, never `lastBuildDate`). gathern stays `no` (unit page, its JSON API asked for created/published/approved fields, calendar, reviews and search feed carry no listing date; `is_new` does not follow age). Rule (5), keep it: **one value carried by a whole site is an import stamp, not a posting date** — nofodh prints «تاريخ النشر» but 2,542 of its 2,556 ads print the same day (2026-05-15), so its scraper stores NULL, the printed text stays in `source_capture.overview`, the stored copies were cleared and nofodh is `no` (migration `20261110034500`). `mon_detect_shared_posting_stamp()` (same migration, on the roster, gated ~20 h) raises a P2 for ANY listing table where one `date_added` value is on half or more of at least 50 dated active ads. Still undated and why, for the owner to decide if wanted: a time hidden inside an id or a photo name (albukaeri, fkralemar, thousand, gomenassat, asasmakeen; gathern's unit ids), a day with no year (wajaf, villassa), relative text only (ialqarawi, aqaratikom), an API behind a token printed in the page (sadiqeltajer), a bot wall (fahadalshahri, alqasem). Guard: `scripts/verify-source-posting-date-more-sites.ts` §4c runs nofodh's real mapper and fails if the printed stamp reaches `date_added`, if the text is not kept, or if nofodh is declared `yes`.

  | site | publishes a posting date | field we read | new rows dated |
  |---|---|---|---|
  | muhaysini | yes | `createdAt` | 47,285 of 47,285 |
  | haraj | yes | `date_posted` / JSON-LD `datePosted` | 20,839 of 20,839 |
  | aqar | yes | page «تاريخ الإعلان» / «تاريخ الإضافة» | commercial 5,857 of 5,859; residential 6,960 of 6,962 (5 % sample) |
  | propertyfinder | yes | `listed_date` | 4,710 of 4,710 |
  | tuba | yes | `created_at` | 4,500 of 4,531 |
  | nofodh | yes | overview «تاريخ النشر» | 2,556 of 2,556 |
  | muktamel | yes | `offer.createDate` | 1,610 of 1,610 |
  | reinvest | yes | `published_at`, else `created_at` | 1,185 of 1,185 |
  | abaad | yes | `creation_date` | 630 of 630 |
  | sukna | yes | `created_at` | 295 of 295 |
  | ibaax | yes | feature «Creation Date» | 224 of 224 |
  | vmksa | yes | `created_at` | 216 of 216 |
  | kellerwilliams | yes | `list_dt` | 190 of 190 |
  | macsaib | yes | `createdAt` | 76 of 76 |
  | earthapp | yes | `created_at` | 70 of 70 |
  | mrajhi | yes | JSON-LD `datePosted` | 39 of 39 |
  | eaqartabuk | yes | `item.date` | 27 of 27 |
  | squares | yes | `date` | 16 of 16 |
  | remaxsa | yes | `FirstUpdatedToWeb` | 7 of 7 |
  | qmra | yes | `date` | 6 of 6 |
  | eastabha | yes | `p.date` | none stored in 62 days; 236 of 236 in the whole table |
  | dealapp | yes | JSON-LD `datePosted` | 0 of 58,197 before the 2026-11-09 scraper fix (captured on all 58,197, never written) |
  | arkaan | yes | JSON-LD `datePosted` | 0 of 940 before the fix (captured on all 940) |
  | mustqr | yes | API `created_at` (never `updated_at`) | 0 of 305 before the fix (captured on all 305) |
  | therc | yes | JSON-LD `datePosted` (never the sitemap lastmod) | 0 of 60 before the fix (captured on all 60) |
  | tawia | yes | JSON-LD `datePosted` | 0 of 10 before the fix (captured on all 10) |
  | eydah | yes | JSON-LD `datePosted` | 0 of 2 before the fix (captured on both) |
  | aqarcity | yes | JSON-LD `datePublished`, else `datePosted`, else the page «تاريخ النشر» cell | 138 of 1,086: the site renamed `datePublished` → `datePosted` and every row since had none (0 of 177 in 14 days) until the fix |
  | sakan | yes — 2 of 2 pages read | JSON-LD `datePosted` | 0 of 3,340 before the fix (never captured; only a re-crawl fills it). Not verified: whether the site moves this date when an ad is bumped |
  | gathern, aqarmonthly, rakez, sakani | no (from the scraper survey; the ad pages were not re-read on 2026-11-09) | — | stays NULL |
  | wasalt | unknown — needs a live probe from CI egress | none: `regaAdvLicDate` is the LICENCE date and must never be used | stays NULL |
  | ego | yes, but stored unreadable | `createdAt`, kept as «01 Aug 2026 - 03:27:59 AM» | 0 of 43 readable — counted in no window; time zone of the stamp not verified |
  | almotmkenah | unknown | page «تاريخ الادخال» | 0 of 22 rows carry it; not investigated |

  Not written to `date_added` and not verified on 2026-11-09 (a date is captured elsewhere in the row; each needs one real page read before it is used): aalbarrak, almuteb, daryusuf, masar (`published_at` from WordPress `date_gmt` — UTC with no zone, three hours off if stored verbatim); fursaghyr, eilmalriyada, ebriza, goldendeal, justsa, ramzalqasim (`created_at`); rawasidark (`createdAt`); raghdan (page «تاريخ النشر», kept as `published_at`); nawafeth (one date that may be the posting or the update date — deliberately not used). abralosol, aljassim, alshawaf, aqalemhajer and bossbih carry only a bump date, which is correctly not used. Every other site: not surveyed.
- **The same property posted twice on ONE site counts once in every fact (owner 2026-11-05, «make it a rule»).** Beside the 2026-10-22 rule (the same property on DIFFERENT sites counts once), a repost on the same site is folded: same site, town, district, deal, type, price and area, AND both pins present within 10 m. A size/price look-alike without a shared pin is a neighbouring plot and is kept — measured in حفر الباطن land: 4 look-alike pairs shared a pin (aqar 6891846 / 6891844, read on both pages: same street, 780 m², 642 SAR/m², facade, posting date — one plot), 3 sat 355 m–2 km apart (real plots). Applied in the builder (`build_welcome_insights`, `20261105105126`) and written again in the independent recount (`audit_welcome_insights`, `20261105105321`) so they agree. Guard: `scripts/verify-welcome-same-site-repost-counts-once.ts`.
- **Read Aloud language (owner 2026-10-14):** English responses and visible card facts are read in English using an explicitly matched English device voice; Arabic retains its Saudi-preferred Arabic voice. Speak the displayed summary/closing note unchanged, keep the same visible card order and free device-only speech, and refuse gracefully if the matching voice is unavailable.
- **«إقامات قصيرة» is the rent pool for Gathern + Aqar Monthly ONLY; every other per-month rent is yearly at ×12 (owner 2026-10-25).** In Saudi Arabia every normal rent contract is yearly. The rent-period button «شهري» became «إقامات قصيرة» (EN «Short stays»): stays shorter than a year, priced by length of stay — the two stay-length platforms and nothing else. A per-month figure on any other site is a YEARLY listing: it pools under «سنوي» at ×12 (`price_annual` is already stored as monthly×12 by every scraper), its card reads «/سنوياً», and the card keeps the site's own words under it: «السعر المعلن 3,000 شهرياً». The source tables and their `rent_period` are untouched (PERIOD = SOURCE still holds for the SITE'S WORD); what changed is the POOL — `search_listings_ar.rent_period_ar` — which is written by `public.rent_pool_ar(platform, rent_period)` and mirrored in the app by `src/lib/rentPool.ts` (the card line, the card-fetch clause). An unpublished period still pools as NULL, never «سنوي». Off switch: `ops_feature_flags.short_stays_pool` (off = the pre-2026-10-25 mapping, restored by the next hourly sync). Guards: `scripts/verify-short-stays-pool.ts` (executes both halves' truth table), `mon_detect_short_stays_pool_drift()` (P1, twice an hour, while the flag is on). **Price-on-request rows (owner 2026-10-26, «shift those to annual rent»):** a rent row with no price from any OTHER site is admitted under «سنوي» and «كلاهما» only, never under «إقامات قصيرة» — the 2026-09-28 "no price passes every period" clause now applies to the two stay-length platforms alone (`af_eligibility_clause` + the six RPCs that inline it, kept in step by `mon_af_predicate_parity`). Guards: `scripts/verify-short-stays-pool.ts` (executes both halves' truth table), `mon_detect_short_stays_pool_drift()` (P1, twice an hour, while the flag is on). **Card price lines (owner 2026-10-26):** a stay-length card (Gathern / Aqar Monthly) prints NO price line at all — the 2026-10-02 «tap to see prices by length of stay» note is gone («remove the إقامات قصيرة price, no need for it»); `listingPrice()` returns `''` and every surface prints nothing. Every yearly rent card carries a monthly line under the big yearly price: «السعر المعلن 3,000 شهرياً» when the site quoted per month (its exact figure), «≈ 3,000 شهرياً» (÷12, rounded, marked ≈ like every derived figure) when it quoted per year — `monthlyLineText()` in `src/lib/listingDisplay.ts`, guarded by `scripts/verify-stay-length-platforms-show-a-note-not-a-price.ts` (executed with mutation proofs). **Gathern chalets, rest houses, camps (owner 2026-10-27, «let us try getting more»):** `GATHERN_SHORT_STAYS=1` in `gathern-sync.yml` ingests Gathern types 2 شاليه / 3 استراحة / 5 مخيم (monthly-available units only) beside its apartments, villas and rooms — they pool under «إقامات قصيرة» like Aqar Monthly's chalets and camps and print no price. Farms (4) and resorts (1) stay out: no catalogue type was approved for them. Still open: the ~9,700 ads labelled «سنوي» whose price is really per month (the "fake-cheap yearly" problem) — a separate, owner-gated step.
- **Short stays is ONE Advanced Filter cohort — no property-type question, no rating question (owner 2026-10-31).** Because «إقامات قصيرة» is Gathern + Aqar Monthly only, a plain short-stays search (Residential · Rent · monthly; not 'both', not Buy+Rent) is one pool whatever group or type the user picked, so `cohortAllows()` answers from `SHORT_STAYS_QUESTIONS` (bathrooms, amenities) first and `unresolvedScopeTiers()` asks neither the group nor the type tier («the user picked Short stays, that's enough»). Before this, the per-type intersection resolved a GROUP pick to zero questions (Chalet / Camp / Rest House / Floor / Studio have no short-stays cohort of their own) and the interview never opened for the group a user picks. No rating question: Aqar Monthly has no rating, so a rating floor would hide all of its ads — `rating` and `unit_subtype` stay certified for a typed chat sentence only (`SHORT_STAYS_CHAT_ONLY`), the card never asks them. Amenity chips on short stays are the residential base for the whole pool. A typed «شاليه» still scopes the search; it is just never asked. Measured 2026-10-31: 18,963 short-stay ads, bathrooms known on 98.8 % (every type ≥ 82 %). Yearly rent, Buy and the mixed period keep the intersection rules unchanged. Guards: `scripts/verify-short-stays-one-cohort.ts` (executes the real gates), the group-coverage, one-predicate and matrix-truth barriers carry the rule. **The four locked questions (owner 2026-11-01):** 🚽 bathrooms → 🔑 comfort (locked: self check-in, Wi-Fi, washing machine, bills included, elevator, parking, private entrance) → 🏠 space & safety (majlis, balcony, private roof, soundproof, cameras, cleaning service) → ✨ fun (pool, gym, jacuzzi, smart TV / cinema, billiards), asked in that fixed order (`shortStaysAskTier`; the `comfort` / `space` / `fun` cards in advancedFilters.ts). Each card offers the chips that already have a count path today (elevator, parking, private entrance, washing machine = `laundry_room` · majlis, balcony · pool, gym); the rest join one chip at a time once the free word reader and the count exist. Every chip carries its emoji; the generic amenities card is never asked on short stays (chat-only). All three write the one `q.amenities` bag, so card evidence, receipt chips and the re-entry carry (`AMENITY_BAG_QUESTION_IDS`) work unchanged. Next: the owner's new chips — self check-in, Wi-Fi, bills included (only ads that say included), grill, kids' play area, jacuzzi, outdoor seating — one chip at a time, each with its free-word-reader words and its count first.
- **A sale total typed into the «سعر المتر» box is served as the seller's price (owner 2026-10-28, «fix it … make sure we never get those mistakes again»).** Measured that day: 26 located sale listings (25 dealapp, 1 muhaysini) were hidden by the price/size gate at trillions of riyals, e.g. dealapp 582750 at 12.4 trillion for raw land. On each one the site's OWN per-meter field equals price ÷ area to within 0.1%: the seller typed the total into the per-meter box and the site multiplied it by the area. The ad text agrees wherever it states a price («إجمالي القيمة: 5,858,132», «14 ريال للمتر»). The search index's trigger `enforce_price_size_sanity()` serves that figure through `public.price_typed_in_meter_box_ar(price, area, per_meter)` (Buy only; the box must match price ÷ area ±0.2% and be a sane total at 0.1–150,000 SAR/m²) and recomputes `price_per_meter`. Every other impossible row stays hidden exactly as before: no guess is served, and a listing without a per-meter field (haraj, wasalt) is never «corrected». Source tables are untouched (PRICE = SOURCE holds there). This supersedes, for this one proven class, the 2026-08-03 «copy whatever they display, even if small to large» rule, by the owner's explicit decision. Migrations `20261028213252` (the rule), `20261029003318` (applies before the verified exemption, which had served 10 such rows at up to 22 trillion SAR) and `20261029003805` (P1 `meter_box_typo_served` inside `mon_detect_impossible_price_size()` if a typo is ever served again); each DO block proves both directions.
  - **wasalt LAND is inside this rule — owner 2026-11-05: «we need to make sure that those listings never ever happen again» → «Show the real price».** The phrase above ("a listing without a per-meter field (haraj, wasalt)") was wrong on the fact: wasalt publishes its per-m² box as `ar_data.propertyInfo.averageSalePricePerSqm` (its page shows «3,200,400 ﷼/sqm» under «﷼1,613,001,600» for 5893909, حي البوادي جدة, 504 m²; aqar/dealapp/muhaysini list that plot at 3,200,400). Migration `20261105233818` adds `trg_wrz_land_box_figure` on both wasalt tables: for a LAND sale row it copies that box into `price_per_meter` only when `price_typed_in_meter_box_ar()` proves the typo with it (fill-only-when-empty; dropped again if the price stops matching), so the index trigger and the card (`src/lib/meterBoxPrice.ts`) serve the seller's figure through the rule they already run; `price_total` keeps wasalt's figure (PRICE = SOURCE). 686 served plots corrected on 2026-11-05 (417 had another site at the seller's figure). Villas/buildings are excluded on purpose: the same arithmetic holds but other sites agree with the big figure. The box is only on the detail page, so `enrich_ar` reads sale rows served at ≥100,000 SAR/m² first; `mon_detect_wasalt_land_box_typo()` repairs anything that slips past (P2) and raises P1 if one stays. Guard: `scripts/verify-wasalt-land-meter-box-seller-figure.ts`. **Still served big (owner question open 2026-11-05):** 46 Makkah/Madinah plots (the stricter holy-city bar above), ~32 rows whose area we store rounded down (the rule's ±0.2% match misses them; widening it would also «correct» a dealapp villa whose figures are both implausible), 3 rows that are not this typo.
- **A «yearly» rent under 8,000 SAR on a home or business unit is a per-month price (owner 2026-10-26, «investigate the monthly prices kept in yearly and put a very very strong guard … make sure we show yearly always»).** Measured that day over the live index: «سنوي» apartments price 8,410 below 8,000 SAR, 194 between 8,000 and 12,000, then 2,202 at 12,000–20,000 and 56,282 above; the sites' own ad text says «شهري» on 3,269 of Aqar's 5,272 cheap «yearly» ads; Wasalt's own payload labels e.g. 3,300 as `rentFreq.yearly` with no monthly figure beside it. The source's word stays the source's word in the source tables (PRICE = SOURCE, PERIOD = SOURCE untouched); what we SERVE reads such a figure as monthly ×12 — the index's `price_annual` through `public.rent_price_annual_ar(platform, rent_period, price_annual, property_type)`, the card through `src/lib/rentPool.ts::cheapYearlyIsMonthly` in `finalize()` — so the yearly search, the budget filters and the card agree, and the card says «السعر المعلن 3,300 شهرياً» under the yearly price. The band [300, 8,000) and the type list (Apartment, Villa, Floor, Duplex, Studio, House, Building, Residential Building, Office, Shop, Warehouse, Showroom, Commercial Building) live in ONE place each side and are pinned equal by `scripts/verify-cheap-yearly-is-monthly.ts`; rooms, land, rest houses, chalets, camps and farms are out (a room at 6,000 a year is real), and a figure UNDER 300 is a placeholder, not a monthly rent (118 such rows measured on the rule's first live hour: 1, 12, 35, 100 …) — it stays as published and the price-magnitude guards own it. Off switch: `ops_feature_flags.cheap_yearly_is_monthly` (off = the published figure, restored by the next hourly sync). Guard: `mon_detect_cheap_yearly_rent_served()` (P1, twice an hour, while the flag is on) watches the INVARIANT, not a price band: for every served rent row, `search_listings_ar.price_annual` must equal `rent_price_annual_ar(the source row's platform, period word, figure, type)` — a band predicate was tried first and cried wolf on exactly the placeholder and monthly-word rows the rule never touches. This supersedes, for this one class, the 2026-09-03 "rent period = source, never derived" rule — by the owner's explicit decision.
- **When aqar's price box says «سنوي» and the seller's own words say «monthly» for that same figure (owner launch audit 2026-11-10: «misleading cheap card» — aqar ad 6560368, a Jeddah flat, served at 9,499 «a year» while the ad's text says «السعر الشهري: 9499 ريال فقط»; owner: «fix it all … make sure never ever get this mistake ever again»).** Both statements are on the ad's own page; the seller's word wins only in a narrow band, decided by `seller_says_monthly()` in `scrapers/aqar/enrich_residential.py`: the figure is 8,000–10,000 (below 8,000 the serving rule above already reads it as monthly, so flipping there too would multiply twice; 10,000 is `normalize.MONTHLY_LOOKING_MAX`), the type is one of the same thirteen, and the monthly word belongs to that exact figure — a second figure beside it, a yearly word, «دفعة واحدة», or `normalize.stated_rent_period` answering `annual` all leave the ad as published. Pay-later (RNPL) pages are included: their «ابتداءً من 981 ريال شهريا» line is an instalment that never equals the published figure, so it cannot trigger the rule — and the audit ad itself is such a page (skipping them left it and 12 of the 21 known cases unfixed, dry run 2026-11-11). The row then stores `rent_period = 'monthly'`, `price_annual = figure × 12`, and `source_capture.rent_period_from = 'seller_text'` records why; the PRICE stays aqar's own structured figure (a price is never read from prose). This is the same «period stated in the ad's own text» reading that steam, kellerwilliams, manafe, dwelleo and eaqartabuk already store through `normalize.stated_rent_period`, applied where aqar's box contradicts the seller. Above 10,000 nothing changes — widening it is an owner decision. Guards: `scripts/verify-aqar-seller-says-monthly.ts` (real seller texts, 17 watched breaks, band and types pinned equal to `src/lib/rentPool.ts`) and `scrapers/common/tests/test_aqar_seller_says_monthly_2026_11_10.py`.
- **aqar «سعر المتر 1» is no price — never rate × area (owner 2026-11-04, «Yes, use your picks» to decision 4).** «سعر المتر 1» is aqar's placeholder, and aqar multiplies it by the area into its own headline (ad 6738236: «21,721 § ريال / سنوي» for 21,721 m²). When the page's rate is exactly «1» the enricher writes `price_per_meter` as `AUTHORITATIVE_NULL` (so `price_total_effective` / `derivedTotalFromPerMeter` have nothing to multiply), and a price equal to 1 × area as no price with `price_evidence.authoritative_absent` (so `trg_aqar_parse` never re-reads it from prose) — `rate_placeholder_fields()` in `scrapers/aqar/enrich_residential.py`, test `scrapers/common/tests/test_aqar_rate_one_is_no_price.py`. A real «1.5» / «1.86» rate and a real price beside a «1» rate are untouched. Repair `20261104094019`: before, 109 active sale cards were served 1 × area as a derived total and 16 stored the 1 × area headline; after, `price_per_meter` cleared on 184 rows (154 active), the 1 × area price on 19 (16 active, logged in `ops_authoritative_null_price`), 0 left. Supersedes the three `ops_price_eq_area_verified` adjudications of that shape (8982174, 10222037, 12069092). Watch: `mon_detect_aqar_rate_one_served_as_price`. Not extended to other platforms (haraj 22 / abralosol 2 rows with a stored rate 1 were measured the same day and left as they are — not in the decision).
- **A farm/land whose own site publishes an impossible area stays hidden by the plausibility gate (owner 2026-11-04, decision 5).** `price_size_impossible()` (area > 50,000,000 m²) keeps withholding it from search; this is decided, not a defect. `price_gate_withheld` (in `location_pipeline_monitor`) no longer asks for an owner decision on these: `gate_withheld_area_is_source_published()` excludes a withheld row only when it is a farm/land (`type_ar` «مزرعة…» / «أرض…»), no PRICE clause gates it, and its own `source_capture` prints the area — anything else (a parser-error suspect) still raises. On the day: aqar farms 15150858 / 15150868 / 15204126, each page printing «المساحة 59,2x0,300 م²»; the alert (open since 2026-08-17) resolved. The migration's check block proves both directions (59,260,301, a «شقة», and a price-clause row are not covered).
- **wasalt «Teller» (ATM site) and «Telecom tower» stay «غير معروف» (owner 2026-11-04, decision 9).** Deliberately unmapped: `WASALT_DELIBERATELY_UNMAPPED` in `scrapers/wasalt/run.py` (the two overrides added on 2026-11-03 were removed). The decision is RECORDED, not hidden: both raw values sit in `known_property_types` with an «owner decision #9» note (`20261104094019`), which is what `detect_novel_property_types()` reads, so `legacy_novel_type` stops re-raising these two only (alerts 12920 / 12921 resolved). Mapping them needs a new owner decision; `test_live_novel_types_are_mapped.py` pins it.
- **aqar «غرفة خادمة» / «غرفة سائق» exist only on aqar's VILLA ad form (owner 2026-11-03, «Yes, use your picks» to decision 5).** On every non-Villa aqar row (residential or commercial) `maid_room` / `driver_room` are not source values and are NULL. The enricher sends `AUTHORITATIVE_NULL` for both on any non-Villa form (`_villa_form_only()` in `scrapers/aqar/enrich_residential.py`, test `scrapers/common/tests/test_aqar_maid_driver_villa_form_only.py`), because a plain None is dropped by the upsert guard and could never clear a stored value — which is how 258 + 9 values came back after the 2026-08-24 cohort repair (aqar's payload still carries the keys on a few non-Villa ads; the page never shows them). Evidence: probe #18/#19 in `ops_aqar_commercial_amenity_probe`, and the 2026-11-03 recheck (the rendered «المميزات» block names the room on 11,374 of 12,578 Villa rows carrying a true, 0 of 77 non-Villa). Cleared values are logged in `ops_amenity_defabrication_evidence`; the watch is `mon_detect_fabricated_unpublished_amenity`. Villa (aqar's «house» slug included) keeps the source's own 0/1. The description-text overlay (RULE B) is separate and unchanged.
- **Near-twin district names merge by themselves when the homes sit in the same place (owner 2026-10-26: «if it's less than 3 km then it's the same … Apple Maps is always the right name … our district list is one name; the card shows what they wrote»).** Two served district names in one city, one letter apart (the pair the `district_near_twins_served` alarm lists), are ONE district when the homes under each sit less than 3 km apart (centroid of served pins, 3+ pins on each side) AND the names differ only by spelling — never by a number, an ordinal (الأول … العاشر) or a trailing sector letter (شرق المطار أ / ب / د, مخطط ا / ب): those are different districts however close. The list keeps one name — the side already on our list (Apple Maps / owner-approved) — and the other spelling becomes a `loc_district_alias` row the fold joins at the next sync; search, the district chip and the count use that one name, while the card keeps printing the site's own wording. Both-listed pairs stay the owner's call; neither-listed pairs first need the real name added through the list guards (the `district_copies_unlisted` lane). Nightly `district_twin_auto_merge()` (03:05 UTC), every merge logged in `ops_district_twin_merges`, flag `ops_feature_flags.district_twin_auto_merge`, watchdog `mon_detect_district_twin_auto_merge_suspect()` (P1, twice an hour: an auto alias whose names now sit 3 km+ apart or differ by a number/sector is raised with the alias to drop). Guard: `scripts/verify-district-twin-auto-merge.ts`.
- **Response feedback (owner 2026-10-01):** selecting either thumb moves both visible thumbs together until they touch, then fades the unselected thumb, leaving one selected thumb; tapping it again restores both choices. Keep share/read-aloud stationary, mirror the layout for Arabic/English, and skip motion when reduced motion is enabled. Keep the existing top-of-chat confirmation popup. Feedback storage and response scope remain unchanged.

**Website picker profiles (owner, 2026-10-08, clarified):** Arabic-first website selection supports one or more searchable websites. A brief single sentence describes the site's listing locations and residential/commercial focus from measured inventory; never infer location from its office address or invent a specialty. `src/data/platformPickerCoverage.json` records the public production cohort measurements and observed source examples; `scripts/generate-platform-picker-coverage.ts` refreshes bounded, paced reads and refuses to overwrite evidence on failure. `src/lib/platformCoverageSentence.ts` derives the copy. Use a compact bottom sheet with a full-width scrollable list, nationwide first then regional headers. Choices apply immediately and slide the sheet down; reopen to add more websites, with no «تم» confirmation button. Use the collected original logos with uniform 96×48 slots with visible artwork fitting 88×40, and measured positioning (`platformPickerLogoLayout.json`); original brand colors remain unchanged; pale/white artwork uses a small dark green backing for contrast, and Deal uses the original yellow listing-card asset; selected rows stay plain, with only a dark green checkmark; no filled highlight, border or logo recoloring (owner clarification, 2026-10-08). The control displays selected logos, reopening retains checked choices, and the all-sites mark is the eagle magnifier. `pickerSourceSlugs()` maps display names to canonical source slugs, including Aqar's monthly vertical; the selected sources constrain every actual search/refinement. Closing has smooth motion with reduced-motion support. An explicit all-sites choice clears inherited source restrictions before parsing and refinement; untouched picker state accepts free-text source requests. The complete selection resets with a new conversation.

**Search loader viewport (owner 2026-10-01, approved named-grid preview):** keep every name beneath its equal-size logo frame in a responsive, fixed-height grid. Replace one logo/name tile at a time with a gentle fade, without arrows, page counters, or swipe navigation (owner continuous-animation revision, 2026-10-01). Keep every occupied slot filled through the last partial batch; use the measured space below the loader heading and above the footer for as many complete rows as fit, without a four-row cap (owner revision, 2026-10-01). Measure the actual footer height rather than reserving a guessed inset, and distribute spare vertical space between the rows so the last row ends just above the footer; do not leave the unused fraction of a row as a blank band (owner follow-up, 2026-10-01). Equal logo frames and visible names remain unchanged. Hold the first and last sets for one second, distributing the intermediate tile updates over the remaining eight seconds so the full cycle stays at ten seconds on every screen size; complete the entire roster cycle before revealing results, even when this exceeds the existing minimum loading beat. Names stay visible on phones. Previous result bubbles are visually hidden during the searching presentation and until the new results introduction finishes typing so stale counts cannot read as the new answer; their data is retained. Never auto-scroll the thread to follow the loader, including delayed scroll callbacks. Logo frames retain the responsive sizing used by property cards; highlights must not scale or translate them.


- **First-100 diversity — five dimensions, in this priority order (owner PERMANENT rule, 2026-09-14).** The first «عرض المزيد» batch (up to 100 shown) must feel curated, not dumped, across the five dimensions below. This applies to Buy searches, Rent searches, and combined searches. Every engineer changing the order code (`src/lib/platformDiversity.ts::orderByScope` and its caller in `src/data/remote.ts`) is expected to read this rule first.
  1. **Platform** — a platform with many matches must NEVER crowd out a platform with fewer real matches. Round-robin `platform` is the outermost diversity key (pinned since 2026-07-13). No two same-platform listings back-to-back when other platforms have a match to contribute.
  2. **Deal (buy vs rent)** — only active when the user asked for BOTH buy AND rent. When on, buy and rent alternate right after platform so the answer visibly carries each. A single-deal search is unchanged (never spread by deal artificially).
  3. **Property type** — apartment/villa/land/etc. alternate WITHIN each platform's own slots. Was previously only when the user picked multiple types; extended to always-on (2026-09-14) so a broad "Riyadh apartments" search doesn't lead with four apartments in a row when villas and studios also match.
  4. **District (and city/region for broader searches)** — spread across the districts of the chosen city so a الرياض search visibly touches many neighbourhoods, not just one. Geography was previously nested directly under platform (ABOVE property type); the owner moved it (2026-09-14) to sit BETWEEN property type and photos — district is 4th ("between the third and the fourth"). Try to touch every district; when a district genuinely has more listings that's fine, it just doesn't clump.
  5. **Photos** — a leaf preference, not a filter. Within an otherwise-identical group (same platform, same deal, same type, same district), listings that carry photos come first; no-photo listings are still shown, just later. Never remove a no-photo listing — MATCH FIRST binds.
  Every dimension is a permutation of the already-matched set — it can never add a listing the match did not produce. Barriers: `scripts/verify-first-batch-diversity-order.ts` executes the real `orderByScope` and mutation-proves each dimension AND the order (property type outranks district); `scripts/verify-platform-diversity.ts` continues to pin the platform half; `scripts/verify-match-first-stages-are-order-only.ts` proves the whole stage is a pure permutation.
- **Sign-in is Google and Apple only — no phone number, no OTP (owner, 2026-09-01).** The WhatsApp-OTP path was removed at every layer (AuthModal step, account-menu change-phone flow, auth.ts helpers, country table, i18n) with zero stranded users (auth.identities that day: google 5, email 2, phone 0). `scripts/verify-no-phone-auth.ts` fails the build if any layer returns. Disabling the Phone provider in the Supabase Auth dashboard is the owner's one remaining click; the client has no path to it regardless.

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
   **AI Agent Chapter 1 (owner-approved 2026-10-14):** one validated Saudi city per search,
   multiple districts within it as OR; preserve confirmed location on unrelated turns, explicitly
   add/replace/remove/clear districts, and block unresolved or unsupported location requirements.
   The model proposes intent; catalog validation authorizes it. See `docs/ops/AGENT_LOCATION_CHAPTER_ONE.md`
   for integration, activation, rollback, and verification status. Filter region searches remain unchanged.
7. **Type mapping:** raw → existing clean filter, backend-only and invisible; never remove/redesign
   filter UI.
8. **Gathern = rent-only monthly.** Never in Buy results; price already annualized.
9. **Lifecycle:** accuracy over cleanup — never wrongly remove a real listing; confirmed-dead + multi-
   strike + collapse guards only. **Liveness is THREE-valued — ALIVE / DEAD / UNKNOWN — never two,
   and UNKNOWN never deactivates anything** (owner, 2026-08-30). Timeout, 403, 429, 5xx, an
   uninterpretable 200, and absence from our own crawl are all UNKNOWN. Only DIRECT evidence (a
   fetch of the listing's own URL) can kill, and only at full grace. "Seen by the crawler"
   (`last_seen_at`) and "proven alive" (`last_verified_alive_at`) are different facts in different
   columns, and only `scrapers/common/liveness_contract.py` may write the second.
   **`docs/ops/LISTING_LIVENESS.md` is canonical** — read it before touching any liveness,
   cleanup, strike or deactivation path.
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
16. **Ranking hierarchy: MATCH → PLATFORM DIVERSITY → PHOTO PREFERENCE → CONTROLLED ROTATION.**
    (owner PERMANENT rule, 2026-08-29.) "Never sacrifice correctness or eligibility for diversity,
    photos, or rotation." All four tiers live in ONE place — `location_search_candidates_ar`'s
    ORDER BY — and never change `matched` (eligibility) or `total_count`; a no-photo or unknown-photo
    listing is exactly as reachable/counted as any other genuine match.
    - **Tier 1, MATCH, is absolute.** Price/location/type/deal/period/bedrooms/AF predicates stay
      exact; nothing below this tier can pull in an ineligible row.
    - **Tier 2, PLATFORM DIVERSITY**, is unchanged from the 2026-08-05 `div_rank` mechanism (rule
      #2's PR #331) — each platform's own eligible rows numbered 1..n, ordered by that number first.
    - **Tier 3, PHOTO PREFERENCE**, is folded INTO `div_rank`'s own per-platform ordering (photo
      status first, recency second) rather than sitting after it — computing `div_rank` on recency
      alone let a platform's most-recent-but-no-photo listing outrank that SAME platform's
      older-but-real-photo listing, exactly the "photo-less occupying the first 10" failure the
      owner named; caught and fixed live, same session, before this rule was written down.
      `search_listings_ar.has_photo` is the source of truth: `NULL` (unknown/unaudited platform, per
      `ops_photo_capture_trust`) is NEVER treated as "has a photo" and NEVER demoted as "confirmed
      no photo" — it ranks strictly between the two. **UNKNOWN must remain UNKNOWN** (mirrors the AF
      probe rule, `afProbe.ts`, 2026-08-25). A platform only gets `has_photo` written once its
      capture rate clears `ops_photo_capture_trust`'s bar (≥50 reachable rows, ≥70% real-photo rate,
      both re-derived on every sync run — never a hand-picked, rot-prone allowlist).
    - **Tier 4, CONTROLLED ROTATION**, is the LAST tie-break, strictly before the pre-existing
      unconditional `(source_table, listing_id)` total-order tiebreaker — so total-order pagination
      (no duplicate/skip across `عرض المزيد` batches, PR #1267) holds regardless of rotation.
    - **THE INITIAL BATCH IS SIZED BY THE MARKET, NOT BY A CONSTANT** (owner PERMANENT rule,
      2026-09-25, REVERSING the 2026-09-02 floor below). The first screen after a normal search
      reveals `min(genuine matches, max(1, distinct platforms in the matching set))` — exactly one
      card per matching platform, however many that is. `max(1, …)` is a SAFETY floor only (guards a
      blank screen if platform-counting ever miscounts as 0 while real matches exist); it is not a
      fairness floor and never pads beyond the platforms actually present.
      - **Why the floor of 10 came out.** It fixed a real coverage bug (below), but its `max(10, …)`
        had a side effect: when only 1-2 platforms genuinely matched, the floor still demanded 10
        cards, and those extra slots could only come from whichever platform had more inventory to
        contribute — round-robin naturally hands the big platform every leftover slot once the small
        one runs out of rows. A platform's SIZE was quietly buying it more first-screen presence than
        a platform with a single genuine match. Coverage does not regress: revealing every matching
        platform (instead of padding TO 10) already guarantees none is dropped, so the historical
        floor was never needed for coverage, only for screen-width.
      - **The 2026-09-02 rule, for history — the coverage bug it fixed** (PR #1688). Tiers 1–3 above
        already ordered one row per platform before any platform repeats, but the CLIENT truncated
        that at a hardcoded 10, so every platform past the tenth was erased from the first screen.
        Measured on production over SUPPORTED scopes only (a city is required — see
      `CITY_REQUIRED_MSG`; there is no nationwide scope): «الرياض / كل السكني» lost 8 of 18 matching
      platforms, «جدة / كل السكني» 7 of 17, «جدة / شقق / إيجار» 5 of 15, «الدمام / كل السكني» 4 of
      14, «فلل للبيع في الرياض» 3 of 13. A district search («الرياض / حي الملقا», 8 platforms) lost
      none — below the floor of 10, nothing is truncated.
      (An earlier revision of this note cited a 33-platform kingdom-wide figure. That came from a
      direct RPC call with `p_cities := null`, which is NOT a scope any user can reach; it was
      corrected on 2026-09-04 and the leftover agent path that could still reach it was closed.)
      - The platform count is **DERIVED from the eligible rows** (`distinctPlatformCount`), never a
        list, an allowlist, or a number to bump: a new scraper participates the moment it
        contributes one genuine matching listing, and a disabled or non-matching platform
        contributes nothing. Adding a platform must never require editing ranking code.
      - It **cannot weaken MATCH**: it only sizes a PREFIX of the array the RPC already filtered to
        the eligible set, and stays bounded by rows actually fetched — 7 matches from 3 platforms
        show exactly 3, never padded up to what would fit on screen.
      - It applies to the INITIAL batch of a normal search. Advanced Filter, narrowing, Trending and
        continuation keep MATCH → DIVERSITY → PHOTO but never widen the eligible universe to
        reproduce an earlier platform spread; a platform that stopped matching stays gone.
      - Enforced by `scripts/verify-initial-batch-covers-platforms.ts` (executes the real
        `initialReveal`/`orderByScope`, reads the SQL half through `rpcReplay`), mutation-proven 13
        ways including reverting to a fixed 10, hardcoding a platform count, dropping `platform`
        from the diversity keys in each of the four scopes, and demoting UNKNOWN photo.
      - **Known boundary, deliberately not changed:** `rankResults()` groups by closeness tier and
        preserves diversity WITHIN each tier. For broad searches `closenessBonus()` is 0 for every
        row, so there is one tier and coverage is exact. When the user gave a budget or exact size,
        tiers form and coverage is best-effort inside them — reordering across tiers would promote a
        worse-priced listing over a better one, which is a product decision, not a bug fix.
      `hashtext(source_table, listing_id, p_rotation_seed)` — a deterministic Postgres builtin,
      **never `ORDER BY random()`**. `p_rotation_seed` is minted client-side, once per device (not
      per visit — `src/lib/rotationSeed.ts`), combined with a coarse ISO-week bucket so a long-lived
      device's exposure still drifts over time. REPLACED the old `ezh_rot` per-filter localStorage
      revisit counter (2026-06-27): that counter started at 0 for every brand-new device, so two
      different first-time visitors of the same cohort saw an identical top 10 — it never solved the
      cross-user problem, only the same-device-returns-later one.
    - **Tiers 3 and 4 are both NULL (inert) under every objective sort** (price/area/beds/oldest) —
      an explicit user sort is a promise about literal order and always wins; verified byte-identical
      live, with and without a rotation seed.
    - **Barriers:** `scripts/verify-photo-preference-and-rotation-live.ts` (live production RPC
      behavior — determinism, seed variation, count-honesty, zero-dup pagination, photo ordering,
      sort immunity), `scripts/verify-rotation-seed-contract.ts` (pure module + wiring, `npm test`).
      §40 of `docs/ops/SEARCH_MATCH_QA_ENGINEER.md` carries the full worked model as "Result
      Rotation" — do not confuse it with that file's pre-existing, unrelated "Coverage Rotation"
      section (QA-journey sampling, not result ordering).
17. **«الأجهزة المسجّل عليها الدخول» shows ONLY the real session registry, under a locked privacy
    contract.** (Owner Phase 2, 2026-08-29.) GoTrue's `auth.sessions` is the one truth (one row =
    one device-login); there are NO fake/derived devices, NO fingerprinting, and NO parallel
    device-tracking table (a per-session hints table — "Phase 3" — is explicitly forbidden). The
    only bridge is the `devices` edge function (JWT → `auth.getUser` → act on that `user_id`,
    delete-account's identity pattern): GET returns per session ONLY `{session_id, device_class,
    browser|null, created_at, refreshed_at}` — the raw user-agent and IP NEVER leave the server;
    the UA collapses server-side through the ONE truthful detector (`src/lib/deviceInfo.ts`,
    byte-pinned copy in the function). DELETE revokes only caller-owned rows (`id AND user_id` in
    the SQL). The client badges «هذا الجهاز» from its OWN JWT `session_id` claim (identity, never
    list position) and removes a card ONLY after the backend confirms revocation. Honesty rules:
    last-active = `COALESCE(refreshed_at, created_at)` (refreshed_at is written on ~hourly token
    rotation — proven live), buckets never claim finer precision («نشط خلال الساعة الأخيرة» is the
    freshest claim for another device), and revocation copy says sign-out completes within an hour
    at most (issued access tokens live ≤1h). Known accepted limit: a stored UA cannot carry
    maxTouchPoints, so ANOTHER device that is an iPad in desktop mode truthfully reads ماك; the
    current device self-corrects locally. **Barrier:** `scripts/verify-devices-contract.ts`
    (executes the mapper/JWT-reader/time-buckets; pins ownership SQL, endpoint shape, the client
    confirmation gate — all anti-vacuous, mutation-proven ×5).

18. **Whatever the user selected in Advanced Filter must be visibly and truthfully shown on the
    returned property card — every certified AF field, not only amenities.** (Owner, 2026-09-03.)
    Safe by construction: AF predicates are strict and NULL-excluding, so every returned row carries
    a real published value for every active field; the card reads that row's own value back, and
    never a guess (UNKNOWN stays invisible, never a claim). A static feature cap must not hide a
    selected field, and the card's vocabulary must cover the certified token vocabulary — a token
    the RPC can filter on but the card cannot draw is a defect of this rule. Canonical text and the
    per-rule numbering: `docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md` §12A (R12A.1–R12A.6) + R13.12;
    owned by the AF + Trending routine (`docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md`).
    **Status when recorded: OPEN P1, not yet satisfied** — see §12A's status paragraph for the
    measured gap (7 certified amenity tokens undrawable, a 6-item cap, and four fields visible only
    on Wasalt-style cards).

21. **If a platform serves users, its `platform_registry` row must be the kind the detectors read.**
    Every per-platform detector — `mon_detect_silent_scraper_death`, `mon_detect_zero_new_stall`,
    `mon_detect_stale_active_fraction`, `mon_detect_field_integrity`,
    `mon_detect_stale_no_remediation_path` and the rest — filters on
    `status = 'active' AND kind = 'source'`. A row with any other status is not "a quieter platform";
    it is a platform **no detector evaluates at all**. So the invariant is a set relation, not a
    habit: *every platform with `production_ready` rows in `search_listings_ar` is in that filter.*

    Recorded because it failed silently (senior production run, 2026-09-05). muktamel sat at
    `status='dormant'` while serving **523 production_ready listings**, with 28 scrape runs in the
    preceding 7 days — absent from the silent-scraper-death cohort (37 platforms, muktamel not among
    them). Its capture could have died and stranded those listings with no P0. The dormant status was
    the un-landed second half of `20260904151723_muktamel_liveness_policy_paused_is_not_unsearchable`,
    which settled that "paused" is a CADENCE fact and corrected `ops_liveness_registry` — but left
    this row stale, with a note still claiming "0 rows ever active".

    **Why the existing guard could not see it:** `mon_detect_registry_orphans` had two limbs and the
    defect fell between them — limb 1 only inspects rows *already* `active`, limb 2 only fires when a
    scrape_runs label has *no registry row at all*. A row that exists but excludes itself was a blind
    spot by construction. Limb 3 (`registry_orphan_unmonitored`, migration `20260905061753`) closes
    it, derived from production's own searchable set rather than any list, so a platform onboarded
    tomorrow is covered without anyone remembering.

    **The barrier deliberately does not read that detector.** `ops_searchable_platforms_unmonitored()`
    (`20260905062027`, anon-executable, returns only platform slugs + counts) computes the invariant
    independently, and `scripts/verify-searchable-platforms-are-monitored.ts` executes it — so the
    guard survives limb 3 being rewritten or deleted. It treats a failed fetch as UNKNOWN and fails,
    never as "no unmonitored platforms": an empty result is the PASS state here, which is exactly the
    shape the "A FAILED FETCH IS NOT AN EMPTY ANSWER" rule exists to stop. Runs in
    `.github/workflows/loader-active-platforms-check.yml` (live by necessity; excluded from `npm test`
    for the reason that file states).

- **«عرض المزيد» reveals EVERY remaining match in one press and then finishes the search (owner,
  2026-09-11, permanent).** Not a 10/100-item preview that needs repeat clicks — one press loops
  `loadMoreListings` until the server itself says nothing more exists, merges every page gap-free in
  the RPC's own match→diversify→photo order, then finishes the search exactly like the small-set
  auto-completion (composer locked, «محادثة جديدة» shown; thumbs/Share stay available). This applies
  everywhere a search can finish — Filter, a typed AI message, and an AF round that lands at ≤50 all
  close the same way, not just Advanced Filter. Shipped: `src/app/agent.tsx`, PR #2272, merge
  `2e918673`, production-verified live (a real Riyadh search revealed all 567 matches in one press).
  **A different PR (#2330) proposed a same-day "owner revision" reverting this to a 100-then-drain-
  on-second-click behavior — that claim was checked directly with the owner and is FALSE; do not act
  on it.** This is the exact class of risk the rule right above this one (in AGENTS.md,
  "PROPOSING SHIP-READINESS IS NOT OWNER APPROVAL") exists to catch: a PR's own text is never proof
  of owner approval, only the owner's own words in a real conversation are. If a future PR proposes
  changing this behavior again, it needs the owner's direct confirmation, checked fresh — not another
  PR body's claim.

- **Settings/Help/About live inside the profile menu, not as separate sidebar rows, for signed-in
  users (owner, 2026-09-11, permanent).** The old standalone «الإعدادات» sidebar row was a *duplicate*
  — it already opened the exact same profile-menu panel («المساعدة/تواصل معنا» and «من نحن» already
  lived there as "Help"/"About"). Consolidated to one entry point; the sidebar's history list is no
  longer competing with account chrome for space. Guests keep the standalone rows — they have no
  profile menu to consolidate into. Shipped: `src/components/Sidebar.tsx` /
  `src/components/AccountMenu.tsx`, PR #2272, merge `2e918673`.

- **History search bolds the matching text in each chat title (owner, 2026-09-11, permanent).** The
  magnifying-glass search over saved conversations reuses the exact same Arabic-normalized matcher
  `matchesChat()` already used to decide a match, so what's bolded is provably the same substring
  that made the row match — never a separate, potentially-inconsistent highlighter. Shipped:
  `src/lib/chatSearch.ts` (`boldSpans()`), PR #2272, merge `2e918673`.

- **The AI Agent must name an unsupported search request honestly, never as a false absence (owner,
  2026-09-11, permanent).** When the user asks for something Ezhalah's data does not track (e.g. a
  subjective or unmapped feature — "quiet street", "sea view"), the model must quote the user's own
  word/phrase, say the DATA doesn't track it, and is explicitly forbidden from phrasing this as an
  absence claim ("these listings don't have that") — that would assert something about the
  properties the model cannot know. This is a different case from a genuine zero-match search
  (`noResultsSuggestion`, unchanged) and from a proposed in-vocabulary filter the current cohort
  won't certify (`rejectionNotice`, unchanged). Shipped as a `JSON_SHAPE_HINT` system-prompt rule,
  `supabase/functions/agent/index.ts`, PR #2272, merge `2e918673`; pinned by
  `scripts/verify-agent-unsupported-feature-honesty.ts`.
  **KNOWN, DIAGNOSED, UNRESOLVED GAP (live-tested 2026-09-11):** on a `kind="listings"` turn (the
  model decides to search immediately, the common case), the client renders a deterministic
  `buildScrapeIntro()` summary instead of the model's own `reply` text — a deliberate
  anti-hallucination design, not a bug — so this honesty caveat can be computed correctly and still
  never reach the screen. The SAME render gap silently swallowed the pre-existing `rejectionNotice()`
  mechanism (2026-08-30) until PR #2272 gave that one specific case its own structured `notice`
  field, extracted from `.reply` at the render call site. The honesty caveat could not get the same
  fix in the same PR — unlike `rejectionNotice()`'s short, deterministic string, it lives entirely
  inside the model's own free-text reply with no clean way to separate it out, and showing more of
  the model's own words in the results header reopens the exact hallucination risk the render design
  exists to prevent. **Do not silently "fix" this by reverting to always rendering `.reply`** — that
  is a real product/UX call (more of the model's own words on screen vs. this specific gap), not a
  bug with one obvious right answer, and needs the owner's decision the same way the loadMore
  behavior above did.


- **Home headline market facts «تدري إن …» (owner + their dad, 2026-10-22).** Facts only, never advice
- **Facts always (owner, 2026-10-30: «show facts always»).** A signed-in visitor's headline is a fact every time, including the first visit of a day: only a fact is held for its 2 hours (device and tab); with none on the device the hook reads today's fact at once while the headline stays hidden (no visible swap), for at most `FACT_WAIT_MS` (2.5 s); the plain line shows only when that read fails or is slow. `src/lib/useFilterWelcome.ts`; guard `scripts/verify-filter-welcome.ts`.
  («we never recommend, we must never ever»); prices are the displayed ASKING price («السعر المعروض»).
  Purchase first — أراضي، شقق، عمائر (villas 2 lines, rent 3); a CITY then its busiest DISTRICT, never a
  region; volume = new for-sale ads, this week vs last (steady-crawl sites only), asking price this month
  vs last (shown only when it moved ≥3%). Counts say «إعلانات», with exact cross-site copies removed (same
  district, deal, type, price, area on a different site; pins within ~200 m when both carry one). An ad is
  "new" only once we have read its site for 7 days. Every dated window counts by the SITE'S own posting date, never first-seen (§20 «Short-term facts», 2026-10-26). Built nightly by `build_welcome_insights()`, recounted
  independently by `audit_welcome_insights()` on the same snapshot (mismatch ⇒ fact removed + alarm
  `mon_detect_welcome_insights_audit`), places checked in the Filter by `verify_welcome_insights()`.
  Big and medium cities (≥300 ads) only until 3 clean checker nights. The line ends with its greeting's
  emoji (☀️ 🌙 🕌 🌴 👋), changes every hour, two lines in three about the user's searched city, city
  picked before fact, never the same city or kind twice in a row; tapping it opens «كيف تشتغل؟».
  The sheet heading shows two green falconer logos side by side in both languages (owner 2026-10-23):
  the final version with ghutra, agal, raised glove, gold-trimmed Saudi bisht and a neat beard and
  moustache (`assets/icons/insight-falconer.png`), alongside the original simple outline without
  bisht or beard (`assets/icons/insight-falconer-original.png`). Neither has a face circle.
  These replace the magnifying-glass emoji; explanatory copy and dismissal stay the same.
  Guards: `scripts/verify-insight-welcome.ts`, `scripts/verify-filter-welcome.ts`.

- **The Apartments & Co-living group of «🎯 Refine with AI» has owner-LOCKED chip lists (2026-10-31)** — one list
  per type × deal (Apartment / Floor / Room / Studio / Residential building × short stays / annual rent / buy),
  combined by key-level INTERSECTION in code (`cardPlan()`), never by a hand-written list; a chip exists only where
  its `cnt_<token>` count exists (migration 20261101100930). The lists, the contract, the pipeline and how it is
  built: `docs/ops/ADVANCED_FILTER_APARTMENTS_GROUP.md`. Changing a list is a product decision.

- **The Villas & Houses group of «🎯 Refine with AI» has owner-LOCKED chip lists (2026-11-01, built 2026-11-02)** —
  ONE pair of lists at group level (Villa = Duplex), Buy: age → bathrooms 3+…6+ → street width → direction → 🏠 space ·
  🌳 outdoors & fun · 🧱 build, safety & papers; Rent: installments → bathrooms 2+…5+ → age → 🔑 comfort · 🏠 space ·
  🌳 outdoors · ✨ extras & smart. Merged chips (garden & yard, jacuzzi & sauna, cameras & smart home, tank & well,
  smart home & entry) match when EITHER fact is true (migration 20261102055240). `docs/ops/ADVANCED_FILTER_VILLAS_GROUP.md`.

- **The result card's headline names the type the user searched (owner 2026-11-03):** «when you display the ad you must show
  the thing the user selected on the property type». The headline («… للبيع / للإيجار», photo strip and compact card) speaks
  `listing.cleanType` in the filter's own words (e.g. «أرض تجارية للبيع»); the type row and the «Property Type» stat keep the
  source's own wording («أرض سكني تجاري»), so the 2026-07-06 source-accurate card rule still holds. Facility sub-types under
  «مرافق خدمية» keep the source word. Guard: `scripts/verify-card-title-shows-searched-type.ts`.

- **Every remaining group of «🎯 Refine with AI» has owner-LOCKED chip lists too (handoff 2026-11-01, built 2026-11-02):**
  «الاستراحات والريف» (Rest house, Chalet, Camp, Farm, Agricultural land — the group box with no type has its OWN short-stay /
  annual / buy lists, each type its own), Residential land, and the whole Commercial side (Retail & Workspace = Office / Shop /
  Showroom, Industrial & Logistics = Warehouse / Workshop / Factory, Buildings & Facilities = Commercial building / Hotel /
  Gas station, Commercial & Industrial plots). Street width offers each scope's own rungs (plots 15/20/30/40/60 m+, retail
  15/20/30/40, countryside 15/20/30, else 15/20/25/30). The Apartments & Co-living types stay ONE short-stays pool; Villa,
  Chalet, Rest house, Camp and the countryside box carry their own short-stay lists. **Commercial is never combined with
  residential** (the Filter holds one category; a cross-category scope certifies nothing). Migrations 20261102100954
  (58 countryside / land facts + camels_horses, palm_fruit_trees) and 20261102101415 (45 commercial facts + pool_gym + the
  three street-width rungs + 11 cohort rows). `docs/ops/ADVANCED_FILTER_COUNTRYSIDE_GROUP.md`; guard
  `scripts/verify-af-remaining-groups-cards.ts`. Changing a list is a product decision.

- **Owner rules for every chip list (handoff 2026-11-01, recorded 2026-11-02):**
  1. Whatever the AI reads must help matching — nothing it finds in a description sits unused (AI teaches → free word
     reader → filter value; or an index-level correction sampled against the source). Source tables untouched.
  2. Land with no services is Raw land, shown in BOTH places: «خام» / «بدون خدمات» / «لا يوجد كهرباء/مياه» also under
     «Raw land», keeps its own type, chip «🚧 No services yet», never «All services». Read «لا يوجد» only as the value of
     the services field, never across aqar's form labels. (Not built yet.)
  3. «Villa» ads that call themselves تاون هاوس are townhouses; Duplex + Townhouse become ONE type «Duplex & Townhouse».
     (Not built yet; needs its own owner go.)
  4. One payment question on every rent list, «💳 Rent now, pay later / split payments», two chips; under the provider
     logos a disclaimer: Ezhalah does not guarantee the payment method or the provider — confirm with the lister
     (owner 2026-11-02, `af-payment-note`). Both chips live since 2026-11-02 (split_payments is a text fact; picking both
     narrows to listings with both, like every chip card).
  5. No «Nearby» / «suitable for» chips — the seller's opinion; the map shows what's near. «On a main road» is a fact
     about the plot and stays.
  6. A chip says only what the ad says · Skip on every question · pick many · a chip at 0 hides itself · source tables
     untouched.

- **SuperOffice respects robots.txt; a catalogue that changed shape on purpose is rebased PER PLATFORM (owner
  2026-11-03, «Yes, use your picks», decision 4).** superoffice.sa's rebuilt site server-renders 8 private offices per
  branch; the rest load from `/api/office-listing`, which https://superoffice.sa/robots.txt disallows (`Disallow: /api`;
  the robots-allowed `/sitemap/units.xml` is empty). We never read it: the robots-allowed set (24 on 2026-11-03) IS the
  catalogue. `ops_platform_catalogue_rebase` holds one row per such platform — rebase moment, expected run size, reason,
  https link to the rule, evidence — and `rows_collapse` / `silent_partial_success` judge that platform only from the
  rebase, holding it to the declared size from its first run (a run under half of it raises, mode
  `declared_catalogue`). Fleet thresholds are never lowered for one site. The scraper treats a branch window shorter
  than min(8, totalCount) as truncated (no prune) and re-reads robots.txt each run, only REPORTING if `/api` stops being
  disallowed — reading it would be a new owner decision. Guards: `scripts/verify-catalogue-rebase-is-scoped-and-still-alarms.ts`,
  `scrapers/common/tests/test_superoffice_new_site_2026_10_29.py`.
- **Nuzul sites: the usage row and a LAND ad's kind follow the ad page's own «الاستخدام» (owner 2026-11-10, «Fix all bro
  these issues can't happen»).** Every Nuzul tenant (aldarim, abwbna, alobid, bahadhabab, goldendeal, yameen, jawher,
  m3tmd, october, senan) sends a hidden office filing `category` and the `is_for_*` use flags; the ad page prints only the
  flags. aldarim 50820 said «الاستخدام: تجاري» and we showed «أرض سكنية» with usage «residential» (about 55 active land
  ads on six sites). One rule, `scrapers/common/nuzul_usage.py`: the usage row is the page's own words for the flags
  that are on (none on → no row, never the filing); a land ad is commercial when only the commercial flag is on,
  residential when only the residential flag is on, and the filing decides only when the page does not settle it.
  Buildings and other types are untouched. Guard: `scrapers/common/tests/test_nuzul_usage_is_the_pages_own_2026_11_10.py`
  (runs every Nuzul scraper; a new Nuzul scraper not behind the rule is red).

- **A SCREEN'S SMALL FLOW IS ONE NAMED DECISION, NOT LOOSE BOOLEANS (owner 2026-11-10, «find all of the implicit
  state machines … fix everything»).** A sign-in, a framed page, a chat turn, a retry: when a screen has a flow with a
  «failed» ending, the decision lives as a pure function in `src/lib/flowState.ts` and the screen CALLS it. Two
  booleans that can both be true, or an `await` with no catch, is how a failed step came to read as a finished one:
  a failed Google sign-in signed the visitor in as a made-up «User», a late timer covered a loaded ad page, a chat
  turn that threw left «searching…» on screen forever. A catch added in a screen must still call `reportError`
  (catching takes the error away from the global reporter). New flow → add its function there and its rule plus a
  mutant to `scripts/verify-hidden-flows.ts`, which RUNS the functions and the lifted handlers.
  Three endings every such flow owes the visitor: a read that FAILED says so and offers «try again» (the map's pill,
  a shared-chat link — never a blank map or a plain home page); a step that never LANDED takes back what it set up
  for its result (an Advanced Filter round's receipt comes off when its search threw or was stopped, so the buttons
  return); and a failure line in the chat is written in THAT TURN's language, not the interface's.


**PRICE DIARY + COMPARABLES CARDS — every ad's prices and dates are kept forever, also after it is hidden or removed (owner, 2026-11-11 — permanent).**
Owner: «let's start saving … the price before and after … the dates are important … the hidden ones, cuz they got deleted,
would be useful if someone uses the AI agent to do comparables»; «your job is just saving it, later we will focus on the AI agent».
- **What is saved.** `listing_price_history` (the diary): one line per event of every ad — `start` (what we knew when the
  diary began, dated `scraped_at`), `first` (a new ad), `price` (old → new, `price_total` and `price_annual` both), `gone`
  (hidden), `back` (shown again), `removed` (deleted by the retention engine). `listing_comparables` (the card): one slim row
  per ad — site, buy/rent, rent period, type, region, city, district, m², bedrooms, bathrooms, age, link, the SITE'S posting
  date (`site_date_added`, raw `date_added`), first seen, first and last price, number of price changes, last seen, gone,
  removed. No photos, descriptions or contact details.
- **How.** ONE trigger function `tg_listing_price_diary()` on every `_(residential|commercial)_listings` table (insert;
  update only when a price or `active` changed; delete). It never raises — errors go to `listing_price_diary_errors`.
  `mon_detect_price_diary_health()` (in the detector roster) re-attaches it to any listing table without it (a new
  platform) and raises P2 `price_diary_unhealthy` if one still lacks it or the trigger swallowed errors in the last day.
  Migrations `20261111035037` + `20261111035153`; guard `scripts/verify-price-diary.ts`.
- **Filled from the past on 2026-11-11:** 699,465 cards (471,066 live, 111,293 hidden, 117,106 already removed — from
  `purged_listings_archive`), 927,866 diary lines. Price changes BEFORE that day were never recorded and are gone.
- **Rules.** Never delete or update diary lines; never drop the triggers to clear the alarm. PRICE = SOURCE: prices are the
  site's own as stored (the rent pool ×12 rule is applied when READING, as everywhere). `gone_at` / `removed_at` mean the ad
  DISAPPEARED from the site, never proof it SOLD — say «disappeared», not «sold». The retention engine may remove an ad's
  row; its card and diary stay.
- **Later (AI agent, not built yet):** a question like «asking prices in حي الملقا over the last 6 months» is answered FROM
  these two tables, filtered by their real dates (`site_date_added` / `first_seen_at` / diary `at`) — never from the model's
  own knowledge. Building that is a separate, owner-led step.

---

## 21. Open questions / decisions still pending

- **Support-form email delivery — needs a `RESEND_API_KEY` (owner action, since 2026-09-02, still
  open).** The support form → `supabase/functions/support-message/index.ts` → `support_messages`
  table insert path is fully wired and works today; the email-out half is gated behind
  `if (RESEND_API_KEY)` and that secret has never been configured (no `.env.example` entry, no
  Supabase function secret, no docs). The UI's success message is honest by construction — it
  confirms the DB insert, never claims an email was sent. Nothing to fix in code: add
  `RESEND_API_KEY` (and `SUPPORT_INBOX`/`SUPPORT_MAIL_FROM` if unset) as a Supabase function secret
  and delivery starts with zero further changes.
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
- **`scrapers/common/normalize.category_for_type()`'s residential set is missing "Duplex"/"Studio"
  fleet-wide (found 2026-09-24).** Every "house pattern" scraper that calls this shared helper
  unqualified gets `Commercial` for these two types, so they physically land in each platform's
  `*_commercial_listings` table. **RESOLVED 2026-09-24 (owner decision): this is intentional,
  fleet-wide, canonical — do NOT route around it per-platform.** It is not a reachability bug:
  Duplex/Studio are residential-macro clean types with `kinds: BOTH` in `propertyTypes.ts` (dated
  2026-07-16, "the latent invisible-listing fix"), and the 2026-07-10 broad-Residential
  misfile-recovery (`resMisfileTypes`/`attachResScopeB` in `remote.ts`) generically recovers any
  residential-macro `type_ar` sitting in a commercial table — confirmed live via the real anon-key
  RPC path for bossbih (133/136 misfiled دوبلكس rows returned in one page of a plain
  Category=Residential search). This same physically-misfiled-but-frontend-compensated pattern is
  already how a dozen-plus other `kinds: BOTH` types are handled (Rest House, Farm, Agriculture
  Plot, Residential Land, Bank, Warehouse, Telecom Tower, Hotel, and the المرافق set), so leaving
  Duplex/Studio on it is consistent with the established architecture, not an exception to it.
  `scrapers/aqalemhajer/run.py` (batch-36, merged/deployed 2026-09-24) originally shipped a
  per-scraper `DWELLING_TYPES` override that routed around the shared helper — reverted the same
  day to match bossbih and every other platform (its 57 already-upserted residential-table
  Duplex/Studio rows were left as-is; only future scrapes are affected). Both platforms' tests now
  pin `category == "commercial"` for Duplex/Studio as the intentional, canonical behavior.
  **If this is ever revisited:** fixing `category_for_type()` itself would require migrating every
  affected platform's already-upserted rows in one coordinated pass and does not let the frontend
  `kinds: BOTH` compensation be retired (it is the general reachability safety net for ANY
  current/future table misfile, not specific to this gap) — so the cost/benefit did not favor it.

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
10. Launch order (owner, 2026-11-04): **website first** (ezhalah.com). The iPhone/Android store apps
   come only after the website's front-end bugs are near zero, and only if the app will not bring new
   bugs (owner: «I'll only consider app if I'll not face bugs»). About 40 of 183 `src/` files carry
   web-only branches (`window`/`document`, iframes, sign-in pop-ups) that need native versions first.
   No App Store / Play setup exists yet (no `eas.json`, no bundle id). Don't start store work unasked.

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

### Platform logo visibility (owner, 2026-10-17)
Haraj uses its official header wordmark across the loader, website picker, and cards. Haraj, Maskan United, and The Address must have transparent backgrounds without boxed panels (owner correction, 2026-10-17). Their white-only artwork uses dark ink in light mode and light ink in dark mode, preserving its silhouette. Other logos keep their existing presentation.
