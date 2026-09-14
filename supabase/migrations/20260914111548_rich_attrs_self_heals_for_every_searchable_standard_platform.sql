-- listing_rich_attrs: give a branch to EVERY searchable standard-template platform.
--
-- THE CLASS. The fleet-wide branches were generated once, by a one-shot `do $$` block
-- (20260811105728). A platform activated AFTER that block silently gets no branch, so every
-- attribute its scraper captured is stranded behind Advanced Filter. Nothing fails loudly: search
-- still works, the platform looks healthy from every user-facing angle, and only the 6-hourly live
-- barrier notices. ops_incident #230 filed this for amlakalahsa on 2026-09-13; by 2026-09-14 it was
-- FOUR platforms (amlakalahsa, suwar, rakez, aqaralsaudia) because three more were activated in
-- between. The one-shot generator is the defect, not any one platform's onboarding.
--
-- THE REPAIR. Clone the october_residential_listings arm — the established activation pattern
-- (20260906210336) — for every searchable table that carries the full standard template and has no
-- branch yet. Cloning, not re-generating, so the spliced arm is by construction identical in shape,
-- column order and casts to one the view already serves.
--
-- NOTHING IS INVENTED. Every cloned column is a DIRECT read of a column that already exists on the
-- table (verified: zero missing columns, zero type divergence across all four vs october). Where the
-- scraper captured nothing the value stays NULL — UNKNOWN stays UNKNOWN, never false. Today that
-- surfaces exactly 8 real values (suwar reception_rooms_majlis) and leaves the rest NULL; the point
-- is that the NEXT captured value is not stranded.
--
-- GUARDS. The real risk of splicing a 40-arm union is SHAPE, not row count, so this asserts the
-- view's exact column signature (name, type and position) is byte-identical before and after. A
-- fleet-wide count(*)/duplicate sweep was tried first and timed out at 60s on a 213k-row union
-- without testing anything the signature check does not; per-listing uniqueness is already a PK.
do $$
declare
  src text; arm text; arms text := ''; st int; en int; t text;
  missing text[]; sig_before text; sig_after text; n int := 0;
begin
  src := rtrim(rtrim(pg_get_viewdef('public.listing_rich_attrs'::regclass, true)), ';');

  select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod), ',' order by a.attnum)
    into sig_before
  from pg_attribute a
  where a.attrelid = 'public.listing_rich_attrs'::regclass and a.attnum > 0 and not a.attisdropped;

  -- the clone source must exist, verbatim, or we refuse to guess
  st := position('SELECT ''october_residential_listings''::text AS source_table' in src);
  if st = 0 then
    raise exception 'listing_rich_attrs has no october arm to clone - shape changed, refusing to guess';
  end if;
  en := st + position('FROM october_residential_listings x' in substring(src from st)) - 1;
  en := en + position('WHERE x.active' in substring(src from en)) - 1 + length('WHERE x.active');
  arm := substring(src from st for en - st);

  -- every searchable table carrying the full standard template but no branch yet
  select coalesce(array_agg(s.st_name order by s.st_name), '{}') into missing
  from (select distinct sl.source_table as st_name from public.search_listings_ar sl) s
  join (
    select table_name,
      count(*) filter (where column_name in
        ('electricity','water_supply','sanitation','balcony_terrace','laundry_room',
         'separate_electricity_meter','separate_water_meter','rent_now_pay_later',
         'rent_now_pay_later_monthly','reception_rooms_majlis','zip_code',
         'additional_info','active','id')) hits
    from information_schema.columns where table_schema='public' group by 1
  ) std on std.table_name = s.st_name and std.hits = 14
  where position(s.st_name in src) = 0;

  if array_length(missing, 1) is null then
    raise notice 'listing_rich_attrs: every searchable standard platform already has a branch';
    return;
  end if;

  foreach t in array missing loop
    arms := arms || E'\nUNION ALL\n ' || replace(arm, 'october_residential_listings', t);
    n := n + 1;
  end loop;

  execute 'create or replace view public.listing_rich_attrs as ' || src || arms;

  select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod), ',' order by a.attnum)
    into sig_after
  from pg_attribute a
  where a.attrelid = 'public.listing_rich_attrs'::regclass and a.attnum > 0 and not a.attisdropped;

  if sig_before is distinct from sig_after then
    raise exception 'listing_rich_attrs column signature changed by the splice: % -> %',
      sig_before, sig_after;
  end if;

  raise notice 'listing_rich_attrs: spliced % branches (%)', n, array_to_string(missing, ', ');
end $$;
