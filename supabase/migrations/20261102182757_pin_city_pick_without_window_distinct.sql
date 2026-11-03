-- refresh_pin_city_correction: «count(distinct …) over (…)» is not implemented in Postgres; count the candidate
-- cities per ad with a GROUP BY instead. Same rule: exactly one named city in the pin's governorate, or exactly one
-- of them is that governorate's seat. Patched on the live definition so nothing else in it is retyped.
do $mig$
declare
  d text := pg_get_functiondef('public.refresh_pin_city_correction(boolean)'::regprocedure);
  old_txt constant text := $o$    from (select k.*, count(distinct k.city_id) over (partition by k.source_table, k.listing_id) n_city,
                 count(*) filter (where k.basis = 'seat') over (partition by k.source_table, k.listing_id) n_seat
            from _cand k) z
   where n_city = 1 or (n_seat = 1 and basis = 'seat')$o$;
  new_txt constant text := $n$    from (select k.*, a.n_city, a.n_seat
            from _cand k
            join (select source_table, listing_id, count(distinct city_id) n_city,
                         count(distinct city_id) filter (where basis = 'seat') n_seat
                    from _cand group by 1, 2) a using (source_table, listing_id)) z
   where n_city = 1 or (n_seat = 1 and basis = 'seat')$n$;
begin
  if position(old_txt in d) = 0 then raise exception 'refresh_pin_city_correction: pick clause not found'; end if;
  execute replace(d, old_txt, new_txt);
  if position('count(distinct k.city_id) over' in pg_get_functiondef('public.refresh_pin_city_correction(boolean)'::regprocedure)) > 0 then
    raise exception 'refresh_pin_city_correction: patch did not land';
  end if;
end
$mig$;
