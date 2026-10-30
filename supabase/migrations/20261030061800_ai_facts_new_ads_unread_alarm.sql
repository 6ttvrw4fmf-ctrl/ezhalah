-- EVERY NEW AD WITH A DESCRIPTION IS READ BY THE AI (owner 2026-10-30: «make sure we never [skip] and we read everything»).
-- On 2026-10-29 the 16 backlog lanes all timed out picking aqar and skipped it while every lane finished green: ~42k
-- unread Aqar ads, and nothing in the database noticed. The nightly AI run (07:40 UTC, mode new) reads every ad first
-- seen in the last 3 days, so an ad first seen 30-72 h ago has had at least one nightly chance. This counts, per table,
-- those ads with readable text (title + description >= 40 chars; the reader's own floor is 30 after redaction) that the
-- AI never read. A table that cannot be counted is reported as failed, never as zero.

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
               count(*) filter (where not exists (select 1 from public.listing_facts l
                                                   where l.platform = %2$L and l.listing_key = x.ad_number::text
                                                     and l.model not like 'word-checker%%'))
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
revoke all on function public.ops_ai_facts_unread_new() from public, anon, authenticated;
grant execute on function public.ops_ai_facts_unread_new() to service_role;

do $patch$
declare d text; k int;
  anchor constant text := '-- 5. the nightly reader';
  addition constant text := $add$-- 8. every new ad with a description is read by the AI (owner 2026-10-30): a table with >= 25 such ads first
  -- seen 30-72 h ago still unread (and >= 5 % of them), or a table that could not be counted
  select count(*) into n from public.ops_ai_facts_unread_new() g
   where g.failed is not null or (g.unread >= 25 and g.unread >= 0.05 * g.window_ads);
  if coalesce(n, 0) > 0 then
    r := r + public.mon_raise('P2', 'ai_facts_new_ads_unread', 'all', 'ai_facts_new_ads_unread',
      jsonb_build_object('tables', n, 'detail', (select jsonb_agg(to_jsonb(g)) from public.ops_ai_facts_unread_new() g), 'for', '🔧', 'why',
        'New ads with a description were not read by the AI facts reader within a nightly run (facts-extract.yml, mode new, 07:40 UTC). Look at the run log for «SKIPPED» / «sampling failed» (a picker timeout) or a budget stop, fix it, then run mode new for the platform. Never raise the threshold to clear this.'));
  else
    perform public.mon_resolve('ai_facts_new_ads_unread', 'all');
  end if;
  $add$;
begin
  select pg_get_functiondef('public.mon_detect_text_facts()'::regprocedure) into d;
  if position('ai_facts_new_ads_unread' in d) > 0 then
    raise notice 'mon_detect_text_facts already carries check 8';
  else
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'mon_detect_text_facts: anchor found % times, want 1', k; end if;
    execute replace(d, anchor, addition || anchor);
  end if;
end $patch$;

-- Proven at apply time: the counter answers for every table with recent ads, and the detector still runs.
do $$ begin
  if exists (select 1 from public.ops_ai_facts_unread_new() where failed is not null) then
    raise exception 'ops_ai_facts_unread_new could not count: %', (select jsonb_agg(to_jsonb(g)) from public.ops_ai_facts_unread_new() g where failed is not null);
  end if;
end $$;
select public.mon_detect_text_facts();
