-- Re-apply repair 20261025153723 to the rows a crawl on a pre-PR-8686 commit turned back to yes after it ran: the
-- small-sources sync dispatched on 197d3728 (dwelleo job 14:49–16:14 UTC) and the 15:05 haraj sync on 2d5b4851 still read
-- «مطبخ غير راكب» / «مصعد داخلي غير راكب» with the old reader. Every crawl from b33778a0 on reads them as unknown, and the
-- upsert never writes a plain None, so once cleared they stay cleared. Same rows, same values, same md5 discipline;
-- watched by mon_detect_not_installed_served_as_yes.
--   dwelleo_residential_listings         elevator          true -> null    1
--   dwelleo_residential_listings         kitchen           true -> null    8
--   haraj_residential_listings           kitchen           true -> null    1

do $r$
declare k int; done int := 0;
  g0 bigint[] := '{15771579}';
  g1 bigint[] := '{13129579,13130133,13130141,13134769,13134771,13135184,13929065,15383189}';
  g2 bigint[] := '{20481193}';
begin
  if md5(array_to_string(g0, ',')) <> '589a0461a402fee74e177ce7827d0db5' then raise exception 'id list g0 does not match the re-read'; end if;
  update public.dwelleo_residential_listings set elevator = null where elevator is not distinct from true and id = any(g0);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'dwelleo_residential_listings elevator true->null: % rows, measured 1', k; end if;
  if md5(array_to_string(g1, ',')) <> 'f1bd004124259c60086658b90f653851' then raise exception 'id list g1 does not match the re-read'; end if;
  update public.dwelleo_residential_listings set kitchen = null where kitchen is not distinct from true and id = any(g1);
  get diagnostics k = row_count; done := done + k;
  if k > 8 then raise exception 'dwelleo_residential_listings kitchen true->null: % rows, measured 8', k; end if;
  if md5(array_to_string(g2, ',')) <> 'b8288f051119848cad3123c97dc2d408' then raise exception 'id list g2 does not match the re-read'; end if;
  update public.haraj_residential_listings set kitchen = null where kitchen is not distinct from true and id = any(g2);
  get diagnostics k = row_count; done := done + k;
  if k > 1 then raise exception 'haraj_residential_listings kitchen true->null: % rows, measured 1', k; end if;
  raise notice 'not installed, re-applied: % rows changed of 10 measured', done;
end $r$;

-- Clean on the repaired data.
do $c$
declare k int;
begin
  perform public.mon_detect_not_installed_served_as_yes();
  select count(*) into k from public.alert_event where kind = 'not_installed_served_as_yes' and resolved_at is null;
  if k <> 0 then raise exception 'detector reports % open alert(s) after the re-apply', k; end if;
end $c$;
