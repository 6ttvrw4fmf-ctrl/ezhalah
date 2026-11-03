-- THE DISTRICT THE AD'S OWN TITLE NAMES (backlog 1165, owner 2026-11-01: «do they have it written in their title?»).
-- A served ad with no district whose title says «حي X» gets X — only when ALL hold:
--   * X (one or two words after «حي») is on the official district list of the city the ad is served in;
--   * the title names exactly ONE such district;
--   * X is not the town's own name (the «حي الخوير, مدينة الخوير» trap, ~1 in 6: a village, not a neighbourhood) —
--     neither the served city nor the city the title names after «مدينة»;
--   * nothing else already gave the ad a district (source field, recovery, pin arm all run first).
-- Decisions live in listing_title_district with the title words that proved them; refresh_district_recovery_table()
-- serves them through a TITLE ARM placed after the pin arm (ON CONFLICT DO NOTHING), so the hourly rebuild keeps them
-- and its loss guard counts them like any other recovered district. Source tables are untouched.
create table if not exists public.listing_title_district (
  source_table text not null,
  listing_id bigint not null,
  city_id integer not null,
  district_ar text not null,
  district_norm text not null,
  title_words text not null,
  decided_at timestamptz not null default now(),
  primary key (source_table, listing_id)
);
alter table public.listing_title_district enable row level security;
revoke all on public.listing_title_district from anon, authenticated;
comment on table public.listing_title_district is 'District named by the ad''s own title («حي X», on the served city''s official list, exactly one, not the town''s own name). Served through the title arm of refresh_district_recovery_table() (backlog 1165).';

create or replace function public.refresh_title_district()
returns jsonb
language plpgsql
set search_path = public
as $$
declare v_blank bigint; v_says bigint; v_found bigint; v_st text; v_ids bigint[];
begin
  create temp table _blank on commit drop as
  select s.source_table, s.listing_id, s.city_id, s.city_ar
    from public.search_listings_ar s
   where s.production_ready and s.city_id is not null and (s.district_ar is null or btrim(s.district_ar) = '');
  get diagnostics v_blank = row_count;
  -- keep decisions for ads that are blank only BECAUSE of an earlier decision being dropped? no: an ad served with a
  -- title district is no longer blank, so judge the previously decided ones too
  insert into _blank
  select s.source_table, s.listing_id, s.city_id, s.city_ar
    from public.listing_title_district t
    join public.search_listings_ar s on s.source_table = t.source_table and s.listing_id = t.listing_id
   where s.production_ready and s.city_id is not null
     and not exists (select 1 from _blank b where b.source_table = t.source_table and b.listing_id = t.listing_id);

  create temp table _ttl (source_table text, listing_id bigint, txt text) on commit drop;
  for v_st in select distinct source_table from _blank loop
    select array_agg(listing_id) into v_ids from _blank where source_table = v_st;
    execute format('insert into _ttl select %L, t.id, coalesce(t.title, '''') from public.%I t where t.id = any($1)', v_st, v_st)
      using v_ids;
  end loop;
  update _ttl set txt = ' ' || btrim(regexp_replace(regexp_replace(normalize_ar(replace(txt, 'حى ', 'حي ')), '[^ء-ي]+', ' ', 'g'), '\s+', ' ', 'g')) || ' ';
  select count(*) into v_says from _ttl where txt like '% حي %';

  create temp table _hit on commit drop as
  select b.source_table, b.listing_id, b.city_id, d.district_norm, min(d.district_ar) as district_ar, min(h.w) as words
    from _blank b
    join _ttl x on x.source_table = b.source_table and x.listing_id = b.listing_id
    cross join lateral (select distinct m[1] as w from regexp_matches(x.txt, ' حي ((?:[ء-ي]+ )?[ء-ي]+)(?= )', 'g') m) h
    join public.loc_catalog_district d
      on d.city_id = b.city_id and d.retired_at is null
     and d.district_norm in (norm_district_tok('حي ' || h.w), norm_district_tok('حي ' || split_part(h.w, ' ', 1)))
   where d.district_norm <> norm_district_tok(b.city_ar)
     and position(' مدينه ' || regexp_replace(d.district_norm, '^ال', '') in replace(x.txt, ' مدينه ال', ' مدينه ')) = 0
   group by 1, 2, 3, 4;

  delete from public.listing_title_district t
   where not exists (select 1 from _hit h where h.source_table = t.source_table and h.listing_id = t.listing_id);
  insert into public.listing_title_district (source_table, listing_id, city_id, district_ar, district_norm, title_words, decided_at)
  select h.source_table, h.listing_id, h.city_id, h.district_ar, h.district_norm, 'حي ' || h.words, now()
    from _hit h
   where (select count(*) from _hit h2 where h2.source_table = h.source_table and h2.listing_id = h.listing_id) = 1
  on conflict (source_table, listing_id) do update
    set city_id = excluded.city_id, district_ar = excluded.district_ar, district_norm = excluded.district_norm,
        title_words = excluded.title_words, decided_at = excluded.decided_at;
  delete from public.listing_title_district t
   where (select count(*) from _hit h where h.source_table = t.source_table and h.listing_id = t.listing_id) <> 1;
  select count(*) into v_found from public.listing_title_district;
  return jsonb_build_object('blank_or_title_filled', v_blank, 'title_says_hay', v_says, 'decided', v_found);
end $$;
revoke all on function public.refresh_title_district() from public, anon, authenticated;

-- the TITLE ARM, after the pin arm, so the hourly per-table rebuild serves (and keeps) these districts
do $mig$
declare
  d text := pg_get_functiondef('public.refresh_district_recovery_table(text)'::regprocedure);
  needle constant text := '  -- LOSS GUARD: districts recovered last time';
  arm constant text := $a$  -- TITLE ARM (backlog 1165, owner 2026-11-01), LAST and ON CONFLICT DO NOTHING: the district the ad's own
  -- title names (listing_title_district), only for an ad nothing above resolved and only in the city it is served in.
  insert into _drt (source_table, listing_id, district_ar, resolved_at, verbatim, basis)
  select t.source_table, t.listing_id, t.district_ar, now(), false, 'title'
    from public.listing_title_district t
    join public.listing_native_location_v1 v1 on v1.source_table = t.source_table and v1.listing_id = t.listing_id
    left join public.search_listings_ar s on s.source_table = t.source_table and s.listing_id = t.listing_id
   where t.source_table = p_table
     and t.city_id = coalesce(s.city_id, v1.city_id)
     and (v1.district_ar is null or btrim(v1.district_ar) = '')
  on conflict (source_table, listing_id) do nothing;

$a$;
begin
  if position('TITLE ARM' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, needle, ''))) / length(needle) <> 1 then
    raise exception 'refresh_district_recovery_table: loss-guard needle not found exactly once';
  end if;
  execute replace(d, needle, arm || needle);
  if position('TITLE ARM' in pg_get_functiondef('public.refresh_district_recovery_table(text)'::regprocedure)) = 0 then
    raise exception 'refresh_district_recovery_table: title arm did not land';
  end if;
end
$mig$;
