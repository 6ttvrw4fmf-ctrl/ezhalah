-- listing_rich_attrs carries the land utilities the scrapers now write (⚡ 2026-10-10, backlogs 325/326).
-- Two branches threw away a value the raw table holds:
--   wasalt residential: «NULL::boolean AS electricity / water_supply» — so the 6,200
--     lands repaired by 20261010051214 (and every crawl since #6636) could never reach the index;
--   aqarcity: derived electricity/water/sanitation from the services TEXT as «true or NULL», so the
--     61 «لايوجد خدمات» lands repaired by 20261010052741 stayed NULL in the index.
-- Needle edit of the LIVE definition (never a pasted older copy): each branch now reads its own
-- column first, keeping the old derivation as the fallback. Each replacement must match, or this
-- raises and nothing changes. Same columns, same order: CREATE OR REPLACE, no DROP.
do $m$
declare
  v text := pg_get_viewdef('public.listing_rich_attrs'::regclass);
  w_old text := $q$LIMIT 1) AS separate_water_meter,
    NULL::boolean AS electricity,
    NULL::boolean AS water_supply,$q$;
  w_new text := $q$LIMIT 1) AS separate_water_meter,
    w.electricity AS electricity,
    w.water_supply AS water_supply,$q$;
  a text[] := array['electricity','water_supply','sanitation'];
  pat text[] := array['%كهرباء%','%مياه%','%صرف صحي%'];
  i int;
  o text; n text;
  hits int;
begin
  hits := (length(v) - length(replace(v, w_old, ''))) / length(w_old);
  if hits < 1 then raise exception 'wasalt anchor not found'; end if;   -- residential (commercial is shaped differently)
  v := replace(v, w_old, w_new);
  for i in 1..3 loop
    o := format($q$CASE
            WHEN ((c.additional_info ->> 'services'::text) ~~ '%s'::text) THEN true
            ELSE NULL::boolean
        END AS %s$q$, pat[i], a[i]);
    n := format($q$COALESCE(c.%s, CASE
            WHEN ((c.additional_info ->> 'services'::text) ~~ '%s'::text) THEN true
            ELSE NULL::boolean
        END) AS %s$q$, a[i], pat[i], a[i]);
    hits := (length(v) - length(replace(v, o, ''))) / length(o);
    if hits < 1 then raise exception 'aqarcity % anchor not found', a[i]; end if;
    v := replace(v, o, n);
  end loop;
  execute 'create or replace view public.listing_rich_attrs as ' || v;
end $m$;

-- Check: the view now returns the raw table's explicit «no services» for an aqarcity land, and a
-- wasalt land's own meter answer.
do $c$
declare bad_a int; bad_w int;
begin
  select count(*) into bad_a from public.aqarcity_residential_listings r
    join public.listing_rich_attrs v on v.source_table = 'aqarcity_residential_listings' and v.listing_id = r.id
   where r.active and r.electricity is false and v.electricity is distinct from false;
  select count(*) into bad_w from (select r.id, r.electricity from public.wasalt_residential_listings r
     where r.active and r.electricity is not null limit 500) r
    join public.listing_rich_attrs v on v.source_table = 'wasalt_residential_listings' and v.listing_id = r.id
   where v.electricity is distinct from r.electricity;
  if bad_a > 0 or bad_w > 0 then raise exception 'view check: aqarcity % / wasalt % rows disagree', bad_a, bad_w; end if;
end $c$;
