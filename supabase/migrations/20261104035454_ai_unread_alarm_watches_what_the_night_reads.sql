-- THE UNREAD ALARM WATCHES WHAT THE NIGHT READS (owner 2026-10-26: «residential only, later commercial»).
-- facts-extract.yml reads --category residential by default, yet ops_ai_facts_unread_new() also counted the commercial
-- tables. On 2026-11-04 the first full night after the lane fix (3 lanes, 4,598 ads, 0 lost) left only aqar / dealapp /
-- haraj COMMERCIAL ads «unread» — ads the night is told not to read — so ai_facts_new_ads_unread could never clear, and a
-- residential table falling behind would hide under that standing alert (mon_raise only re-raises a key that is closed).
-- The counter now covers the category the nightly reads. When the owner turns commercial on, change BOTH the workflow
-- default and this filter; verify-ai-reader-never-skips-silently.ts fails while they disagree.
set local lock_timeout = '5s';

create or replace function public.ops_ai_facts_unread_new()
 returns table(source_table text, window_ads bigint, unread bigint, failed text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare t text; tc text; n bigint; u bigint;
begin
  for t in select distinct s.source_table from public.search_listings_ar s
            where s.source_table ~ '_residential_listings$' and s.first_seen_at >= now() - interval '72 hours' loop
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

-- PROOF at apply: the counter reads the residential tables only, and still fails closed.
do $$
declare def text := pg_get_functiondef('public.ops_ai_facts_unread_new()'::regprocedure);
begin
  if position($a$s.source_table ~ '_residential_listings$'$a$ in def) = 0 then raise exception 'PROOF: the counter is not residential-only'; end if;
  if position($a$unread := null; failed := left(sqlerrm, 160);$a$ in def) = 0 then raise exception 'PROOF: the counter no longer fails closed'; end if;
end $$;