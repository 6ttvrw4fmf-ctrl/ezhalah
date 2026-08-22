-- Senior Production Engineer run #33 (2026-08-21), owner-directed.
--
-- DEFECT. Sanadak publishes REGA's «خدمات العقار» panel — a closed comma-separated multi-select of
-- مياه / كهرباء / صرف صحي (+ هاتف). The scraper resolves it correctly (it dereferences the Next.js
-- RSC lazy ref `$<id>` via _resolve_additional_infos) and retains it verbatim in
-- <table>.additional_info. But BOTH sanadak branches of listing_rich_attrs — the canonical AF layer
-- that sync_all_rich_attrs copies into search_listings_ar — produced nothing for the trio:
--   residential:  NULL::boolean AS electricity / water_supply / sanitation
--   commercial:   x.electricity / x.water_supply / x.sanitation, i.e. the raw typed columns, which
--                 the Sanadak scraper never writes (it has zero references to them)
-- So 1,114 searchable Sanadak listings carried no utility data, unreachable by those AF predicates,
-- while the values sat in the row the whole time.
--
-- This is the UNION-branch NULL-literal class for the THIRD view in this codebase (after
-- listing_native_location_v2's catch-all and souq24 branches, run #32). The branch already derives
-- ac_type and kitchen_status from source_capture two lines above — the pattern was there.
--
-- WHY THE FIX GOES IN THE VIEW, NOT THE SCRAPER. listing_rich_attrs is the canonical AF bridge and
-- already derives rich attrs from retained payloads for other platforms (wasalt from ar_data, satel
-- and the wasalt branch from additional_info). Deriving here fixes every existing row AND every
-- future one in one place, with no re-crawl and no backfill; the scraper's contract (capture the
-- source faithfully) is already met.
--
-- STRICT TRI-STATE, via public.sanadak_service_flag():
--     panel absent          -> NULL   (UNKNOWN — never fabricate false from missing data)
--     service enumerated    -> true
--     panel present, absent -> false  (a real negative: land plots publish «كهرباء» alone)
-- Token-exact matching (split on ',' then btrim), never a substring test.
--
-- VERIFIED against a test view BEFORE applying (test vs live, same snapshot):
--   195,769 rows both sides
--   1,088 target diffs, ALL sanadak; 0 diffs outside sanadak
--   0 rows where an existing non-NULL value was overwritten
--   0 diffs on any non-target rich column (ac_type, kitchen_status, parking_count, balcony,
--     laundry_room, optical_fibers, latitude, postal_code, separate_water_meter)
--   an INDEPENDENT inline oracle (not the helper) agreed on all 1,140 active rows, 0 disagreements
--   resulting tri-state: water 998 true / 90 false / 52 NULL · electricity 1,084 true / 4 false
--     · sanitation 879 true / 209 false  — genuinely three-valued, 52 honest UNKNOWNs preserved
--
-- Applied by rewriting ONLY the two matching UNION branches (split on 'UNION ALL', assert exactly
-- one residential and one commercial branch, assert each utility literal appears exactly once inside
-- that branch), never by hand-transcribing a 95,793-character 52-branch view.

do $$
declare v_def text; parts text[]; i int; p text; n_res int := 0; n_com int := 0; changed text;
begin
  select pg_get_viewdef(c.oid,true) into v_def from pg_class c where c.relname='listing_rich_attrs';
  parts := string_to_array(v_def, 'UNION ALL');

  for i in 1 .. array_length(parts,1) loop
    p := parts[i];

    if p ~ '''sanadak_residential_listings''::text AS source_table' then
      if (length(p)-length(replace(p,'NULL::boolean AS electricity,','')))/length('NULL::boolean AS electricity,') <> 1
      or (length(p)-length(replace(p,'NULL::boolean AS water_supply,','')))/length('NULL::boolean AS water_supply,') <> 1
      or (length(p)-length(replace(p,'NULL::boolean AS sanitation,','')))/length('NULL::boolean AS sanitation,') <> 1 then
        raise exception 'REFUSED: residential utility literals not found exactly once';
      end if;
      changed := replace(p,'NULL::boolean AS electricity,','public.sanadak_service_flag(s.additional_info, ''كهرباء''::text) AS electricity,');
      changed := replace(changed,'NULL::boolean AS water_supply,','public.sanadak_service_flag(s.additional_info, ''مياه''::text) AS water_supply,');
      changed := replace(changed,'NULL::boolean AS sanitation,','public.sanadak_service_flag(s.additional_info, ''صرف صحي''::text) AS sanitation,');
      parts[i] := changed; n_res := n_res + 1;

    elsif p ~ '''sanadak_commercial_listings''::text AS source_table' then
      if (length(p)-length(replace(p,'    x.electricity,','')))/length('    x.electricity,') <> 1
      or (length(p)-length(replace(p,'    x.water_supply,','')))/length('    x.water_supply,') <> 1
      or (length(p)-length(replace(p,'    x.sanitation,','')))/length('    x.sanitation,') <> 1 then
        raise exception 'REFUSED: commercial utility refs not found exactly once';
      end if;
      changed := replace(p,'    x.electricity,','    public.sanadak_service_flag(x.additional_info, ''كهرباء''::text) AS electricity,');
      changed := replace(changed,'    x.water_supply,','    public.sanadak_service_flag(x.additional_info, ''مياه''::text) AS water_supply,');
      changed := replace(changed,'    x.sanitation,','    public.sanadak_service_flag(x.additional_info, ''صرف صحي''::text) AS sanitation,');
      parts[i] := changed; n_com := n_com + 1;
    end if;
  end loop;

  if n_res <> 1 or n_com <> 1 then
    raise exception 'REFUSED: expected exactly one sanadak residential and one commercial branch (res=%, com=%)', n_res, n_com;
  end if;

  execute 'create or replace view public.listing_rich_attrs as ' || array_to_string(parts, 'UNION ALL');
end $$;

drop view if exists public.listing_rich_attrs_test;
