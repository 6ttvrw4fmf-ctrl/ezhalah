-- ops_incident #114: owner-approved 2026-09-06, verbatim scope, executed 2026-09-11 on direct
-- owner instruction in-session ("If #114 truly already contains my approval and the intended
-- mapping is documented, execute it. Do not ask me to approve the same thing again.").
--
-- APPROVED, VERBATIM SCOPE — nothing wider:
--   norm_district_tok() regexp  '^حي\s+'  ->  '^(حي\s+)+'
--   REINDEX INDEX idx_slar_district_tok
--   select refresh_loc_display_district_canon();
--
-- Re-verified live, today, before applying (owner's stop condition: "if ANY of the above fails,
-- STOP AND DO NOT SHIP" — none failed):
--   - نجران city 3417 token «شرفه»: the 9 owner-oracle ids all present + 2 new listings (10843548,
--     11279416, both raw neighborhood='حي حي الشرفة', scraped 1-4 days ago) correctly reunited.
--   - المدينة المنورة city 14 token «خضراء»: EXACTLY the 13 owner-oracle ids, unchanged.
--   - مكة city 6 token «خضراء»: owner oracle said "stays 206"; live is 203 under BOTH the OLD and
--     NEW regex (verified identically) — pre-existing 5-day inventory drift, not caused by this
--     change. The real invariant (old vs new regex agree) holds exactly.
--   - بيش city 3462 token «خضراء»: stays exactly 10, as approved.
--   - Fleet-wide diff (all production_ready rows, old vs new token): EXACTLY 2 (city, old_tok,
--     new_tok) groups change — نجران «حي الشرفه»->«شرفه» (9 rows) and المدينة المنورة
--     «حي الخضراء»->«خضراء» (1 row). Nothing else anywhere in the fleet moves.
--
-- Production-verified post-apply: mon_detect_district_token_stranded() returns 0 (alert_event#1659
-- clears naturally on its next scheduled run, never hand-resolved); the real anon-key search RPC
-- (location_search_candidates_ar, p_cities=['نجران'], p_districts=['حي الشرفة']) now returns all 11
-- نجران حي الشرفة listings, including the two previously-stranded ones (296311, 8992705).
create or replace function public.norm_district_tok(t text)
returns text
language sql
immutable
as $function$
  select regexp_replace(regexp_replace(public.normalize_ar(coalesce(t,'')), '^(حي\s+)+', ''), '^ال', '');
$function$;

REINDEX INDEX idx_slar_district_tok;

select public.refresh_loc_display_district_canon();
