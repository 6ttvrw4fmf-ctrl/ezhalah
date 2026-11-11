-- PRICE DIARY fix (2026-11-11): an UPDATE on an ad with no comparables card yet opened the card from the NEW
-- row, so the card's first price was the price AFTER the change (caught by the rolled-back production test of the
-- price_diary_and_comparables_cards migration: first=220001 after a 220000 → 220001 change). The card is now opened from the OLD row first.

create or replace function public.tg_listing_price_diary()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_changed boolean := false;
  v_id bigint;
begin
  begin
    if TG_OP = 'INSERT' then
      v_id := new.id;
      insert into public.listing_price_history (source_table, listing_id, event, price_total, price_annual)
      values (TG_TABLE_NAME, new.id, 'first', new.price_total, new.price_annual);
      perform public.listing_card_upsert(TG_TABLE_NAME, to_jsonb(new),
        case when new.active is false then coalesce(new.deactivated_at, now()) end, null, false);
    elsif TG_OP = 'UPDATE' then
      v_id := new.id;
      -- An ad with no card yet (before the backfill reached it): open the card from the OLD row first, so its
      -- first price is the price before this change, not after it.
      if not exists (select 1 from public.listing_comparables c
                      where c.source_table = TG_TABLE_NAME and c.listing_id = new.id) then
        perform public.listing_card_upsert(TG_TABLE_NAME, to_jsonb(old),
          case when old.active is not true then coalesce(old.deactivated_at, now()) end, null, false);
      end if;
      if old.price_total is distinct from new.price_total or old.price_annual is distinct from new.price_annual then
        v_changed := true;
        insert into public.listing_price_history
          (source_table, listing_id, event, price_total, price_annual, old_price_total, old_price_annual)
        values (TG_TABLE_NAME, new.id, 'price', new.price_total, new.price_annual, old.price_total, old.price_annual);
      end if;
      if old.active is distinct from new.active then
        insert into public.listing_price_history (source_table, listing_id, event, price_total, price_annual)
        values (TG_TABLE_NAME, new.id, case when new.active is true then 'back' else 'gone' end,
                new.price_total, new.price_annual);
      end if;
      perform public.listing_card_upsert(TG_TABLE_NAME, to_jsonb(new),
        case when new.active is not true then coalesce(new.deactivated_at, now()) end, null, v_changed);
    elsif TG_OP = 'DELETE' then
      v_id := old.id;
      insert into public.listing_price_history (source_table, listing_id, event, price_total, price_annual)
      values (TG_TABLE_NAME, old.id, 'removed', old.price_total, old.price_annual);
      perform public.listing_card_upsert(TG_TABLE_NAME, to_jsonb(old),
        coalesce(old.deactivated_at, now()), now(), false);
    end if;
  exception when others then
    -- The diary must never break a scraper write or a retention delete.
    begin
      insert into public.listing_price_diary_errors (source_table, listing_id, op, err)
      values (TG_TABLE_NAME, v_id, TG_OP, sqlerrm);
    exception when others then null;
    end;
  end;
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end
$$;