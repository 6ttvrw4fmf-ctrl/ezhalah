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
| Date | 2026-07-10 |
| Vercel deployment ID | `dpl_D6LmqNGX8iP8kCjkQmGPZwzkgKBo` |
| Production URL | `https://ezhalah-app.vercel.app` |
| Bundle hash | `entry-b12749eea6c6842efc92b8ed42814a1a.js` |
| Deployed from | `main` @ `c9ff47d3d8999258bc26db49f3045fc01d22de92`, via `scripts/safe-deploy.sh` from a clean worktree (0 uncommitted files, local `main` == `origin/main` exactly) — first real use of the guard script |
| Contains | PR #41 (commercial two-scope fix) + PR #43 (deploy safety tooling) + PR #42 (UI baseline: About dialog, card feedback row, search loader v4, load-more cascade, price/area range picker, property icons) + PR #44 (64 missing icon/image assets `propertyIcons.ts` needed — found because this deploy attempt failed once first; see incident addendum below) |
| Verified post-deploy | Bundle re-fetched fresh and grepped: `p_tables2`/`p_types2` present, old buggy commercial markers absent, `getListingFeedback`/`pickLoaderPlatforms`/`PanResponder`/`useReducedMotion`/`eagle-mark`/`hero-bg` all present, new icon paths (`apartments-coliving`, `bed-1`, `filter-price`) present confirming the asset fix took effect. Live RPC call end-to-end: `total_count: 14619` for a real broad-Commercial query. |
| Known gaps (unrelated, not a regression) | `log-click` edge function still not deployed (client-side click tracking silently no-ops — this deploy's `clicks.ts` is the OLDER pre-existing version, since click/session work was deliberately excluded from PR #42's scope); custom domain `ezhalah.com` does not point to this project — neither affects the UI baseline |
| Main has since moved further | `origin/main` is now at `d82145f` (PR #45, a different/concurrent session's `SearchLoader.tsx`/`loaderPlatforms.ts` polish, merged 2026-07-10T07:58:15Z, **after** this deploy) — not part of what's currently live. Not a regression, just normal: a deploy is a snapshot, `main` can advance after it. Redeploy when ready to pick it up. |

### Incident addendum (2026-07-10): a real near-miss, caught correctly

The first attempt to deploy this exact baseline (`main` @ `25e886e`, before PR #44) **failed** — `scripts/safe-deploy.sh`'s real `expo export` build hit `Unable to resolve module ../../assets/icons/apartments-coliving.png`. Root cause: PR #42's file-scoping missed 64 binary asset files that `propertyIcons.ts` requires (they existed locally, git-tracked on the old branch, but a sampling-based check during PR #42's construction didn't catch every `require()` in the new files, and `tsc --noEmit` doesn't validate that image paths resolve — only a real build does). **Production was never affected** — Vercel does not promote a failed build to the alias, confirmed by checking the live bundle hash was unchanged immediately after the failed attempt. Fixed via PR #44 (the 64 missing files, no code changes), verified with a real local `expo export --platform web` build before merging, then redeployed successfully. This is exactly the failure mode `scripts/safe-deploy.sh` exists to catch — and it worked.

**Update this table after every future production deploy.** Stale entries here are worse than no
entry — if you deploy and don't update it, the next person (or the next Claude session) will
compare against the wrong baseline.

## Emergency rollback procedure

If the live UI ever regresses again (looks different, missing features, broken layout):

### Fastest — instant rollback to a known-good deployment (no rebuild)
Vercel keeps prior deployments and can re-point the production alias to one instantly, without
rebuilding:
```bash
npx vercel rollback <deployment-id-or-url> --yes
# e.g.: npx vercel rollback dpl_8ML9bBf2b8c7RKXe4VR4tMdbNQMe --yes
```
Use the deployment ID from the "Approved baseline record" table above (or a newer one if this
document has been kept up to date since). This is the right first move in a live incident — it
restores service in seconds while you investigate.

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
