-- CLEAR THE AMENITY YESES OUR OLD PROSE MATCHER WROTE THAT THE AD'S OWN WORDS DO NOT STATE (owner 2026-11-03: «Yes, clear
-- them», after «whatever user selects must be true and must be written on the other sites»).
--
-- These columns are not site fields: dealapp, rakez (description) and wasalt publish no structured amenity, and aqar
-- publishes maid / driver rooms on the VILLA form only. Each value was written by the older normalize.prose_amenities
-- matcher, and Rule B served it as «the site's own field». The 2026-11-03 audit found that matcher reading «مداخل مكيفة»
-- (air-conditioned lobbies) as unit AC, «مكان مخصص للمصعد» (a reserved shaft) as an elevator, and similar. The
-- Advanced Filter's word reader (scrapers/facts/word_checker.py) has read every one of these ads; where IT does not say
-- yes, the yes is cleared to NULL (unknown — never «no»). Measured before the clear (active rows): dealapp ~2,400
-- (parking 567, AC 512, elevator 480, kitchen 263, …), wasalt 182, aqar non-villa maid/driver 61; plus ~8,900 on
-- inactive rows. Every cleared value is kept in ops_prose_box_cleared (reversible: restore old_value by key). The code
-- that wrote them now uses the word reader (PR #10263, wasalt in #10211), so the next scrape writes the same answer
-- the Advanced Filter reads. ops_clear_prose_box_yes() is idempotent and can be run again after that code lands.
set local lock_timeout = '5s';

create table if not exists public.ops_prose_box_cleared (
  source_table text not null,
  listing_id   bigint not null,
  col          text not null,
  old_value    boolean,
  cleared_at   timestamptz not null default now(),
  primary key (source_table, listing_id, col)
);
alter table public.ops_prose_box_cleared enable row level security;
revoke all on public.ops_prose_box_cleared from anon, authenticated;

create or replace function public.ops_clear_prose_box_yes()
returns table(source_table text, col text, cleared bigint)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r record; n bigint;
begin
  for r in select * from (values
    ('dealapp_residential_listings','elevator','elevator',false), ('dealapp_residential_listings','kitchen','kitchen',false),
    ('dealapp_residential_listings','air_conditioner','air_conditioner',false), ('dealapp_residential_listings','parking','parking',false),
    ('dealapp_residential_listings','maid_room','maid_room',false), ('dealapp_residential_listings','driver_room','driver_room',false),
    ('dealapp_residential_listings','laundry_room','laundry_room',false), ('dealapp_residential_listings','balcony_terrace','balcony',false),
    ('dealapp_residential_listings','private_entrance','private_entrance',false), ('dealapp_residential_listings','car_entrance','car_entrance',false),
    ('dealapp_residential_listings','furnished','furnished',false),
    ('rakez_residential_listings','parking','parking',false), ('rakez_residential_listings','kitchen','kitchen',false),
    ('rakez_residential_listings','maid_room','maid_room',false), ('rakez_residential_listings','driver_room','driver_room',false),
    ('rakez_residential_listings','private_entrance','private_entrance',false),
    ('wasalt_residential_listings','elevator','elevator',false), ('wasalt_residential_listings','air_conditioner','air_conditioner',false),
    ('wasalt_residential_listings','private_entrance','private_entrance',false),
    ('aqar_residential_listings','maid_room','maid_room',true), ('aqar_residential_listings','driver_room','driver_room',true)
  ) t(tbl, c, txtkey, nonvilla)
  loop
    execute format($q$
      with hit as (
        select x.id from public.%1$I x
          left join public.listing_text_facts f on f.source_table = %1$L and f.listing_id = x.id and f.stale_at is null
         where x.%2$I is true and coalesce(f.facts -> %3$L ->> 'v', 'x') <> 'true' %4$s),
      saved as (
        insert into public.ops_prose_box_cleared (source_table, listing_id, col, old_value)
        select %1$L, id, %2$L, true from hit
        on conflict (source_table, listing_id, col) do update set old_value = excluded.old_value, cleared_at = now()
        returning listing_id)
      update public.%1$I x set %2$I = null from saved where x.id = saved.listing_id and x.%2$I is true$q$,
      r.tbl, r.c, r.txtkey, case when r.nonvilla then $c$and coalesce(x.property_type, '') <> 'Villa'$c$ else '' end);
    get diagnostics n = row_count;
    source_table := r.tbl; col := r.c; cleared := n;
    return next;
  end loop;
end
$function$;
revoke execute on function public.ops_clear_prose_box_yes() from public, anon, authenticated;

-- Run it, and prove: every cleared value is backed up, and no target column still holds a yes the word reader does not say.
do $$
declare v_cleared bigint; v_saved bigint; v_left bigint;
begin
  select coalesce(sum(cleared), 0) into v_cleared from public.ops_clear_prose_box_yes();
  select count(*) into v_saved from public.ops_prose_box_cleared;
  if v_saved < v_cleared then raise exception 'PROOF: % cleared but only % backed up', v_cleared, v_saved; end if;
  select coalesce(sum(cleared), 0) into v_left from public.ops_clear_prose_box_yes();   -- idempotent: a second run finds nothing
  if v_left <> 0 then raise exception 'PROOF: a second run still cleared % rows', v_left; end if;
  raise notice 'cleared % prose yeses (backed up: %)', v_cleared, v_saved;
end $$;