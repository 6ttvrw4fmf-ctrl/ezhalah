-- Backend deltas for the contextual Advanced Filter interview (owner-approved UX, 2026-08-11).
--
-- 1. filter_tier on af_field_registry — the Normal/Advanced boundary becomes DATA the engine reads
--    and a barrier can assert, not a convention:
--      normal        = Normal-Filter territory; the interview must NEVER auto-ask it (owner rule —
--                      bedrooms included, even when unset)
--      advanced      = the interview's question pool
--      more_options  = manual «خيارات إضافية» sheet only, never auto-asked
--      backend       = stored truth, no UI control
--
-- 2. Three counts the interview needs that apartment_guided_counts_ar didn't return:
--    cnt_unfurnished (furnished IS FALSE — explicit source no, tri-state respected),
--    cnt_maid_room, cnt_driver_room. Added via the TEMPLATE + rebuild_af_filter_rpcs(), the only
--    sanctioned writer — the parity barrier's md5 check would trip on any other route.

alter table public.af_field_registry
  add column if not exists filter_tier text not null default 'backend'
  check (filter_tier in ('normal','advanced','more_options','backend'));

update public.af_field_registry set filter_tier = 'normal'
 where canonical_key = 'bedrooms';
update public.af_field_registry set filter_tier = 'advanced'
 where canonical_key in ('bathrooms','property_age','air_conditioner','elevator','kitchen',
                         'private_entrance','furnished','installment_available','parking',
                         'maid_room','driver_room');
update public.af_field_registry set filter_tier = 'more_options'
 where canonical_key in ('direction_ar','street_width_m','floor_number','license_number');

do $$
declare tpl text; n int;
begin
  select template into strict tpl from public.af_rpc_templates
   where fn_name = 'apartment_guided_counts_ar';

  -- RETURNS TABLE: append the three columns after cnt_private_entrance
  if position('cnt_private_entrance bigint, cnt_bath1 bigint' in tpl) = 0 then
    raise exception 'RETURNS anchor not found';
  end if;
  tpl := replace(tpl, 'cnt_private_entrance bigint, cnt_bath1 bigint',
    'cnt_private_entrance bigint, cnt_unfurnished bigint, cnt_maid_room bigint, cnt_driver_room bigint, cnt_bath1 bigint');

  -- scoped CTE must carry the two extra columns
  if position('select s.rent_now_pay_later, s.kitchen, s.parking, s.elevator, s.furnished, s.bathrooms, s.air_conditioner, s.private_entrance' in tpl) = 0 then
    raise exception 'scoped select anchor not found';
  end if;
  tpl := replace(tpl,
    'select s.rent_now_pay_later, s.kitchen, s.parking, s.elevator, s.furnished, s.bathrooms, s.air_conditioner, s.private_entrance',
    'select s.rent_now_pay_later, s.kitchen, s.parking, s.elevator, s.furnished, s.bathrooms, s.air_conditioner, s.private_entrance, s.maid_room, s.driver_room');

  -- output select list: the three aggregates after cnt_private_entrance
  if position(E'count(*) filter (where private_entrance)                as cnt_private_entrance,\n    count(*) filter (where bathrooms >= 1)' in tpl) = 0 then
    raise exception 'aggregate anchor not found';
  end if;
  tpl := replace(tpl,
    E'count(*) filter (where private_entrance)                as cnt_private_entrance,\n    count(*) filter (where bathrooms >= 1)',
    E'count(*) filter (where private_entrance)                as cnt_private_entrance,\n'
 || E'    count(*) filter (where furnished is false)              as cnt_unfurnished,\n'
 || E'    count(*) filter (where maid_room)                       as cnt_maid_room,\n'
 || E'    count(*) filter (where driver_room)                     as cnt_driver_room,\n'
 || E'    count(*) filter (where bathrooms >= 1)');

  n := (select count(*) from regexp_matches(tpl, 'cnt_unfurnished', 'g'));
  if n <> 2 then raise exception 'expected 2 cnt_unfurnished mentions, got %', n; end if;

  update public.af_rpc_templates set template = tpl where fn_name = 'apartment_guided_counts_ar';
end $$;

select * from public.rebuild_af_filter_rpcs();

do $$
declare v int;
begin
  v := public.mon_af_predicate_parity();
  if v <> 0 then raise exception 'parity barrier reports % after rebuild', v; end if;
end $$;
