-- mon_district_contradicts_source was a VIEW WITH NO DETECTOR AND NO ROSTER ENTRY.
--
-- AGENTS.md: "a detector outside the roster is decoration". This one was worse — there was no
-- detector at all, just a view nobody called. It is the reason 6 gathern listings served a district
-- the source never published, for weeks, with every barrier green: nothing was ever going to raise
-- them. mon_detect_orphaned_detectors() fires on a detector nothing reaches, but not on a
-- monitoring VIEW that never became one.
--
-- THE SECOND FROZEN SNAPSHOT. Found 2026-08-31, the same architectural class as phasea_src_arabic
-- (see 20260831080856). listings_arabic_locations is a plain TABLE with NO cron job repopulating
-- it, and listing_native_location_v1's final SELECT falls back to it for district_ar whenever the
-- upstream arm yields NULL — which is always, for the phasea platforms. So a stale row in it is
-- served directly to users. Measured: 6,781 of 21,172 active gathern rows carry raw fields that no
-- longer match the live source. Most are canonical-equivalent spelling drift and harmless; exactly
-- 6 contradicted the source's OWN Arabic district after normalisation, and those 6 were repaired:
--   gathern 724812/724816/724818/724823/724844 — served «حي الملك عبدالله»
--     (snapshot raw "King Abdullah Dist."); the source publishes "Al Jamiyin Dist." / «حي الجامعيين».
--   gathern 726509 — served «حي الربوة» (snapshot raw "Ar Rabwah Dist." + a stale city «أبها»);
--     the source publishes "As Safa Dist." / «حي الصفا», in Jeddah.
-- Each row's two source fields (English neighborhood and additional_info.district_ar) agree with
-- each other and disagree with the snapshot, so the direction is not a judgement call.
--
-- The remaining ~6,775 raw differences are deliberately NOT touched: they do not contradict the
-- source's published district once normalised, and rewriting a resolver input table for thousands
-- of listings on a raw-string difference is the bulk operation the RED list reserves for the owner.
-- The detector below measures the user-visible condition, so it stays at 0 while they are benign
-- and fires the moment one of them starts contradicting the source.
--
-- The repair is idempotent and self-guarding: it only moves a row when the source publishes BOTH
-- district fields and the view still reports the contradiction, so re-running it is a no-op.

update public.listings_arabic_locations l
   set raw_district = g.neighborhood,
       district_ar  = g.additional_info->>'district_ar'
  from public.gathern_residential_listings g
 where l.source_table = 'gathern_residential_listings'
   and l.listing_id = g.id
   and g.active
   and nullif(btrim(g.neighborhood), '') is not null
   and nullif(btrim(g.additional_info->>'district_ar'), '') is not null
   and l.district_ar is distinct from (g.additional_info->>'district_ar')
   and exists (select 1 from public.mon_district_contradicts_source m
                where m.source_table = l.source_table and m.listing_id = l.listing_id);

create or replace function public.mon_detect_district_contradicts_source()
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
  for r in
    select source_table, platform, count(*)::bigint as rows_affected,
           (array_agg(listing_id order by listing_id))[1:5] as sample_ids,
           (array_agg(source_says || ' -> ' || we_display order by listing_id))[1:3] as sample_pairs
      from public.mon_district_contradicts_source
     group by source_table, platform
     order by count(*) desc
  loop
    seen := seen || r.source_table;
    n := n + public.mon_raise(
      'P1', 'district_contradicts_source', r.platform,
      'district_contradicts_source:' || r.source_table,
      jsonb_build_object(
        'source_table', r.source_table,
        'rows_affected', r.rows_affected,
        'sample_listing_ids', to_jsonb(r.sample_ids),
        'sample_source_to_displayed', to_jsonb(r.sample_pairs),
        'why', r.rows_affected || ' listing(s) are SERVED a district the source never published. '
               'The comparison is against listing_source_district_ar — what the source itself '
               'published — and is normalisation-aware, so a spelling variant is not a finding: '
               'these genuinely name a different neighbourhood. A user filtering by the real '
               'district cannot find the listing, and a user filtering by the displayed one finds a '
               'property that is not there. Known cause (2026-08-31): listings_arabic_locations is '
               'a frozen snapshot with no refresh job, and listing_native_location_v1 falls back to '
               'it for district_ar whenever the upstream arm yields NULL. REPAIR: copy the source '
               'row''s own neighborhood + additional_info.district_ar into that table for the '
               'contradicting listings, refresh listing_native_location_v1, then '
               'sync_search_listings_ar. Verify each row''s two source fields agree with each other '
               'first; where they do not, resolve to NULL rather than guessing (§6).'));
  end loop;

  -- Self-heal: a table that no longer contradicts its source resolves on the next sweep.
  perform public.mon_resolve_key('district_contradicts_source',
                                 'district_contradicts_source:' || t.relname)
    from pg_class t join pg_namespace ns on ns.oid = t.relnamespace
   where ns.nspname = 'public' and t.relkind = 'r'
     and t.relname ~ '_(residential|commercial)_listings$'
     and not (t.relname = any(seen));

  return n;
end $function$;

-- Roster entry in the SAME migration. Idempotent, and fails closed if its anchor is gone.
do $mig$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if def is null then
    raise exception 'mon_run_all_detectors() not found — roster wiring cannot be verified';
  end if;

  if position('mon_detect_district_contradicts_source' in def) = 0 then
    if position('''mon_detect_phasea_offregion_pick''' in def) = 0 then
      raise exception 'roster anchor mon_detect_phasea_offregion_pick missing — refusing to guess';
    end if;
    def := replace(def,
      '''mon_detect_phasea_offregion_pick''',
      '''mon_detect_phasea_offregion_pick'','
        || chr(10) || '    ''mon_detect_district_contradicts_source''');
    execute def;
  end if;
end $mig$;
