-- RETIRE RAZRE'S 94 WIX-ERA ROWS (owner 2026-10-27: «do that please fix everything»; backlog #849 / #846 / lifecycle
-- #793 said «owner decides» — this is that decision).
--
-- WHY. razre.sa was rebuilt (PR #8449). The new site publishes 27 projects with 18 available units, and the crawl reads
-- all of them every night (complete=True). 94 of the 112 active razre_residential_listings rows are from the PREVIOUS
-- (Wix) site: ad_number RAZ<uuid>, listing_url /onepro-1/N, last seen before the rebuild. Their old URLs now redirect
-- to a project page (/onepro-1/29 → /projects/raz-29/), so the direct-read oracle correctly answers UNKNOWN for them
-- and nothing could ever retire them: the collapse guard refused every prune (re-saw 18 of 112), and users kept
-- seeing ~94 units that the source no longer offers.
--
-- WHAT. The 94 rows are registered in ops_adjudicated_retraction FIRST (so auto_recover_false_inactive() can never
-- switch them back on — AGENTS.md «hiding a listing is a two-part act»), then deactivated. Kept, not deleted: undo is
-- deleting the register rows and setting active = true. Only rows that are still active, on the Wix URL shape and
-- unseen since before the rebuild are touched; the 18 new-site rows are never in scope.

insert into public.ops_adjudicated_retraction (source_table, listing_id, reason, evidence)
select 'razre_residential_listings', r.id,
       'owner 2026-10-27: Wix-era razre row from the site before its rebuild; its URL now redirects to a project page and the new site does not offer it',
       jsonb_build_object('ad_number', r.ad_number, 'listing_url', r.listing_url, 'last_seen_at', r.last_seen_at,
                          'probe', '/onepro-1/29 → /projects/raz-29/ (redirect, 2026-10-26)',
                          'new_site', '27 projects, 18 available units, complete crawl')
  from public.razre_residential_listings r
 where r.active and r.listing_url like '%/onepro-1/%' and r.last_seen_at < now() - interval '3 days'
   and not exists (select 1 from public.ops_adjudicated_retraction j
                    where j.source_table = 'razre_residential_listings' and j.listing_id = r.id);

update public.razre_residential_listings r
   set active = false, deactivated_at = now()
 where r.active and r.listing_url like '%/onepro-1/%' and r.last_seen_at < now() - interval '3 days'
   and exists (select 1 from public.ops_adjudicated_retraction j
                where j.source_table = 'razre_residential_listings' and j.listing_id = r.id);

do $proof$
declare v_left int; v_new int; v_reg int;
begin
  select count(*) into v_left from public.razre_residential_listings where active and listing_url like '%/onepro-1/%';
  select count(*) into v_new from public.razre_residential_listings where active and listing_url not like '%/onepro-1/%';
  select count(*) into v_reg from public.ops_adjudicated_retraction where source_table = 'razre_residential_listings';
  if v_left <> 0 then raise exception 'PROOF: % Wix-era rows still active', v_left; end if;
  if v_new < 1 then raise exception 'PROOF: the new-site rows must stay active (found %)', v_new; end if;
  if v_reg < 94 then raise exception 'PROOF: expected 94 register rows, found %', v_reg; end if;
end $proof$;
