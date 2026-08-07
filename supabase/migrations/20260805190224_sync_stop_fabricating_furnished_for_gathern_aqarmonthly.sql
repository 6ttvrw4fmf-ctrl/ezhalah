-- P1 FIDELITY DEFECT (apartment advanced-filter audit wf_fce265de-a8a, 2026-08-05).
--
-- sync_search_listings_ar wrote furnished for two whole platforms by REGEX ON THE TABLE NAME:
--     case when v.source_table ~ '^(gathern|aqarmonthly)_' then true else v.furnished end
-- No source value is consulted. For gathern the raw table has no furnished column at all, so the value
-- is invented outright. For aqarmonthly it is worse than invention: aqar.fm's GraphQL publishes a real
-- per-listing `furnished` 0/1, our scraper explicitly REQUESTS it (scrapers/aqarmonthly/run.py:120
-- DETAIL_Q) and it lands in source_capture — verified live 17/17 against the source — but map_listing()
-- never maps it to a column and the table has no column to map it to, so the captured truth dies and
-- the sync then asserts `true` over the top, contradicting the source on flats it marks NOT furnished.
--
-- Owner rule: never fabricate; the source website is the truth; if the source is not confident, store
-- unknown. A platform-wide constant is the opposite of a source-published value.
-- Fix: pass v.furnished through unchanged. gathern/aqarmonthly become NULL (honestly unknown) until
-- their capture path is wired end-to-end. The Furnished chip is STRICT, so NULL simply does not match —
-- no user is shown a flat that fails their filter.
--
-- The expression appears TWICE (INSERT projection + the s3.furnished change-detection predicate, where
-- it is parenthesised) and both must move together, or corrected rows would never re-sync — the
-- silent-propagation defect class closed on 2026-08-03. The guard enforces exactly 2.
do $mig$
declare
  src text; n int;
  old_expr constant text := 'case when v.source_table ~ ''^(gathern|aqarmonthly)_'' then true else v.furnished end';
  new_expr constant text := 'v.furnished';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'sync_search_listings_ar';
  if src is null then raise exception 'sync_search_listings_ar not found'; end if;

  n := (length(src) - length(replace(src, old_expr, ''))) / length(old_expr);
  if n <> 2 then
    raise exception 'expected exactly 2 occurrences of the furnished fabrication, found %', n;
  end if;

  execute replace(src, old_expr, new_expr);

  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'sync_search_listings_ar';
  if position(old_expr in src) > 0 then
    raise exception 'fabrication still present after replace';
  end if;
  -- the predicate parenthesises the expression: `s3.furnished is distinct from (v.furnished)`
  if position('s3.furnished is distinct from (v.furnished)' in src) = 0 then
    raise exception 'change-detection clause did not land on the passthrough expression';
  end if;
end
$mig$;

-- Retract the fabricated values already in the index. Only the two fabricated platforms are touched;
-- every other platform's furnished is untouched. NULL = honestly unknown.
update search_listings_ar
   set furnished = null
 where source_table ~ '^(gathern|aqarmonthly)_'
   and furnished is not null;
