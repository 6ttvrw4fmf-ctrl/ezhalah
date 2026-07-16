# Deploy Safety — Ezhalah frontend (ezhalah-app)

## Why this file exists

**2026-07-09 P0 incident:** UI/UX work (About dialog, card feedback row, search loader v4,
load-more cascade, price/area range picker, property icons, and more) was built up over many
commits and uncommitted edits on a local branch, and deployed straight to `ezhalah-app.vercel.app`
via `vercel --prod` CLI each time. It was live and approved — but it only ever existed on one
machine's local working tree, never pushed to GitHub. A later deploy of a `main`-only fix (the
commercial-search reachability fix, PR #41) was built from a clean checkout of `main` — which had
none of that UI work — and the deploy silently rolled the live UI back to before all of it.

**Root cause:** this repo's Vercel deploys are CLI-triggered (`vercel --prod` run from a local
directory), not GitHub-integration deploys. Two different local states (a dirty working tree full
of unpushed work, and a clean `main` checkout) can each be deployed at different times, and nothing
stops a deploy from silently overwriting the other's work if they've diverged.

**The rule now:** if it's visible to users, it must be committed, pushed, and merged to `main`
before it's ever deployed. Never deploy a dirty working tree again.

## Pre-deploy checklist

Before running any production deploy, confirm ALL of the following:

1. **Working tree clean** — `git status --short` returns nothing. No modified or untracked files
   that affect the app (`src/`, `assets/`, `app.json`, `package.json`, `vercel.json`, etc.).
2. **Branch pushed** — the branch you're deploying from exists on `origin` and its HEAD is
   reachable from `origin` (`git branch -r --contains <sha>` is non-empty, or simpler: you're
   deploying from `main` itself).
3. **PR merged** — any change you intend to be live went through a PR and was merged to `main`.
   No deploying directly from a feature branch.
4. **UI baseline verified** — if the change touches `src/app/`, `src/components/`, `src/theme/`,
   or other visual code, the deployed bundle should be spot-checked against what's expected (see
   "Verifying a deploy" below).
5. **Commercial fix still present** — spot-check the served bundle for `p_tables2` and `p_types2`
   (the broad-Commercial two-scope search fix, PR #41). If either is missing, something has
   regressed — do not consider the deploy complete.
6. **No dirty-tree Vercel deploy** — you are deploying from `main` at a commit that matches
   `origin/main` exactly, not from a local branch with uncommitted or unpushed changes.

**Use `scripts/safe-deploy.sh` instead of running `vercel --prod` directly** — it enforces checks
1, 2, and 6 automatically and refuses to deploy if they fail.

## Verifying a deploy

After any production deploy, confirm it actually served what you expect — do not assume:

```bash
curl -sI https://ezhalah-app.vercel.app/ | grep -E "x-vercel-id|age|last-modified"
BUNDLE=$(curl -s https://ezhalah-app.vercel.app/ | grep -oE '_expo/static/js/web/entry-[a-f0-9]+\.js')
curl -s "https://ezhalah-app.vercel.app/$BUNDLE" -o /tmp/bundle-check.js
grep -c "p_tables2" /tmp/bundle-check.js   # commercial fix marker — should be >0
```

`age: 0` on the headers confirms you're looking at the deploy that just ran, not a cached older
one. The bundle hash (`entry-<hash>.js`) is content-based — an unchanged hash after a deploy you
expected to change something means the deploy didn't actually include what you think it did.

## Approved baseline record

This is the last known-good state, confirmed live and verified, kept up to date after every
production deploy. Use it as the rollback target if a future deploy needs to be undone.

| Field | Value |
|---|---|
| Date | 2026-07-14 (platform-diversity first-page ranking fix — see PR #74) — CURRENT LIVE |
| Vercel deployment ID | `dpl_5ZueLtnMQqaLzLrCHTZefPUUavtB` |
| Production URL | `https://ezhalah-app.vercel.app` |
| Bundle hash | `entry-ea1555d00c9041a46df3da2e8a49fb8a.js` |
| Deployed from | `main` @ `c0304db` (PR #74 squash-merged), via `scripts/safe-deploy.sh` from a clean worktree. |
| Contains | Owner PERMANENT rule (2026-07-13): Rule 1 filters always win; Rule 2 the first page must show a genuine platform mix, no platform crowds out others with equally-valid matches. Root cause (SQL-verified live): the single recency-ordered RPC candidate window (`QUERY_LIMIT=1500`) could be entirely filled by one platform's same-batch rescrape, pushing a LARGER platform's freshest match outside it (wasalt 6,458 matches vs aqar 3,238 for one filter, yet wasalt ranked 2,076th). Fix: a page-0-only per-platform-capped RPC seed (`mergeDiversitySeed`/`filterBoosted`, new `src/lib/platformDiversity.ts`) merges under-represented platforms into the pool under IDENTICAL filters, with Load-More dedup bookkeeping; `orderByScope` reordered to platform-first for every scope (was geography-first). Full detail: memory `project_platform-diversity-first-page-fix-2026-07-13`. |
| Verified post-deploy | Live bundle `entry-ea1555d0…` on `ezhalah-app.vercel.app`: `supabase.co` ×2 present (re-grepped after the safe-deploy CDN-propagation false-alarm warning — known gap, see [[project_safe-deploy-cdn-propagation-wait]]-style note below). Bundle-grepped and confirmed the exact new logic shipped: `mergeDiversitySeed`/`filterBoosted` present with the atomic single-write fix from adversarial review (`Y(J,i)` / `Y(J,new Set)`, no read-then-mutate-across-await), `p_per_platform:i,p_limit:2e3,p_offset:0` (the diversity-seed RPC call) alongside the untouched `p_per_platform:null` main call, and `orderByScope`'s new key arrays `['platform','region','city','district']` / `['platform','city','district']` / `['platform','district']` all present verbatim. Pre-deploy: real-RPC end-to-end simulation against production data proved Rent+Apartment+Riyadh went from `{aqar:9,sanadak:1}` in the first 10 to one row from 10 distinct platforms, country-wide broad search surfaced 25 distinct platforms in the first 25, and a real Load-More continuation caught 20 rows that would have duplicated and confirmed the fix removes them. `tsc` 0 new errors, `npm test` 159/159 pass. |
| Note (safe-deploy false-alarm, recurring) | The post-deploy `supabase.co` check WARNED again (known `sleep`-too-short CDN propagation gap, same class as the 2026-07-10 note below); re-grepped the served bundle ~15s later and confirmed `supabase.co` ×2 present. Not the env-var P0. |
| SUPERSEDES the entry below | Note: this table lags actual deploy history (a pre-existing, previously-flagged doc gap — several deploys between PR #58/#60 and this one, e.g. PR #64/#71/#73, were not separately recorded here). The entry below remains a valid, older rollback target; this deploy's HEAD contains everything in it. |

| Field | Value |
|---|---|
| Date | 2026-07-10 (whole-number input keyguard + npm test — see PR #58; plus preflight test-file fix PR #60) — superseded, valid rollback target |
| Vercel deployment ID | `dpl_2gVFqgfgu5Ar14WkoFxiFp7ubTCg` |
| Production URL | `https://ezhalah-app.vercel.app` |
| Bundle hash | `entry-d4d1ca9e5ec9ce51055d6a034b9338a4.js` |
| Deployed from | `main` @ `75b8970` (PR #58 keyguard + PR #60 preflight fix, both squash-merged), via `scripts/safe-deploy.sh` from a clean worktree. |
| Contains | Everything in the entry below (through FIX A / PR #51) **plus PR #58**: web keydown guard (`wholeNumberKeyDecision`) on all 5 price/area/size inputs so char-by-char typing of a decimal (`500.5`) collapses to the integer part (`500`, never `5005`), on top of the already-live `toWholeNumberDigits` helper; old inline test replaced by a runnable 31-assertion `npm test` (`scripts/verify-whole-number-input.ts`). **Plus PR #60**: preflight's src/-deletion guard now ignores test files (`*.test.ts(x)`, `*.spec.ts(x)`, `__tests__/`) — they never ship in the bundle — which had falsely blocked #58's test-file relocation. Frontend + deploy-tooling only; no backend/DB/RPC/search change. |
| Verified post-deploy | Live bundle `entry-d4d1ca9e…` on `ezhalah-app.vercel.app`: `supabase.co` ×2 + project ref `aannarbkwcymrotzwdbo` ×1 + `createClient` ×4 (env baked in), `p_tables2` present (FIX A residential scope intact), keyguard markers (`fracLock`/`Decimal`) ×10. Ancestry: HEAD contains `ef6a3ae` (PR #48), `59d411c` (FIX A/#51), `1936fc0` — no approved feature dropped. **Live browser (mobile 375px), on production:** typing `500.5`→`500`, `500٫5`→`500`, paste `1,500.75`→stored `1500` (4 range inputs); real-keydown on the mounted component confirms decimal/grouping/locked-digit BLOCKED and Backspace/Delete/Arrow/End allowed + unlock (never stuck); Residential Buy «لقينا 113,342» and Commercial Buy «14,837» both render real cards with the neutrality line — identical to pre-deploy counts (zero search regression). 5th input (exact-size box) uses byte-identical `wholeNumberKeyGuard('size')` wiring (guard proven field-agnostic). |
| Note (safe-deploy false-alarm, recurring) | The post-deploy `supabase.co` check WARNED again (its `sleep 3` < CDN alias propagation); a manual bundle re-check confirmed `supabase.co` ×2 present. Not the env-var P0. (Bumping the sleep is still worth doing.) |
| SUPERSEDES the entry below | The FIX A entry (`dpl_GbBS…` / `entry-0055ae2e` / `59d411c`) remains a valid healthy rollback target; superseded by this deploy. NOTE: intermediate baselines `a6a8a37` and `1936fc0` (PR #57 input-hygiene helper) were deployed between FIX A and this entry via `safe-deploy.sh` but not separately recorded in this table (concurrent-session doc gap) — both are contained in the current HEAD. |

| Field | Value |
|---|---|
| Date | 2026-07-10 (FIX A residential-misfile recovery — see PR #51) — superseded, valid rollback target |
| Vercel deployment ID | `dpl_GbBSTViuFjJpMFm48GTN4xp1ZHiB` |
| Production URL | `https://ezhalah-app.vercel.app` |
| Bundle hash | `entry-0055ae2e3d06d432c90c6554da897198.js` |
| Deployed from | `main` @ `59d411c` (PR #51 squash-merged), via `scripts/safe-deploy.sh` from a clean worktree. |
| Contains | Everything in the entry below (through PR #48) **plus PR #51 (FIX A)**: broad + specific Residential search now also scans commercial tables for residential `type_ar` (excl عمارة), recovering the 292 genuinely-residential listings misfiled into `*_commercial_listings`. `remote.ts` only; Commercial search byte-identical. |
| Verified post-deploy | `age: 22`. Bundle grep: project ref + `supabase.co` present (env baked in), `p_tables2` = 3 (was 2 — FIX A adds the residential scope), all UI markers present (`getListingFeedback`/`pickLoaderPlatforms`/`PanResponder`/`useReducedMotion`/`eagle-mark`/`apartments-coliving`). Browser: broad Residential Buy shows «لقينا 113,282» = 113,096 + 186 (exact Buy recovery), cards render incl. recovered types (مزرعة/أرض سكنية). Live RPC: specific فيلا residential scope-B delta = +4 (the misfiled Villa rows). Companion DB change FIX B (reachability alarm) applied live + captured in `supabase/migrations/20260710_fixb_reachability_alarm.sql`. |
| Note (safe-deploy false-alarm) | The post-deploy `supabase.co` check WARNED because its `sleep 3` is shorter than CDN alias propagation; a manual re-check ~20s later confirmed the marker present. Consider bumping the sleep. Not a repeat of the env-var P0. |
| SUPERSEDES the entry below | The PR #48 entry (`dpl_5Lvjeq` / `entry-9eefc6`) remains a valid healthy rollback target; superseded by this FIX A deploy. |

| Field | Value |
|---|---|
| Date | 2026-07-10 (filter-screen UX pass — see PR #48) |
| Vercel deployment ID | `dpl_5LvjeqEVEyiTbjWGBVAzov3zu1dk` |
| Production URL | `https://ezhalah-app.vercel.app` (verified — see below). Note: `ezhalah.com` is listed as a Vercel-side alias for this project but currently resolves via DNS to an unrelated Next.js app, NOT this deployment — pre-existing, already-tracked domain/DNS issue (registrar/DNS level, not a code or deploy problem), unaffected by this deploy. Do not treat `ezhalah.com` as a verification target until that's fixed. |
| Bundle hash | `entry-9eefc6fdf77c71cc10c584de97e5ff13.js` |
| Deployed from | `main` @ `ef6a3ae76c349bbb2ac7d6913aeb7d9902f8c0d0` (PR #48, squash-merged), via `scripts/safe-deploy.sh` from a clean worktree. Vercel deployment metadata independently confirms `gitCommitSha: ef6a3ae76c349bbb2ac7d6913aeb7d9902f8c0d0` — the exact commit intended. |
| Verified post-deploy | `age: 10` shortly after deploy (fresh CDN entry, not a stale pre-deploy cache). Bundle grep: `aannarbkwcymrotzwdbo` project ref present, `supabase.co` present (x2), `p_tables2` present — Supabase client inlines correctly (the deploy script's own automated post-deploy check fired a false-alarm WARNING here due to its 3s sleep being too short for CDN propagation right after upload; a manual re-check moments later found both markers present — not a repeat of the 2026-07-10 env-var P0). **Manual browser verification** (this session, mobile 375px + desktop, against the local dev server pre-deploy): Rent→group→type flow scrolls with the previous section still peeking (partial reveal); Monthly/Yearly toggle renders above the size/price card and switches correctly; tapping the padding/unit-text area of a Price/Area box (not the `<input>` itself) focuses it and accepts typed input. |
| SUPERSEDES the entry below | The `dpl_812zo6b` / `entry-d45474fa` entry below remains a valid, healthy rollback target (env-var P0 fix) — not broken, just superseded by this newer UI-only change. |
| — historical (BROKEN, do not use as rollback target) — | ~~`dpl_6K2nJfsrBHYXBUXSzGo8xdJsfwsZ` / `entry-83f725ab...` / `main`@`d82145f`~~ |
| Contains | Everything in the prior baseline entries below (PR #41/#42/#43/#44/#45/#47) **plus PR #48**: (1) filter-screen scroll on every step now reveals just the next section instead of jumping (`SCROLL_REVEAL_OFFSET = 96px`, new `withAnchor` helper), (2) Monthly/Yearly rent-period toggle moved from dead-last (above Search) to directly above the Refine/Detail (bedrooms/area/size) section, (3) Price Min/Max, Area Min/Max, and the Size-in-meters box are now full-box tap targets (`Pressable` wrapping, mirrors the existing city-field pattern) instead of requiring a tap on the exact `TextInput` sliver. Pure JSX/style/ref change — zero filter/search logic touched, confirmed via diff review (adversarial agent review + manual verification, no blocking issues). |
| Verified post-deploy | `age: 0` (fresh, not cached). Bundle re-fetched and grepped: `p_tables2` present (commercial fix intact), `Thanks for your feedback` / `your first destination for property search` / `mBtnPrimary` all present (prior UI baseline intact). Logic-only change (no new/removed user-facing strings to grep for PR #45 itself) — verified via clean PR merge + typecheck + fast-forward from a verified `main` tip, not a live-bundle string match. |
| Known gaps (unrelated, not a regression) | `log-click` edge function still not deployed (client-side click tracking silently no-ops — this deploy's `clicks.ts` is the OLDER pre-existing version, since click/session work was deliberately excluded from PR #42's scope); custom domain `ezhalah.com` does not point to this project — neither affects the UI baseline |
| Main has since moved further | `origin/main` is at `fb6107b` (this same PR's baseline-table doc update, #46) — no code change ahead of what's live as of this entry. |

### 2026-07-10 incident #2: clean-main build had no Supabase env → all search dead (P0)

**Symptom:** every search (residential AND commercial, all filters) showed «يجري تحميل الإعلانات — حاول مرة ثانية بعد لحظات» ("loading, try again") and rendered zero cards. App-wide.

**Root cause:** `src/lib/supabase.ts` builds the client as `(url && key) ? createClient(...) : null`, reading `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_KEY`. Those vars come from a local `.env` file that is **gitignored and never committed**. The OLD (pre-safety-rule) deploys ran `vercel --prod` from the local working tree, so `.env` was present and the vars inlined. But `scripts/safe-deploy.sh` deliberately builds from a **fresh git worktree of clean `main`, which has no `.env`** — and the **Vercel project had zero env vars set** — so `expo export` built with the vars undefined, `supabase` became `null`, and `fetchListingsForQuery` returned `null` before ever making a network call → the "try again" path fired for every query. The very "deploy from clean main" rule that fixed incident #1 is what exposed this.

**Diagnosis proof:** browser console showed the app made **no** `location_search_candidates_ar` request at all (null client = no call); a hardcoded in-page fetch to the same RPC returned 200 + real data (backend fine); and the served bundle contained **zero** occurrences of the project ref / anon key (env not inlined).

**Fix:** (1) added `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_KEY` to the Vercel project env (production) — these are `EXPO_PUBLIC_` client-public values (the key is a publishable anon key), correct to store there; (2) redeployed clean `main` via `safe-deploy.sh` (the build now inlines them from Vercel's env); (3) verified end-to-end in a browser that search renders cards.

**Note on rollback:** instant `vercel rollback` was NOT usable — the free plan only rolls back one deployment, and that one (`dpl_D6Lmq`, the prior clean-main build) was *also* env-less. The last env-baked deploy (`dpl_8ML9`, a dirty-tree build) was too far back to reach. This is why the real fix (Vercel env + redeploy) was the path, not rollback.

**Prevention added this PR:** `scripts/safe-deploy.sh` now (a) refuses to deploy if the required `EXPO_PUBLIC_*` vars are missing from the Vercel production env, and (b) after deploy, asserts the served bundle references `supabase.co` (proving the vars inlined) — a green build with a null client is exactly what this catches.

### Incident addendum (2026-07-10): a real near-miss, caught correctly

The first attempt to deploy this exact baseline (`main` @ `25e886e`, before PR #44) **failed** — `scripts/safe-deploy.sh`'s real `expo export` build hit `Unable to resolve module ../../assets/icons/apartments-coliving.png`. Root cause: PR #42's file-scoping missed 64 binary asset files that `propertyIcons.ts` requires (they existed locally, git-tracked on the old branch, but a sampling-based check during PR #42's construction didn't catch every `require()` in the new files, and `tsc --noEmit` doesn't validate that image paths resolve — only a real build does). **Production was never affected** — Vercel does not promote a failed build to the alias, confirmed by checking the live bundle hash was unchanged immediately after the failed attempt. Fixed via PR #44 (the 64 missing files, no code changes), verified with a real local `expo export --platform web` build before merging, then redeployed successfully. This is exactly the failure mode `scripts/safe-deploy.sh` exists to catch — and it worked.

**Update this table after every future production deploy.** Stale entries here are worse than no
entry — if you deploy and don't update it, the next person (or the next Claude session) will
compare against the wrong baseline.

## Deployment lock (added 2026-07-16)

This repo's Vercel production alias can be changed by **multiple concurrent Claude/agent
sessions**, not just one human operator — and on 2026-07-15 that caused a real incident: while one
session was mid-revert of an unapproved deploy, a different session deployed `main` directly at a
moment it still had the bug, re-breaking production a second time with zero coordination between
the two. Full story: project memory `pr78-outage-rollback-2026-07-15`.

`scripts/safe-deploy.sh` and `scripts/emergency-rollback.sh` (below) now acquire a mutual-exclusion
lock (`ops_deploy_lock` table + `acquire_deploy_lock()`/`release_deploy_lock()` functions, see
`supabase/migrations/20260716_deploy_lock.sql`) before touching the Vercel alias, and release it
immediately after — self-expiring after 10 minutes so a crashed session can never permanently block
deploys. If a session calls a Vercel MCP tool directly instead of going through these scripts, it
must acquire/release the same lock manually — see `AGENTS.md` "Deployment lock" for the exact SQL.

## Emergency rollback procedure

If the live UI ever regresses again (looks different, missing features, broken layout):

### Fastest — instant rollback to a known-good deployment (no rebuild)
Use `scripts/emergency-rollback.sh <deployment-id-or-url>` — it acquires the deploy lock, then
re-points the production alias to an already-built deployment instantly, no rebuild:
```bash
scripts/emergency-rollback.sh dpl_8ML9bBf2b8c7RKXe4VR4tMdbNQMe
```
Use the deployment ID from the "Approved baseline record" table above (or a newer one if this
document has been kept up to date since). This is the right first move in a live incident — it
restores service in seconds while you investigate. (The raw `npx vercel rollback ... --yes` command
still works, but skips the deploy lock — only fall back to it if the script is unavailable, and
acquire the lock manually first per `AGENTS.md`.)

### Proper fix — redeploy from the correct git state
Instant rollback re-points to an old, immutable build artifact — it does not fix the underlying
git state, and the NEXT deploy from `main` could reintroduce the same regression if `main` still
doesn't have everything. After an instant rollback:
1. Diff what's on `main` against what's live (see "Verifying a deploy" above) to find exactly
   what's missing.
2. Get the missing work onto `main` properly: commit → push → PR → review → merge. Do not deploy
   directly from a local/dirty branch, even "just to fix it quickly" — that's exactly how this
   incident happened.
3. Run `scripts/safe-deploy.sh` from a clean `main` checkout to redeploy.
4. Re-verify the bundle (above) and update the "Approved baseline record" table.

### If you don't know what the "correct" UI state even looks like
Check this file's git history (`git log -p -- docs/DEPLOY_SAFETY.md`) for prior versions of the
"Approved baseline record" table, and cross-reference merged PRs touching `src/app/`,
`src/components/`, `src/theme/` on `main` for what should be live.
