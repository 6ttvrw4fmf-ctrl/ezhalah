# SENTRY ROUTING (canonical, owner 2026-08-28)

**This file is the single source of truth for which routine owns which class of Sentry error.**
Every routine spec's Sentry mandate cites this file; if the two ever disagree, this file wins.

## §0 — Why this exists

Sentry (`src/lib/observability.ts`) reports real production errors from real users' devices. That
is only useful if:

1. **Every relevant routine actually checks it**, on a fixed cadence, as a mandatory step — not
   "when they remember."
2. **Every error has ONE clear owner**, so seven engineers do not fix the same crash seven times
   (or, worse, all skip it thinking someone else has it).
3. **The owner fixes the class**, not just the instance — full loop: reproduce → root cause →
   permanent regression barrier → mutation-proof → deploy → production verify → close/resolve the
   Sentry issue.

This document is what turns Sentry from a dashboard-nobody-checks into a routed queue with
enforced ownership.

## §1 — Access

- **Every one of the seven daily routines has read access to Sentry** (`sentry-mcp`, once the owner
  connects it in claude.ai). Read access is not the boundary — ownership is.
- **Only the OWNING routine acts on any given issue.** Every other routine sees the issue in its
  own scoped view, confirms ownership matches this table, and moves on. If ownership is genuinely
  unclear or a Sentry issue spans two owners' surfaces, routine #2 (Senior Production) triages and
  routes; that is what §21 of its own spec covers.

## §2 — Ownership routing (canonical table)

Sentry issues are routed by the **file/module** the top frame of the stack trace originates in,
then confirmed by the **user-visible symptom** in the breadcrumbs. Both must agree before an owner
claims it — if they disagree, that itself is a Sentry issue for routine #2 to triage.

| # | Routine | Owns Sentry issues whose top frame is in… | …AND user-visible symptom is… |
|---|---|---|---|
| 1 | ⚡ **Junior Scraping** | `scrapers/**/*.py`, `scrapers/common/**`, scraping cron handlers | scraper failure, source fetch error, parser crash — surfaced from cron/CI, not from the app |
| 2 | 🎖️ **Senior Production** | anything unclaimed after 24h, cross-routine seams, generic React runtime errors that don't match another owner's surface | broad production symptoms; also the **triage owner** for ambiguous or multi-owner issues |
| 3 | 🛡️ **Data Integrity (Normal Filter)** | `src/data/listings.ts`, `src/data/remote.ts` (search RPC path only), `src/lib/savedSearchIdentity.ts`, `src/lib/roomBedrooms.ts`, `src/data/propertyTypes.ts`, source-truth predicates | wrong count, wrong price/area/period, canonical-truth mismatch, listing appears/disappears on the Filter path |
| 4 | 🧪 **Search & Matching QA** | `src/data/search.ts`, `src/lib/platformDiversity.ts`, `src/data/locations.ts` (matching path), the Normal-Filter «بحث» → results → load-more journey | wrong matching result, missing platform diversity, «عرض المزيد» broken, card→browser handoff wrong |
| 5 | 🎯 **AF + Trending Data Integrity** | `src/data/advancedFilters.ts`, `src/lib/afRanking.ts`, `src/lib/afCohorts.ts`, `src/lib/afSteps.ts`, `src/lib/afSummary.ts`, `src/lib/afPlan.ts`, `src/components/AdvancedQuestionCard.tsx`, `src/components/TrendingChips.tsx`, `src/components/TrendingList.tsx` | AF question wrong/missing/repeated, AF count wrong, Skip/Back/Show-Results wrong, pill wrong, Trending count wrong |
| 6 | 👣 **Journey & Persistence** | `src/store.tsx`, `src/lib/chatTranscript.ts`, `src/lib/chatMerge.ts`, `src/lib/chatSync.ts`, `src/lib/auth.ts`, `src/components/Sidebar.tsx`, `src/components/GoogleOneTap.tsx`, `src/components/AuthModal.tsx`, `src/lib/voiceInput.ts`, `src/lib/readAloud*.ts`, `src/lib/webRefreshRoute.ts`, `src/lib/appSession.ts`, `src/app/agent.tsx` (chat plumbing paths, not AF logic) | sign-in fails, One Tap misbehaves, chat lost/duplicated/mutated, refresh strands the user, sidebar wrong, voice/read-aloud crash, page load blank |
| 7 | 🧵 **Systems Seam** | `src/lib/supabase.ts`, `src/data/clicks.ts`, RLS-boundary code paths, error paths whose reason names a cron/detector/alert/migration/RPC-schema seam, network-layer wrappers | RLS refused, cron→detector→alert chain broke, migration-drift symptom in the client, PostgREST schema mismatch, deploy-claim vs served-bundle disagreement |
| 8 | 🔴 **Regression Hunter** | no file surface of its own — it claims a Sentry issue only when the stack spans TWO owners' files, or when the issue is a REOPEN of one a previous fix closed | an error that reproduces only in a combination (AF × pagination × Back), or a regression of something already marked fixed |
| 9 | 🔬 **Production Red Team** | no file surface of its own — it claims an issue whose symptom is two LAYERS disagreeing (displayed count vs returned set, request vs RPC params, card vs DB) | "the number on screen is not the number in the database" shaped errors, post-deploy drift |
| 10 | 🧱 **Bug Prevention & Barrier** | `scripts/verify-*`, `scripts/lib/testRegistry.ts`, `scripts/lib/liftSymbols.ts`, `scripts/run-tests.mjs`, `e2e/**` harness code (not the product it drives) | a check crashed, a harness threw, CI tooling broke — never a product symptom |
| 11 | ♻️ **Listing Lifecycle** | `scrapers/common/liveness_contract.py`, `scrapers/common/liveness_policies.py`, deletion/prune/recovery paths, and any error raised while removing or restoring a listing | a dead listing still rendered, a false resurrection, a deletion that left orphans, UNKNOWN treated as dead |

### §2.1 — Unownable / ignore-list

- **Third-party script errors** (Google One Tap FedCM, browser-extension noise, `ResizeObserver
  loop`) — `beforeSend` in `src/lib/observability.ts` should drop these before they cost anyone a
  triage; if one slips through, routine #7 owns adding it to the scrubber's ignore list.
- **Sentry SDK internal errors** — belong to routine #7 (SDK is a seam; upgrade it or file
  upstream; do NOT let them expire on the dashboard).

### §2.2 — Tie-breakers (owner-locked)

- If the top frame is in a **shared utility** (`src/i18n.tsx`, `src/theme/tokens.ts`), read the
  breadcrumb trail's last user action and route by that action's owner.
- If the error is **only visible on refresh of a specific route**, routine #6 owns it (journey/
  persistence). Even if the underlying cause is AF/data, routine #6 files it as their finding for
  the actual owner and continues rather than fixing outside their surface.
- **P1 severity + unclaimed for 4h** → routine #2 takes it regardless of top-frame path. P1 does
  not wait for the next daily cycle.


**Disambiguating #8, #9 and #10 (added 2026-09-04).** All three are cross-cutting, so the tie-break is
the OBJECT of the issue, applied in this order:

1. Does the stack trace sit in `scripts/verify-*` or `e2e/**` harness code? → **#10 🧱**. The
   apparatus broke, not the product.
2. Is the symptom two LAYERS disagreeing about the same question? → **#9 🔬**.
3. Does it reproduce only in a COMBINATION, or is it a reopen of something already closed? → **#8 🔴**.
4. Otherwise it belongs to the surface owner in rows 1–7 and 11, exactly as before.

None of #8/#9/#10 may claim an issue that resolves cleanly to a single surface owner — they ROUTE it
with `incident_handoff()` and continue. That rule is what stops three new routines from becoming
three new claimants on every crash.

## §3 — The mandatory check (identical wording in every routine spec)

Every routine's canonical spec now carries:

> **SENTRY (owner rule 2026-08-28):** on every run, read your scoped Sentry issue queue per
> `docs/ops/SENTRY_ROUTING.md` — the issues whose top-frame path matches YOUR ownership row in
> that table's §2. For each one: reproduce → root cause → fix → permanent regression barrier
> (mutation-proven where meaningful) → deploy through the sanctioned gate if the change requires
> it → verify on production → **resolve the Sentry issue with a link to the fix commit/PR**. An
> issue that you resolve without a barrier is a violation of this contract, not a fix. Report:
> `SENTRY ISSUES CLAIMED THIS RUN: N` and `SENTRY ISSUES RESOLVED THIS RUN: N` in your FINAL
> REPORT — routines whose current spec has a fixed FINAL REPORT format add these two lines to it.

## §4 — Anti-duplication protocol

- **Claim before you fix.** Before starting on a Sentry issue, comment on it (`Owned by routine
  #<n> from run <timestamp>`) so any parallel routine reading the same dashboard sees it and skips.
  This is a soft claim — it does not prevent a subsequent routine from taking over if the first
  session dies mid-fix, but it prevents same-day collision.
- **Never resolve someone else's claim.** If you see another routine's claim on an issue whose
  owner is you per §2, note the conflict in your report and let #2 triage on the next run —
  routes evolve, and the answer might be that §2 needs a rule added.
- **One PR = one Sentry issue** wherever possible, so the resolve/close link is unambiguous.
  Bundling multiple resolutions in one PR is allowed for related fixes but the PR body must list
  every issue id it closes.

## §5 — Enablement checklist (owner-side, done once)

1. Owner-only, one-time: create the Sentry project (react-native, EU region) and add
   `EXPO_PUBLIC_SENTRY_DSN` to Vercel Production env. Until this is done, `observability.ts` is a
   no-op and every routine's Sentry mandate reads an empty queue — safe, but useless.
2. Owner-only, one-time: connect the Sentry MCP in claude.ai settings so the routines can read
   issues without a browser step.
3. This document + the seven routine specs + the barrier
   (`scripts/verify-sentry-routing-wired.ts`) do the rest permanently.

## §6 — Barrier

`scripts/verify-sentry-routing-wired.ts` (in `npm test`) proves:

- This file exists and carries the ownership table.
- Every one of the seven routine specs carries the §3 mandatory-check paragraph and the two FINAL
  REPORT lines.
- The ownership table names all seven routines with distinct scopes (no two routines listed as
  owner of the same top-frame path).
- The tie-breakers and unownable list are present.
- Mutation-proven: deleting the mandate from any routine spec turns the barrier red.
