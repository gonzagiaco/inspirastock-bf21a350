import { supabase } from "@/integrations/supabase/client";
import {
  bulkAddToMyStockOffline,
  bulkRemoveFromMyStockOffline,
  getOfficialDollarRate,
  isOnline,
  localDB,
  queueOperation,
  queueOperationsBulk,
} from "@/lib/localDB";
import { normalizeRawPrice } from "@/utils/numberParser";
import { applyPercentageAdjustment, resolveDeliveryNoteUnitPrice } from "@/utils/deliveryNotePricing";
import { notifyDeliveryNotePricesUpdated } from "@/utils/deliveryNoteEvents";
import type { ColumnSchema } from "@/types/productList";

function uniqStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v && v.trim()))));
}

const DEFAULT_PRICE_KEY = "price";

const chunkArray = (values: string[], size = 500) => {
  const chunks: string[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
};

const resolveDeliveryNotePriceKey = (item: any, mappingConfig?: any) => {
  const explicit = typeof item?.price_column_key_used === "string" && item.price_column_key_used.trim()
    ? item.price_column_key_used
    : typeof item?.priceColumnKeyUsed === "string" && item.priceColumnKeyUsed.trim()
      ? item.priceColumnKeyUsed
      : null;
  return explicit ?? mappingConfig?.delivery_note_price_column ?? mappingConfig?.price_primary_key ?? DEFAULT_PRICE_KEY;
};

const buildUpdatedDeliveryNoteItems = async (args: {
  items: any[];
  mappingConfig?: any;
  indexMap: Map<string, any>;
  productMap: Map<string, any>;
}) => {
  const { items, mappingConfig, indexMap, productMap } = args;

  const updates = await Promise.all(
    items.map(async (item) => {
      const productId = item.product_id;
      if (!productId) return null;

      const indexRow = indexMap.get(productId);
      const productRow = productMap.get(productId);
      if (!indexRow && !productRow) return null;

      const priceKey = resolveDeliveryNotePriceKey(item, mappingConfig);
      const baseUnitPrice = await resolveDeliveryNoteUnitPrice(
        priceKey,
        mappingConfig,
        productRow ?? indexRow ?? {},
        { indexRow, localProductRow: productRow },
      );
      if (baseUnitPrice == null) return null;

      const adjustmentPct = Number(item.adjustment_pct ?? 0);
      const adjustedUnitPrice = applyPercentageAdjustment(baseUnitPrice, adjustmentPct);
      const subtotal = Number(item.quantity ?? 0) * Number(adjustedUnitPrice);

      return {
        ...item,
        unit_price_base: baseUnitPrice,
        adjustment_pct: adjustmentPct,
        unit_price: adjustedUnitPrice,
        subtotal,
      };
    }),
  );

  return updates.filter(Boolean) as any[];
};

const updateDeliveryNoteItemsOnline = async (args: {
  listId: string;
  productIds?: string[];
  mappingConfig?: any;
}) => {
  const { listId, productIds, mappingConfig } = args;
  const ids = uniqStrings(productIds || []);

  const noteItems: any[] = [];
  if (ids.length) {
    for (const chunk of chunkArray(ids)) {
      const { data, error } = await supabase
        .from("delivery_note_items")
        .select("id, product_id, quantity, adjustment_pct, price_column_key_used")
        .in("product_id", chunk);
      if (error) throw error;
      if (data?.length) noteItems.push(...data);
    }
  } else if (listId) {
    const { data, error } = await supabase
      .from("delivery_note_items")
      .select("id, product_id, quantity, adjustment_pct, price_column_key_used")
      .eq("product_list_id", listId);
    if (error) throw error;
    if (data?.length) noteItems.push(...data);
  }

  if (!noteItems.length) return;

  const productIdsToFetch = uniqStrings(noteItems.map((item) => item.product_id));
  if (!productIdsToFetch.length) return;

  const indexRows: any[] = [];
  const productRows: any[] = [];

  for (const chunk of chunkArray(productIdsToFetch)) {
    const [indexResult, productResult] = await Promise.all([
      supabase
        .from("dynamic_products_index")
        .select("product_id, price, calculated_data")
        .in("product_id", chunk),
      supabase
        .from("dynamic_products")
        .select("id, price, data")
        .in("id", chunk),
    ]);
    if (indexResult.error) throw indexResult.error;
    if (productResult.error) throw productResult.error;
    if (indexResult.data?.length) indexRows.push(...indexResult.data);
    if (productResult.data?.length) productRows.push(...productResult.data);
  }

  const indexMap = new Map(indexRows.map((row) => [row.product_id, row]));
  const productMap = new Map(productRows.map((row) => [row.id, row]));

  const updatedItems = await buildUpdatedDeliveryNoteItems({
    items: noteItems,
    mappingConfig,
    indexMap,
    productMap,
  });

  if (!updatedItems.length) return;

  await Promise.all(
    updatedItems.map(async (item) => {
      const { error } = await supabase
        .from("delivery_note_items")
        .update({
          unit_price: item.unit_price,
          unit_price_base: item.unit_price_base,
          adjustment_pct: item.adjustment_pct,
          subtotal: item.subtotal,
        })
        .eq("id", item.id);
      if (error) throw error;
    }),
  );

  await Promise.all(
    updatedItems.map((item) =>
      localDB.delivery_note_items.update(item.id, {
        unit_price: item.unit_price,
        unit_price_base: item.unit_price_base,
        adjustment_pct: item.adjustment_pct,
        subtotal: item.subtotal,
      }),
    ),
  );
};

const notifyDeliveryNoteRefresh = (detail: { listId?: string; productIds?: string[] }) => {
  notifyDeliveryNotePricesUpdated(detail);
};

export function sanitizeMappingConfigAfterDeletingColumns(mappingConfig: any | undefined, deletedKeys: string[]) {
  if (!mappingConfig) return mappingConfig;
  const deleted = new Set(deletedKeys);

  const stripFromArray = (arr: any) => (Array.isArray(arr) ? arr.filter((k) => !deleted.has(k)) : arr);
  const stripScalar = (value: any) => (typeof value === "string" && deleted.has(value) ? null : value);

  const next: any = { ...mappingConfig };

  next.code_keys = stripFromArray(next.code_keys);
  next.name_keys = stripFromArray(next.name_keys);
  next.extra_index_keys = stripFromArray(next.extra_index_keys);
  next.price_alt_keys = stripFromArray(next.price_alt_keys);

  next.quantity_key = stripScalar(next.quantity_key);
  next.price_primary_key = stripScalar(next.price_primary_key);
  next.cart_price_column = stripScalar(next.cart_price_column);
  next.delivery_note_price_column = stripScalar(next.delivery_note_price_column);

  if (next.dollar_conversion?.target_columns) {
    next.dollar_conversion = {
      ...next.dollar_conversion,
      target_columns: stripFromArray(next.dollar_conversion.target_columns),
    };
  }

  if (next.price_modifiers?.overrides) {
    const overrides = { ...next.price_modifiers.overrides };
    for (const key of Object.keys(overrides)) {
      if (deleted.has(key)) delete overrides[key];
    }
    next.price_modifiers = { ...next.price_modifiers, overrides };
  }

  if (next.custom_columns) {
    const customColumns: any = { ...next.custom_columns };
    for (const key of Object.keys(customColumns)) {
      const formula = customColumns[key];
      if (deleted.has(key) || deleted.has(formula?.base_column)) {
        delete customColumns[key];
      }
    }
    next.custom_columns = Object.keys(customColumns).length ? customColumns : undefined;
  }

  return next;
}

export async function deleteColumnsFromList(args: {
  listId: string;
  columnSchema: ColumnSchema[];
  mappingConfig?: any;
  columnKeys: string[];
}) {
  const { listId, columnSchema, mappingConfig, columnKeys } = args;
  const now = new Date().toISOString();

  const updatedSchema = columnSchema.filter((c) => !columnKeys.includes(c.key) && c.key !== "stock_threshold");
  const updatedMappingConfig = sanitizeMappingConfigAfterDeletingColumns(mappingConfig, columnKeys);

  await localDB.product_lists.update(listId, {
    column_schema: updatedSchema,
    mapping_config: updatedMappingConfig,
    updated_at: now,
  });

  if (isOnline()) {
    const updatePayload: any = {
      column_schema: JSON.parse(JSON.stringify(updatedSchema)),
      updated_at: now,
    };
    if (updatedMappingConfig) updatePayload.mapping_config = updatedMappingConfig;

    const { error } = await supabase.from("product_lists").update(updatePayload).eq("id", listId);
    if (error) throw error;
  } else {
    await queueOperation("product_lists", "UPDATE", listId, {
      column_schema: updatedSchema,
      mapping_config: updatedMappingConfig,
      updated_at: now,
    });
  }

  return { updatedSchema, updatedMappingConfig };
}

async function getDollarRateWithFallback(): Promise<number> {
  let rate = await getOfficialDollarRate();
  if (rate && rate > 0) return rate;
  if (!isOnline()) return 0;

  const { data, error } = await supabase.from("settings").select("value").eq("key", "dollar_official").maybeSingle();
  if (error) throw error;
  const value = data?.value as any;
  rate = Number(value?.rate ?? 0);
  return Number.isFinite(rate) ? rate : 0;
}

export async function bulkAddToMyStock(args: { productIds: string[]; quantity?: number; stockThreshold?: number }) {
  const { productIds, quantity = 1, stockThreshold = 0 } = args;
  if (!productIds.length) return { processed: 0 };

  if (isOnline()) {
    const chunkSize = 900;
    let processed = 0;
    for (let i = 0; i < productIds.length; i += chunkSize) {
      const chunk = productIds.slice(i, i + chunkSize);
      const { data, error } = await supabase.rpc("bulk_add_to_my_stock", {
        p_product_ids: chunk,
        p_quantity: quantity,
        p_stock_threshold: stockThreshold,
      });
      if (error) throw error;
      const result = data as any;
      if (result?.success === false) throw new Error(result?.error || "bulk_add_to_my_stock failed");
      processed += Number(result?.processed ?? chunk.length);
    }
    return { processed };
  }

  return await bulkAddToMyStockOffline({ productIds, quantity, stockThreshold });
}

export async function bulkRemoveFromMyStock(args: { productIds: string[] }) {
  const { productIds } = args;
  if (!productIds.length) return { processed: 0 };

  if (isOnline()) {
    const chunkSize = 900;
    let processed = 0;
    for (let i = 0; i < productIds.length; i += chunkSize) {
      const chunk = productIds.slice(i, i + chunkSize);
      const { data, error } = await supabase.rpc("bulk_remove_from_my_stock", {
        p_product_ids: chunk,
      });
      if (error) throw error;
      const result = data as any;
      if (result?.success === false) throw new Error(result?.error || "bulk_remove_from_my_stock failed");
      processed += Number(result?.processed ?? chunk.length);
    }
    return { processed };
  }

  return await bulkRemoveFromMyStockOffline({ productIds });
}

export async function convertUsdToArsForProducts(args: {
  listId: string;
  products: Array<{
    id: string;
    price?: number | null;
    quantity?: number | null;
    data?: Record<string, any>;
    calculated_data?: Record<string, any>;
  }>;
  mappingConfig?: any;
  columnSchema?: ColumnSchema[];
  targetKeys?: string[];
  productIds?: string[];
  applyToAll?: boolean;
}): Promise<{ processed: number; updated: number; skippedAlreadyConverted: number; dollarRate: number; targetKeys: string[] }> {
  const { products, mappingConfig, columnSchema } = args;
  const now = new Date().toISOString();
  const notifyProductIds = uniqStrings(
    args.productIds && args.productIds.length > 0 ? args.productIds : products.map((p) => p.id),
  );

  const configuredTargets = mappingConfig?.dollar_conversion?.target_columns;
  const targetKeys = uniqStrings(
    args.targetKeys && args.targetKeys.length > 0
      ? args.targetKeys
      : [
          ...(Array.isArray(configuredTargets) ? configuredTargets : []),
          mappingConfig?.price_primary_key ?? null,
          ...(Array.isArray(mappingConfig?.price_alt_keys) ? mappingConfig.price_alt_keys : []),
          mappingConfig?.cart_price_column ?? null,
          mappingConfig?.delivery_note_price_column ?? null,
          ...(mappingConfig?.custom_columns ? Object.keys(mappingConfig.custom_columns) : []),
          ...(Array.isArray(columnSchema)
            ? columnSchema
                .filter((c) => c.type === "number")
                .map((c) => c.key)
                .filter((k) => k.toLowerCase().includes("precio") || k.toLowerCase().includes("price"))
            : []),
        ],
  );

  if (isOnline()) {
    const primaryKey = mappingConfig?.price_primary_key ?? "price";
    const deliveryNotePriceKey = mappingConfig?.delivery_note_price_column ?? null;
    const selectedIds = args.applyToAll
      ? null
      : (args.productIds && args.productIds.length > 0 ? args.productIds : products.map((p) => p.id));
    const { data, error } = await supabase.rpc("bulk_convert_usd_ars", {
      p_list_id: args.listId,
      p_product_ids: selectedIds && selectedIds.length ? selectedIds : null,
      p_target_keys: targetKeys,
      p_primary_key: primaryKey,
      p_delivery_note_price_key: deliveryNotePriceKey ?? undefined,
    });
    if (error) throw error;
    const result = data as any;
    if (result?.success === false) throw new Error(result?.error || "bulk_convert_usd_ars failed");

    if (Number(result?.updated ?? 0) > 0) {
      try {
        await updateDeliveryNoteItemsOnline({
          listId: args.listId,
          productIds: notifyProductIds.length ? notifyProductIds : undefined,
          mappingConfig,
        });
      } catch (updateError) {
        console.error("updateDeliveryNoteItemsOnline (convert) error:", updateError);
      }

      notifyDeliveryNoteRefresh({
        listId: args.listId,
        productIds: notifyProductIds.length ? notifyProductIds : undefined,
      });
    }

    return {
      processed: Number(result?.processed ?? 0),
      updated: Number(result?.updated ?? 0),
      skippedAlreadyConverted: Number(result?.skipped ?? 0),
      dollarRate: Number(result?.dollar_rate ?? 0),
      targetKeys: (result?.target_keys as string[]) ?? targetKeys,
    };
  }

  const dollarRate = await getDollarRateWithFallback();
  if (!dollarRate || dollarRate <= 0) {
    return { processed: products.length, updated: 0, skippedAlreadyConverted: 0, dollarRate: 0, targetKeys: [] };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Usuario no autenticado");

  let updated = 0;
  let skippedAlreadyConverted = 0;
  const queueOps: Array<{
    tableName: string;
    operationType: "INSERT" | "UPDATE" | "DELETE";
    recordId: string;
    data: any;
  }> = [];

  for (const product of products) {
    const productId = product.id;

    const indexRecord = await localDB.dynamic_products_index.where({ product_id: productId }).first();
    const indexId = indexRecord?.id;
    if (!indexId) continue;
    const existingCalc = ((indexRecord as any)?.calculated_data || {}) as Record<string, any>;

    const isPrimaryKey = (key: string) => Boolean(mappingConfig?.price_primary_key && key === mappingConfig.price_primary_key);
    const getOriginalValueForKey = (key: string) => {
      if (isPrimaryKey(key)) {
        return existingCalc.__fx_usd_ars__orig__price ?? null;
      }
      return existingCalc[`__fx_usd_ars__orig__${key}`] ?? null;
    };
    const isKeyAlreadyConverted = (key: string) => getOriginalValueForKey(key) != null;

    const resolveComputedValue = (key: string, visited: Set<string>): any => {
      if (visited.has(key)) return null;
      const nextVisited = new Set(visited);
      nextVisited.add(key);

      const original = getOriginalValueForKey(key);
      if (original != null) return original;

      if (isPrimaryKey(key)) {
        return product.price ?? product.data?.[key] ?? product.calculated_data?.[key] ?? null;
      }

      if (key in existingCalc) return existingCalc[key];
      if (product.calculated_data && key in product.calculated_data) return product.calculated_data[key];

      const customFormula = mappingConfig?.custom_columns?.[key];
      if (customFormula?.base_column) {
        const baseValue = resolveComputedValue(customFormula.base_column, nextVisited);
        const baseNumeric = normalizeRawPrice(baseValue);
        if (baseNumeric == null) return null;

        const percentage = Number(customFormula.percentage ?? 0);
        const addVat = Boolean(customFormula.add_vat);
        const vatRate = Number(customFormula.vat_rate ?? 0);

        let computed = baseNumeric * (1 + percentage / 100);
        if (addVat) computed = computed * (1 + vatRate / 100);
        return computed;
      }

      if (key === "price" || key === "precio") return product.price ?? null;
      if (key === "quantity") return product.quantity ?? null;

      return product.data?.[key] ?? null;
    };

    const keysToProcess = targetKeys.filter((key) => !isKeyAlreadyConverted(key));
    if (!keysToProcess.length) {
      skippedAlreadyConverted += 1;
      continue;
    }

    const patch: Record<string, number> = {};
    let nextPrimaryPrice: number | null = null;
    const meta: Record<string, any> = {
      __fx_usd_ars__at: now,
      __fx_usd_ars__rate: dollarRate,
    };

    for (const key of keysToProcess) {
      const isPrimary = Boolean(mappingConfig?.price_primary_key && key === mappingConfig.price_primary_key);
      const baseValue = resolveComputedValue(key, new Set());
      const baseNumeric = normalizeRawPrice(baseValue);
      if (baseNumeric == null) continue;

      const converted = Number((baseNumeric * dollarRate).toFixed(2));
      if (!Number.isFinite(converted)) continue;

      if (isPrimary) {
        nextPrimaryPrice = converted;
        meta.__fx_usd_ars__orig__price = baseNumeric;
      } else {
        patch[key] = converted;
        meta[`__fx_usd_ars__orig__${key}`] = baseNumeric;
      }
    }

    if (!Object.keys(patch).length && nextPrimaryPrice == null) continue;

    const mergedCalculated = { ...existingCalc, ...patch, ...meta };

    await localDB.dynamic_products_index.update(indexId, {
      calculated_data: mergedCalculated,
      ...(nextPrimaryPrice != null ? { price: nextPrimaryPrice } : {}),
      updated_at: now,
    });

    await localDB.dynamic_products.update(productId, {
      ...(nextPrimaryPrice != null ? { price: nextPrimaryPrice } : {}),
      updated_at: now,
    });

    if (nextPrimaryPrice != null) {
      const myStockRow = await localDB.my_stock_products.where({ user_id: user.id, product_id: productId }).first();
      if (myStockRow) {
        await localDB.my_stock_products.update(myStockRow.id, {
          price: nextPrimaryPrice,
          updated_at: now,
        });
      }
    }

    if (isOnline()) {
      const { error: idxError } = await supabase
        .from("dynamic_products_index")
        .update({
          calculated_data: mergedCalculated as any,
          ...(nextPrimaryPrice != null ? { price: nextPrimaryPrice } : {}),
          updated_at: now,
        })
        .eq("product_id", productId);
      if (idxError) throw idxError;

      if (nextPrimaryPrice != null) {
        const { error: productError } = await supabase
          .from("dynamic_products")
          .update({ price: nextPrimaryPrice, updated_at: now })
          .eq("id", productId);
        if (productError) throw productError;

        await supabase
          .from("my_stock_products")
          .update({ price: nextPrimaryPrice, updated_at: now })
          .eq("user_id", user.id)
          .eq("product_id", productId);
      }
    } else {
      queueOps.push({
        tableName: "dynamic_products_index",
        operationType: "UPDATE",
        recordId: indexId,
        data: {
          calculated_data: mergedCalculated,
          ...(nextPrimaryPrice != null ? { price: nextPrimaryPrice } : {}),
          updated_at: now,
        },
      });
      queueOps.push({
        tableName: "dynamic_products",
        operationType: "UPDATE",
        recordId: productId,
        data: {
          ...(nextPrimaryPrice != null ? { price: nextPrimaryPrice } : {}),
          updated_at: now,
        },
      });

      if (nextPrimaryPrice != null) {
        const myStockRow = await localDB.my_stock_products.where({ user_id: user.id, product_id: productId }).first();
        if (myStockRow) {
          queueOps.push({
            tableName: "my_stock_products",
            operationType: "UPDATE",
            recordId: myStockRow.id,
            data: {
              price: nextPrimaryPrice,
              updated_at: now,
            },
          });
        }
      }
    }

    const noteItems = await localDB.delivery_note_items.where("product_id").equals(productId).toArray();
    if (noteItems.length) {
      const localProductRow = await localDB.dynamic_products.get(productId);
      const indexForPricing = {
        ...(indexRecord || {}),
        calculated_data: mergedCalculated,
        ...(nextPrimaryPrice != null ? { price: nextPrimaryPrice } : {}),
      };

      const updatedItems = await buildUpdatedDeliveryNoteItems({
        items: noteItems,
        mappingConfig,
        indexMap: new Map([[productId, indexForPricing]]),
        productMap: localProductRow ? new Map([[productId, localProductRow]]) : new Map(),
      });

      if (updatedItems.length) {
        await localDB.delivery_note_items.bulkPut(updatedItems);

        if (isOnline()) {
          await Promise.all(
            updatedItems.map(async (item: any) => {
              const { error } = await supabase
                .from("delivery_note_items")
                .update({
                  unit_price: item.unit_price,
                  unit_price_base: item.unit_price_base,
                  adjustment_pct: item.adjustment_pct,
                  subtotal: item.subtotal,
                })
                .eq("id", item.id);
              if (error) throw error;
            }),
          );
        } else {
          updatedItems.forEach((item: any) => {
            queueOps.push({
              tableName: "delivery_note_items",
              operationType: "UPDATE",
              recordId: item.id,
              data: {
                unit_price: item.unit_price,
                unit_price_base: item.unit_price_base,
                adjustment_pct: item.adjustment_pct,
                subtotal: item.subtotal,
              },
            });
          });
        }
      }
    }

    updated += 1;
  }

  if (queueOps.length) {
    await queueOperationsBulk(queueOps);
  }

  if (updated > 0) {
    notifyDeliveryNoteRefresh({
      listId: args.listId,
      productIds: notifyProductIds.length ? notifyProductIds : undefined,
    });
  }

  return { processed: products.length, updated, skippedAlreadyConverted, dollarRate, targetKeys };
}

export async function revertUsdToArsForProducts(args: {
  listId: string;
  products: Array<{ id: string }>;
  mappingConfig?: any;
  targetKeys?: string[];
  productIds?: string[];
  applyToAll?: boolean;
}): Promise<{ processed: number; reverted: number; skippedNotConverted: number }> {
  const { products, mappingConfig } = args;
  const now = new Date().toISOString();
  const notifyProductIds = uniqStrings(
    args.productIds && args.productIds.length > 0 ? args.productIds : products.map((p) => p.id),
  );

  if (isOnline()) {
    const primaryKey = mappingConfig?.price_primary_key ?? "price";
    const deliveryNotePriceKey = mappingConfig?.delivery_note_price_column ?? null;
    const selectedIds = args.applyToAll
      ? null
      : (args.productIds && args.productIds.length > 0 ? args.productIds : products.map((p) => p.id));
    const { data, error } = await supabase.rpc("bulk_revert_usd_ars", {
      p_list_id: args.listId,
      p_product_ids: selectedIds && selectedIds.length ? selectedIds : null,
      p_target_keys: args.targetKeys && args.targetKeys.length > 0 ? args.targetKeys : null,
      p_primary_key: primaryKey,
      p_delivery_note_price_key: deliveryNotePriceKey ?? undefined,
    });
    if (error) throw error;
    const result = data as any;
    if (result?.success === false) throw new Error(result?.error || "bulk_revert_usd_ars failed");

    if (Number(result?.reverted ?? 0) > 0) {
      try {
        await updateDeliveryNoteItemsOnline({
          listId: args.listId,
          productIds: notifyProductIds.length ? notifyProductIds : undefined,
          mappingConfig,
        });
      } catch (updateError) {
        console.error("updateDeliveryNoteItemsOnline (revert) error:", updateError);
      }

      notifyDeliveryNoteRefresh({
        listId: args.listId,
        productIds: notifyProductIds.length ? notifyProductIds : undefined,
      });
    }

    return {
      processed: Number(result?.processed ?? 0),
      reverted: Number(result?.reverted ?? 0),
      skippedNotConverted: Number(result?.skipped ?? 0),
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Usuario no autenticado");

  let reverted = 0;
  let skippedNotConverted = 0;
  const queueOps: Array<{
    tableName: string;
    operationType: "INSERT" | "UPDATE" | "DELETE";
    recordId: string;
    data: any;
  }> = [];

  for (const product of products) {
    const productId = product.id;
    const indexRecord = await localDB.dynamic_products_index.where({ product_id: productId }).first();
    const indexId = indexRecord?.id;
    if (!indexId) continue;

    const calc = ((indexRecord as any).calculated_data || {}) as Record<string, any>;
    const targetKeySet = args.targetKeys && args.targetKeys.length > 0 ? new Set(args.targetKeys) : null;
    const primaryKey = mappingConfig?.price_primary_key ?? null;
    const shouldRevertPrimary = targetKeySet ? (primaryKey ? targetKeySet.has(primaryKey) : targetKeySet.has("price")) : true;

    const nextCalculated: Record<string, any> = { ...calc };
    const restoredPatch: Record<string, any> = {};
    let restoredPrimary: number | null = null;
    let revertedAny = false;

    if (shouldRevertPrimary && calc.__fx_usd_ars__orig__price != null) {
      restoredPrimary = normalizeRawPrice(calc.__fx_usd_ars__orig__price);
      delete nextCalculated.__fx_usd_ars__orig__price;
      revertedAny = true;
    }

    for (const [k, v] of Object.entries(calc)) {
      if (!k.startsWith("__fx_usd_ars__orig__")) continue;
      const originalKey = k.replace("__fx_usd_ars__orig__", "");
      if (originalKey === "price") continue;
      if (targetKeySet && !targetKeySet.has(originalKey)) continue;

      const numeric = normalizeRawPrice(v);
      if (numeric != null) {
        restoredPatch[originalKey] = numeric;
      }
      delete nextCalculated[k];
      revertedAny = true;
    }

    if (!revertedAny) {
      skippedNotConverted += 1;
      continue;
    }

    Object.assign(nextCalculated, restoredPatch);

    const hasRemainingOriginals = Object.keys(nextCalculated).some((k) => k.startsWith("__fx_usd_ars__orig__"));
    if (!hasRemainingOriginals) {
      delete nextCalculated.__fx_usd_ars__at;
      delete nextCalculated.__fx_usd_ars__rate;
    }

    await localDB.dynamic_products_index.update(indexId, {
      calculated_data: nextCalculated,
      ...(restoredPrimary != null ? { price: restoredPrimary } : {}),
      updated_at: now,
    });
    await localDB.dynamic_products.update(productId, {
      ...(restoredPrimary != null ? { price: restoredPrimary } : {}),
      updated_at: now,
    });

    if (restoredPrimary != null) {
      const myStockRow = await localDB.my_stock_products.where({ user_id: user.id, product_id: productId }).first();
      if (myStockRow) {
        await localDB.my_stock_products.update(myStockRow.id, { price: restoredPrimary, updated_at: now });
      }
    }

    const noteItems = await localDB.delivery_note_items.where("product_id").equals(productId).toArray();
    if (noteItems.length) {
      const localProductRow = await localDB.dynamic_products.get(productId);
      const indexForPricing = {
        ...(indexRecord || {}),
        calculated_data: nextCalculated,
        ...(restoredPrimary != null ? { price: restoredPrimary } : {}),
      };

      const updatedItems = await buildUpdatedDeliveryNoteItems({
        items: noteItems,
        mappingConfig,
        indexMap: new Map([[productId, indexForPricing]]),
        productMap: localProductRow ? new Map([[productId, localProductRow]]) : new Map(),
      });

      if (updatedItems.length) {
        await localDB.delivery_note_items.bulkPut(updatedItems);

        if (isOnline()) {
          await Promise.all(
            updatedItems.map(async (item: any) => {
              const { error } = await supabase
                .from("delivery_note_items")
                .update({
                  unit_price: item.unit_price,
                  unit_price_base: item.unit_price_base,
                  adjustment_pct: item.adjustment_pct,
                  subtotal: item.subtotal,
                })
                .eq("id", item.id);
              if (error) throw error;
            }),
          );
        } else {
          updatedItems.forEach((item: any) => {
            queueOps.push({
              tableName: "delivery_note_items",
              operationType: "UPDATE",
              recordId: item.id,
              data: {
                unit_price: item.unit_price,
                unit_price_base: item.unit_price_base,
                adjustment_pct: item.adjustment_pct,
                subtotal: item.subtotal,
              },
            });
          });
        }
      }
    }

    if (isOnline()) {
      const { error: idxError } = await supabase
        .from("dynamic_products_index")
        .update({
          calculated_data: nextCalculated as any,
          ...(restoredPrimary != null ? { price: restoredPrimary } : {}),
          updated_at: now,
        })
        .eq("product_id", productId);
      if (idxError) throw idxError;

      if (restoredPrimary != null) {
        const { error: productError } = await supabase
          .from("dynamic_products")
          .update({ price: restoredPrimary, updated_at: now })
          .eq("id", productId);
        if (productError) throw productError;

        await supabase
          .from("my_stock_products")
          .update({ price: restoredPrimary, updated_at: now })
          .eq("user_id", user.id)
          .eq("product_id", productId);
      }
    } else {
      queueOps.push({
        tableName: "dynamic_products_index",
        operationType: "UPDATE",
        recordId: indexId,
        data: {
          calculated_data: nextCalculated,
          ...(restoredPrimary != null ? { price: restoredPrimary } : {}),
          updated_at: now,
        },
      });
      queueOps.push({
        tableName: "dynamic_products",
        operationType: "UPDATE",
        recordId: productId,
        data: {
          ...(restoredPrimary != null ? { price: restoredPrimary } : {}),
          updated_at: now,
        },
      });

      if (restoredPrimary != null) {
        const myStockRow = await localDB.my_stock_products.where({ user_id: user.id, product_id: productId }).first();
        if (myStockRow) {
          queueOps.push({
            tableName: "my_stock_products",
            operationType: "UPDATE",
            recordId: myStockRow.id,
            data: { price: restoredPrimary, updated_at: now },
          });
        }
      }
    }

    reverted += 1;
  }

  if (queueOps.length) {
    await queueOperationsBulk(queueOps);
  }

  if (reverted > 0) {
    notifyDeliveryNoteRefresh({
      listId: args.listId,
      productIds: notifyProductIds.length ? notifyProductIds : undefined,
    });
  }

  return { processed: products.length, reverted, skippedNotConverted };
}

export async function deleteProductsEverywhere(args: { productIds: string[] }) {
  const { productIds } = args;
  if (!productIds.length) return { deleted: 0 };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Usuario no autenticado");

  if (isOnline()) {
    const chunkSize = 900;
    let deleted = 0;
    for (let i = 0; i < productIds.length; i += chunkSize) {
      const chunk = productIds.slice(i, i + chunkSize);
      const { data, error } = await supabase.rpc("bulk_delete_products", {
        p_product_ids: chunk,
      });
      if (error) throw error;
      const result = data as any;
      if (result?.success === false) throw new Error(result?.error || "bulk_delete_products failed");
      deleted += Number(result?.deleted ?? chunk.length);
    }
    return { deleted };
  }

  const now = new Date().toISOString();

  const indexRecords = await localDB.dynamic_products_index.where("product_id").anyOf(productIds).toArray();
  const indexIds = indexRecords.map((r) => r.id).filter(Boolean);
  const productRecords = await localDB.dynamic_products.where("id").anyOf(productIds).toArray();
  const productListCounts = new Map<string, number>();
  const productListById = new Map<string, string>();
  const nextCountsByListId = new Map<string, number>();

  for (const record of indexRecords) {
    if (record.product_id && record.list_id) {
      productListById.set(record.product_id, record.list_id);
    }
  }
  for (const record of productRecords) {
    if (record.id && record.list_id && !productListById.has(record.id)) {
      productListById.set(record.id, record.list_id);
    }
  }
  for (const listId of productListById.values()) {
    productListCounts.set(listId, (productListCounts.get(listId) ?? 0) + 1);
  }
  const listIds = Array.from(productListCounts.keys());

  const myStockRows = await localDB.my_stock_products.where({ user_id: user.id }).toArray();
  const myStockToDelete = myStockRows.filter((r) => productIds.includes(r.product_id));

  const requestItems = await localDB.request_items.where({ user_id: user.id }).toArray();
  const requestToDelete = requestItems.filter((r) => productIds.includes(r.product_id));

  await localDB.transaction(
    "rw",
    [
      localDB.dynamic_products,
      localDB.dynamic_products_index,
      localDB.my_stock_products,
      localDB.product_lists,
      localDB.request_items,
    ],
    async () => {
      await localDB.dynamic_products.bulkDelete(productIds);
      if (indexIds.length) await localDB.dynamic_products_index.bulkDelete(indexIds as any);
      if (myStockToDelete.length) await localDB.my_stock_products.bulkDelete(myStockToDelete.map((r) => r.id) as any);
      if (requestToDelete.length) await localDB.request_items.bulkDelete(requestToDelete.map((r) => r.id) as any);
      for (const listId of listIds) {
        const nextCount = await localDB.dynamic_products_index.where({ list_id: listId }).count();
        nextCountsByListId.set(listId, nextCount);
        await localDB.product_lists.update(listId, { product_count: nextCount, updated_at: now });
      }
    },
  );

  const queueOps: Array<{
    tableName: string;
    operationType: "INSERT" | "UPDATE" | "DELETE";
    recordId: string;
    data: any;
  }> = [];

  for (const id of productIds) {
    queueOps.push({ tableName: "dynamic_products", operationType: "DELETE", recordId: id, data: {} });
  }
  for (const idxId of indexIds) {
    queueOps.push({ tableName: "dynamic_products_index", operationType: "DELETE", recordId: idxId, data: {} });
  }
  for (const row of myStockToDelete) {
    queueOps.push({ tableName: "my_stock_products", operationType: "DELETE", recordId: row.id, data: {} });
  }
  for (const row of requestToDelete) {
    queueOps.push({ tableName: "request_items", operationType: "DELETE", recordId: row.id, data: {} });
  }
  for (const [listId, nextCount] of nextCountsByListId.entries()) {
    queueOps.push({
      tableName: "product_lists",
      operationType: "UPDATE",
      recordId: listId,
      data: { product_count: nextCount, updated_at: now },
    });
  }

  await queueOperationsBulk(queueOps);

  return { deleted: productIds.length };
}
