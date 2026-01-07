-- Crear función helper para re-aplicar conversión FX preservada
CREATE OR REPLACE FUNCTION public.apply_preserved_fx_conversion(
  p_new_calc jsonb,
  p_fx_meta jsonb,
  p_mapping jsonb
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rate numeric;
  v_result jsonb := COALESCE(p_new_calc, '{}'::jsonb);
  v_orig_key text;
  v_target_key text;
  v_orig_value numeric;
  v_converted numeric;
BEGIN
  -- Si no hay metadatos FX, devolver calculated_data sin cambios
  IF p_fx_meta IS NULL OR p_fx_meta = '{}'::jsonb THEN
    RETURN v_result;
  END IF;

  -- Obtener el rate usado en la conversión original
  v_rate := (p_fx_meta->>'__fx_usd_ars__rate')::numeric;
  IF v_rate IS NULL OR v_rate <= 0 THEN
    RETURN v_result;
  END IF;

  -- Copiar metadatos FX al resultado
  v_result := v_result || jsonb_build_object(
    '__fx_usd_ars__at', p_fx_meta->>'__fx_usd_ars__at',
    '__fx_usd_ars__rate', v_rate
  );

  -- Iterar sobre cada __fx_usd_ars__orig__* y re-aplicar conversión
  FOR v_orig_key, v_orig_value IN 
    SELECT k, (v)::numeric 
    FROM jsonb_each_text(p_fx_meta) AS kv(k, v)
    WHERE k LIKE '__fx_usd_ars__orig__%'
      AND v ~ '^-?[0-9]+\.?[0-9]*$'
  LOOP
    -- Extraer nombre de columna target (ej: "__fx_usd_ars__orig__COSTO" -> "COSTO")
    v_target_key := REPLACE(v_orig_key, '__fx_usd_ars__orig__', '');
    
    -- Re-aplicar conversión: original * rate
    v_converted := ROUND(v_orig_value * v_rate, 2);
    
    -- Actualizar calculated_data con valor convertido (excepto 'price' que va aparte)
    IF v_target_key != 'price' THEN
      v_result := jsonb_set(v_result, ARRAY[v_target_key], to_jsonb(v_converted));
    END IF;
    
    -- Preservar el valor original
    v_result := jsonb_set(v_result, ARRAY[v_orig_key], to_jsonb(v_orig_value));
  END LOOP;

  RETURN v_result;
END;
$$;

-- Actualizar refresh_list_index para preservar y re-aplicar conversiones FX
CREATE OR REPLACE FUNCTION public.refresh_list_index(p_list_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mapping jsonb;
  v_user_id uuid;
  v_dollar_rate numeric;
  v_dollar_columns jsonb;
  v_global_dollar_rate numeric;
  v_custom_columns jsonb;
begin
  -- Obtener mapping_config y user_id de la lista
  select mapping_config, user_id 
  into v_mapping, v_user_id
  from product_lists 
  where id = p_list_id;

  if v_mapping is null then
    raise notice 'Lista % no tiene mapping_config configurado', p_list_id;
    return;
  end if;

  -- Obtener rate GLOBAL desde settings
  select (value->>'rate')::numeric 
  into v_global_dollar_rate
  from public.settings 
  where key = 'dollar_official';

  -- Usar rate global, con fallback a mapping_config por compatibilidad
  v_dollar_rate := coalesce(
    v_global_dollar_rate,
    (v_mapping->'dollar_conversion'->>'rate')::numeric,
    0
  );

  -- Columnas donde aplicar conversión (desde mapping_config)
  v_dollar_columns := coalesce(v_mapping->'dollar_conversion'->'target_columns', '[]'::jsonb);
  
  -- Columnas personalizadas
  v_custom_columns := coalesce(v_mapping->'custom_columns', '{}'::jsonb);

  -- PASO 1: Guardar datos del usuario (quantity, in_my_stock, stock_threshold) Y metadatos FX
  create temp table if not exists temp_preserved (
    product_id uuid primary key,
    quantity integer,
    in_my_stock boolean,
    stock_threshold integer,
    fx_metadata jsonb
  ) on commit drop;
  
  truncate temp_preserved;
  
  insert into temp_preserved (product_id, quantity, in_my_stock, stock_threshold, fx_metadata)
  select 
    product_id, 
    quantity, 
    in_my_stock, 
    stock_threshold,
    -- Extraer solo los campos __fx_usd_ars__* de calculated_data
    (
      select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
      from jsonb_each(calculated_data) as kv(k, v)
      where k like '__fx_usd_ars__%'
    ) as fx_metadata
  from dynamic_products_index 
  where list_id = p_list_id;

  -- PASO 2: Eliminar índices existentes
  delete from dynamic_products_index 
  where list_id = p_list_id;

  -- PASO 3: Insertar nuevos índices con datos actualizados (sin conversión FX, será re-aplicada después)
  insert into dynamic_products_index (
    user_id,
    list_id,
    product_id,
    code,
    name,
    price,
    quantity,
    search_vector,
    calculated_data,
    in_my_stock,
    stock_threshold
  )
  select 
    dp.user_id,
    dp.list_id,
    dp.id,
    -- CODE
    coalesce(
      (select (dp.data->>key)::text 
       from jsonb_array_elements_text(v_mapping->'code_keys') as key
       where dp.data->>key is not null 
       limit 1),
      dp.code
    ) as code,
    -- NAME
    coalesce(
      (select (dp.data->>key)::text 
       from jsonb_array_elements_text(v_mapping->'name_keys') as key
       where dp.data->>key is not null 
       limit 1),
      dp.name
    ) as name,
    -- PRICE: Valor base sin conversión FX (será re-aplicada después)
    calculate_price_with_modifiers(
      case 
        when v_mapping->>'price_primary_key' is not null 
        then dp.data->>((v_mapping->>'price_primary_key')::text)
        else coalesce(dp.price::text, '0')
      end,
      coalesce((v_mapping->'price_modifiers'->'general'->>'percentage')::numeric, 0),
      coalesce((v_mapping->'price_modifiers'->'general'->>'add_vat')::boolean, false),
      coalesce((v_mapping->'price_modifiers'->'general'->>'vat_rate')::numeric, 21)
    ) as price,
    -- QUANTITY (temporal, del archivo - se sobrescribirá con valor preservado)
    case 
      when v_mapping->>'quantity_key' is not null 
      then (dp.data->>((v_mapping->>'quantity_key')::text))::integer
      else dp.quantity
    end as quantity,
    -- Search vector
    to_tsvector('spanish', 
      coalesce(
        (select string_agg(dp.data->>key, ' ')
         from jsonb_array_elements_text(
           coalesce(v_mapping->'code_keys', '[]'::jsonb) || 
           coalesce(v_mapping->'name_keys', '[]'::jsonb) || 
           coalesce(v_mapping->'extra_index_keys', '[]'::jsonb)
         ) as key
         where dp.data->>key is not null),
        ''
      ) || ' ' ||
      coalesce(dp.code, '') || ' ' ||
      coalesce(dp.name, '')
    ) as search_vector,
    -- Calculated data: overrides y custom columns (sin FX, será re-aplicada después)
    (
      select coalesce(
        jsonb_object_agg(col_key, col_value) FILTER (WHERE col_value IS NOT NULL),
        '{}'::jsonb
      )
      from (
        -- Override columns (sin conversión dólar automática)
        select col_key,
          case 
            when v_mapping->'price_modifiers'->'overrides' ? col_key then
              calculate_price_with_modifiers(
                dp.data->>col_key,
                coalesce((v_mapping->'price_modifiers'->'overrides'->col_key->>'percentage')::numeric, 0),
                coalesce((v_mapping->'price_modifiers'->'overrides'->col_key->>'add_vat')::boolean, false),
                coalesce(
                  (v_mapping->'price_modifiers'->'overrides'->col_key->>'vat_rate')::numeric,
                  (v_mapping->'price_modifiers'->'general'->>'vat_rate')::numeric,
                  21
                )
              )
            else
              parse_price_string(dp.data->>col_key)
          end as col_value
        from (
          select distinct col_key
          from (
            select jsonb_object_keys(v_mapping->'price_modifiers'->'overrides') as col_key
            where v_mapping->'price_modifiers'->'overrides' is not null
          ) override_keys
          where dp.data ? col_key
        ) override_cols
        
        union all
        
        -- Custom columns calculations
        select 
          custom_key as col_key,
          calculate_price_with_modifiers(
            dp.data->>(v_custom_columns->custom_key->>'base_column'),
            coalesce((v_custom_columns->custom_key->>'percentage')::numeric, 0),
            coalesce((v_custom_columns->custom_key->>'add_vat')::boolean, false),
            coalesce((v_custom_columns->custom_key->>'vat_rate')::numeric, 21)
          ) as col_value
        from jsonb_object_keys(v_custom_columns) as custom_key
        where dp.data ? (v_custom_columns->custom_key->>'base_column')
      ) all_calculated
    ) as calculated_data,
    -- Valores por defecto para in_my_stock y stock_threshold (se sobrescriben luego)
    false as in_my_stock,
    0 as stock_threshold
  from dynamic_products dp
  where dp.list_id = p_list_id;

  -- PASO 4: RESTAURAR datos del usuario (quantity, in_my_stock, stock_threshold) Y re-aplicar FX
  update dynamic_products_index dpi
  set 
    quantity = tp.quantity,
    in_my_stock = tp.in_my_stock,
    stock_threshold = tp.stock_threshold,
    calculated_data = apply_preserved_fx_conversion(
      dpi.calculated_data,
      tp.fx_metadata,
      v_mapping
    )
  from temp_preserved tp
  where dpi.product_id = tp.product_id
    and dpi.list_id = p_list_id;

  -- PASO 5: Actualizar price si fue convertido a ARS
  update dynamic_products_index dpi
  set 
    price = round(
      (tp.fx_metadata->>'__fx_usd_ars__orig__price')::numeric 
      * (tp.fx_metadata->>'__fx_usd_ars__rate')::numeric, 
      2
    )
  from temp_preserved tp
  where dpi.product_id = tp.product_id
    and dpi.list_id = p_list_id
    and tp.fx_metadata ? '__fx_usd_ars__orig__price'
    and (tp.fx_metadata->>'__fx_usd_ars__rate')::numeric > 0;

  raise notice 'Índice refrescado para lista %: % productos, % datos preservados (incluyendo FX), columnas personalizadas: %', 
    p_list_id, 
    (select count(*) from dynamic_products_index where list_id = p_list_id),
    (select count(*) from temp_preserved),
    (select count(*) from jsonb_object_keys(v_custom_columns));
end;
$function$;