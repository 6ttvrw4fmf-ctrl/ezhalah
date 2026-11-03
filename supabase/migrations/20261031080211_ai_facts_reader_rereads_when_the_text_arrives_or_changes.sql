-- The AI facts reader re-reads an ad whose text ARRIVED or CHANGED after it was read (owner 2026-10-31:
-- «make sure it's all good and that all new listings are good»).
--
-- Measured 2026-10-31: 13 small sites had no description column filled until the crawls of 03:09 / 07:27 UTC
-- that day, but the AI backlog runs of 10-26..10-30 had already "read" their ads from the TITLE alone and left
-- a `_none` marker. facts_ai_todo_ids() treated any listing_facts row as "read", so the text that arrived later
-- was never read — ksaaqar 719, therc 455, sanadak 361, ashab 279, aqargate 92, manzo 79, hajer 67, satel 60,
-- akariyoun 7 ads (2,119) — and the nightly «new» run has the same blind spot for every platform whose detail
-- text lands a crawl after the listing: read on day 1 from the title, text on day 2, never re-read.
--
-- Mechanism: every listing_facts row the reader writes (facts and the `_none` marker) carries
-- text_hash = md5(title || E'\n' || text) of what the model actually saw (scrapers/facts/extract.py text_hash(),
-- the same bytes as facts_text_hash() here). An ad counts as read only by a row whose hash matches its CURRENT
-- text; a NULL hash (rows written before this migration) still counts as read, except the 13 sites' rows
-- below, which are marked «read-before-text» so the backlog picks them up again.

alter table public.listing_facts add column if not exists text_hash text;
comment on column public.listing_facts.text_hash is
  'md5(title||E''\n''||description) the model saw when this row was written (facts_text_hash()). NULL = written before 2026-10-31; a row whose hash differs from the ad''s current text no longer counts as "read" (facts_ai_is_read()).';

create or replace function public.facts_text_hash(p_title text, p_text text)
returns text language sql immutable parallel safe set search_path to 'public' as $$
  select md5(coalesce(p_title, '') || E'\n' || coalesce(p_text, ''))
$$;

create or replace function public.facts_ai_is_read(p_platform text, p_key text, p_hash text)
returns boolean language sql stable parallel safe set search_path to 'public' as $$
  select exists (select 1 from public.listing_facts l
                  where l.platform = p_platform and l.listing_key = p_key
                    and l.model not like 'word-checker%'
                    and (l.text_hash is null or l.text_hash = p_hash))
$$;

create or replace function public.facts_ai_todo_ids(p_table text, p_limit integer, p_mode text, p_seed text, p_shard integer default 0, p_shards integer default 1)
returns table(id bigint) language plpgsql stable security definer set search_path to 'public' as $function$
declare tc text;
begin
  if p_table is null or p_table !~ '^[a-z0-9_]+_listings$' or to_regclass('public.' || p_table) is null
     or p_limit not between 1 and 5000 or p_mode not in ('new', 'backlog')
     or p_shards not between 1 and 32 or p_shard < 0 or p_shard >= p_shards then
    return;
  end if;
  tc := case when p_table like 'wasalt\_%' then $c$x.ar_data->'propertyInfo'->>'description'$c$ else 'x.description' end;
  return query execute format($q$
    select x.id::bigint
      from public.%1$I x
      join public.search_listings_ar s on s.source_table = %2$L and s.listing_id = x.id
     where x.active and x.ad_number is not null
       and x.id %% %7$s = %8$s
       and (%3$L <> 'new' or s.first_seen_at >= now() - interval '3 days')
       and not public.facts_ai_is_read(%4$L, x.ad_number::text, public.facts_text_hash(x.title, %9$s))
     order by md5(x.id::text || %5$L) limit %6$s
  $q$, p_table, p_table, p_mode, regexp_replace(p_table, '_(residential|commercial)_listings$', ''), coalesce(p_seed, ''),
       p_limit, p_shards, p_shard, tc);
end $function$;

create or replace function public.ops_ai_facts_unread_new()
returns table(source_table text, window_ads bigint, unread bigint, failed text)
language plpgsql stable security definer set search_path to 'public' as $function$
declare t text; tc text; n bigint; u bigint;
begin
  for t in select distinct s.source_table from public.search_listings_ar s
            where s.source_table ~ '_(residential|commercial)_listings$' and s.first_seen_at >= now() - interval '72 hours' loop
    tc := case when t like 'wasalt\_%' then $c$x.ar_data->'propertyInfo'->>'description'$c$ else 'x.description' end;
    begin
      execute format($q$
        select count(*),
               count(*) filter (where not public.facts_ai_is_read(%2$L, x.ad_number::text, public.facts_text_hash(x.title, %3$s)))
          from public.%1$I x
          join public.search_listings_ar s on s.source_table = %1$L and s.listing_id = x.id
         where x.active and x.ad_number is not null
           and s.first_seen_at between now() - interval '72 hours' and now() - interval '30 hours'
           and length(coalesce(x.title, '') || coalesce(%3$s, '')) >= 40$q$,
        t, regexp_replace(t, '_(residential|commercial)_listings$', ''), tc) into n, u;
      source_table := t; window_ads := n; unread := u; failed := null;
    exception when others then
      source_table := t; window_ads := null; unread := null; failed := left(sqlerrm, 160);
    end;
    if failed is not null or unread > 0 then return next; end if;
  end loop;
end $function$;

-- The 13 sites whose text arrived on 2026-10-31 after the AI had read the title: every AI row written before
-- the first of those crawls is marked so the ad reads as unread. Nothing is deleted; the new run adds its rows.
update public.listing_facts l
   set text_hash = 'read-before-text:2026-10-31'
 where l.text_hash is null
   and l.model not like 'word-checker%'
   and l.extracted_at < '2026-10-31 03:00+00'
   and l.platform in ('ksaaqar','sadiqeltajer','sanadak','akariyoun','satel','aqargate','therc','ashab','hajer','manzo','alsaedan','compoundin','aqarat');
