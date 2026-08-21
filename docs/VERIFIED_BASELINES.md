# Verified baselines (reuse index)

> **Purpose:** stop re-deriving the same verified fact every session. Each entry below is a claim that
> was independently verified, with a cheap way to re-check it and a condition that means it's stale.
> Check here BEFORE running an expensive audit; if a staleness condition hasn't occurred, cite this
> entry instead of re-auditing. See `AGENTS.md` "Read this first" and
> [[feedback_token-efficiency-reuse-first-rule]] for the operating rule this file exists to serve.
>
> **Rules for entries here:** only STABLE, mechanism-level facts (how something works, what a code path
> does, a fixed identifier) — never live counts (listing totals, search totals, per-platform row counts)
> that drift with every scrape; those belong in a monitor/dashboard query, not a static file. Update an
> entry IN PLACE when re-verified; don't append a duplicate.

| Claim | Verified | Re-verify with | Stale when |
|---|---|---|---|
| Deploy target is `ezhalah-app` (`prj_CLp9BxNzT4RmWL9Is1KjHoQlSAlX`, team `enzalah`); `ezhalah-app.vercel.app` is the only production alias | 2026-07-21 | `cat .vercel/project.json` + `scripts/deploy-target-guard.sh` constants | Owner changes the target (would be a P0 AGENTS.md edit) |
| Supabase project is `aannarbkwcymrotzwdbo`, region Tokyo `ap-northeast-1`, no KSA region offered | 2026-06-09 (region), 2026-07-06 (no-KSA-region finding) | Supabase MCP `get_project` / `list_projects` | Supabase adds a Middle East region, or project is migrated |
| Scraper repo is `6ttvrw4fmf-ctrl/ezhalah`; all scraper cadence is owned by `pg_cron` → `trigger_gh_workflow` → GitHub `workflow_dispatch` (dispatch-only, monitorable/pausable from the DB) | 2026-07-06 | `select * from platform_cadence;` | A scraper adds its own independent schedule outside `pg_cron` |
| aqar.fm liveness: HTTP 200 proves nothing (soft-close pages return 200); the real signal is the page's RSC status code — `1`/`5`/`10` = listing closed | 2026-08-07/08 | `reference_aqar-liveness-source-verification-method` memory; fetch a known-closed aqar URL and inspect the RSC payload | aqar changes its RSC status-code scheme |
| Wasalt liveness oracle: the **Arabic** product sitemap updates daily and is the liveness signal; the English sitemap is frozen/stale; direct GETs 403 from non-Saudi egress | 2026-07-12 | `reference_wasalt-sitemap-liveness-oracle` memory | Wasalt changes its sitemap structure |
| `npm test`'s migration-drift check finds **539** migration identifiers via `scripts/build-repo-migration-versions.cjs` (sanity floor >100) — both `safe-deploy.sh` and the continuous drift checker share this one parser | 2026-08-10 | `npm test 2>&1 \| grep "migration identifiers"` | Count only meaningful as a floor check, not tracked as an exact number here |
| Legacy search RPCs `location_search_candidates` / `location_search_candidates2` are REVOKEd for `anon`/`authenticated`; frontend can only call `location_search_candidates_ar` | 2026-07-06 | `select has_function_privilege('anon', 'location_search_candidates(...)', 'execute');` (expect false) | A new migration re-grants EXECUTE on the legacy functions |
| aqar_residential's recurring "integrity guard tripped" RC-B demotions were NOT timeouts (runs finish in 4-24s) — `mon_check_run_field_ranges`'s buy/rent null-price checks compared aqar-sweep.yml's per-city (all-property-type) touched slice against ONE flat table-wide baseline; a city sweep landing disproportionately on structurally-high-null types (Room 25%, Chalet 91%, Rest House 17%, legacy House 78%) always looked anomalous vs the ~6-8% flat average even with zero real regression. Fixed 2026-08-21 with a per-property_type composite baseline (migration `20260821031350_fix_run_field_range_composite_baseline.sql`); falls back to the old flat baseline per-type when that type has <20 table-wide rows or `property_type` isn't a column, so other `check_tables` callers (wasalt, aqaratikom, etc) are unaffected | 2026-08-21 | `select pg_get_functiondef(oid) from pg_proc where proname='mon_check_run_field_ranges'` — look for `composite_type_baseline_frac`; regression proof: `scripts/verify-run-field-range-composite-baseline-live.ts` | The composite design changes again, or a genuinely new flat-baseline false positive appears on a different check_tables caller |

**How to add an entry:** verify it once, add a row with today's date and a cheap re-verify command, and
delete/replace any memory-only copy of the same fact once it's here.
