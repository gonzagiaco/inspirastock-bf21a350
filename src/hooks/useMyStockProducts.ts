import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { localDB, MY_STOCK_UPDATED_EVENT } from "@/lib/localDB";
import { useOnlineStatus } from "./useOnlineStatus";
import { supabase } from "@/integrations/supabase/client";

export interface MyStockProduct {
  id: string;
  product_id: string;
  list_id: string;
  code: string | null;
  name: string | null;
  price: number | null;
  quantity: number | null;
  stock_threshold?: number | null;
  calculated_data?: Record<string, any>;
  data?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

interface UseMyStockProductsOptions {
  supplierId?: string | null;
  searchTerm?: string;
  onlyWithStock?: boolean;
}

// Logging helper
const logSync = (action: string, details?: any) => {
  const timestamp = new Date().toISOString();
  console.log(`[MyStock ${timestamp}] ${action}`, details || "");
};

const IN_CLAUSE_BATCH_SIZE = 500;
const MY_STOCK_PAGE_SIZE = 900;

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

async function fetchInBatches<T = any>(params: {
  table: string;
  select: string;
  column: string;
  ids: string[];
}): Promise<T[]> {
  const { table, select, column, ids } = params;
  if (ids.length === 0) return [];

  const batches = chunkArray(ids, IN_CLAUSE_BATCH_SIZE);
  const results = await Promise.all(
    batches.map(async (batch) => {
      const { data, error } = await (supabase as any).from(table).select(select).in(column, batch);
      if (error) throw error;
      return (data ?? []) as T[];
    }),
  );

  return results.flat();
}

async function fetchAllMyStockRows(userId: string): Promise<any[]> {
  const rows: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("my_stock_products")
      .select("id, product_id, user_id, quantity, stock_threshold, code, name, price, created_at, updated_at")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, from + MY_STOCK_PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < MY_STOCK_PAGE_SIZE) break;
    from += MY_STOCK_PAGE_SIZE;
  }
  return rows;
}

async function updateLocalMyStockCache(userId: string, rows: any[]): Promise<void> {
  await localDB.transaction("rw", localDB.my_stock_products, async () => {
    await localDB.my_stock_products.where({ user_id: userId }).delete();
    if (rows.length > 0) {
      await localDB.my_stock_products.bulkPut(rows);
    }
  });
}

/**
 * Hook to fetch products for "My Stock" view.
 * Criteria: presence in my_stock_products
 * Uses indexed queries for performance (no full table scans)
 */
export function useMyStockProducts(options: UseMyStockProductsOptions = {}) {
  const { supplierId, searchTerm, onlyWithStock } = options;
  const isOnline = useOnlineStatus();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["my-stock", "remote-first-v1", isOnline ? "online" : "offline"],
    queryFn: async () => {
      const startTime = performance.now();
      logSync("Fetching my-stock products", { supplierId, searchTerm, onlyWithStock });

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuario no autenticado");

      let enrichedProducts: any[] = [];

      if (isOnline !== false) {
        // ONLINE (prioridad): fetch desde Supabase, usando my_stock_products como fuente de verdad.
        let myStockRows: any[] = [];
        let fetchFailed = false;
        try {
          myStockRows = await fetchAllMyStockRows(user.id);
        } catch (myStockError) {
          fetchFailed = true;
          console.error("Error fetching my_stock_products (online):", myStockError);
          // Fallback a offline cache (2da opcion)
          const offlineEntries = await localDB.my_stock_products.where({ user_id: user.id }).toArray();
          enrichedProducts = offlineEntries.map((entry: any) => ({
            ...entry,
            list_id: entry.list_id ?? "",
            data: entry.data ?? {},
            calculated_data: entry.calculated_data ?? {},
            code: entry.code ?? "",
            name: entry.name ?? "",
            price: entry.price ?? null,
            quantity: entry.quantity ?? 0,
            stock_threshold: entry.stock_threshold ?? 0,
          }));
        }

        if (!fetchFailed) {
          const safeRows = (myStockRows ?? []) as any[];
          if (safeRows.length === 0) {
            await updateLocalMyStockCache(user.id, []);
            return [];
          }

          const productIds = Array.from(new Set(safeRows.map((row) => row.product_id).filter(Boolean)));

          const [indexEntries, fullProducts] = await Promise.all([
            fetchInBatches({
              table: "dynamic_products_index",
              select: "product_id, list_id, code, name, price, calculated_data, updated_at",
              column: "product_id",
              ids: productIds,
            }),
            fetchInBatches({
              table: "dynamic_products",
              select: "id, list_id, data, updated_at",
              column: "id",
              ids: productIds,
            }),
          ]);

          const indexByProductId = new Map<string, any>();
          (indexEntries || []).forEach((p: any) => indexByProductId.set(p.product_id, p));

          const fullProductsMap = new Map<string, any>();
          (fullProducts || []).forEach((p: any) => {
            if (p?.id) fullProductsMap.set(p.id, p);
          });

          const listIds = Array.from(
            new Set(
              [
                ...safeRows.map((row) => row.list_id),
                ...safeRows.map((row) => indexByProductId.get(row.product_id)?.list_id),
                ...safeRows.map((row) => fullProductsMap.get(row.product_id)?.list_id),
              ].filter(Boolean),
            ),
          );

          const productLists = await fetchInBatches({
            table: "product_lists",
            select: "id, supplier_id",
            column: "id",
            ids: listIds,
          });

          const listToSupplier = new Map<string, string>();
          (productLists || []).forEach((list: any) => {
            if (list?.id) listToSupplier.set(list.id, list.supplier_id);
          });

          enrichedProducts = safeRows.map((entry: any) => {
            const indexRecord = indexByProductId.get(entry.product_id);
            const fullProduct = fullProductsMap.get(entry.product_id);
            const resolvedListId = fullProduct?.list_id ?? indexRecord?.list_id ?? entry.list_id ?? "";

            return {
              ...entry,
              list_id: resolvedListId,
              supplier_id: listToSupplier.get(resolvedListId) ?? null,
              data: fullProduct?.data || {},
              calculated_data: indexRecord?.calculated_data || {},
              code: entry.code ?? indexRecord?.code ?? "",
              name: entry.name ?? indexRecord?.name ?? "",
              price: entry.price ?? indexRecord?.price ?? null,
              quantity: entry.quantity ?? 0,
              stock_threshold: entry.stock_threshold ?? 0,
            };
          });

          // Mantener cache offline actualizado (sin bloquear el render).
          void updateLocalMyStockCache(user.id, safeRows).catch((e) =>
            console.error("Error updating local my_stock cache:", e),
          );
        }
      } else {
        // OFFLINE: usar IndexedDB.
        const myStockEntries = await localDB.my_stock_products.where({ user_id: user.id }).toArray();
        if (!myStockEntries.length) return [];

        const productIds = myStockEntries.map((entry) => entry.product_id);
        const [fullProducts, indexEntries, productLists] = await Promise.all([
          localDB.dynamic_products.bulkGet(productIds),
          localDB.dynamic_products_index.where("product_id").anyOf(productIds).toArray(),
          localDB.product_lists.toArray(),
        ]);

        const fullProductsMap = new Map<string, any>();
        fullProducts.forEach((p) => {
          if (p) fullProductsMap.set(p.id, p);
        });

        const indexByProductId = new Map<string, any>();
        indexEntries.forEach((p) => indexByProductId.set(p.product_id, p));

        const listToSupplier = new Map<string, string>();
        productLists.forEach((list: any) => {
          listToSupplier.set(list.id, list.supplier_id);
        });

        enrichedProducts = myStockEntries.map((entry) => {
          const fullProduct = fullProductsMap.get(entry.product_id);
          const indexRecord = indexByProductId.get(entry.product_id);
          const resolvedListId = fullProduct?.list_id ?? indexRecord?.list_id ?? "";

          return {
            ...entry,
            list_id: resolvedListId,
            supplier_id: listToSupplier.get(resolvedListId) ?? null,
            data: fullProduct?.data || {},
            calculated_data: indexRecord?.calculated_data || {},
            code: entry.code ?? indexRecord?.code ?? "",
            name: entry.name ?? indexRecord?.name ?? "",
            price: entry.price ?? indexRecord?.price ?? null,
            quantity: entry.quantity ?? 0,
            stock_threshold: entry.stock_threshold ?? 0,
          };
        });
      }

      const endTime = performance.now();
      logSync(`Query completed in ${(endTime - startTime).toFixed(2)} ms`, {
        totalProducts: enrichedProducts?.length ?? 0,
      });

      return enrichedProducts as MyStockProduct[];
    },
    staleTime: Infinity,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleMyStockUpdated = () => {
      queryClient.invalidateQueries({ queryKey: ["my-stock"], exact: false });
    };

    window.addEventListener(MY_STOCK_UPDATED_EVENT, handleMyStockUpdated as EventListener);
    return () => window.removeEventListener(MY_STOCK_UPDATED_EVENT, handleMyStockUpdated as EventListener);
  }, [queryClient]);

  const filteredData = useMemo(() => {
    let data = (query.data ?? []) as any[];

    if (supplierId && supplierId !== "all") {
      data = data.filter((p: any) => p.supplier_id === supplierId);
    }

    if (searchTerm && searchTerm.trim().length >= 1) {
      const lowerSearch = searchTerm.toLowerCase().trim();
      data = data.filter((p: any) => p.code?.toLowerCase().includes(lowerSearch) || p.name?.toLowerCase().includes(lowerSearch));
    }

    if (onlyWithStock) {
      data = data.filter((p: any) => (p.quantity || 0) > 0);
    }

    data = [...data].sort((a: any, b: any) => {
      const nameA = a.name || "";
      const nameB = b.name || "";
      return nameA.localeCompare(nameB);
    });

    return data as MyStockProduct[];
  }, [query.data, supplierId, searchTerm, onlyWithStock]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["my-stock"] });
  };

  return {
    ...query,
    data: filteredData,
    invalidate,
  };
}

/**
 * Sync individual product's my_stock state from Supabase to IndexedDB
 */
export async function syncProductMyStockState(productId: string): Promise<void> {
  logSync("syncProductMyStockState", { productId });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data, error } = await supabase
    .from("my_stock_products")
    .select("id, product_id, user_id, quantity, stock_threshold, code, name, price, created_at, updated_at")
    .eq("user_id", user.id)
    .eq("product_id", productId)
    .maybeSingle();

  if (error) {
    logSync("ERROR syncProductMyStockState", error);
    return;
  }

  const existing = await localDB.my_stock_products.where({ user_id: user.id, product_id: productId }).first();

  if (!data) {
    if (existing) {
      await localDB.my_stock_products.delete(existing.id);
    }
    return;
  }

  if (existing) {
    await localDB.my_stock_products.update(existing.id, {
      quantity: data.quantity ?? 0,
      stock_threshold: data.stock_threshold ?? 0,
      code: data.code ?? existing.code,
      name: data.name ?? existing.name,
      price: data.price ?? existing.price,
      updated_at: data.updated_at,
    });
  } else {
    await localDB.my_stock_products.add(data);
  }

  await localDB.dynamic_products_index.where({ product_id: productId }).modify({
    quantity: data.quantity ?? 0,
    stock_threshold: data.stock_threshold ?? 0,
    updated_at: data.updated_at,
  });
}


