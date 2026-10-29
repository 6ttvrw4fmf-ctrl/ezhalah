-- THE AI READER RUNS IN PARALLEL LANES THAT NEVER SHARE AN AD (owner 2026-10-29: «how long is needed … make sure we
-- capture it all»). DeepSeek V3.2 through the OpenRouter reader key answers in ~35–53 s per call (direct DeepSeek: ~6 s),
-- so one lane needs ~10 days for the ~270k unread ads. facts_ai_todo_ids gains p_shard / p_shards: lane k of n is
-- handed only ids with id % n = k, so n lanes read disjoint ads and no ad is paid for twice. Defaults (0 of 1) keep
-- every existing caller exact. Dropped and re-created in one transaction: a second overload is the PGRST203 shape.

drop function if exists public.facts_ai_todo_ids(text, integer, text, text);

create function public.facts_ai_todo_ids(p_table text, p_limit integer, p_mode text, p_seed text,
                                         p_shard integer default 0, p_shards integer default 1)
returns table(id bigint)
language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if p_table is null or p_table !~ '^[a-z0-9_]+_listings$' or to_regclass('public.' || p_table) is null
     or p_limit not between 1 and 5000 or p_mode not in ('new', 'backlog')
     or p_shards not between 1 and 32 or p_shard < 0 or p_shard >= p_shards then
    return;
  end if;
  return query execute format($q$
    select x.id::bigint
      from public.%1$I x
      join public.search_listings_ar s on s.source_table = %2$L and s.listing_id = x.id
     where x.active and x.ad_number is not null
       and x.id %% %7$s = %8$s
       and (%3$L <> 'new' or s.first_seen_at >= now() - interval '3 days')
       and not exists (select 1 from public.listing_facts l
                        where l.platform = %4$L and l.listing_key = x.ad_number::text and l.model not like 'word-checker%%')
     order by md5(x.id::text || %5$L) limit %6$s
  $q$, p_table, p_table, p_mode, regexp_replace(p_table, '_(residential|commercial)_listings$', ''), coalesce(p_seed, ''),
       p_limit, p_shards, p_shard);
end $function$;
revoke all on function public.facts_ai_todo_ids(text, integer, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.facts_ai_todo_ids(text, integer, text, text, integer, integer) to service_role;
