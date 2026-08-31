-- phasea_src_arabic is a FROZEN one-off snapshot with no refresh job, and the live resolver still
-- reads it as if it were current source truth.
--
-- Found live 2026-08-31. phasea_src_arabic (23,252 rows) was captured during the 2026-08-21 phasea
-- work. Nothing repopulates it — no cron job writes it — yet listing_native_location_v1 (refreshed
-- hourly, jobid 17) resolves city_id/region_id through phasea_shadow_resolution, whose candidate
-- ordering PREFERS the city matching the snapshot's city_ar_src over shadow_city. So where the
-- snapshot has gone stale against the source, a listing is served in the WRONG CITY and nothing
-- notices: the search index agrees with v2, which agrees with v1 — they are all wrong together.
-- mon_search_index_city_drift compares the index against the resolver's own output and therefore
-- structurally cannot see a resolver that is confidently wrong.
--
-- Two rows were being served in the wrong city, both proven against the source's own payload:
--   gathern 726509 — snapshot «ابها»; source publishes city_ar «جدة», English city "Jeddah", and
--     GPS 21.583/39.211 (Jeddah; Abha is 18.2/42.5). Was served as أبها / منطقة عسير.
--   sadin  597777 — snapshot «المدينة المنورة»; source publishes city_ar «تبوك», English city
--     "Tabuk", and its own title reads «فيلا فاخرة للبيع في تبوك – حي الجامعة». Was served as
--     المدينة المنورة.
-- Both snapshot rows were corrected from the live payload in the same run.
--
-- WHAT THIS DETECTS, and deliberately what it does NOT. It fires only where the snapshot
-- contradicts the LIVE SOURCE PAYLOAD for the same listing — a provable staleness bug with a
-- provable repair (re-read the source value), so every finding is closable. It does NOT fire on
-- the wider set of ~49 rows where the snapshot and the canonical city merely resolve to different
-- catalog cities: that set is an adjudication question, not a defect. Measured, it splits into
-- «الاحساء»→«الهفوف» (29 rows — governorate vs its principal city, a TAXONOMY decision on the RED
-- list), «المبرز»/«الرايس»/«حقل» (17 rows where the snapshot's Arabic value is the MORE specific
-- and correct city, so today's ordering is right and flipping it would BREAK them), and
-- «سبت العلاية»→«العلا» (3 rows needing per-listing source checks). Raising those here would be a
-- detector nobody can clear — this repo's own known failure mode
-- (mon_detect_unresolvable_alert_kinds). They go to the owner instead.
--
-- Cost: one query_to_xml count per snapshot table (34), the same shape as the other roster
-- detectors.

create or replace view public.mon_phasea_snapshot_stale_vs_source as
select z.source_table, split_part(z.source_table, '_', 1) as platform, z.stale_rows
from (
  select t.source_table,
    (xpath('/row/a/text()', query_to_xml(format(
      'select count(*) a from public.phasea_src_arabic p join public.%I c on c.id = p.listing_id '
      ' where p.source_table = %L '
      '   and c.additional_info ? ''city_ar'' '
      '   and nullif(btrim(c.additional_info->>''city_ar''), '''') is not null '
      '   and normalize_ar(btrim(p.city_ar_src)) is distinct from '
      '       normalize_ar(btrim(c.additional_info->>''city_ar''))',
      t.source_table, t.source_table), false, true, '')))[1]::text::bigint as stale_rows
  from (select distinct source_table from public.phasea_src_arabic) t
  where exists (select 1 from information_schema.columns ic
                 where ic.table_schema = 'public' and ic.table_name = t.source_table
                   and ic.column_name = 'additional_info')
) z
where z.stale_rows > 0;

create or replace function public.mon_detect_phasea_snapshot_stale_vs_source()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0;
  r record;
  seen text[] := array[]::text[];
begin
  for r in select * from public.mon_phasea_snapshot_stale_vs_source order by stale_rows desc loop
    seen := seen || r.source_table;
    n := n + public.mon_raise(
      'P1', 'phasea_snapshot_stale', r.platform,
      'phasea_snapshot_stale:' || r.source_table,
      jsonb_build_object(
        'source_table', r.source_table,
        'stale_rows', r.stale_rows,
        'why', 'phasea_src_arabic is a FROZEN snapshot with no refresh job, and ' || r.stale_rows ||
               ' row(s) in it now contradict the city_ar the source itself publishes for the same '
               'listing. listing_native_location_v1 resolves city_id/region_id through '
               'phasea_shadow_resolution, whose candidate ordering PREFERS the snapshot value — so '
               'each of these rows can be SERVED IN THE WRONG CITY, and no consistency monitor can '
               'see it (index agrees with v2 agrees with v1; all wrong together). REPAIR: re-read '
               'city_ar from the source row into phasea_src_arabic for the contradicting listings, '
               'then refresh listing_native_location_v1 and let sync_search_listings_ar propagate. '
               'Confirm each against the source payload first (city_ar, the English city field, '
               'GPS, and the title) — do NOT bulk-overwrite: the snapshot is right and the live '
               'field wrong often enough that this is adjudicated per row.',
        'query', 'select p.* from phasea_src_arabic p join ' || r.source_table || ' c on c.id = '
                 'p.listing_id where p.source_table = ''' || r.source_table || ''' and '
                 'normalize_ar(btrim(p.city_ar_src)) is distinct from '
                 'normalize_ar(btrim(c.additional_info->>''city_ar''))'));
  end loop;

  -- Self-heal: a table that no longer contradicts its source resolves on the next sweep.
  perform public.mon_resolve_key('phasea_snapshot_stale', 'phasea_snapshot_stale:' || t.source_table)
    from (select distinct source_table from public.phasea_src_arabic) t
   where not (t.source_table = any(seen));

  return n;
end $function$;

-- Roster entry in the SAME migration (AGENTS.md: a detector nothing reaches is decoration, and
-- mon_detect_orphaned_detectors() fires on one). The roster is a hard-coded array inside
-- mon_run_all_detectors(), so append to it surgically and idempotently rather than restating ~200
-- lines of a surface other routines also edit.
do $mig$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if def is null then
    raise exception 'mon_run_all_detectors() not found — roster wiring cannot be verified';
  end if;

  if position('mon_detect_phasea_snapshot_stale_vs_source' in def) = 0 then
    if position('''mon_detect_phasea_offregion_pick''' in def) = 0 then
      raise exception 'roster anchor mon_detect_phasea_offregion_pick missing — refusing to guess';
    end if;
    def := replace(def,
      '''mon_detect_phasea_offregion_pick''',
      '''mon_detect_phasea_offregion_pick'','
        || chr(10) || '    ''mon_detect_phasea_snapshot_stale_vs_source''');
    execute def;
  end if;
end $mig$;
