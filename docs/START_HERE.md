# Start here — a new teammate on Ezhalah

Written 2026-11-04 for a new person helping on production, and for the Claude they work with. Read this
first, then `AGENTS.md`, then `docs/ARCHITECTURE.md`. Those two files are the law; this page is the map.
Many of the owner's decisions below used to live only in one Claude's private notes on the owner's
laptop. They are written here so every Claude on the team knows them.

## 1. What Ezhalah is

- A **neutral property search** for Saudi Arabia, in Arabic first, English second.
- It reads the ads of about **150 property websites** (Aqar, Wasalt, Haraj, Sakani, Gathern and many
  small agencies) and shows them in one place. It owns no property, sells nothing, takes no commission.
- Two ways to search: the **Filter** (city, district, type, price…) with the **Advanced Filter** questions,
  and the **AI Agent** («الوسيط الذكي» / Smart Broker), which asks questions and runs the same search.
- The AI Agent is a **broker, never an advisor**: it never says "best", "good deal" or "buy this". It shows
  ads; the user decides.

## 2. How it is built (one line each)

| Piece | Where |
|---|---|
| App (web today, phone later) | Expo / React Native Web in `src/`, hosted on Vercel at ezhalah.com and ezhalah-app.vercel.app |
| Database | Supabase Postgres, project `aannarbkwcymrotzwdbo` |
| Ad readers ("scrapers") | Python in `scrapers/<site>/run.py`, run by GitHub Actions on a schedule |
| Search index | the table `search_listings_ar`, rebuilt from the site tables every hour |
| AI Agent | Supabase edge function `supabase/functions/agent/` (deploy only with `deploy-edge-function.yml`) |
| Checks ("barriers") | `scripts/verify-*.ts`; `npm test` runs every one of them |
| Alarms ("detectors") | SQL functions `mon_detect_*`, run every 30 minutes by `mon_run_all_detectors()` |

## 3. Who does what

- **The owner** decides product and business questions. Ask them; never guess.
- **Six night engineers** are Claude routines on the owner's account (times in UTC):
  ⚡ Scraping 05:00 · 🆕 New Listings 07:00 · 🔬 Advanced Filter 09:00 · ♻️ Lifecycle 11:00 ·
  🔧 Quality & Repair 13:00 and 21:00 · 🦅 Falcon deep audit Tue + Fri 19:05.
  Their rulebooks are `docs/ops/*_ENGINEER.md`. A teammate on another account cannot see or edit them.
- Work for them goes in the table `ops_engineer_backlog` (columns `engineer`, `item`, `status`, `evidence`).
  Their nightly reports are in `ops_daily_engineer_run`.
- **Robots:** `engineer-automerge.yml` merges the engineers' scraper fixes; `auto-deploy-merged-fixes.yml`
  ships merged app fixes every hour through the 10 % canary, which rolls itself back if a test journey fails.

## 4. How to ship a change safely

1. Work on a branch, never on `main`. Open the PR with `--head <your-branch> --base main` (other sessions
   share the same folder).
2. Merge only with `node --experimental-strip-types scripts/safe-pr-merge.ts <PR>`. It re-checks everything
   and then MERGES — it is not a dry run. Never `gh pr merge --admin`.
3. Deploy the app only with the `Deploy frontend (production)` workflow (`deploy-frontend.yml`), or let the
   hourly robot do it. Never run `vercel` yourself and never press Redeploy in Vercel.
4. A database change applied to production must be committed as `supabase/migrations/<version>_<name>.sql`
   in the same change. Run `scripts/check-migration-before-apply.ts <file>` before applying.
5. Before anything that hits production hard (many searches, a browser sweep), look at `pg_stat_activity`;
   use at most 2 browsers against production at a time. Apply migrations only when the database is quiet.
6. **Nothing is "live" until you used it like a real user** on the website: search, find the card you
   changed, open it, and compare it with the source website. A green check or a merged PR is not "live".
7. Never paste passwords, keys or tokens into a chat, a file or a PR.

## 5. The owner's standing decisions (do not re-ask these)

**Data truth**
- **The source website is the truth.** Price, area, rooms, district and rent period are copied exactly.
  Never invent, round or "fix" a number you cannot prove Ezhalah broke. A field the site does not show is
  empty, never "no".
- **Gathern and Aqar Monthly show no price**, only «اضغط للاطلاع على الأسعار حسب مدة الإقامة» (stays are
  priced by length). Price on request («السعر عند الطلب») shows under every rent period.
- **The seller's sentence counts** (Advanced Filter "Rule B"): if the ad text clearly says «مسبح», the pool
  question can match it even when the site's box is empty. A box that says yes while the text says no is a
  conflict and becomes "unknown".
- **Districts:** the site's own district first; when it gives none, the district under the ad's map pin
  (Apple Maps, then Google), else the city only.
- **Before saying a site doesn't publish something** (a pin, a price, a district), check four places in a
  real browser: the ad page, the page's own data calls, the site's map or list feed, and the parent project.

**Sites**
- **A site that is down is put to sleep ("dormant"), not retired.** Its ads and logo are hidden, the robot
  keeps trying it every day, and it comes back by itself when it works again. Only the owner retires a site.
- **Projects:** a finished unit with its own page and price is a normal ad. Off-plan projects and
  project-only pages with no units or prices (for example the rebuilt Senan site) are stored but hidden.

**Product**
- **Website first.** No App Store / Play Store work until the website's bugs are near zero and the owner asks.
- **Ended ads in a saved chat** stay in place under a dark «انتهى الإعلان» cover; they are never removed.
- **English mirrors the Arabic**; the close button ✕ is top-right in both languages.
- **Instalment question** in the Advanced Filter shows the five partner logos; the per-ad badge stays EJARI.
- **AI money:** the AI spend breaker is reset by the owner only.

## 6. How the owner likes answers

Status line first, then at most 5 short bullets, then ONE bold question. Simple words, no jargon. Say
"live" only after the real-user check in §4.6. If something failed, say so first.

## 7. Read next

`AGENTS.md` → `docs/ARCHITECTURE.md` (§20 permanent rules, §21 decisions) → `docs/VERIFIED_BASELINES.md` →
the `docs/ops/*.md` file for the area you touch (`LISTING_LIVENESS.md` for dead ads,
`ADVANCED_FILTER_SOURCE_TRUTH.md` for the filter, `DEPLOY_SAFETY.md` for shipping).
