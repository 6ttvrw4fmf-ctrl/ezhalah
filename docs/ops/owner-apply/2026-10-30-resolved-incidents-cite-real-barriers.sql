-- FOR THE OWNER SESSION TO APPLY (falcon 2026-10-30). The routine's apply_migration call asked a question nobody could answer and
-- timed out, so this was NOT applied. Apply with apply_migration name resolved_incidents_cite_real_barriers when the DB is quiet,
-- mirror it into supabase/migrations/ with the minted version, then dispatch incident-citation-guard.yml: it must turn green.
-- Five resolved incidents cited barriers that are not in the repo, so incident-citation-guard.yml was red on every run
-- (falcon 2026-10-30). #155, #187, #242, #338 named live pill-removal journeys that were never committed under those names;
-- removing an Advanced Filter answer no longer exists at all — the owner made the chips read-only on 2026-10-03 (PR 5708,
-- «no ✕») — so they now cite the barrier that pins that, beside their own offline barrier. #1270 was closed by the
-- detector self-heal with a slice label that names nothing; it now cites the detector that self-healed it.
do $cite$
declare n int;
begin
  update public.ops_incident set barrier_script =
    'scripts/verify-af-committed-pills-are-never-covered.ts + scripts/verify-af-stays-in-place.ts (pill removal retired by the owner 2026-10-03, PR 5708: chips are read-only)'
   where id = 155 and state = 'resolved';
  get diagnostics n = row_count; if n <> 1 then raise exception '#155 not updated'; end if;
  update public.ops_incident set barrier_script =
    'scripts/verify-af-cross-round-carry.ts + scripts/verify-af-stays-in-place.ts (pill removal retired by the owner 2026-10-03, PR 5708: chips are read-only)'
   where id in (187, 242) and state = 'resolved';
  get diagnostics n = row_count; if n <> 2 then raise exception '#187/#242 not updated'; end if;
  update public.ops_incident set barrier_script =
    'scripts/verify-cards-reveal-on-scroll.ts + scripts/verify-af-stays-in-place.ts (pill removal retired by the owner 2026-10-03, PR 5708: chips are read-only)'
   where id = 338 and state = 'resolved';
  get diagnostics n = row_count; if n <> 1 then raise exception '#338 not updated'; end if;
  update public.ops_incident set detail = jsonb_set(detail, '{barrier}', to_jsonb(
    'verify-cards-reveal-on-scroll.ts extended with 7 EXECUTED cases + call-site pins; 3 mutants planted in the REAL source and watched RED. The live pill-removal journey was retired with the feature (owner 2026-10-03, PR 5708: chips are read-only), pinned by scripts/verify-af-stays-in-place.ts.'::text))
   where id = 338 and detail ? 'barrier';
  get diagnostics n = row_count; if n <> 1 then raise exception '#338 detail not updated'; end if;
  update public.ops_incident set barrier_script =
    'auto:detector-self-heal:af_chip_vs_db_truth (scripts/verify-af-db-truth-knows-type-tags.ts)'
   where id = 1270 and state = 'resolved';
  get diagnostics n = row_count; if n <> 1 then raise exception '#1270 not updated'; end if;
end $cite$;
