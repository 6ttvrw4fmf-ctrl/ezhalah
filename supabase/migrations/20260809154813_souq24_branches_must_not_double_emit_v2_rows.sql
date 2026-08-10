-- listing_native_location_v2 emits duplicate (source_table, listing_id) rows for souq24.
-- The view is a UNION ALL. Branch 4 (catch-all) excludes souq24 AND carries a NOT EXISTS guard
-- against listing_native_location_v1; the two souq24 branches carry neither. So a souq24 row that
-- is present in v1 is emitted by branch 1 AND by its own souq24 branch. Exactly 2 rows today
-- (souq24_residential_listings 648152 and 648160), each copy carrying a DIFFERENT city_id, which
-- sync_search_listings_ar()'s `distinct on ... order by last_updated desc nulls last` then resolves
-- arbitrarily -- both currently land in the search index with city_id NULL. This is also the
-- documented "+2" gap between crawl_stats.total_searchable and the real index row count.
--
-- The guard is tied to "branch 1 will ACTUALLY emit a replacement" (v1 AND active_listing_ids_v2
-- membership), not to v1 membership alone. Both are matviews read against a live source table, so
-- during refresh skew a souq24 row can be active + in v1 + absent from active_listing_ids_v2. A
-- v1-only guard would suppress the souq24 branch while branch 1 stayed silent, the row would
-- vanish from v2, and the sync's DELETE arm would then drop it from the search index -- hiding a
-- source-published listing. This form is a strict de-duplication: it can only ever remove a second
-- copy, never the last one.
--
-- Built by rewriting the LIVE definition rather than pasting a transcribed copy. An earlier attempt
-- (migration 20260809154032) was silently reverted 52 seconds later by a concurrent session's
-- migration (20260809154124_dealapp_live_location_overlay), which recreated this same view from its
-- own base text. Deriving the new definition from pg_get_viewdef() at apply time means this
-- composes with whatever the other session landed instead of clobbering it, and the assertions
-- make a silent no-op impossible. Two exact anchors are used rather than one regexp: Postgres
-- treats the `.*?` in a mixed-greediness RE as greedy, so a single pattern spanned BOTH branches
-- and attached the guard once with the wrong table name.
do $do$
declare
  v_def text;
  v_new text;
  v_guards int;
  v_dups bigint;
  c_res constant text := E'  WHERE s.active = true\nUNION ALL\n SELECT ''souq24''::text';
  c_com constant text := E'  WHERE s.active = true\nUNION ALL\n SELECT regexp_replace(';
  g_res constant text := E'  WHERE s.active = true AND NOT (EXISTS ( SELECT 1\n           FROM listing_native_location_v1 v1\n             JOIN active_listing_ids_v2 a2 ON a2.source_table = v1.source_table AND a2.listing_id = v1.listing_id\n          WHERE v1.source_table = ''souq24_residential_listings''::text AND v1.listing_id = s.id))\nUNION ALL\n SELECT ''souq24''::text';
  g_com constant text := E'  WHERE s.active = true AND NOT (EXISTS ( SELECT 1\n           FROM listing_native_location_v1 v1\n             JOIN active_listing_ids_v2 a2 ON a2.source_table = v1.source_table AND a2.listing_id = v1.listing_id\n          WHERE v1.source_table = ''souq24_commercial_listings''::text AND v1.listing_id = s.id))\nUNION ALL\n SELECT regexp_replace(';
begin
  v_def := pg_get_viewdef('public.listing_native_location_v2'::regclass, true);

  if v_def like '%active_listing_ids_v2 a2%' then
    raise notice 'souq24 de-dup guard already present; nothing to do';
    return;
  end if;

  -- Each anchor is unique in the definition: only the residential souq24 branch is followed by
  -- another souq24 branch, and only the commercial one is followed by the catch-all branch.
  if (select count(*) from regexp_matches(v_def, regexp_replace(c_res,'([\.\(\)\[\]\*\+\?\|\^\$\\])','\\\1','g'), 'g')) <> 1
     or (select count(*) from regexp_matches(v_def, regexp_replace(c_com,'([\.\(\)\[\]\*\+\?\|\^\$\\])','\\\1','g'), 'g')) <> 1 then
    raise exception 'souq24 branch anchors are no longer unique — the view has been restructured; re-derive them before shipping';
  end if;

  v_new := replace(replace(v_def, c_res, g_res), c_com, g_com);

  v_guards := (select count(*) from regexp_matches(v_new, 'active_listing_ids_v2 a2', 'g'));
  if v_guards <> 2 then
    raise exception 'souq24 de-dup guard did not attach to both branches (attached % of 2)', v_guards;
  end if;

  execute 'create or replace view public.listing_native_location_v2 as ' || v_new;

  -- Proof, inside the same transaction: no duplicate PKs left, and the two formerly-duplicated
  -- listings must both survive. A guard that de-duplicated by deleting would fail here.
  select count(*) into v_dups
    from (select source_table, listing_id from public.listing_native_location_v2
          group by 1,2 having count(*) > 1) d;
  if v_dups <> 0 then
    raise exception 'listing_native_location_v2 still emits % duplicate PK row(s) after the guard', v_dups;
  end if;

  if (select count(*) from public.listing_native_location_v2
       where source_table = 'souq24_residential_listings' and listing_id in (648152, 648160)) <> 2 then
    raise exception 'the de-dup guard removed a listing instead of a duplicate copy — refusing to ship';
  end if;
end $do$;
