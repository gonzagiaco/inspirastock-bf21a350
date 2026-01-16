import { useCallback, useEffect, useMemo, useState } from "react";
import { useMyStockProducts } from "@/hooks/useMyStockProducts";
import { useProductListsIndex } from "@/hooks/useProductListsIndex";
import { useRequestCartStore } from "@/stores/requestCartStore";
import { useConfigStore } from "@/stores/configStore";
import type { RequestItem } from "@/types";
import { localDB, MY_STOCK_UPDATED_EVENT } from "@/lib/localDB";

function parsePriceValue(value: any): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[^0-9.,-]/g, "").replace(",", ".");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function useAutoAddLowStockToCart() {
  const {
    autoAddLowStockToCart,
    dismissedLowStockIds,
    addDismissedLowStockIds,
    removeDismissedLowStockIds,
    clearDismissedLowStockIds,
  } = useConfigStore();
  const { requestList, addOrIncrement, updateQuantity } = useRequestCartStore();
  const { data: products = [], isSuccess } = useMyStockProducts();
  const { data: lists = [] } = useProductListsIndex();
  const [isConfigHydrated, setIsConfigHydrated] = useState(useConfigStore.persist.hasHydrated());

  const mappingConfigByListId = useMemo(() => {
    const map = new Map<string, any>();
    (lists as any[]).forEach((list) => {
      if (list?.id) map.set(list.id, list.mapping_config);
    });
    return map;
  }, [lists]);

  const dismissedSet = useMemo(() => new Set(dismissedLowStockIds), [dismissedLowStockIds]);

  const processLowStockProducts = useCallback(
    (sourceProducts: any[]) => {
      const lowStockProducts = sourceProducts.filter((product) => {
        const quantity = product.quantity ?? 0;
        const threshold = product.stock_threshold ?? 0;
        return threshold > 0 && quantity < threshold;
      });

      lowStockProducts.forEach((product) => {
        const productId = product.product_id || product.id;
        if (!productId || dismissedSet.has(productId)) return;

        const quantity = product.quantity ?? 0;
        const threshold = product.stock_threshold ?? 0;
        const neededQuantity = Math.max(0, threshold - quantity);
        if (neededQuantity <= 0) return;

        const existingItem = requestList.find((r) => r.productId === productId);
        if (existingItem) {
        if (existingItem.autoLowStock && !existingItem.manualOverride && existingItem.quantity < neededQuantity) {
          updateQuantity(existingItem.id, neededQuantity, { manualOverride: false });
        }
        return;
      }

        let finalPrice = parsePriceValue(product.price) ?? 0;
        const cartPriceColumn = mappingConfigByListId.get(product.list_id)?.cart_price_column;
        if (cartPriceColumn && product.calculated_data?.[cartPriceColumn]) {
          const fromCalculated = parsePriceValue(product.calculated_data[cartPriceColumn]);
          if (fromCalculated != null) finalPrice = fromCalculated;
        }

        const newRequest: RequestItem = {
          id:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          productId,
          code: product.code || "",
          name: product.name || "",
          supplierId: product.supplierId || product.supplier_id || "",
        costPrice: finalPrice,
        quantity: neededQuantity,
        autoLowStock: true,
        manualOverride: false,
      };

      addOrIncrement(newRequest);
      });
    },
    [addOrIncrement, dismissedSet, mappingConfigByListId, requestList, updateQuantity],
  );

  useEffect(() => {
    if (useConfigStore.persist.hasHydrated()) {
      setIsConfigHydrated(true);
      return;
    }

    const unsubscribe = useConfigStore.persist.onFinishHydration(() => {
      setIsConfigHydrated(true);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isConfigHydrated) return;
    if (!autoAddLowStockToCart) {
      clearDismissedLowStockIds();
    }
  }, [autoAddLowStockToCart, clearDismissedLowStockIds, isConfigHydrated]);

  useEffect(() => {
    if (!dismissedLowStockIds.length || !isConfigHydrated || !isSuccess) return;
    const stillLowStockIds = new Set(
      (products as any[])
        .filter((product) => {
          const quantity = product.quantity ?? 0;
          const threshold = product.stock_threshold ?? 0;
          return threshold > 0 && quantity < threshold;
        })
        .map((product) => product.product_id || product.id)
        .filter(Boolean),
    );

    const toRemove = dismissedLowStockIds.filter((id) => !stillLowStockIds.has(id));
    if (toRemove.length > 0) {
      removeDismissedLowStockIds(toRemove);
    }
  }, [dismissedLowStockIds, isConfigHydrated, isSuccess, products, removeDismissedLowStockIds]);

  useEffect(() => {
    if (!autoAddLowStockToCart || !isSuccess || !isConfigHydrated) return;
    processLowStockProducts(products as any[]);
  }, [
    autoAddLowStockToCart,
    isSuccess,
    products,
    processLowStockProducts,
    isConfigHydrated,
  ]);

  useEffect(() => {
    if (!autoAddLowStockToCart || !isConfigHydrated) return;

    const handleMyStockUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ productId?: string; productIds?: string[] }>).detail;
      const productIds = detail?.productIds ?? (detail?.productId ? [detail.productId] : []);
      if (!productIds.length) return;

      void (async () => {
        const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));
        if (!uniqueIds.length) return;

        const [myStockRows, indexRows] = await Promise.all([
          localDB.my_stock_products.where("product_id").anyOf(uniqueIds).toArray(),
          localDB.dynamic_products_index.where("product_id").anyOf(uniqueIds).toArray(),
        ]);

        if (!myStockRows.length) return;

        const indexByProductId = new Map(indexRows.map((row: any) => [row.product_id, row]));
        const listIds = Array.from(
          new Set(indexRows.map((row: any) => row.list_id).filter(Boolean)),
        );
        const listRows = listIds.length
          ? await localDB.product_lists.where("id").anyOf(listIds).toArray()
          : [];
        const supplierByListId = new Map(listRows.map((row: any) => [row.id, row.supplier_id]));

        const enriched = myStockRows.map((row: any) => {
          const indexRow = indexByProductId.get(row.product_id);
          const listId = indexRow?.list_id ?? "";
          return {
            ...row,
            list_id: listId,
            supplier_id: supplierByListId.get(listId) ?? "",
            calculated_data: indexRow?.calculated_data ?? {},
            price: row.price ?? indexRow?.price ?? 0,
            code: row.code ?? indexRow?.code ?? "",
            name: row.name ?? indexRow?.name ?? "",
          };
        });

        processLowStockProducts(enriched);
      })();
    };

    window.addEventListener(MY_STOCK_UPDATED_EVENT, handleMyStockUpdated as EventListener);
    return () => {
      window.removeEventListener(MY_STOCK_UPDATED_EVENT, handleMyStockUpdated as EventListener);
    };
  }, [autoAddLowStockToCart, isConfigHydrated, processLowStockProducts]);
}
