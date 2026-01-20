-- Fix custom column base prices to use calculated primary/override values
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
  -- Fetch mapping_config and user_id for the list
  select mapping_config, user_id
  into v_mapping, v_user_id
  from product_lists
  where id = p_list_id;

  if v_mapping is null then
    raise notice 'List % has no mapping_config configured', p_list_id;
    return;
  end if;

  -- Get global dollar rate from settings
  select (value->>'rate')::numeric
  into v_global_dollar_rate
  from public.settings
  where key = 'dollar_official';

  -- Use global rate, fallback to mapping_config for compatibility
  v_dollar_rate := coalesce(
    v_global_dollar_rate,
    (v_mapping->'dollar_conversion'->>'rate')::numeric,
    0
  );

  -- Columns where FX conversion applies (from mapping_config)
  v_dollar_columns := coalesce(v_mapping->'dollar_conversion'->'target_columns', '[]'::jsonb);

  -- Custom columns
  v_custom_columns := coalesce(v_mapping->'custom_columns', '{}'::jsonb);

  -- STEP 1: Preserve user data (quantity, in_my_stock, stock_threshold) and FX metadata
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
    (
      select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
      from jsonb_each(calculated_data) as kv(k, v)
      where k like '__fx_usd_ars__%'
    ) as fx_metadata
  from dynamic_products_index
  where list_id = p_list_id;

  -- STEP 2: Remove existing index rows
  delete from dynamic_products_index
  where list_id = p_list_id;

  -- STEP 3: Insert updated index rows (FX conversion is re-applied later)
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
    -- PRICE: base value without FX conversion (re-applied later)
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
    -- QUANTITY (temporary, from file - overwritten by preserved values)
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
    -- Calculated data: overrides and custom columns (FX re-applied later)
    (
      select coalesce(
        jsonb_object_agg(col_key, col_value) FILTER (WHERE col_value IS NOT NULL),
        '{}'::jsonb
      )
      from (
        -- Override columns (no automatic FX conversion)
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

        -- Custom columns: base uses calculated primary/override values
        select
          custom_key as col_key,
          calculate_price_with_modifiers(
            case
              when (v_custom_columns->custom_key->>'base_column') = coalesce(v_mapping->>'price_primary_key', 'price') then
                calculate_price_with_modifiers(
                  case
                    when v_mapping->>'price_primary_key' is not null
                    then dp.data->>((v_mapping->>'price_primary_key')::text)
                    else coalesce(dp.price::text, '0')
                  end,
                  coalesce((v_mapping->'price_modifiers'->'general'->>'percentage')::numeric, 0),
                  coalesce((v_mapping->'price_modifiers'->'general'->>'add_vat')::boolean, false),
                  coalesce((v_mapping->'price_modifiers'->'general'->>'vat_rate')::numeric, 21)
                )::text
              when v_mapping->'price_modifiers'->'overrides' ? (v_custom_columns->custom_key->>'base_column') then
                calculate_price_with_modifiers(
                  dp.data->>(v_custom_columns->custom_key->>'base_column'),
                  coalesce(
                    (v_mapping->'price_modifiers'->'overrides'->(v_custom_columns->custom_key->>'base_column')->>'percentage')::numeric,
                    0
                  ),
                  coalesce(
                    (v_mapping->'price_modifiers'->'overrides'->(v_custom_columns->custom_key->>'base_column')->>'add_vat')::boolean,
                    false
                  ),
                  coalesce(
                    (v_mapping->'price_modifiers'->'overrides'->(v_custom_columns->custom_key->>'base_column')->>'vat_rate')::numeric,
                    (v_mapping->'price_modifiers'->'general'->>'vat_rate')::numeric,
                    21
                  )
                )::text
              else
                dp.data->>(v_custom_columns->custom_key->>'base_column')
            end,
            coalesce((v_custom_columns->custom_key->>'percentage')::numeric, 0),
            coalesce((v_custom_columns->custom_key->>'add_vat')::boolean, false),
            coalesce((v_custom_columns->custom_key->>'vat_rate')::numeric, 21)
          ) as col_value
        from jsonb_object_keys(v_custom_columns) as custom_key
        where dp.data ? (v_custom_columns->custom_key->>'base_column')
      ) all_calculated
    ) as calculated_data,
    -- Defaults for in_my_stock and stock_threshold (restored later)
    false as in_my_stock,
    0 as stock_threshold
  from dynamic_products dp
  where dp.list_id = p_list_id;

  -- STEP 4: Restore user data and re-apply FX metadata
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

  -- STEP 5: Update price if it was converted to ARS
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

  raise notice 'Index refreshed for list %: % products, % preserved (including FX), custom columns: %',
    p_list_id,
    (select count(*) from dynamic_products_index where list_id = p_list_id),
    (select count(*) from temp_preserved),
    (select count(*) from jsonb_object_keys(v_custom_columns));
end;
$function$;
