-- ♻️ lifecycle 2026-11-03: the «source vouched» clause added earlier today (migration name
-- lifecycle_duplicate_stale_copy_source_vouched) read a served copy with NO verification (NULL) as
-- vouched, because `not (NULL > t)` is NULL and drops the row. A served copy
-- never verified is exactly a pair that must still count: coalesce the comparison to false.
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
         -- The SOURCE has already answered which copy is right (2026-11-03): the served copy carries a
         -- live verification inside 48 h that is newer than its twin's retirement, so the inactive
         -- twin is a retired sibling, not a disagreement about whether the page exists (measured that
         -- day: aqalemhajer 51/51, sadiqeltajer 47/47, arkaan 13/13 — one card each, live). A served
         -- copy with no fresh proof still counts.
         and not coalesce(case when res.active is not true then com.last_verified_alive_at
                               else res.last_verified_alive_at end
                          > greatest(now() - interval '48 hours',
                                     coalesce(case when res.active is not true then res.deactivated_at
                                                   else com.deactivated_at end, '-infinity'::timestamptz)),
                          false)
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