-- Add adjustment fields to delivery notes/items
alter table public.delivery_notes
  add column if not exists global_adjustment_pct numeric default 0;

alter table public.delivery_note_items
  add column if not exists adjustment_pct numeric default 0,
  add column if not exists unit_price_base numeric;

update public.delivery_note_items
set unit_price_base = unit_price
where unit_price_base is null;
