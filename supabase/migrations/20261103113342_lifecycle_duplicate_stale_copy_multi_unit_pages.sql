-- ♻️ lifecycle 2026-11-03: lifecycle_duplicate_stale_copy paired rows by listing_url alone, so a
-- project page that lists several units under ONE url (nufouth latest-offers?ads-N4175=1: 9 units,
-- 2 res + 7 com; expattrusted compounds) read a unit removed at the source as «our two copies of the
-- same page disagree» while every other unit on that page is a different listing. Measured: of 185
-- pairs, every one whose url has exactly two rows shares its ad_number (aqalemhajer 51/51,
-- sadiqeltajer 47/47, dealapp 16/16 …); the 15 that do not (nufouth 2, expattrusted 11) sit on urls
-- carried by 3+ rows. A pair is now one listing only when its ad_numbers match OR its url is carried by
-- just those two rows — the multi-unit page is the only shape that leaves.
CREATE OR REPLACE FUNCTION public.ops_lifecycle_duplicate_stale_copy()
 RETURNS TABLE(platform text, listing_url text, dead_table text, dead_id bigint, live_table text, live_id bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
begin
  for r in
    select regexp_replace(t.table_name, '_(residential|commercial)_listings$', '') as p
      from information_schema.tables t
     where t.table_schema = 'public' and t.table_name ~ '_(residential|commercial)_listings$'
     group by 1
    having count(*) filter (where t.table_name like '%\_residential\_listings') = 1
       and count(*) filter (where t.table_name like '%\_commercial\_listings')  = 1
  loop
    -- Both tables must actually carry listing_url; a platform captured without it cannot be joined on
    -- identity and is skipped rather than guessed at.
    if (select count(*) from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name in (r.p || '_residential_listings', r.p || '_commercial_listings')
           and c.column_name = 'listing_url') <> 2 then
      continue;
    end if;

    return query execute format($q$
      select %1$L::text, res.listing_url,
             case when res.active is not true then %2$L else %3$L end::text,
             case when res.active is not true then res.id  else com.id  end,
             case when res.active is not true then %3$L else %2$L end::text,
             case when res.active is not true then com.id  else res.id  end
        from public.%2$I res
        join public.%3$I com on com.listing_url = res.listing_url
       where res.listing_url is not null
         and (res.active is not true) <> (com.active is not true)
         -- ONE listing, not two units of one project page (2026-11-03): the same ad_number, or a url
         -- that only these two rows carry.
         and (com.ad_number is not distinct from res.ad_number
              or ((select count(*) from public.%2$I x where x.listing_url = res.listing_url)
                + (select count(*) from public.%3$I y where y.listing_url = res.listing_url)) <= 2)
         -- An inactive copy the adjudication ledger accounts for is a DECISION, not a
         -- contradiction. Restoring it would undo a repair (20260830140110) and re-create the
         -- duplicate that repair removed.
         and public.ops_lifecycle_dead_copy_is_a_contradiction(
               case when res.active is not true then %2$L else %3$L end,
               case when res.active is not true then res.id  else com.id  end)
         and exists (
           select 1 from public.search_listings_ar s
            where (s.source_table = %2$L and s.listing_id = res.id and res.active is true)
               or (s.source_table = %3$L and s.listing_id = com.id and com.active is true))
    $q$, r.p, r.p || '_residential_listings', r.p || '_commercial_listings');
  end loop;
end;
$function$;