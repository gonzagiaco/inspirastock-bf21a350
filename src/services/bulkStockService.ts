import { supabase } from "@/integrations/supabase/client";
import { localDB } from "@/lib/localDB";

export interface StockAdjustment {
  product_id: string;
  list_id: string;
  delta: number;
  op_id?: string;
}

export interface BulkAdjustResult {
  success: boolean;
  processed: number;
  results: Array<{
    product_id: string;
    old_qty: number;
    new_qty: number;
    delta: number;
    op_id?: string;
  }>;
  error?: string;
}

const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ensureUuid(value: unknown): string {
  if (typeof value === "string" && UUID_RE.test(value)) return value;
  return NIL_UUID;
}

// Logging helper con métricas
const logBulk = (action: string, details?: any) => {
  const timestamp = new Date().toISOString();
  console.log(`[BulkStock ${timestamp}] ${action}`, details || "");
};

/**
 * C) bulkAdjustStock - Operaciones masivas para Remitos
 * Una sola llamada RPC para múltiples productos
 * Incluye idempotencia via op_id
 */
export async function bulkAdjustStock(adjustments: StockAdjustment[], isOnline: boolean): Promise<BulkAdjustResult> {
  const startTime = performance.now();
  logBulk("Starting bulk adjustment", {
    count: adjustments.length,
    isOnline,
    products: adjustments.map((a) => ({ id: a.product_id, delta: a.delta })),
  });

  if (adjustments.length === 0) {
    return { success: true, processed: 0, results: [] };
  }

  // Generar op_id único para idempotencia si no existe
  // + Asegurar list_id válido (bulk_adjust_stock castea a uuid)
  const adjustmentsWithOpId = adjustments.map((adj) => ({
    ...adj,
    list_id: ensureUuid(adj.list_id),
    op_id: adj.op_id || `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  }));

  if (isOnline) {
    try {
      // Usar RPC para operación atómica en servidor
      const { data, error } = await supabase.rpc("bulk_adjust_stock", {
        p_adjustments: adjustmentsWithOpId,
      });

      if (error) {
        logBulk("ERROR RPC bulk_adjust_stock", error);
        throw error;
      }

      const result = data as unknown as BulkAdjustResult;

      // ⚠️ Importante: esta función puede devolver { success:false } sin tirar error SQL.
      // En ese caso forzamos fallback offline para no quedar en estado inconsistente.
      if (!result?.success) {
        logBulk("RPC returned success=false", result);
        throw new Error(result?.error || "bulk_adjust_stock returned success=false");
      }

      const endTime = performance.now();
      logBulk(`RPC completed in ${(endTime - startTime).toFixed(2)}ms`, {
        processed: result.processed,
        success: result.success,
      });

      // Sincronizar resultados a IndexedDB (+ my_stock_products remoto)
      if (result.results) {
        await syncBulkResultsToLocal(result.results);
        await syncBulkResultsToRemoteMyStock(result.results);
      }

      return result;
    } catch (error: any) {
      logBulk("ERROR online bulk adjustment, falling back to offline", error);
      // Fallback a modo offline
      return await bulkAdjustStockOffline(adjustmentsWithOpId);
    }
  }

  return await bulkAdjustStockOffline(adjustmentsWithOpId);
}

/**
 * Versión offline de bulk adjust
 * Actualiza IndexedDB y encola operaciones
 */
async function syncBulkResultsToRemoteMyStock(results: BulkAdjustResult["results"]): Promise<void> {
  if (!results.length) return;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const productIds = Array.from(new Set(results.map((r) => r.product_id).filter(Boolean)));
  if (!productIds.length) return;

  const { data: existingRows, error } = await supabase
    .from("my_stock_products")
    .select("id, product_id")
    .eq("user_id", user.id)
    .in("product_id", productIds);

  if (error) {
    logBulk("ERROR syncing my_stock_products (select)", error);
    return;
  }

  const nextQtyByProductId = new Map(results.map((r) => [r.product_id, r.new_qty]));
  const now = new Date().toISOString();

  const rowsToUpsert = (existingRows ?? [])
    .map((row: any) => {
      const nextQty = nextQtyByProductId.get(row.product_id);
      if (typeof nextQty !== "number") return null;
      return {
        id: row.id,
        user_id: user.id,
        product_id: row.product_id,
        quantity: nextQty,
        updated_at: now,
      };
    })
    .filter(Boolean);

  if (!rowsToUpsert.length) return;

  const { error: upsertError } = await supabase.from("my_stock_products").upsert(rowsToUpsert as any[], {
    onConflict: "id",
  });

  if (upsertError) {
    logBulk("ERROR syncing my_stock_products (upsert)", upsertError);
  }
}

async function bulkAdjustStockOffline(adjustments: StockAdjustment[]): Promise<BulkAdjustResult> {
  const startTime = performance.now();
  logBulk("Starting offline bulk adjustment", { count: adjustments.length });

  const results: BulkAdjustResult["results"] = [];
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user?.id;

  for (const adj of adjustments) {
    try {
      // Buscar producto en índice
      const indexRecord = await localDB.dynamic_products_index.where("product_id").equals(adj.product_id).first();

      if (!indexRecord) {
        logBulk(`Product not found: ${adj.product_id}`);
        continue;
      }

      const oldQty = indexRecord.quantity || 0;
      const newQty = Math.max(0, oldQty + adj.delta);

      // Actualizar dynamic_products_index
      await localDB.dynamic_products_index.update(indexRecord.id!, {
        quantity: newQty,
        updated_at: new Date().toISOString(),
      });

      // Actualizar dynamic_products
      const fullProduct = await localDB.dynamic_products.get(adj.product_id);
      if (fullProduct) {
        await localDB.dynamic_products.update(adj.product_id, {
          quantity: newQty,
          updated_at: new Date().toISOString(),
        });
      }

      if (userId) {
        const myStockEntry = await localDB.my_stock_products
          .where({ user_id: userId, product_id: adj.product_id })
          .first();

        if (myStockEntry) {
          await localDB.my_stock_products.update(myStockEntry.id, {
            quantity: newQty,
            updated_at: new Date().toISOString(),
          });

          await localDB.pending_operations.add({
            table_name: "my_stock_products",
            operation_type: "UPDATE",
            record_id: myStockEntry.id,
            data: {
              quantity: newQty,
              updated_at: new Date().toISOString(),
            },
            timestamp: Date.now(),
            retry_count: 0,
          });
        }
      }

      // Encolar para sincronización (con serialización por producto)
      await localDB.pending_operations.add({
        table_name: "dynamic_products_index",
        operation_type: "UPDATE",
        record_id: adj.product_id,
        data: {
          quantity: newQty,
          op_id: adj.op_id, // Para idempotencia
        },
        timestamp: Date.now(),
        retry_count: 0,
      });

      results.push({
        product_id: adj.product_id,
        old_qty: oldQty,
        new_qty: newQty,
        delta: adj.delta,
        op_id: adj.op_id,
      });
    } catch (error) {
      logBulk(`ERROR adjusting product ${adj.product_id}`, error);
    }
  }

  const endTime = performance.now();
  logBulk(`Offline bulk completed in ${(endTime - startTime).toFixed(2)}ms`, {
    processed: results.length,
  });

  return {
    success: true,
    processed: results.length,
    results,
  };
}

/**
 * Sincroniza resultados del RPC a IndexedDB
 */
async function syncBulkResultsToLocal(results: BulkAdjustResult["results"]): Promise<void> {
  logBulk("Syncing bulk results to IndexedDB", { count: results.length });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user?.id;

  for (const result of results) {
    const indexRecord = await localDB.dynamic_products_index.where("product_id").equals(result.product_id).first();

    if (indexRecord) {
      await localDB.dynamic_products_index.update(indexRecord.id!, {
        quantity: result.new_qty,
        updated_at: new Date().toISOString(),
      });
    }

    // También actualizar dynamic_products
    const fullProduct = await localDB.dynamic_products.get(result.product_id);
    if (fullProduct) {
      await localDB.dynamic_products.update(result.product_id, {
        quantity: result.new_qty,
        updated_at: new Date().toISOString(),
      });
    }

    if (userId) {
      const myStockEntry = await localDB.my_stock_products
        .where({ user_id: userId, product_id: result.product_id })
        .first();

      if (myStockEntry) {
        await localDB.my_stock_products.update(myStockEntry.id, {
          quantity: result.new_qty,
          updated_at: new Date().toISOString(),
        });
      }
    }
  }

  logBulk("IndexedDB sync completed");
}

/**
 * Prepara ajustes de stock para un remito (crear/update/delete)
 */
export function prepareDeliveryNoteAdjustments(
  items: Array<{ productId?: string; quantity: number }>,
  operation: "create" | "delete" | "revert",
): StockAdjustment[] {
  return items
    .filter((item) => item.productId)
    .map((item) => ({
      product_id: item.productId!,
      // bulk_adjust_stock castea list_id a uuid (aunque hoy no lo use). Evitamos "" que rompe el cast.
      list_id: NIL_UUID,
      delta: operation === "delete" || operation === "revert" ? item.quantity : -item.quantity,
    }));
}

/**
 * Calcula ajustes netos de stock comparando items originales vs nuevos
 * Devuelve solo los deltas necesarios (evita revert+create para productos sin cambios)
 */
export function calculateNetStockAdjustments(
  originalItems: Array<{ productId?: string; quantity: number }>,
  newItems: Array<{ productId?: string; quantity: number }>,
): StockAdjustment[] {
  const adjustmentsMap = new Map<string, number>();

  // Sumar cantidades originales (se devuelven al stock = delta positivo)
  for (const item of originalItems) {
    if (item.productId) {
      const current = adjustmentsMap.get(item.productId) || 0;
      adjustmentsMap.set(item.productId, current + item.quantity);
    }
  }

  // Restar cantidades nuevas (se descuentan del stock = delta negativo)
  for (const item of newItems) {
    if (item.productId) {
      const current = adjustmentsMap.get(item.productId) || 0;
      adjustmentsMap.set(item.productId, current - item.quantity);
    }
  }

  // Convertir a array de ajustes (solo los que tienen delta != 0)
  const adjustments: StockAdjustment[] = [];
  for (const [productId, delta] of adjustmentsMap.entries()) {
    if (delta !== 0) {
      adjustments.push({
        product_id: productId,
        list_id: NIL_UUID,
        delta,
      });
    }
  }

  return adjustments;
}

