-- ROOT CAUSE of the 2026-09-14 regression of the owner's 2026-09-13 الجفر/الضاحية merge
-- (routine-3 data-integrity). The merge was re-applied by migration
-- 20260913080703 and the scraper was fixed to keep it (scrapers/amlakalahsa/run.py:318), yet by
-- 2026-09-14 04:29 only 7 of the 32 rows were still merged and a buyer picking الجفر → الضاحية got
-- 7 results instead of 32 (proven through location_search_candidates_ar itself, not by counting
-- table rows).
--
-- Neither hypothesis the existing detector names was right: the scraper fix was NOT reverted and
-- the sync path did NOT stop propagating. The third mechanism is this, and it is the
-- "A FAILED FETCH IS NOT AN EMPTY ANSWER" class expressed in a NORMALISATION rule instead of a
-- fetch:
--
--   * run.py derives city_ar from THIS crawl's geocode blob (`pw-map.city`). amlakalahsa omits
--     that key on a large minority of ads — measured on these very rows, 25 of 32.
--   * the collapse is city-SCOPED on purpose (the identical "الضاحية <ordinal>" text also appears
--     under الهفوف/الفضول, which the owner did NOT ask to merge), so it is written
--     `city_ar == 'الجفر'`. With city_ar None that test is False — UNKNOWN silently read as NO —
--     and the un-collapsed numbered value is written straight over the merged one.
--   * `_unknown_must_not_overwrite_known` then correctly DROPS the None city_ar/city_id from the
--     payload, so the stored 'الجفر'/2764 survive.
--
-- The guard is right and the rule is in the wrong LAYER. Only the stored row ever holds both facts
-- at once, so the invariant belongs to the row, not to the crawl that happened to be able to
-- geocode it. Evidence, measured before this migration: source_capture->'pw-map'->>'city' is
-- present on 6 of the 7 rows that stayed merged and on 0 of the 25 that reverted.
--
-- One definition of the owner's rule, callable on its own so a barrier can EXECUTE it rather than
-- string-match it. NULL/unknown city returns the district unchanged: at INSERT time the scoping
-- city genuinely is unknown, and inventing a collapse there would be a guess.
create or replace function public.amlakalahsa_district_match(p_city_ar text, p_district_ar text)
returns text
language sql
immutable
set search_path to 'public'
as $fn$
  select case
           when p_city_ar = 'الجفر' and p_district_ar like 'الضاحية%' then 'الضاحية'
           else p_district_ar
         end
$fn$;

comment on function public.amlakalahsa_district_match(text, text) is
  'Owner rule 2026-09-13: in الجفر only, amlakalahsa''s numbered "الضاحية <ordinal>" sub-plots are '
  'one physical development and collapse to one MATCH district, "الضاحية". Only district_ar (the '
  'match column) is touched; neighborhood keeps the ad''s own text. Unknown city => unchanged.';

create or replace function public.tg_amlakalahsa_district_match()
returns trigger
language plpgsql
set search_path to 'public'
as $tg$
begin
  -- On PostgREST's ON CONFLICT DO UPDATE, columns absent from the payload are absent from the SET
  -- list, so NEW.city_ar here is the row's STORED city — known even on a crawl whose geocode was
  -- silent. That is the whole point of enforcing this here rather than in the scraper.
  new.district_ar := public.amlakalahsa_district_match(new.city_ar, new.district_ar);
  return new;
end $tg$;

drop trigger if exists zz_amlakalahsa_district_match on public.amlakalahsa_residential_listings;
create trigger zz_amlakalahsa_district_match
  before insert or update on public.amlakalahsa_residential_listings
  for each row execute function public.tg_amlakalahsa_district_match();

-- Same writer (map_listing feeds both tables through _wasalt_batch), so the commercial side can
-- take the identical hit the moment such an ad appears. Armed now rather than after it does.
drop trigger if exists zz_amlakalahsa_district_match on public.amlakalahsa_commercial_listings;
create trigger zz_amlakalahsa_district_match
  before insert or update on public.amlakalahsa_commercial_listings
  for each row execute function public.tg_amlakalahsa_district_match();

-- Repair the rows the reverting crawls left behind (25 residential at time of writing; the
-- predicate is the invariant itself, so it is exact rather than a hardcoded count).
update public.amlakalahsa_residential_listings
set district_ar = 'الضاحية'
where city_ar = 'الجفر' and district_ar like 'الضاحية%' and district_ar <> 'الضاحية';

update public.amlakalahsa_commercial_listings
set district_ar = 'الضاحية'
where city_ar = 'الجفر' and district_ar like 'الضاحية%' and district_ar <> 'الضاحية';

-- search_listings_ar is a denormalised index synced from listing_native_location_v1/v2, not a live
-- passthrough, so the base-table repair does not reach a user until the next sync. Same direct
-- correction the 2026-09-13 backfill used, and byte-identical to what that sync will next write now
-- that the base table is correct again.
update public.search_listings_ar
set district_ar = 'الضاحية'
where city_ar = 'الجفر' and source_table in ('amlakalahsa_residential_listings',
                                             'amlakalahsa_commercial_listings')
  and district_ar like 'الضاحية%' and district_ar <> 'الضاحية';

-- Prove the invariant holds in every direction before this migration is allowed to commit.
do $verify$
declare
  v_base int;
  v_index int;
  v_merged int;
begin
  select count(*) into v_base from public.amlakalahsa_residential_listings
   where city_ar = 'الجفر' and district_ar like 'الضاحية%' and district_ar <> 'الضاحية';
  select count(*) into v_index from public.search_listings_ar
   where city_ar = 'الجفر' and source_table like 'amlakalahsa%'
     and district_ar like 'الضاحية%' and district_ar <> 'الضاحية';
  select count(*) into v_merged from public.amlakalahsa_residential_listings
   where active and city_ar = 'الجفر' and district_ar = 'الضاحية';

  if v_base <> 0 then raise exception 'base table still has % unmerged row(s)', v_base; end if;
  if v_index <> 0 then raise exception 'search index still has % unmerged row(s)', v_index; end if;
  if v_merged < 32 then raise exception 'only % merged active row(s), expected >= 32', v_merged; end if;

  -- the collapse itself, executed
  if public.amlakalahsa_district_match('الجفر', 'الضاحية العاشر') <> 'الضاحية' then
    raise exception 'الجفر collapse did not fire';
  end if;
  -- and the scope the owner drew, which it must NOT cross
  if public.amlakalahsa_district_match('الهفوف', 'الضاحية العاشر') <> 'الضاحية العاشر' then
    raise exception 'collapse crossed into الهفوف';
  end if;
  if public.amlakalahsa_district_match(null, 'الضاحية العاشر') <> 'الضاحية العاشر' then
    raise exception 'collapse fired on an UNKNOWN city';
  end if;
  if public.amlakalahsa_district_match('الجفر', 'حي النخيل') <> 'حي النخيل' then
    raise exception 'collapse touched an unrelated الجفر district';
  end if;
end $verify$;
