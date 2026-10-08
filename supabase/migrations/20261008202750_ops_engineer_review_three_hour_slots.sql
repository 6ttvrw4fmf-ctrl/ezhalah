-- Owner 2026-10-08: every nightly engineer gets 3 hours instead of 2 (sequential, non-overlapping slots).
-- Only the per-engineer cap changes (120 -> 180 minutes); the rest of the view is the live definition.
create or replace view public.ops_engineer_review as
 WITH team(eng, cap_min) AS (
         VALUES ('scraping-engineer'::text,180), ('new_listings_engineer'::text,180), ('advanced_filter'::text,180), ('lifecycle'::text,180)
        ), last_run AS (
         SELECT t.eng,
            t.cap_min,
            ( SELECT max(r.run_at) AS max
                   FROM ops_daily_engineer_run r
                  WHERE r.phase = (t.eng || ':start'::text)) AS last_start
           FROM team t
        ), x AS (
         SELECT l.eng,
            l.cap_min,
            l.last_start,
            ( SELECT min(r.run_at) AS min
                   FROM ops_daily_engineer_run r
                  WHERE r.phase = (l.eng || ':end'::text) AND r.run_at >= l.last_start) AS last_end
           FROM last_run l
        )
 SELECT eng AS engineer,
    cap_min,
    last_start,
    last_end,
    last_start > (now() - '26:00:00'::interval) AS ran_last_26h,
    last_end IS NOT NULL AS finished,
        CASE
            WHEN last_end IS NOT NULL THEN round(EXTRACT(epoch FROM last_end - last_start) / 60::numeric)::integer
            ELSE NULL::integer
        END AS minutes_used,
    COALESCE((EXTRACT(epoch FROM last_end - last_start) / 60::numeric) > (cap_min + 10)::numeric, false) AS over_cap,
    (( SELECT count(*) AS count
           FROM ops_daily_engineer_run r
          WHERE r.phase = (x.eng || ':progress'::text) AND r.run_at >= x.last_start))::integer AS progress_rows,
    ( SELECT r.issues_found
           FROM ops_daily_engineer_run r
          WHERE r.phase = (x.eng || ':end'::text) AND r.run_at >= x.last_start
          ORDER BY r.run_at DESC
         LIMIT 1) AS issues_found,
    ( SELECT r.issues_fixed
           FROM ops_daily_engineer_run r
          WHERE r.phase = (x.eng || ':end'::text) AND r.run_at >= x.last_start
          ORDER BY r.run_at DESC
         LIMIT 1) AS issues_fixed,
    (( SELECT "substring"(r.report, '(\d{1,2})\s*/\s*10'::text) AS "substring"
           FROM ops_daily_engineer_run r
          WHERE r.phase = (x.eng || ':end'::text) AND r.run_at >= x.last_start
          ORDER BY r.run_at DESC
         LIMIT 1))::integer AS rating_in_report,
    ( SELECT COALESCE(r.report ~* '(owner questions|asking you|needs your|needs from you)'::text AND r.report !~* 'needs from you:?\s*nothing'::text, false) AS "coalesce"
           FROM ops_daily_engineer_run r
          WHERE r.phase = (x.eng || ':end'::text) AND r.run_at >= x.last_start
          ORDER BY r.run_at DESC
         LIMIT 1) AS asks_owner_heuristic
   FROM x;
