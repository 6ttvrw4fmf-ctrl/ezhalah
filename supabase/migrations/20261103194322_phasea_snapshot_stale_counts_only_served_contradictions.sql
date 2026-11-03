-- phasea_snapshot_stale counts only contradictions that can put a SERVED listing in the wrong city.
--
-- Alerts 5791 (aqarcity residential, 17 rows) and 6807 (aqarcity commercial, 1 row), open since
-- 2026-09-25/28. Adjudicated row by row on 2026-11-03 against the source payload on each row:
--   * 12 of the 17 are INACTIVE - not in search at all, so "served in the wrong city" cannot happen
--     to them. Every one is a script difference, not a different city: snapshot «جدة», source
--     city_ar "Jeddah" (likewise الدمام/Dammam, الخبر/Khobar, بقيق/Abqaiq, المدينة المنورة/Madinah).
--   * the other 5 + the commercial row are «PARENT - PLACE» snapshot values whose second part IS
--     the source's current city_ar: «الدوادمي - الفيضه» vs «الفيضه» (English city "Dawadmi", served
--     الدوادمي), «جازان - الغريف» vs «الغريف» (English "Jazan", served جازان), «الروضة - الجفر» vs
--     «الجفر» (served الجفر), «أبو عريش - أبو عريش» vs «ابو عريش». The snapshot names the same place
--     plus its parent; nothing contradicts.
-- So all 18 were false: zero rows can be served in a city the source disputes.
--
-- The distinction, both directions (DO block at the bottom):
--   * the row must be ACTIVE (only an active row reaches search_listings_ar);
--   * a snapshot value one of whose « - » parts equals the source city_ar (normalize_ar) agrees;
--   * a genuine contradiction - «ابها» vs «جدة» (gathern 726509, the case this detector was built
--     on), «المدينة المنورة» vs «تبوك» (sadin 597777) - still counts.
-- No threshold, no list: the oracle is still the live source payload, compared per row.

-- True when one of the snapshot's « - » parts IS the source's city_ar (spelling-normalised): the
-- snapshot names the same place, plus its parent («الدوادمي - الفيضه» names «الفيضه»).
create or replace function public.phasea_snapshot_names_place(p_snapshot text, p_source text)
returns boolean
language sql
stable
set search_path to 'public'
as $f$
  select coalesce(bool_or(normalize_ar(btrim(seg)) = normalize_ar(btrim(p_source))), false)
    from unnest(string_to_array(p_snapshot, ' - ')) as seg
   where nullif(btrim(p_source), '') is not null and nullif(btrim(seg), '') is not null
$f$;

create or replace view public.mon_phasea_snapshot_stale_vs_source as
select z.source_table,
       split_part(z.source_table, '_', 1) as platform,
       z.stale_rows
  from (select t.source_table,
               (xpath('/row/a/text()', query_to_xml(format(
                  'select count(*) a from public.phasea_src_arabic p join public.%I c on c.id = p.listing_id '
                  ' where p.source_table = %L '
                  '   and c.active is true '
                  '   and c.additional_info ? ''city_ar'' '
                  '   and nullif(btrim(c.additional_info->>''city_ar''), '''') is not null '
                  '   and normalize_ar(btrim(p.city_ar_src)) is distinct from '
                  '       normalize_ar(btrim(c.additional_info->>''city_ar'')) '
                  '   and not public.phasea_snapshot_names_place(p.city_ar_src, c.additional_info->>''city_ar'')',
                  t.source_table, t.source_table), false, true, '')))[1]::text::bigint as stale_rows
          from (select distinct source_table from public.phasea_src_arabic) t
         where exists (select 1 from information_schema.columns ic
                        where ic.table_schema = 'public' and ic.table_name = t.source_table
                          and ic.column_name = 'additional_info')
           and exists (select 1 from information_schema.columns ic
                        where ic.table_schema = 'public' and ic.table_name = t.source_table
                          and ic.column_name = 'active')) z
 where z.stale_rows > 0;

-- The alert's copy-paste query must select the rows the view counts, not the wider old set.
do $patch$
declare
  def text := pg_get_functiondef('public.mon_detect_phasea_snapshot_stale_vs_source()'::regprocedure);
  a1 text := $a$'p.listing_id where p.source_table = ''' || r.source_table || ''' and '$a$;
  b1 text := $a$'p.listing_id where c.active is true and p.source_table = ''' || r.source_table || ''' and '
                 'not phasea_snapshot_names_place(p.city_ar_src, c.additional_info->>''city_ar'') and '$a$;
begin
  if position(a1 in def) = 0 then
    raise exception 'mon_detect_phasea_snapshot_stale_vs_source: query anchor is gone - refusing to guess';
  end if;
  execute replace(def, a1, b1);
end
$patch$;

-- Both directions, on the real shapes adjudicated above (fails the migration if wrong).
do $chk$
declare got boolean[];
begin
  select array_agg(public.phasea_snapshot_names_place(snap, src) order by k) into got
    from (values
      (1, 'الدوادمي - الفيضه', 'الفيضه'),          -- aqarcity 594680: same place + parent   -> agrees
      (2, 'أبو عريش - أبو عريش', 'ابو عريش'),      -- aqarcity 594614: spelling only         -> agrees
      (3, 'ابها', 'جدة'),                          -- gathern 726509: a different city       -> contradicts
      (4, 'المدينة المنورة', 'تبوك'),              -- sadin 597777: a different city         -> contradicts
      (5, 'جدة - الروضة', 'الدمام'),               -- parts that name neither                -> contradicts
      (6, 'جدة', null)                             -- source silent: never "agrees"          -> false
    ) v(k, snap, src);
  if got is distinct from array[true, true, false, false, false, false] then
    raise exception 'phasea_snapshot_names_place check failed: %', got;
  end if;
  if position('c.active is true' in pg_get_viewdef('public.mon_phasea_snapshot_stale_vs_source'::regclass)) = 0 then
    raise exception 'mon_phasea_snapshot_stale_vs_source does not restrict to active rows';
  end if;
end
$chk$;