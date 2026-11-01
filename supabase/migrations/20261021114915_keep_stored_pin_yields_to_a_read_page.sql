-- keep_stored_pin yields to a page that was READ and had no pin (mapping audit 2026-10-21).
--
-- The trigger (owner 2026-10-19: «a failed goo.gl hop must not erase a stored pin») re-adds the old pair to any
-- write without one. That also kept the WRONG pins abralosol stored before its article-only fix (PR #7920): after
-- the 04:12 UTC re-crawl, 92 «الراشدية» ads still carried 25.454170764324,49.58200356526 — the first related-ads
-- row's link, outside every one of their own articles. The scraper now writes `pin_absent: true` exactly when it
-- read the ad's own article and found no pin. A write that says so clears the pin; a write that does not (a
-- failed fetch, a failed short-link hop) still keeps it, as the owner asked.
create or replace function public.tg_keep_stored_pin() returns trigger
language plpgsql as $$
begin
  if (new.additional_info ->> 'latitude') is null
     and coalesce((new.additional_info ->> 'pin_absent')::boolean, false) is false
     and (old.additional_info ->> 'latitude') is not null
     and (old.additional_info ->> 'longitude') is not null then
    new.additional_info := coalesce(new.additional_info, '{}'::jsonb)
      || jsonb_build_object('latitude',  (old.additional_info -> 'latitude'),
                            'longitude', (old.additional_info -> 'longitude'));
  end if;
  return new;
end $$;
comment on function public.tg_keep_stored_pin() is
  'BEFORE UPDATE: a write with no latitude/longitude keeps the stored pair (owner 2026-10-19: a failed goo.gl hop must not erase a stored pin) — unless it carries pin_absent = true, i.e. the ad''s own page was read and shows no pin (mapping audit 2026-10-21).';
