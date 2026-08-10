-- Range guard on every count field feeding the rich layer.
--
-- The first rich sync aborted on `value "581633381" is out of range for smallint`.
-- aqar's `halls` alone holds 33 implausible values out of 37,036 (max 30,500) - the
-- prose parser occasionally grabs an ID or a price fragment instead of a room count.
--
-- Barrier rule: "parser uncertainty -> NULL for that field, not the whole listing."
-- So rather than chase individual bad rows, EVERY count cast is bounded. A room /
-- parking / floor / frontage count outside 0..99 is not a number we can defend, so
-- it becomes NULL. This also makes the sync crash-proof: one bad value can no longer
-- abort a 12,000-row batch.
create or replace function public.sane_count(v anyelement, hi integer default 99)
returns smallint language sql immutable as $$
  select case when v is null then null
              when v::numeric >= 0 and v::numeric <= hi then v::numeric::smallint end;
$$;

comment on function public.sane_count(anyelement, integer) is
  'Bounded count cast for the rich attribute layer. Out-of-range => NULL (parser uncertainty), never a clamped guess and never an aborted batch.';
