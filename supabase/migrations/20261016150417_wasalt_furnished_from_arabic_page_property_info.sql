-- wasalt furnished from the Arabic detail page's own structured field (🔬 AF engineer, 2026-10-16, backlog 558).
-- listing_extra_attrs_v0 and listing_rich_attrs read wasalt furnishing from ar_data -> 'attributes' ->>
-- 'furnishingType', a path that holds a value on ZERO of 86,038 active rows. enrich_ar.py stores the page's
-- propertyDetailsV3, where the field lives at ar_data -> 'propertyInfo' ->> 'furnishingType' (2,527 active
-- rows: غير مفروشة 2,260 · مفروشة 187 · نصف مفروشة 80). Only the English capture in additional_info reached
-- search, and rentals rarely carry it, so 372 rental ads that state their furnishing answered NULL to the
-- Advanced Filter's furnished question. Where both captures exist they agree on 2,121 of 2,121 rows.
-- Dry run (rolled back, 2026-10-16): wasalt residential furnished true 70 -> 192, false 2,051 -> 2,302;
-- wasalt commercial gains too; every other source's furnished column byte-identical (md5 equal).
-- Semi-furnished stays NULL for the yes/no furnished answer, as Semi-Furnished already does, and reads
-- «مفروش جزئيا» as the furnishing level. Structured field, so no prose is consulted.
do $m$
declare
  o text := $q$CASE ((w.ar_data -> 'attributes'::text) ->> 'furnishingType'::text)$q$;
  n text := $q$CASE COALESCE(((w.ar_data -> 'attributes'::text) ->> 'furnishingType'::text), ((w.ar_data -> 'propertyInfo'::text) ->> 'furnishingType'::text))$q$;
  semi_o text := $q$WHEN 'مفروشة جزئيا'::text THEN 'مفروش جزئيا'::text$q$;
  semi_n text := $q$WHEN 'مفروشة جزئيا'::text THEN 'مفروش جزئيا'::text
            WHEN 'نصف مفروشة'::text THEN 'مفروش جزئيا'::text$q$;
  v text;
  hits int;
begin
  v := pg_get_viewdef('public.listing_extra_attrs_v0'::regclass);
  hits := (length(v) - length(replace(v, o, ''))) / length(o);
  -- two branches read it: wasalt residential and wasalt commercial
  if hits <> 2 then raise exception 'listing_extra_attrs_v0 wasalt anchor matched % times (want 2)', hits; end if;
  execute 'create or replace view public.listing_extra_attrs_v0 as ' || replace(v, o, n);

  v := pg_get_viewdef('public.listing_rich_attrs'::regclass);
  hits := (length(v) - length(replace(v, o, ''))) / length(o);
  if hits <> 1 then raise exception 'listing_rich_attrs wasalt anchor matched % times (want 1)', hits; end if;
  hits := (length(v) - length(replace(v, semi_o, ''))) / length(semi_o);
  if hits <> 1 then raise exception 'listing_rich_attrs semi anchor matched % times (want 1)', hits; end if;
  execute 'create or replace view public.listing_rich_attrs as ' || replace(replace(v, o, n), semi_o, semi_n);
end $m$;

-- Barrier: a wasalt ad whose own page states furnished or unfurnished must answer the furnished question.
create or replace function public.mon_detect_wasalt_structured_furnished_dropped()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n       int := 0;
  live    text[] := '{}';
  v_seen  bigint;
  v_drop  bigint;
begin
  -- ~20h gate: reading ar_data on every active wasalt row costs ~4 s (measured 2026-10-16), too much for
  -- the twice-hourly sweep. mon_detect_stalled_daily_detector watches that this gate cannot wedge shut.
  if not public.mon_claim_daily_slot('mon_detect_wasalt_structured_furnished_dropped') then
    return 0;
  end if;

  select count(*) into v_seen from public.wasalt_residential_listings w
   where w.active and w.ar_data -> 'propertyInfo' ->> 'furnishingType' in ('مفروشة', 'غير مفروشة');
  select count(*) into v_drop
    from public.listing_extra_attrs_v0 v
    join public.wasalt_residential_listings w on w.id = v.listing_id
   where v.source_table = 'wasalt_residential_listings'
     and v.furnished is null
     and w.ar_data -> 'propertyInfo' ->> 'furnishingType' in ('مفروشة', 'غير مفروشة');

  -- BLINDNESS GUARD: with no structured furnishing captured a 0 proves nothing.
  if v_seen = 0 then
    live := live || 'wasalt_structured_furnished_dropped:BLIND'::text;
    n := n + public.mon_raise('P2', 'wasalt_structured_furnished_dropped', 'wasalt',
      'wasalt_structured_furnished_dropped:BLIND',
      jsonb_build_object('blind', true,
        'why', 'No active wasalt row carries ar_data propertyInfo furnishingType, so this detector cannot see a dropped furnished answer.',
        'action', 'Check scrapers/wasalt/enrich_ar.py still stores propertyDetailsV3 into ar_data.'));
  elsif v_drop > 0 then
    live := live || 'wasalt_structured_furnished_dropped:null_served'::text;
    n := n + public.mon_raise('P1', 'wasalt_structured_furnished_dropped', 'wasalt',
      'wasalt_structured_furnished_dropped:null_served',
      jsonb_build_object('rows', v_drop, 'structured_rows', v_seen,
        'why', 'The ad page states مفروشة or غير مفروشة in propertyDetailsV3.propertyInfo.furnishingType, but listing_extra_attrs_v0 answers NULL, so a customer asking for furnished never finds it.',
        'action', 'listing_extra_attrs_v0 must read ar_data propertyInfo furnishingType for wasalt (the migration that added this detector); re-apply it.'));
  end if;

  perform public.mon_resolve_stale_keys('wasalt_structured_furnished_dropped', live);
  return n;
end
$function$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_wasalt_structured_furnished_dropped' in src) > 0 then
    raise notice 'mon_detect_wasalt_structured_furnished_dropped already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_sanadak_unticked_box_as_no'',',
    E'    ''mon_detect_sanadak_unticked_box_as_no'',\n    ''mon_detect_wasalt_structured_furnished_dropped'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

do $$
begin
  if public.mon_detect_wasalt_structured_furnished_dropped() <> 0 then
    raise exception 'repair did not land: the detector still finds a stated wasalt furnishing answered NULL';
  end if;
end $$;