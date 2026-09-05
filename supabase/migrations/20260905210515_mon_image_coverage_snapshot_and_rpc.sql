-- IMAGE COVERAGE BECOMES A WATCHED NUMBER (owner directive 2026-09-05: «we never want this issue
-- again»). Two platforms shipped with a hardcoded-empty photo list and nothing noticed until the
-- owner looked at the site; a follow-up sweep then found coverage as low as 31% (mustqr) on
-- platforms whose sources publish photos. An unphotographed listing renders «لا توجد صورة» and is
-- perfectly valid at every pipeline layer — so the only honest detector is a COVERAGE NUMBER,
-- snapshotted and ratcheted.
--
-- Shape follows the dashboard-first monitoring pattern (mon_snapshot_searchability): a snapshot
-- table refreshed by cron + a cheap reader RPC for the CI barrier. The sweep itself scans every
-- listings table (aqar alone is ~90k rows), which is fine at 03:35 under the cron's 600s timeout
-- and NOT fine inside an anon REST call — hence snapshot, not live computation.
CREATE TABLE IF NOT EXISTS public.mon_image_coverage (
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  platform text NOT NULL,
  active_rows bigint NOT NULL,
  with_images bigint NOT NULL,
  pct numeric NOT NULL,
  total_images bigint NOT NULL,
  PRIMARY KEY (snapshot_at, platform)
);
ALTER TABLE public.mon_image_coverage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read" ON public.mon_image_coverage;
CREATE POLICY "public read" ON public.mon_image_coverage FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.mon_snapshot_image_coverage()
RETURNS TABLE (platform text, active_rows bigint, with_images bigint, pct numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE r record; v_now timestamptz := now();
BEGIN
  CREATE TEMP TABLE _cov(tbl text, act bigint, wi bigint, imgs bigint) ON COMMIT DROP;
  FOR r IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name ~ '_(residential|commercial)_listings$'
  LOOP
    EXECUTE format(
      'INSERT INTO _cov SELECT %L, count(*),
         count(*) FILTER (WHERE coalesce(array_length(photo_urls,1),0) > 0),
         coalesce(sum(array_length(photo_urls,1)),0)
       FROM %I WHERE active', r.table_name, r.table_name);
  END LOOP;

  INSERT INTO mon_image_coverage (snapshot_at, platform, active_rows, with_images, pct, total_images)
  SELECT v_now, split_part(tbl,'_',1), sum(act), sum(wi),
         round(100.0*sum(wi)/nullif(sum(act),0), 1), sum(imgs)
  FROM _cov GROUP BY 2 HAVING sum(act) > 0;

  -- keep 90 days; the barrier only ever reads the newest snapshot
  DELETE FROM mon_image_coverage WHERE snapshot_at < v_now - interval '90 days';

  RETURN QUERY SELECT m.platform, m.active_rows, m.with_images, m.pct
  FROM mon_image_coverage m WHERE m.snapshot_at = v_now ORDER BY m.pct, m.active_rows DESC;
END $fn$;

-- cheap reader for the CI barrier: the LATEST snapshot plus its age, so a stale/never-run snapshot
-- is visible to the caller instead of silently passing (a guard whose input can go missing must
-- say so — the barrier fails closed on freshness).
CREATE OR REPLACE FUNCTION public.ops_image_coverage_latest()
RETURNS TABLE (platform text, active_rows bigint, with_images bigint, pct numeric,
               total_images bigint, snapshot_age_hours numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  WITH latest AS (SELECT max(snapshot_at) AS t FROM mon_image_coverage)
  SELECT m.platform, m.active_rows, m.with_images, m.pct, m.total_images,
         round(extract(epoch FROM (now() - l.t))/3600, 1)
  FROM mon_image_coverage m CROSS JOIN latest l
  WHERE m.snapshot_at = l.t
  ORDER BY m.pct, m.active_rows DESC;
$fn$;

REVOKE ALL ON FUNCTION public.mon_snapshot_image_coverage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mon_snapshot_image_coverage() TO service_role;
REVOKE ALL ON FUNCTION public.ops_image_coverage_latest() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ops_image_coverage_latest() TO anon, authenticated, service_role;

-- daily at 03:35 UTC, after the overnight scrapes settle and beside the searchability snapshot
SELECT cron.schedule('mon-image-coverage-snapshot', '35 3 * * *',
  $$set statement_timeout to '600s'; select * from public.mon_snapshot_image_coverage();$$);
