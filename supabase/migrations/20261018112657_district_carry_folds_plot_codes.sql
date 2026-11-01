-- APPLIED 2026-10-18 (owner session), fourth step of the source-district carry (20261018081657 → 083435 → 111622).
--
-- THE «NUMBERED» BUCKET WAS MOSTLY REAL DISTRICTS. 611 live rows were refused by 083435's «never a digit» guard, but 400
-- of them name a district followed by a PLOT code — «بوسحبل (345/4)», «شرق المحدود 176 أ», «ضاحية هجر ،، الحي السابع
-- رقم 351 / ب», «الصفا ١ (93/14)» — or a district with a small ordinal («الغسانية ٢», «حي النسيم 2»).
-- district_plot_fold() cuts at the plot code (a bracket, «رقم N», a 3+ digit run) and drops a trailing block letter;
-- district_word_carryable() accepts the result only if it still names something (≥ 3 letters beyond «حي»/«مخطط») and any
-- digit left is a 1–2 digit ordinal on a real name. Pure codes stay NULL: «33ج», «حي 1029 مخطط رقم», «(حي رقم (5», «ج1»,
-- «مخطط 6», ksaaqar's plus-codes («7037 سلمان الفا»). The catalog spelling still wins (resolve on the folded word first).
--
-- NOT IN THIS STEP (owner decision pending): 083435's carry also serves 137 rows whose names are in the 10-08 المبرز hold of
-- resolve_district_ar() (الغسانية، جوهرة النزهة… on الهفوف/الاحساء office-default ads). Restoring that hold would raise
-- those rows back to NULL; the coordinator's rule is that no platform's NULL count goes up without a decision.
--
-- SAFE REFILL (coordinator 10-18): no TRUNCATE. Each table is refilled by refresh_district_recovery_table() — DELETE by
-- key + INSERT, MVCC-safe — all in this one transaction, holding the two locks the hourly pipeline uses
-- (location_pipeline:v1_refresh, which job 28 waits on before its sync statement takes a snapshot, and
-- search_listings_ar:single_writer, which makes any other sync refuse rather than interleave). Before commit it asserts
-- every platform kept ≥ 99% of its recovery rows (dealapp, abralosol, aqar named) and raises — rolling back — otherwise.

create or replace function public.district_plot_fold(p text)
returns text
language sql immutable
as $$
  select nullif(btrim(regexp_replace(regexp_replace(regexp_replace(
           coalesce(p, ''),
           '\s*(\(|\[|رقم\s*[\(:0-9٠-٩]|[0-9٠-٩]{3,}).*$', ''),
           '(\s+([أابجدهو]|هـ))+$', ''),
           '^[\s،,\-/]+|[\s،,\-/]+$', '', 'g')), '')
$$;

create or replace function public.district_word_carryable(w text)
returns boolean
language sql immutable
as $$
  select coalesce(
    w ~ '[ء-ي]'
    and regexp_replace(w, '^\s*(حي|مخطط)\s*', '') ~ '[ء-ي]{3,}'
    and (w !~ '[0-9٠-٩]' or w ~ '^[^0-9٠-٩]*[ء-ي]{3,}[^0-9٠-٩]*[0-9٠-٩]{1,2}$')
    and public.norm_district_tok(w) not in
        ('', public.norm_district_tok('غير محدد'), public.norm_district_tok('اخرى'), public.norm_district_tok('أخرى')),
    false)
$$;

create or replace function public.district_recovery_value(p_platform text, p_city_id integer, p_neighborhood text, p_url text default null)
returns text
language sql stable
as $$
  select coalesce(
    public.resolve_district_ar(p_city_id, p_neighborhood),
    case when p_platform = 'aqar' then public.resolve_district_ar(p_city_id, public.aqar_address_district(p_url)) end,
    case when p_neighborhood ~ '[0-9٠-٩]' then public.resolve_district_ar(p_city_id, public.district_plot_fold(p_neighborhood)) end,
    case
      when p_neighborhood !~ '[0-9٠-٩]' and public.district_word_carryable(btrim(p_neighborhood)) then btrim(p_neighborhood)
      when p_neighborhood ~ '[0-9٠-٩]' and public.district_word_carryable(public.district_plot_fold(p_neighborhood))
        then public.district_plot_fold(p_neighborhood)
    end)
$$;

-- The measurement: «dropped» = a usable source word (as written, or plot-folded) served as nothing; «numbered» = pure codes.
create or replace function public.source_district_dropped_rows(p_grace interval default interval '0')
returns table (platform text, source_table text, null_rows bigint, dropped bigint, blank bigint, numbered bigint,
               english bigint, silent_proven boolean)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    where c.table_schema = 'public' and c.column_name = 'neighborhood' and c.table_name ~ '_(residential|commercial)_listings$'
      and exists (select 1 from information_schema.columns i
                  where i.table_schema = 'public' and i.table_name = c.table_name and i.column_name = 'id')
  loop
    return query execute format($q$
      with r as (
        select nullif(btrim(r.neighborhood), '') as nb, s.last_updated,
               exists (select 1 from public.listings_arabic_locations l
                        where l.source_table = s.source_table and l.listing_id = s.listing_id
                          and l.review_reason like 'city_only_match%%') as city_only
        from public.search_listings_ar s
        join public.%I r on r.id = s.listing_id
        where s.source_table = %L and s.production_ready and s.district_ar is null
      ), k as (
        select r.*, case when nb ~ '[0-9٠-٩]' then public.district_plot_fold(nb) else nb end as w from r
      )
      select %L::text, %L::text, count(*)::bigint,
             count(*) filter (where public.district_word_carryable(w)
                                and not city_only and (last_updated is null or last_updated < now() - $1))::bigint,
             count(*) filter (where not city_only and (nb is null or public.norm_district_tok(nb) in
                                    ('', public.norm_district_tok('غير محدد'), public.norm_district_tok('اخرى'), public.norm_district_tok('أخرى'))))::bigint,
             count(*) filter (where nb ~ '[ء-ي]' and nb ~ '[0-9٠-٩]' and not public.district_word_carryable(w))::bigint,
             count(*) filter (where nb is not null and nb !~ '[ء-ي]')::bigint,
             exists (select 1 from public.ops_district_silent_source o where o.platform = %L and o.source_table is null)
      from k
      having count(*) > 0 $q$,
      t, t, regexp_replace(t, '_(residential|commercial)_listings$', ''), t,
      regexp_replace(t, '_(residential|commercial)_listings$', '')) using p_grace;
  end loop;
end $function$;

-- PROOF 1: the fold/carry truth table (owner's cases).
do $truth$
declare c record;
begin
  for c in select * from (values
    ('بوسحبل (345/4)',                         'بوسحبل',                     true),
    ('شرق المحدود 176 أ',                      'شرق المحدود',                true),
    ('مخطط الراجحي (425/4) د',                 'مخطط الراجحي',               true),
    ('ضاحية هجر ،، الحي السابع رقم 351 / ب',   'ضاحية هجر ،، الحي السابع',   true),
    ('حي الفويلق رقم(1)',                      'حي الفويلق',                 true),
    ('الصفا ١ (93/14)',                        'الصفا ١',                    true),
    ('الغسانية ٢',                             'الغسانية ٢',                 true),
    ('33ج',                                    '33ج',                        false),
    ('حي 1029 مخطط رقم',                       'حي',                         false),
    ('حي (حي رقم (5',                          'حي',                         false),
    ('حي ج1',                                  'حي ج1',                      false),
    ('حي 1النخيل',                             'حي 1النخيل',                 false),
    ('البصر3 مدينه',                           'البصر3 مدينه',               false),
    ('حي جو',                                  'حي جو',                      false),
    ('مخطط رقم 1011-1149 المصطفى',             'مخطط',                       false),
    ('7037 سلمان الفا',                        null,                         false)
  ) v(src, folded, carry)
  loop
    if public.district_plot_fold(c.src) is distinct from c.folded then
      raise exception 'PROOF fold: «%» → «%», want «%»', c.src, public.district_plot_fold(c.src), c.folded;
    end if;
    if public.district_word_carryable(public.district_plot_fold(c.src)) <> c.carry then
      raise exception 'PROOF carry: «%» carryable=%, want %', c.src, not c.carry, c.carry;
    end if;
  end loop;
end $truth$;

-- PROOF 2 + SAFE REFILL, one transaction, the pipeline's locks held.
do $refill$
declare
  t text; got boolean; before_total bigint; after_total bigint; p record;
begin
  perform pg_advisory_xact_lock(hashtext('location_pipeline:v1_refresh'));
  got := pg_try_advisory_xact_lock(hashtext('search_listings_ar:single_writer'));
  if not got then raise exception 'SAFE REFILL: the search-index writer lock is held by another session — not refilling'; end if;

  create temp table _before on commit drop as
    select regexp_replace(source_table, '_(residential|commercial)_listings$', '') as platform, count(*) n
      from public.district_recovery group by 1;
  select coalesce(sum(n), 0) into before_total from _before;

  for t in
    select c.table_name from information_schema.columns c
    where c.table_schema = 'public' and c.column_name = 'neighborhood' and c.table_name like '%\_listings'
      and exists (select 1 from information_schema.columns i
                  where i.table_schema = 'public' and i.table_name = c.table_name and i.column_name = 'id')
  loop
    perform public.refresh_district_recovery_table(t);
  end loop;

  select count(*) into after_total from public.district_recovery;
  if after_total < 0.99 * before_total then
    raise exception 'SAFE REFILL: district_recovery % → % (< 99%%) — rolled back', before_total, after_total;
  end if;
  for p in
    select b.platform, b.n before_n, coalesce(a.n, 0) after_n
      from _before b
      left join (select regexp_replace(source_table, '_(residential|commercial)_listings$', '') platform, count(*) n
                   from public.district_recovery group by 1) a on a.platform = b.platform
     where b.n >= 50
  loop
    if p.after_n < 0.99 * p.before_n then
      raise exception 'SAFE REFILL: % recovery rows % → % (< 99%%) — rolled back', p.platform, p.before_n, p.after_n;
    end if;
  end loop;
  if exists (select 1 from _before b where b.platform in ('dealapp', 'abralosol', 'aqar') and b.n < 1000) then
    raise exception 'SAFE REFILL: a named platform had < 1000 rows before — wrong target?';
  end if;

  -- v2 reads district_recovery live (the index follows at the next sync): no plot-coded district left behind.
  foreach t in array array['alshawaf_residential_listings','bossbih_residential_listings','shomou_residential_listings',
                           'arkaan_residential_listings','aqalemhajer_residential_listings'] loop
    execute format($q$
      select count(*) from public.listing_native_location_v2 v join public.%I r on r.id = v.listing_id
       where v.source_table = %L and v.district_ar is null
         and exists (select 1 from public.listing_native_location_v1 v1 where v1.source_table = v.source_table and v1.listing_id = v.listing_id)
         and r.neighborhood ~ '[0-9٠-٩]' and public.district_word_carryable(public.district_plot_fold(r.neighborhood))$q$, t, t)
      into after_total;
    if after_total <> 0 then raise exception 'PROOF: % plot-coded districts of % still served as nothing', after_total, t; end if;
  end loop;
  raise notice 'SAFE REFILL OK: district_recovery % → %, every platform ≥ 99%%', before_total, after_total;
end $refill$;
