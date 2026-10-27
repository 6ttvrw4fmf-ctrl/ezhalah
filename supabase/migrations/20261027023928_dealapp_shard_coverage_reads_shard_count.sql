-- mon_detect_dealapp_shard_coverage() READS THE SHARD COUNT FROM THE RUNS, NOT A CONSTANT (2026-10-27).
-- dealapp-sharded.yml moves from 12 shards to 24 (12 at a time): measured 2026-10-26, each of 12 shards owned ~3,000
-- ids against dealapp's ~9 origin renders/min/IP, 6-8 shards ran out their budget nightly and ~23k sitemap ids were
-- never fetched. With `v_shards constant int := 12` the detector would report every /24 run as a missing /12 shard.
-- It now takes N from the most recent `dealapp:<k>/<N>` run label (falling back to 12), so the change of count — or
-- any future one — is measured against the fleet that actually ran. Nothing else in the detector changes.
do $patch$
declare d text; k int;
  old_decl constant text := 'v_shards constant int := 12;';
  new_decl constant text := 'v_shards int := coalesce((select split_part(r.platform, ''/'', 2)::int from public.scrape_runs r where r.platform ~ ''^dealapp:[0-9]+/[0-9]+$'' order by r.started_at desc limit 1), 12);';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_detect_dealapp_shard_coverage';
  if d is null then raise exception 'mon_detect_dealapp_shard_coverage not found'; end if;
  if position(new_decl in d) > 0 then raise notice 'already reads the shard count'; return; end if;
  k := (length(d) - length(replace(d, old_decl, ''))) / length(old_decl);
  if k <> 1 then raise exception 'shard constant found % times, want 1', k; end if;
  d := replace(d, old_decl, new_decl);
  d := replace(d, 'int(ad_number)%12', 'int(ad_number)%N');
  d := replace(d, 'a full sweep must show all 12.', 'a full sweep must show all N.');
  d := replace(d, 'leaves ~1/12 of inventory', 'leaves ~1/N of inventory');
  execute d;
end $patch$;

do $proof$
declare r int;
begin
  if position('split_part(r.platform, ''/'', 2)::int' in pg_get_functiondef('public.mon_detect_dealapp_shard_coverage()'::regprocedure)) = 0 then
    raise exception 'PROOF: the detector does not read the shard count';
  end if;
  r := public.mon_detect_dealapp_shard_coverage();   -- runs on today's /12 labels: must not error
end $proof$;
