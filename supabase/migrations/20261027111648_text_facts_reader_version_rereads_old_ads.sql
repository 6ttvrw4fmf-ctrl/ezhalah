-- A READER LESSON REACHES THE ADS IT WAS LEARNED FOR (owner 2026-10-27: «add guards … make sure … we learn so the new
-- coming ads we don't face same issue»).
--
-- WHAT WENT WRONG. The nightly word reader (scrapers/facts/words.py, phase incremental) re-reads an ad only when its
-- text changed, it was never read, or a flag switch asked for it (text_facts_todo). When the reader LEARNED new words
-- (10-25, 10-26, 10-27) nothing re-read the ~415k ads it had already read, so ops_ai_facts_reader_gaps kept listing
-- phrasings the reader already knew — ~20k residential ads missing an Advanced Filter fact for no reason but age.
--
-- THE GUARD, three parts:
--   1. every overlay row carries the reader_version that read it (words.py stamps a hash of word_checker.py +
--      scrapers/common/normalize.py, the two files that decide what the reader finds);
--   2. text_facts_todo(…, p_reader_version) treats a row read by any OTHER version as to-do, so the next run re-reads
--      it — no manual stale_at pass, and facts-words.yml now also runs on a push to main that touches the reader;
--   3. mon_detect_text_facts check 7 raises P2 text_facts_reader_version_lag when indexed ads are still read by an
--      older version 36 h after the current one was first seen (text_facts_reader_version records first sight).
--
-- text_facts_todo is DROPPED and re-created with the extra defaulted parameter in one transaction: adding a parameter
-- with CREATE OR REPLACE would leave two overloads (the PGRST203 outage shape the drift guard checks). Old callers
-- (no p_reader_version) keep today's behaviour exactly.

alter table public.listing_text_facts add column if not exists reader_version text;

create table if not exists public.text_facts_reader_version (
  version text primary key,
  first_seen_at timestamptz not null default now()
);
alter table public.text_facts_reader_version enable row level security;
revoke all on table public.text_facts_reader_version from public, anon, authenticated;
grant select, insert on table public.text_facts_reader_version to service_role;

create or replace function public.text_facts_reader_version_seen(p_version text)
returns void language sql security definer set search_path to 'public' as $$
  insert into public.text_facts_reader_version (version) select p_version
   where p_version ~ '^[0-9a-f]{8,64}$'
  on conflict (version) do nothing
$$;
revoke all on function public.text_facts_reader_version_seen(text) from public, anon, authenticated;
grant execute on function public.text_facts_reader_version_seen(text) to service_role;

drop function if exists public.text_facts_todo(text, bigint, integer, integer, integer);

create function public.text_facts_todo(p_table text, p_after bigint, p_limit integer, p_shard integer default 0,
                                       p_shards integer default 1, p_reader_version text default null)
returns table(id bigint, ad_number text, title text, body text, src_hash text, has_history boolean, changed boolean)
language plpgsql stable as $function$
declare h text; b text;
begin
  if p_table is null or p_table !~ '^[a-z0-9_]+_listings$' or to_regclass('public.' || p_table) is null
     or p_shards < 1 or p_shard < 0 or p_shard >= p_shards or p_limit not between 1 and 2000
     or (p_reader_version is not null and p_reader_version !~ '^[0-9a-f]{8,64}$') then
    return;
  end if;
  h := public.text_facts_hash_expr(p_table, 'x');
  b := case when p_table like 'wasalt\_%' then 'x.ar_data -> ''propertyInfo'' ->> ''description''' else 'x.description::text' end;
  return query execute format(
    'select x.id::bigint, x.ad_number::text, x.title::text, (%1$s)::text, %2$s,
            exists (select 1 from public.listing_facts l where l.platform = %3$L and l.listing_key = x.ad_number::text and l.model = ''word-checker-v1''),
            f.listing_id is not null
       from public.%4$I x
       left join public.listing_text_facts f on f.source_table = %5$L and f.listing_id = x.id
      where x.active and x.ad_number is not null and x.id > $1 and x.id %% $4 = $3
        and (f.listing_id is null or f.stale_at is not null or f.src_hash is distinct from %2$s
             or ($5 is not null and f.reader_version is distinct from $5)
             or (not (f.facts ? ''street_width_m'') and f.read_at < (select kf.changed_at from public.ops_feature_flags kf where kf.name = ''af_text_facts_street_width'')
                 and exists (select 1 from public.listing_facts l2 where l2.platform = %3$L and l2.listing_key = x.ad_number::text and l2.model = ''word-checker-v1'' and l2.fact = ''street_width_m'' and l2.value_num is not null))
             or (not (f.facts ? ''majlis'') and f.read_at < (select kf.changed_at from public.ops_feature_flags kf where kf.name = ''af_text_facts_majlis'' and kf.enabled)
                 and exists (select 1 from public.listing_facts l3 where l3.platform = %3$L and l3.listing_key = x.ad_number::text and l3.model = ''word-checker-v1'' and l3.fact = ''majlis'' and l3.value_bool is not null)))
      order by x.id limit $2',
    b, h, regexp_replace(p_table, '_(residential|commercial)_listings$', ''), p_table, p_table)
  using p_after, p_limit, p_shard, p_shards, p_reader_version;
end
$function$;
revoke all on function public.text_facts_todo(text, bigint, integer, integer, integer, text) from public, anon, authenticated;
grant execute on function public.text_facts_todo(text, bigint, integer, integer, integer, text) to service_role;

-- The alarm: indexed ads still read by an older reader, 36 h after the current reader was first seen.
create or replace function public.ops_text_facts_reader_lag()
returns table(current_version text, first_seen_at timestamptz, indexed_rows_behind bigint)
language sql stable security definer set search_path to 'public' as $$
  with v as (select version, first_seen_at from public.text_facts_reader_version order by first_seen_at desc limit 1)
  select v.version, v.first_seen_at,
         (select count(*) from public.listing_text_facts f
            join public.search_listings_ar s on s.source_table = f.source_table and s.listing_id = f.listing_id
           where f.stale_at is null and f.reader_version is distinct from v.version)
    from v
$$;
revoke all on function public.ops_text_facts_reader_lag() from public, anon, authenticated;
grant execute on function public.ops_text_facts_reader_lag() to service_role;

do $patch$
declare d text; k int;
  anchor constant text := '-- 5. the nightly reader';
  addition constant text := $add$-- 7. a reader lesson that never reached the old ads (2026-10-27): indexed ads still read by an older
  -- reader_version 36 h after the current one was first seen
  select l.indexed_rows_behind, l.first_seen_at into n, since_w from public.ops_text_facts_reader_lag() l;
  if coalesce(n, 0) > 0 and since_w < now() - interval '36 hours' then
    r := r + public.mon_raise('P2', 'text_facts_reader_version_lag', 'all', 'text_facts_reader_version_lag',
      jsonb_build_object('rows', n, 'current_since', since_w, 'for', '🔧', 'why',
        'The word reader learned new words (a new reader_version) more than 36 h ago, yet these indexed ads are still read by an older version, so their Advanced Filter facts miss what the reader now knows. facts-words.yml incremental re-reads them (text_facts_todo p_reader_version); check that it runs and is passed the version.'));
  else
    perform public.mon_resolve('text_facts_reader_version_lag', 'all');
  end if;
  $add$;
begin
  select pg_get_functiondef('public.mon_detect_text_facts()'::regprocedure) into d;
  if position('text_facts_reader_version_lag' in d) > 0 then
    raise notice 'mon_detect_text_facts already carries check 7';
  else
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'mon_detect_text_facts: anchor found % times, want 1', k; end if;
    execute replace(d, anchor, addition || anchor);
  end if;
end $patch$;

select public.mon_detect_text_facts();
