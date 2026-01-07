-- Agregar columnas para rastrear qué columna de precio se usó
ALTER TABLE delivery_note_items 
  ADD COLUMN IF NOT EXISTS product_list_id uuid NULL,
  ADD COLUMN IF NOT EXISTS price_column_key_used text NULL;

-- Backfill de datos existentes (best-effort)
UPDATE delivery_note_items dni
SET 
  product_list_id = dp.list_id,
  price_column_key_used = COALESCE(
    pl.mapping_config->>'delivery_note_price_column',
    pl.mapping_config->>'price_primary_key',
    'price'
  )
FROM dynamic_products dp
JOIN product_lists pl ON pl.id = dp.list_id
WHERE dni.product_id = dp.id
  AND dni.product_list_id IS NULL;