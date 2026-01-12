import { useEffect, useMemo, useState } from "react";
import { useMyStockProducts } from "@/hooks/useMyStockProducts";
import { useProductListsIndex } from "@/hooks/useProductListsIndex";
import { useRequestCartStore } from "@/stores/requestCartStore";
import { useConfigStore } from "@/stores/configStore";
import type { RequestItem } from "@/types";

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

    const lowStockProducts = (products as any[]).filter((product) => {
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
        if (existingItem.quantity < neededQuantity) {
          updateQuantity(existingItem.id, neededQuantity);
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
      };

      addOrIncrement(newRequest);
    });
  }, [
    autoAddLowStockToCart,
    isSuccess,
    dismissedSet,
    mappingConfigByListId,
    products,
    requestList,
    addOrIncrement,
    updateQuantity,
  ]);
}
