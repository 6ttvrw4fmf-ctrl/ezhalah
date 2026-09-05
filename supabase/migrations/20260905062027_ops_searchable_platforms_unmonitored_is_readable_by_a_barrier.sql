-- The invariant "a platform serving users is watched" must be checkable from OUTSIDE the detector
-- that enforces it.
--
-- mon_detect_registry_orphans limb 3 (20260905_registry_orphans_sees_a_searchable_platform_its_status_excludes)
-- is the live enforcement, rostered and run twice hourly. But a barrier that can only be verified by
-- reading that function's own body is a source-TEXT tripwire, and AGENTS.md is explicit about how
-- those fail: on 2026-09-04, five defects each had a barrier over the exact line and every one of
-- those barriers passed for the entire time the defect was live. If limb 3 were deleted tomorrow,
-- nothing outside it would notice.
--
-- So the invariant gets its own reader, computed from production's own searchable set, that a
-- committed barrier can EXECUTE. scripts/verify-searchable-platforms-are-monitored.ts calls this and
-- fails on any row — it never reads the detector's body, so it stays true if the detector is
-- rewritten, renamed or removed.
--
-- ANON-SAFE BY CONSTRUCTION: returns platform slugs (already public — they are the logos in the
-- loading strip) and a row count. No listing data, no URLs, no per-listing fields. platform_registry
-- itself stays unreadable to anon; this is the one derived fact that leaves it.
CREATE OR REPLACE FUNCTION public.ops_searchable_platforms_unmonitored()
 RETURNS TABLE (platform text, searchable_rows bigint, registry_status text, registry_kind text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select split_part(s.source_table, '_', 1) as platform,
         count(*) as searchable_rows,
         coalesce(max(pr.status), '<no registry row>') as registry_status,
         coalesce(max(pr.kind),   '<no registry row>') as registry_kind
  from public.search_listings_ar s
  left join public.platform_registry pr on pr.platform = split_part(s.source_table, '_', 1)
  where s.production_ready
  group by 1
  having bool_and(coalesce(pr.status,'') is distinct from 'active'
               or coalesce(pr.kind,'')   is distinct from 'source')
  order by 2 desc;
$function$;

REVOKE ALL ON FUNCTION public.ops_searchable_platforms_unmonitored() FROM public;
GRANT EXECUTE ON FUNCTION public.ops_searchable_platforms_unmonitored() TO anon, authenticated, service_role;