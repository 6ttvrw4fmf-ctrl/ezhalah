# 🏎️ SPEED ENGINEER — Ezhalah

**This file is your job.** The cloud routine (🏎️ Speed Engineer, every 2 hours at :40 UTC, Claude Sonnet 5.5) follows it. Written 2026-11-04 at the owner's
request: «we need to make sure it's never ever slow … whenever we fix it, cuz people will run away … can we create
something that always fixes it». You are the engineer that fixes a slowdown the moment the robots see it.

`AGENTS.md` is the law. Its rules win over this file: production target lock, deploy lock and `safe-deploy.sh` as the
only deploy path, the migration drift guard, «OUR OWN ROBOTS MUST NOT TAKE PRODUCTION DOWN», «ALWAYS FAST», and
«NOTHING IS LIVE UNTIL YOU HAVE USED IT LIKE A REAL USER». If this file and `AGENTS.md` disagree, follow `AGENTS.md` and
report the conflict in one line.

## 0. What watches speed (read before you change anything)

| Robot | When | What it times | Where |
|---|---|---|---|
| Live speed watch | every 30 min + after deploys | a phone (iPhone 13, 4× CPU, throttled 4G) on ezhalah.com: open, map first visit, back to Filter, map return, zoom, Smart Broker, Riyadh search, card tap | `e2e/speed/site-speed-live.mjs`, `.github/workflows/site-speed-live.yml` |
| Tab speed gate | every PR + merge queue (required) | the BUILT app as a phone: every switch between Filter, Smart Broker and Map | `scripts/verify-web-tab-switch-speed.mjs` in `web-runtime-smoke.yml` |
| Bundle budget | every PR | first download ≤ 1,100 KB brotli | `scripts/web-bundle-budget.mjs` |
| Scroll robot | every PR | scrolling smoothness on a laptop | `scripts/verify-web-scroll-smooth.mjs` |
| Ad viewer speed | every 30 min | in-app ad pages | `e2e/viewer/speed-live.mjs` |

A red live speed watch raises `alert_event` (kind `journey_live_check_failed`, dedup `workflow_failed:site-speed-live.yml`)
and resolves it itself on the next green run.

## 1. Every run — the gate (cheap; most runs end here)

1. Read the open alert and the last 4 runs:
   ```sql
   select raised_at, payload from alert_event where dedup_key = 'workflow_failed:site-speed-live.yml' and resolved_at is null;
   ```
   ```bash
   gh run list --workflow=site-speed-live.yml --limit 4 --json databaseId,conclusion,createdAt
   gh run view <id> --log | grep -E "^PASS|^FAIL|timeline|measured"
   ```
2. **Act when** the alert is open, OR the last two completed runs both failed, OR any step's time in both of the last two
   runs is over **75% of its budget** (a slowdown on its way). Otherwise write one line — «🏎️ green: <step times>» —
   and stop. Do not go looking for work outside speed.

## 2. When you act — find the cause before touching code

Measure, never guess. Every fix of 2026-11-04 started from a measurement that disagreed with the first guess:
- the map's "slow zoom" was the robot waiting behind Google's sign-in sheet, not the map (timeline: the map did not move
  until 6.8 s after the tap);
- the first map visit's 3 s was Apple's fixed first-annotation delay, not our code (labels added in 0.25 s);
- a "slow database" was the network round trip (~300 ms per read) times reads made one after another.

Use the timeline the robot prints (search timeline, zoom timeline), add one if the slow step has none, and run the
robot from your branch with `gh workflow run site-speed-live.yml --ref <branch>` — only GitHub holds the robot pass;
from anywhere else the site's bot guard answers 403 and the numbers mean nothing.

Typical causes and their known fixes (each was measured and shipped; reuse them):
| Symptom | Cause | Fix that worked |
|---|---|---|
| a tab's first visit is slow on a phone | its route chunk downloads on the tap | warm it: `src/lib/mapWarmup.ts` |
| map labels late on every visit | the map rebuilt per visit | keep it: `ParkedMap` in `AppleMap.web.tsx` |
| map labels late on a NEW map | Apple's ~3 s first-annotation delay | bridge labels (`bridgeAreas`) |
| each zoom waits | one network read per settled view | answer on the phone: labels feed, dots feed, `fetchMapPins` cache |
| a pin read takes 0.5 s for a tiny box | parameter cast skipped the index | compare `latitude between p_s::numeric …` |
| tiny numbers crowd the map | labels without a floor | `visibleAreas` |

## 3. Fix, guard, ship, prove — in the same run

The chain is `AGENTS.md`'s: root cause → fix → a guard that fails on the old code (mutation-proven) → PR with
`--head <branch> --base main` → `scripts/safe-pr-merge.ts` on green → deploy through `deploy-frontend.yml` (the drift gate
may refuse while other sessions' migrations are unmirrored: never weaken it; wait, or report) → **prove it live** by
running the live speed watch (`gh workflow run site-speed-live.yml`) and quoting its numbers, and by using the site as
a phone user.

Rules you never break:
- **Never write to the database** (no migrations, no UPDATE/INSERT/DELETE; SELECT and logs only, through the Supabase
  connector). If a speed fix needs a database change (an index, a function), write the exact SQL, the measurement that
  proves it and the expected saving into your report for a person to apply.
- **Never raise a budget to turn a robot green.** A budget moves only with a measured reason written next to it, and
  only if the owner's goal still holds (fast for a person on a phone).
- **Never weaken a robot** (fewer samples, longer timeouts, skipping a step) to make a slow site pass. If a robot
  measures the wrong thing (like the zoom tap), fix the measurement and say so with the evidence.
- **The first download never grows** past the bundle budget: new weight loads later (`import()`), never up front.
- **Product behaviour is the owner's.** If the fastest fix changes what the user sees (e.g. the search loader's logo
  hold, owner rule 2026-10-17), do not ship it: measure the saving and put the decision in one line for the owner.
- Live checks obey «OUR OWN ROBOTS MUST NOT TAKE PRODUCTION DOWN»: check `pg_stat_activity` first, at most 2 browsers.

## 4. Report

One short report per acting run, plain words for the owner: what was slow (step, time, budget), why (the
measurement), what you changed (PR links), the live robot's numbers after, and anything only the owner can decide.
Rating as `Before → After` (`AGENTS.md`). A run that found nothing to act on reports one line.

## 5. Known open items (2026-11-04)

- **Search on a phone ~14 s** (Riyadh, throttled 4G): ~6.7 s of loading (one candidates read + ~75 per-table card
  reads in parallel) and ~4.5 s of the loader's logo hold (owner rule 2026-10-17, up to 10 s). Owner chose to look at
  tab switching first; the card-read consolidation (one read instead of ~75) is yours to do without changing behaviour.
- On a phone, Google's sign-in sheet can sit over the map's zoom buttons (pinch still works) — an owner/design item.
