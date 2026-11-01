-- jurash: kitchen / maid / driver room from each ad's own words, and an empty garage field is silence (🔬 AF engineer, 2026-10-14).
-- jurash has no structured field for kitchen, maid room or driver room, so the ad's «مكونات العقار» prose is the statement
-- (yes or nothing). The scraper never read it: 0 of 4 findable on 10-14, kitchen missed 3 of 5. Values below are
-- scrapers/jurash/run.py prose_answers() run over each row's stored description on 10-14. Written only where NULL, true only.
-- Its one structured parking field, pt_garages, was read as bool(...), so 5 active land ads with no garage field stored
-- parking = false, a «no» the page never printed; those rows carry no parking_note and go back to NULL (silence).
do $b$
declare n int; total int := 0;
begin
  update public.jurash_residential_listings set kitchen = true
   where kitchen is null and active and id = any(array[645410,645415,866749,15321317]::bigint[]) and description like '%مطبخ%';
  get diagnostics n = row_count; total := total + n;
  update public.jurash_residential_listings set maid_room = true
   where maid_room is null and active and id = any(array[645408,645415]::bigint[]) and description like '%غرفة خادمة%';
  get diagnostics n = row_count; total := total + n;
  update public.jurash_residential_listings set driver_room = true
   where driver_room is null and active and id = 645408 and description like '%غرفة سائق%';
  get diagnostics n = row_count; total := total + n;
  update public.jurash_residential_listings set parking = null
   where parking = false and not (additional_info ? 'parking_note')
     and id = any(array[645409,10030037,11236926,11312782,15706513]::bigint[]);
  get diagnostics n = row_count; total := total + n;
  raise notice 'jurash answers: % values written', total;
  if total <> 12 then raise exception 'jurash repair out of range: % of 12', total; end if;
end $b$;
