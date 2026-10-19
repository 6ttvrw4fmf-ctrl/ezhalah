-- 🔧 QA 2026-10-09 (backlog 274): a recovered district may vouch for a canonical name only when it
-- is the ad's OWN word for its district.
--
-- refresh_district_recovery() fills a NULL district from the ad's raw neighbourhood through
-- resolve_district_ar(), which reads loc_canonical_district. refresh_loc_canonical_district() then
-- counted every served district — recovered ones included — as live attestation. A recovery that
-- RENAMED the ad's text (an alias, a borrowed spelling) therefore attested its own name the next
-- hour and could never fall out: on 2026-10-08 that kept 559 الهفوف ads on المبرز names after the
-- borrowing was undone. Measured 2026-10-09: 85,265 recovered rows, 43,550 of them non-verbatim;
-- 5 canonical names / 17 listings were attested by nothing else (سلامه 6, مشهد 5, دانه الريان 4,
-- سلام 1, خالديه 1). Verbatim recoveries (raw token = recovered token) stay attestation: that is the
-- source naming its own district.
alter table public.district_recovery add column if not exists verbatim boolean;

create or replace function public.refresh_district_recovery()
 returns bigint
 language plpgsql
as $function$
declare
  r record;
  n bigint := 0;
  m bigint;
begin
  truncate public.district_recovery;

  for r in
    select c.table_name as t
    from information_schema.columns c
    where c.table_schema = 'public' and c.column_name = 'neighborhood' and c.table_name like '%\_listings'
      and exists (select 1 from information_schema.columns i
                  where i.table_schema = 'public' and i.table_name = c.table_name and i.column_name = 'id')
  loop
    execute format($f$
      insert into public.district_recovery (source_table, listing_id, district_ar, resolved_at, verbatim)
      select %L, v1.listing_id, d.val, now(),
             public.norm_district_tok(d.val) = public.norm_district_tok(x.neighborhood)
      from public.listing_native_location_v1 v1
      join (select distinct on (id) id, neighborhood from public.%I order by id, neighborhood) x
        on x.id = v1.listing_id
      cross join lateral (select public.resolve_district_ar(v1.city_id, x.neighborhood) as val) d
      where v1.source_table = %L
        and v1.city_id is not null
        and (v1.district_ar is null or btrim(v1.district_ar) = '')
        and d.val is not null
        and not exists (
              select 1 from public.listing_source_district_ar sd
              where sd.source_table = v1.source_table and sd.listing_id = v1.listing_id)
      on conflict (source_table, listing_id)
        do update set district_ar = excluded.district_ar, resolved_at = excluded.resolved_at,
                      verbatim = excluded.verbatim
    $f$, r.t, r.t, r.t);
    get diagnostics m = row_count;
    n := n + m;
  end loop;

  insert into public.district_recovery (source_table, listing_id, district_ar, resolved_at, verbatim)
  select v1.source_table, v1.listing_id, d.val, now(),
         public.norm_district_tok(d.val) = public.norm_district_tok(sd.source_district_ar)
  from public.listing_native_location_v1 v1
  join public.listing_source_district_ar sd
    on sd.source_table = v1.source_table and sd.listing_id = v1.listing_id
  cross join lateral (select public.resolve_district_ar(v1.city_id, sd.source_district_ar) as val) d
  where v1.city_id is not null
    and (v1.district_ar is null or btrim(v1.district_ar) = '')
    and d.val is not null
  on conflict (source_table, listing_id)
    do update set district_ar = excluded.district_ar, resolved_at = excluded.resolved_at,
                  verbatim = excluded.verbatim;
  get diagnostics m = row_count;
  n := n + m;

  return n;
end;
$function$;

create or replace function public.refresh_loc_canonical_district()
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n bigint; v_bogus_live int; v_numbered int;
begin
  truncate public.loc_canonical_district;
  insert into public.loc_canonical_district (city_id, district_norm, canonical_district_ar, source, refreshed_at)
  with cat as (
    select city_id, norm_district_tok(district_ar) k, district_ar sp, 0 as pref, 1::bigint cnt
    from public.loc_catalog_district
    where district_ar is not null and btrim(district_ar) <> ''
  ),
  liv as (
    select s.city_id, norm_district_tok(s.district_ar) k, s.district_ar sp, 1 as pref, count(*)::bigint cnt
    from public.search_listings_ar s
    where s.production_ready and s.district_ar is not null and btrim(s.district_ar) <> ''
      and s.district_ar not in ('غير محدد','اخرى','أخرى')
      and not public.district_ar_looks_bogus(s.district_ar)
      -- A district WE recovered by renaming the ad's text is not the source's word, so it never
      -- vouches for itself (backlog 274). A verbatim recovery is the source naming its district.
      and not exists (select 1 from public.district_recovery dr
                       where dr.source_table = s.source_table and dr.listing_id = s.listing_id
                         and dr.verbatim is false)
    group by 1,2,3
  ),
  allrows as (select * from cat union all select * from liv),
  ranked as (
    select city_id, k, sp, pref,
      row_number() over (partition by city_id, k
        order by pref asc, (sp ~ '[0-9٠-٩]') asc, cnt desc, length(sp) asc, sp asc) rn
    from allrows
    where k is not null and k <> ''
  )
  select city_id, k,
         -- Fold a number wherever it sits: bracketed group anywhere, then a bare run at either end,
         -- then collapse the whitespace the removal leaves. Falls back to the raw spelling only if
         -- folding would empty the label; the guards below still refuse a digit that survives.
         coalesce(
           nullif(btrim(regexp_replace(
             regexp_replace(
               regexp_replace(sp, '[\(\[\{][^\)\]\}]*[0-9٠-٩][^\)\]\}]*[\)\]\}]', ' ', 'g'),
               '(^\s*[0-9٠-٩][0-9٠-٩/\-]*\s*)|(\s*[0-9٠-٩][0-9٠-٩/\-]*\s*$)', ' ', 'g'),
             '\s+', ' ', 'g')), ''),
           sp),
         case when pref = 0 then 'catalog' else 'live' end, now()
  from ranked where rn = 1;
  get diagnostics n = row_count;

  select count(*) into v_bogus_live
    from public.loc_canonical_district
   where source = 'live' and public.district_ar_looks_bogus(canonical_district_ar);
  if v_bogus_live > 0 then
    raise exception 'refresh_loc_canonical_district: % bogus-shaped ''live'' row(s) survived the '
      'district_ar_looks_bogus() exclusion — the WHERE clause was weakened. Refusing to publish a '
      'catalog that re-leaks internal plan/parcel codes (see migration 20260911201716).', v_bogus_live;
  end if;

  -- The owner's rule, asserted on EVERY row (not just 'live' — the codes were catalog-sourced).
  select count(*) into v_numbered
    from public.loc_canonical_district
   where canonical_district_ar ~ '[0-9٠-٩]';
  if v_numbered > 0 then
    raise exception 'refresh_loc_canonical_district: % row(s) would put a number in our own district '
      'list. Our list never shows a number (owner rule 2026-09-14); a source-published number belongs '
      'on the property card only. Refusing to publish.', v_numbered;
  end if;

  return n;
end;
$function$;