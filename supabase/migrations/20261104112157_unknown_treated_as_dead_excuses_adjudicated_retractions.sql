-- mon_detect_unknown_treated_as_dead: a hide recorded as a decision is not an UNKNOWN treated as dead
-- (♻️ lifecycle, 2026-11-04).
--
-- The detector excused two kinds of bookkeeping hide (res/com dedup, automatic supersession) but not
-- the third the repo uses: a deliberate retraction registered in ops_adjudicated_retraction (AGENTS.md
-- «HIDING A LISTING IS A TWO-PART ACT»). Measured: almuteb's retirement (migration retire_almuteb_domain_does_not_resolve, owner
-- decision 2, almuteb.sa NXDOMAIN since 10-23) hid 11 rows at 09:46:09 and registered all 11 at the
-- same instant, and at 09:59 this detector raised P1 unknown_treated_as_dead:almuteb_residential_listings
-- (alert 13026) asking for them to be restored — restoring them would serve 11 cards on a dead domain.
-- Now a row whose retraction was recorded within the hour around its deactivation is excluded and
-- counted as adjudicated_retraction_excluded; time-bounded exactly like the other two, so an old
-- adjudication can never excuse a fresh kill on the same id. Nothing else changes.
do $anchor$
declare
  v_def text := pg_get_functiondef('public.mon_detect_unknown_treated_as_dead()'::regprocedure);
  a1 text := $a$               ) as superseded,
$a$;
  b1 text := $b$               ) as superseded,
               -- A DELIBERATE retraction recorded as a decision (ops_adjudicated_retraction, e.g. a
               -- platform retirement): the decision is the evidence. Bounded to the hour around the
               -- deactivation, like the two above.
               exists (
                 select 1 from public.ops_adjudicated_retraction j
                  where j.source_table = %1$L and j.listing_id = d.id
                    and j.retracted_at between d.deactivated_at - interval '1 hour'
                                           and d.deactivated_at + interval '1 hour'
               ) as retracted,
$b$;
  a2 text := 'not dedup and not superseded';
  a3 text := $c$             count(*) filter (where superseded and not dedup)
        from classified$c$;
  b3 text := $c$             count(*) filter (where superseded and not dedup),
             count(*) filter (where retracted and not dedup and not superseded)
        from classified$c$;
  a4 text := 'into v_no_ev, v_unknown, v_total, v_dedup, v_super;';
  a5 text := $e$          'auto_supersession_excluded', v_super,$e$;
  a6 text := 'v_super     bigint;';
begin
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1
     or (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 2
     or position(a3 in v_def) = 0 or position(a4 in v_def) = 0
     or position(a5 in v_def) = 0 or position(a6 in v_def) = 0
     or position('retracted' in v_def) > 0 then
    raise exception 'mon_detect_unknown_treated_as_dead is not the body this was written against; nothing changed';
  end if;
  v_def := replace(v_def, a1, b1);
  v_def := replace(v_def, a2, 'not dedup and not superseded and not retracted');
  v_def := replace(v_def, a3, b3);
  v_def := replace(v_def, a4, 'into v_no_ev, v_unknown, v_total, v_dedup, v_super, v_retr;');
  v_def := replace(v_def, a5, a5 || E'\n          ''adjudicated_retraction_excluded'', v_retr,');
  v_def := replace(v_def, a6, a6 || E'\n  v_retr      bigint;');
  execute v_def;
end
$anchor$;
