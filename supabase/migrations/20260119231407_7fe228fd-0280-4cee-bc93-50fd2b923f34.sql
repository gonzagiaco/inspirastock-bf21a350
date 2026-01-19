-- Function to reconvert already-converted products when dollar type changes
CREATE OR REPLACE FUNCTION public.bulk_reconvert_usd_ars(
  p_dollar_type text DEFAULT 'official'
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
  v_processed integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_row record;
  v_calc jsonb;
  v_next_calc jsonb;
  v_orig_key text;
  v_original_key text;
  v_orig_val numeric;
  v_converted numeric;
  v_next_primary numeric;
  v_old_rate numeric;
  v_has_conversion boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  -- Normalize dollar type
  v_dollar_type := CASE WHEN p_dollar_type = 'blue' THEN 'blue' ELSE 'official' END;
  v_dollar_key := CASE WHEN v_dollar_type = 'blue' THEN 'dollar_blue' ELSE 'dollar_official' END;

  -- Get current rate for the selected dollar type
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
      'message', 'No dollar rate available'
    );
  END IF;

  -- Find all products with existing USD-ARS conversions
  FOR v_row IN
    SELECT dpi.product_id, dpi.calculated_data, dpi.price, dpi.list_id, dp.data
    FROM dynamic_products_index dpi
    JOIN dynamic_products dp ON dp.id = dpi.product_id
    WHERE dpi.user_id = v_user_id
      AND dpi.calculated_data::text LIKE '%__fx_usd_ars__orig__%'
  LOOP
    v_processed := v_processed + 1;
    v_calc := COALESCE(v_row.calculated_data, '{}'::jsonb);
    v_next_calc := v_calc;
    v_next_primary := NULL;
    v_has_conversion := false;

    -- Get old rate to check if reconversion is needed
    v_old_rate := parse_price_string(v_calc->>'__fx_usd_ars__rate');
    
    -- Skip if rate is the same (within tolerance)
    IF v_old_rate IS NOT NULL AND ABS(v_old_rate - v_dollar_rate) < 0.01 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Process primary price (price column)
    IF v_calc ? '__fx_usd_ars__orig__price' THEN
      v_orig_val := parse_price_string(v_calc->>'__fx_usd_ars__orig__price');
      IF v_orig_val IS NOT NULL THEN
        v_converted := ROUND(v_orig_val * v_dollar_rate, 2);
        v_next_primary := v_converted;
        v_has_conversion := true;
      END IF;
    END IF;

    -- Process all other converted columns
    FOR v_orig_key IN
      SELECT key FROM jsonb_object_keys(v_calc) AS key
      WHERE key LIKE '__fx_usd_ars__orig__%'
        AND key <> '__fx_usd_ars__orig__price'
    LOOP
      v_original_key := replace(v_orig_key, '__fx_usd_ars__orig__', '');
      v_orig_val := parse_price_string(v_calc->>v_orig_key);
      
      IF v_orig_val IS NOT NULL THEN
        v_converted := ROUND(v_orig_val * v_dollar_rate, 2);
        v_next_calc := v_next_calc || jsonb_build_object(v_original_key, v_converted);
        v_has_conversion := true;
      END IF;
    END LOOP;

    IF NOT v_has_conversion THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Update metadata with new rate
    v_next_calc := v_next_calc || jsonb_build_object(
      '__fx_usd_ars__at', v_now,
      '__fx_usd_ars__rate', v_dollar_rate
    );

    -- Update index
    UPDATE dynamic_products_index
    SET calculated_data = v_next_calc,
        price = COALESCE(v_next_primary, price),
        updated_at = v_now
    WHERE product_id = v_row.product_id
      AND user_id = v_user_id;

    -- Update dynamic_products if primary price changed
    IF v_next_primary IS NOT NULL THEN
      UPDATE dynamic_products
      SET price = v_next_primary,
          updated_at = v_now
      WHERE id = v_row.product_id
        AND user_id = v_user_id;

      -- Update my_stock_products
      UPDATE my_stock_products
      SET price = v_next_primary,
          updated_at = v_now
      WHERE product_id = v_row.product_id
        AND user_id = v_user_id;
    END IF;

    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'processed', v_processed,
    'updated', v_updated,
    'skipped', v_skipped,
    'dollar_rate', v_dollar_rate,
    'dollar_type', v_dollar_type
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;