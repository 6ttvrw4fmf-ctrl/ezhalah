-- Guard + arrivals repair for migration wasalt_card_licence_from_rega_block (wasalt_preserve_detail appends the card's licence row).
-- 1. mon_detect_wasalt_card_licence_missing(): a served wasalt row that the sweep re-upserted AFTER the trigger landed,
--    whose index holds a 10-digit REGA licence (from ar_data.regaVerifiedInfo) but whose card panel has no
--    rega_ad_license_number row, means the trigger stopped working: P2 to 🆕. Rows not yet touched since the trigger
--    are not counted (the 02:25 UTC sweeps touch every row daily).
-- 2. Repair, narrow: today's wasalt arrivals (first seen in the last 26 h) and the proof ad 24745764 are touched with
--    a no-op UPDATE so the BEFORE UPDATE trigger adds their licence row now; the rest gain it at the next sweep.
create or replace function public.mon_detect_wasalt_card_licence_missing()
returns integer
language plpgsql
as $$
declare v int;
begin
  select count(*) into v
    from public.search_listings_ar s
   where s.platform = 'wasalt'
     and s.license_number ~ '^\d{10}$'
     and ((s.source_table = 'wasalt_residential_listings' and exists (
             select 1 from public.wasalt_residential_listings w
              where w.id = s.listing_id and w.last_seen_at > timestamptz '2026-11-08 07:15:00+00'
                and jsonb_typeof(w.additional_info) = 'array'
                and not w.additional_info @> '[{"key": "rega_ad_license_number"}]'::jsonb))
       or (s.source_table = 'wasalt_commercial_listings' and exists (
             select 1 from public.wasalt_commercial_listings w
              where w.id = s.listing_id and w.last_seen_at > timestamptz '2026-11-08 07:15:00+00'
                and jsonb_typeof(w.additional_info) = 'array'
                and not w.additional_info @> '[{"key": "rega_ad_license_number"}]'::jsonb)));
  if v > 0 then
    return public.mon_raise('P2', 'wasalt_card_licence_missing', 'wasalt', 'wasalt_card_licence_missing',
      jsonb_build_object('rows', v, 'why',
        'served wasalt rows re-upserted after 2026-11-08 07:15 UTC hold a REGA licence in the index but no licence row on '
        || 'the card: wasalt_preserve_detail() no longer appends it'));
  end if;
  perform public.mon_resolve_key('wasalt_card_licence_missing', 'wasalt_card_licence_missing');
  return 0;
end $$;

-- Roster: needle-inserted into the LIVE definition (a full copy would clobber a peer's entry).
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_wasalt_card_licence_missing' in src) > 0 then raise notice 'already on the roster'; return; end if;
  out_def := replace(src,
    E'    ''mon_detect_heartbeat_silent'',',
    E'    ''mon_detect_heartbeat_silent'',\n    ''mon_detect_wasalt_card_licence_missing'',');
  if out_def = src then raise exception 'roster anchor not found — refusing to guess where the entry belongs'; end if;
  execute out_def;
end $$;

-- Lane: the alert belongs to 🆕 (needle-inserted the same way).
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.ops_engineer_for_alert(text, text)'::regprocedure);
  if position('wasalt_card_licence_missing' in src) > 0 then return; end if;
  out_def := replace(src, '^(card_parity_source_mismatch|', '^(card_parity_source_mismatch|wasalt_card_licence_missing|');
  if out_def = src then raise exception 'ops_engineer_for_alert anchor not found — refusing to guess'; end if;
  execute out_def;
end $$;

-- Repair: today's arrivals + the proof ad (no-op UPDATE; the BEFORE UPDATE trigger adds the licence row).
update public.wasalt_residential_listings w
   set additional_info = w.additional_info
 where w.active
   and (w.id = 24745764
        or w.id in (select s.listing_id from public.search_listings_ar s
                     where s.platform = 'wasalt' and s.source_table = 'wasalt_residential_listings'
                       and s.first_seen_at > now() - interval '26 hours'));

update public.wasalt_commercial_listings w
   set additional_info = w.additional_info
 where w.active
   and w.id in (select s.listing_id from public.search_listings_ar s
                 where s.platform = 'wasalt' and s.source_table = 'wasalt_commercial_listings'
                   and s.first_seen_at > now() - interval '26 hours');
