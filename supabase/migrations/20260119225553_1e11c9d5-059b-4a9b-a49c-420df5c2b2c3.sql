-- Migration: bulk_ops_rpc + delivery_note_adjustments

-- 1. Add adjustment fields to delivery notes/items (if not exists)
ALTER TABLE public.delivery_notes
  ADD COLUMN IF NOT EXISTS global_adjustment_pct numeric DEFAULT 0;

ALTER TABLE public.delivery_note_items
  ADD COLUMN IF NOT EXISTS adjustment_pct numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_price_base numeric;

UPDATE public.delivery_note_items
SET unit_price_base = unit_price
WHERE unit_price_base IS NULL;

-- 2. Bulk RPCs for optimized product operations

CREATE OR REPLACE FUNCTION public.bulk_convert_usd_ars(
  p_list_id uuid,
  p_product_ids uuid[] DEFAULT NULL,
  p_target_keys text[] DEFAULT NULL,
  p_primary_key text DEFAULT NULL,
  p_delivery_note_price_key text DEFAULT NULL,
  p_dollar_type text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_now timestamptz := now();
  v_dollar_rate numeric;
  v_dollar_type text;
  v_dollar_key text;
  v_target_keys text[];
  v_primary_key text;
  v_use_all boolean;
  v_processed integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_row record;
  v_calc jsonb;
  v_patch jsonb;
  v_meta jsonb;
  v_next_calc jsonb;
  v_keys_converted integer;
  v_base numeric;
  v_converted numeric;
  v_next_primary numeric;
  v_remito_price numeric;
  v_key text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  v_dollar_type := CASE WHEN p_dollar_type = 'blue' THEN 'blue' ELSE 'official' END;
  v_dollar_key := CASE WHEN v_dollar_type = 'blue' THEN 'dollar_blue' ELSE 'dollar_official' END;

  SELECT (value->>'rate')::numeric
  INTO v_dollar_rate
  FROM public.settings
  WHERE key = v_dollar_key;

  IF v_dollar_rate IS NULL OR v_dollar_rate <= 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'processed', 0,
      'updated', 0,
      'skipped', 0,
      'dollar_rate', 0,
      'dollar_type', v_dollar_type,
      'target_keys', COALESCE(p_target_keys, ARRAY[]::text[])
    );
  END IF;

  v_target_keys := COALESCE(p_target_keys, ARRAY[]::text[]);
  IF array_length(v_target_keys, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'processed', 0,
      'updated', 0,
      'skipped', 0,
      'dollar_rate', v_dollar_rate,
      'dollar_type', v_dollar_type,
      'target_keys', v_target_keys
    );
  END IF;

  v_primary_key := COALESCE(p_primary_key, 'price');
  v_use_all := p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL;

  FOR v_row IN
    SELECT dpi.product_id, dpi.calculated_data, dpi.price, dp.data
    FROM dynamic_products_index dpi
    JOIN dynamic_products dp ON dp.id = dpi.product_id
    WHERE dpi.list_id = p_list_id
      AND dpi.user_id = v_user_id
      AND (v_use_all OR dpi.product_id = ANY(p_product_ids))
  LOOP
    v_processed := v_processed + 1;
    v_calc := COALESCE(v_row.calculated_data, '{}'::jsonb);
    v_patch := '{}'::jsonb;
    v_meta := '{}'::jsonb;
    v_keys_converted := 0;
    v_next_primary := NULL;

    FOREACH v_key IN ARRAY v_target_keys
    LOOP
      IF v_key = v_primary_key THEN
        IF v_calc ? '__fx_usd_ars__orig__price' THEN
          CONTINUE;
        END IF;

        v_base := v_row.price;
        IF v_base IS NULL THEN
          v_base := parse_price_string(v_row.data->>v_primary_key);
        END IF;
        IF v_base IS NULL THEN
          CONTINUE;
        END IF;

        v_converted := ROUND(v_base * v_dollar_rate, 2);
        v_next_primary := v_converted;
        v_meta := v_meta || jsonb_build_object('__fx_usd_ars__orig__price', v_base);
        v_keys_converted := v_keys_converted + 1;
      ELSE
        IF v_calc ? ('__fx_usd_ars__orig__' || v_key) THEN
          CONTINUE;
        END IF;

        IF v_calc ? v_key THEN
          v_base := parse_price_string(v_calc->>v_key);
        ELSE
          v_base := parse_price_string(v_row.data->>v_key);
        END IF;
        IF v_base IS NULL THEN
          CONTINUE;
        END IF;

        v_converted := ROUND(v_base * v_dollar_rate, 2);
        v_patch := v_patch || jsonb_build_object(v_key, v_converted);
        v_meta := v_meta || jsonb_build_object('__fx_usd_ars__orig__' || v_key, v_base);
        v_keys_converted := v_keys_converted + 1;
      END IF;
    END LOOP;

    IF v_keys_converted = 0 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_meta := v_meta || jsonb_build_object('__fx_usd_ars__at', v_now, '__fx_usd_ars__rate', v_dollar_rate);
    v_next_calc := v_calc || v_patch || v_meta;

    UPDATE dynamic_products_index
    SET calculated_data = v_next_calc,
        price = COALESCE(v_next_primary, price),
        updated_at = v_now
    WHERE product_id = v_row.product_id
      AND user_id = v_user_id;

    IF v_next_primary IS NOT NULL THEN
      UPDATE dynamic_products
      SET price = v_next_primary,
          updated_at = v_now
      WHERE id = v_row.product_id
        AND user_id = v_user_id;

      UPDATE my_stock_products
      SET price = v_next_primary,
          updated_at = v_now
      WHERE product_id = v_row.product_id
        AND user_id = v_user_id;
    END IF;

    v_remito_price := NULL;
    IF p_delivery_note_price_key IS NOT NULL THEN
      IF p_delivery_note_price_key = v_primary_key THEN
        v_remito_price := v_next_primary;
      ELSE
        v_remito_price := NULLIF(v_patch->>p_delivery_note_price_key, '')::numeric;
      END IF;
    ELSE
      v_remito_price := v_next_primary;
    END IF;

    IF v_remito_price IS NOT NULL THEN
      UPDATE delivery_note_items
      SET unit_price = v_remito_price
      WHERE product_id = v_row.product_id
        AND EXISTS (
          SELECT 1 FROM delivery_notes dn
          WHERE dn.id = delivery_note_items.delivery_note_id
            AND dn.user_id = v_user_id
        );
    END IF;

    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'processed', v_processed,
    'updated', v_updated,
    'skipped', v_skipped,
    'dollar_rate', v_dollar_rate,
    'dollar_type', v_dollar_type,
    'target_keys', v_target_keys
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_revert_usd_ars(
  p_list_id uuid,
  p_product_ids uuid[] DEFAULT NULL,
  p_target_keys text[] DEFAULT NULL,
  p_primary_key text DEFAULT NULL,
  p_delivery_note_price_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_now timestamptz := now();
  v_target_keys text[];
  v_primary_key text;
  v_use_targets boolean;
  v_use_all boolean;
  v_processed integer := 0;
  v_reverted integer := 0;
  v_skipped integer := 0;
  v_row record;
  v_calc jsonb;
  v_next_calc jsonb;
  v_restored_patch jsonb;
  v_restored_primary numeric;
  v_reverted_any boolean;
  v_orig_key text;
  v_original_key text;
  v_orig_val numeric;
  v_has_orig boolean;
  v_remito_price numeric;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  v_target_keys := COALESCE(p_target_keys, ARRAY[]::text[]);
  v_use_targets := array_length(v_target_keys, 1) IS NOT NULL;
  v_primary_key := COALESCE(p_primary_key, 'price');
  v_use_all := p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL;

  FOR v_row IN
    SELECT dpi.product_id, dpi.calculated_data
    FROM dynamic_products_index dpi
    WHERE dpi.list_id = p_list_id
      AND dpi.user_id = v_user_id
      AND (v_use_all OR dpi.product_id = ANY(p_product_ids))
  LOOP
    v_processed := v_processed + 1;
    v_calc := COALESCE(v_row.calculated_data, '{}'::jsonb);
    v_next_calc := v_calc;
    v_restored_patch := '{}'::jsonb;
    v_restored_primary := NULL;
    v_reverted_any := false;

    IF (NOT v_use_targets OR v_primary_key = ANY(v_target_keys))
      AND (v_calc ? '__fx_usd_ars__orig__price') THEN
      v_restored_primary := parse_price_string(v_calc->>'__fx_usd_ars__orig__price');
      v_next_calc := v_next_calc - '__fx_usd_ars__orig__price';
      v_reverted_any := true;
    END IF;

    FOR v_orig_key IN
      SELECT key FROM jsonb_object_keys(v_calc) AS key
      WHERE key LIKE '__fx_usd_ars__orig__%'
    LOOP
      IF v_orig_key = '__fx_usd_ars__orig__price' THEN
        CONTINUE;
      END IF;

      v_original_key := replace(v_orig_key, '__fx_usd_ars__orig__', '');
      IF v_use_targets AND NOT (v_original_key = ANY(v_target_keys)) THEN
        CONTINUE;
      END IF;

      v_orig_val := parse_price_string(v_calc->>v_orig_key);
      IF v_orig_val IS NOT NULL THEN
        v_restored_patch := v_restored_patch || jsonb_build_object(v_original_key, v_orig_val);
      END IF;
      v_next_calc := v_next_calc - v_orig_key;
      v_reverted_any := true;
    END LOOP;

    IF NOT v_reverted_any THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_next_calc := v_next_calc || v_restored_patch;

    SELECT EXISTS (
      SELECT 1 FROM jsonb_object_keys(v_next_calc) AS k
      WHERE k LIKE '__fx_usd_ars__orig__%'
    ) INTO v_has_orig;

    IF NOT v_has_orig THEN
      v_next_calc := v_next_calc - '__fx_usd_ars__at';
      v_next_calc := v_next_calc - '__fx_usd_ars__rate';
    END IF;

    UPDATE dynamic_products_index
    SET calculated_data = v_next_calc,
        price = COALESCE(v_restored_primary, price),
        updated_at = v_now
    WHERE product_id = v_row.product_id
      AND user_id = v_user_id;

    IF v_restored_primary IS NOT NULL THEN
      UPDATE dynamic_products
      SET price = v_restored_primary,
          updated_at = v_now
      WHERE id = v_row.product_id
        AND user_id = v_user_id;

      UPDATE my_stock_products
      SET price = v_restored_primary,
          updated_at = v_now
      WHERE product_id = v_row.product_id
        AND user_id = v_user_id;
    END IF;

    v_remito_price := NULL;
    IF p_delivery_note_price_key IS NOT NULL THEN
      IF p_delivery_note_price_key = v_primary_key THEN
        v_remito_price := v_restored_primary;
      ELSE
        v_remito_price := NULLIF(v_restored_patch->>p_delivery_note_price_key, '')::numeric;
      END IF;
    ELSE
      v_remito_price := v_restored_primary;
    END IF;

    IF v_remito_price IS NOT NULL THEN
      UPDATE delivery_note_items
      SET unit_price = v_remito_price
      WHERE product_id = v_row.product_id
        AND EXISTS (
          SELECT 1 FROM delivery_notes dn
          WHERE dn.id = delivery_note_items.delivery_note_id
            AND dn.user_id = v_user_id
        );
    END IF;

    v_reverted := v_reverted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'processed', v_processed,
    'reverted', v_reverted,
    'skipped', v_skipped
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_add_to_my_stock(
  p_product_ids uuid[],
  p_quantity integer DEFAULT 1,
  p_stock_threshold integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_now timestamptz := now();
  v_ids uuid[];
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  v_ids := ARRAY(SELECT DISTINCT unnest(p_product_ids));
  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', true, 'processed', 0);
  END IF;

  INSERT INTO my_stock_products (user_id, product_id, quantity, stock_threshold, created_at, updated_at)
  SELECT v_user_id, product_id, p_quantity, p_stock_threshold, v_now, v_now
  FROM unnest(v_ids) AS product_id
  ON CONFLICT (user_id, product_id) DO UPDATE
  SET quantity = my_stock_products.quantity + EXCLUDED.quantity,
      updated_at = v_now;

  UPDATE dynamic_products_index dpi
  SET quantity = m.quantity::integer,
      in_my_stock = CASE WHEN m.quantity > 0 THEN true ELSE dpi.in_my_stock END,
      updated_at = v_now
  FROM my_stock_products m
  WHERE m.user_id = v_user_id
    AND m.product_id = dpi.product_id
    AND dpi.user_id = v_user_id
    AND m.product_id = ANY(v_ids);

  UPDATE dynamic_products dp
  SET quantity = m.quantity::integer,
      updated_at = v_now
  FROM my_stock_products m
  WHERE m.user_id = v_user_id
    AND m.product_id = dp.id
    AND dp.user_id = v_user_id
    AND m.product_id = ANY(v_ids);

  RETURN jsonb_build_object('success', true, 'processed', array_length(v_ids, 1));
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_remove_from_my_stock(
  p_product_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_now timestamptz := now();
  v_ids uuid[];
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  v_ids := ARRAY(SELECT DISTINCT unnest(p_product_ids));
  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', true, 'processed', 0);
  END IF;

  DELETE FROM my_stock_products
  WHERE user_id = v_user_id
    AND product_id = ANY(v_ids);

  UPDATE dynamic_products_index
  SET quantity = 0,
      in_my_stock = false,
      updated_at = v_now
  WHERE user_id = v_user_id
    AND product_id = ANY(v_ids);

  UPDATE dynamic_products
  SET quantity = 0,
      updated_at = v_now
  WHERE user_id = v_user_id
    AND id = ANY(v_ids);

  RETURN jsonb_build_object('success', true, 'processed', array_length(v_ids, 1));
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_delete_products(
  p_product_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_now timestamptz := now();
  v_ids uuid[];
  v_list_ids uuid[];
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  v_ids := ARRAY(SELECT DISTINCT unnest(p_product_ids));
  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', true, 'deleted', 0);
  END IF;

  SELECT array_agg(DISTINCT list_id)
  INTO v_list_ids
  FROM dynamic_products
  WHERE user_id = v_user_id
    AND id = ANY(v_ids);

  DELETE FROM request_items
  WHERE user_id = v_user_id
    AND product_id = ANY(v_ids);

  DELETE FROM my_stock_products
  WHERE user_id = v_user_id
    AND product_id = ANY(v_ids);

  DELETE FROM dynamic_products_index
  WHERE user_id = v_user_id
    AND product_id = ANY(v_ids);

  DELETE FROM dynamic_products
  WHERE user_id = v_user_id
    AND id = ANY(v_ids);

  IF v_list_ids IS NOT NULL AND array_length(v_list_ids, 1) IS NOT NULL THEN
    WITH target_lists AS (
      SELECT unnest(v_list_ids) AS list_id
    ),
    counts AS (
      SELECT list_id, COUNT(*) AS cnt
      FROM dynamic_products_index
      WHERE list_id = ANY(v_list_ids)
      GROUP BY list_id
    )
    UPDATE product_lists pl
    SET product_count = COALESCE(counts.cnt, 0),
        updated_at = v_now
    FROM target_lists
    LEFT JOIN counts ON counts.list_id = target_lists.list_id
    WHERE pl.user_id = v_user_id
      AND pl.id = target_lists.list_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'deleted', array_length(v_ids, 1));
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;