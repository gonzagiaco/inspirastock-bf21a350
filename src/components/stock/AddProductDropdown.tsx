import { useEffect, useState } from "react";
import { ShoppingCart, Package, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { addToMyStock, localDB, removeFromMyStock } from "@/lib/localDB";
import { useQueryClient } from "@tanstack/react-query";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocation } from "react-router-dom";

interface AddProductDropdownProps {
  product: any;
  mappingConfig?: any;
  onAddToRequest: (product: any, mappingConfig?: any, options?: { silent?: boolean }) => void;
  onStockChange?: (productId: string, patch: { quantity?: number; stock_threshold?: number; in_my_stock?: boolean }) => void;
  showAddToStock?: boolean;
  showRemoveFromStock?: boolean;
}

export function AddProductDropdown({
  product,
  mappingConfig,
  onAddToRequest,
  onStockChange,
  showAddToStock = true,
  showRemoveFromStock = false,
}: AddProductDropdownProps) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const isInMyStockPath = location.pathname === "/";

  const [hasBeenAddedToStock, setHasBeenAddedToStock] = useState(false);

  const productId = product.product_id || product.id;
  const syncListProductsCache = async (
    targetProductId: string,
    overrides?: {
      quantity?: number;
      stock_threshold?: number;
      in_my_stock?: boolean;
    },
  ) => {
    const [indexRow, stockRow] = await Promise.all([
      localDB.dynamic_products_index.where({ product_id: targetProductId }).first(),
      localDB.my_stock_products.where({ product_id: targetProductId }).first(),
    ]);

    const nextQuantity = overrides?.quantity ?? stockRow?.quantity ?? indexRow?.quantity ?? 0;
    const nextThreshold = overrides?.stock_threshold ?? stockRow?.stock_threshold ?? indexRow?.stock_threshold ?? 0;
    const inMyStock = overrides?.in_my_stock ?? Boolean(stockRow);

    queryClient.setQueriesData({ queryKey: ["list-products"] }, (old: any) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((page: any) => ({
          ...page,
          data: (page.data ?? []).map((item: any) =>
            item.product_id === targetProductId
              ? {
                  ...item,
                  quantity: nextQuantity,
                  stock_threshold: nextThreshold,
                  in_my_stock: inMyStock,
                }
              : item,
          ),
        })),
      };
    });
  };
  const syncGlobalSearchCache = (
    targetProductId: string,
    overrides?: {
      quantity?: number;
      stock_threshold?: number;
      in_my_stock?: boolean;
    },
  ) => {
    queryClient.setQueriesData({ queryKey: ["global-search"], exact: false }, (old: any) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((page: any) => ({
          ...page,
          data: (page.data ?? []).map((item: any) =>
            item.product_id === targetProductId || item.id === targetProductId
              ? {
                  ...item,
                  quantity: overrides?.quantity ?? item.quantity,
                  stock_threshold: overrides?.stock_threshold ?? item.stock_threshold,
                  in_my_stock: overrides?.in_my_stock ?? item.in_my_stock,
                }
              : item,
          ),
        })),
      };
    });
  };
  const handleAddToStock = async () => {
    const prevQuantity = Number(product.quantity || 0);
    const prevInMyStock = Boolean(product.in_my_stock);
    const nextQuantity = Math.max(1, prevQuantity + 1);
    const optimisticPatch = { quantity: nextQuantity, in_my_stock: true };

    setHasBeenAddedToStock(true);
    product.quantity = nextQuantity;
    product.in_my_stock = true;
    onStockChange?.(productId, optimisticPatch);
    await syncListProductsCache(productId, optimisticPatch);
    syncGlobalSearchCache(productId, optimisticPatch);
    const now = new Date().toISOString();
    queryClient.setQueriesData({ queryKey: ["my-stock"], exact: false }, (old: any) => {
      if (!Array.isArray(old)) return old;
      const exists = old.some((item: any) => item.product_id === productId);
      if (exists) {
        return old.map((item: any) =>
          item.product_id === productId
            ? {
                ...item,
                quantity: nextQuantity,
                stock_threshold: item.stock_threshold ?? 0,
                updated_at: now,
                in_my_stock: true,
              }
            : item,
        );
      }

      return [
        {
          id: productId,
          product_id: productId,
          list_id: product.listId || product.list_id || "",
          code: product.code ?? "",
          name: product.name ?? "",
          price: product.price ?? null,
          quantity: nextQuantity,
          stock_threshold: 0,
          calculated_data: product.calculated_data ?? {},
          data: product.data ?? {},
          created_at: now,
          updated_at: now,
        },
        ...old,
      ];
    });

    try {
      await addToMyStock(productId, 1);
      toast.success("Agregado a Mi Stock");
      queryClient.invalidateQueries({ queryKey: ["my-stock"], exact: false });
    } catch (error) {
      console.error("Error al agregar a Mi Stock:", error);
      const rollback = { quantity: prevQuantity, in_my_stock: prevInMyStock };
      product.quantity = prevQuantity;
      product.in_my_stock = prevInMyStock;
      onStockChange?.(productId, rollback);
      await syncListProductsCache(productId, rollback);
      syncGlobalSearchCache(productId, rollback);
      setHasBeenAddedToStock(false);
      toast.error("Error al agregar a Mi Stock");
    }
  };

  const handleRemoveFromStock = async () => {
    toast.success("Producto quitado de Mi Stock");

    const rollback = { quantity: product.quantity || 0, in_my_stock: Boolean(product.in_my_stock) };
    try {
      product.in_my_stock = false;
      product.quantity = 0;
      const optimisticPatch = { quantity: 0, in_my_stock: false };
      onStockChange?.(productId, optimisticPatch);
      await syncListProductsCache(productId, optimisticPatch);
      syncGlobalSearchCache(productId, optimisticPatch);
      await removeFromMyStock(productId);
      queryClient.invalidateQueries({ queryKey: ["my-stock"], exact: false });
    } catch (error: any) {
      console.error("Error removing from stock:", error);
      product.quantity = rollback.quantity;
      product.in_my_stock = rollback.in_my_stock;
      onStockChange?.(productId, rollback);
      await syncListProductsCache(productId, rollback);
      syncGlobalSearchCache(productId, rollback);
      toast.error("Error al quitar de Mi Stock");
    }
  };

  const isInMyStock = Boolean(product.in_my_stock);
  const shouldDisableAddToStock = isInMyStock || hasBeenAddedToStock;

  useEffect(() => {
    if (!isInMyStock) setHasBeenAddedToStock(false);
  }, [isInMyStock]);

  // Página Mi Stock: mostrar botones para agregar al pedido y quitar del stock
  if (showRemoveFromStock) {
    return (
      <TooltipProvider delayDuration={300}>
        <div className="flex gap-1" data-interactive="true">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  onAddToRequest(product, mappingConfig);
                  e.stopPropagation();
                }}
                className="flex-1"
              >
                <ShoppingCart className="h-4 w-4" />
                <span>Agregar al pedido</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>Agregar al pedido</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  handleRemoveFromStock();
                  e.stopPropagation();
                }}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
                <span>Quitar de Mi Stock</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>Quitar de Mi Stock</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    );
  }

  // Lista de productos: mostrar dos botones separados
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex gap-1" data-interactive="true">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onAddToRequest(product, mappingConfig);
              }}
              className="flex-1"
            >
              <ShoppingCart className="h-4 w-4" />
              <span className={`${!isInMyStockPath ? "sr-only" : ""}`}>Agregar al carrito</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>Agregar al carrito</p>
          </TooltipContent>
        </Tooltip>

        {showAddToStock && !isInMyStockPath && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  handleAddToStock();
                  e.stopPropagation();
                }}
                disabled={shouldDisableAddToStock}
                className={
                  shouldDisableAddToStock ? "opacity-50 cursor-not-allowed" : "text-primary hover:text-primary"
                }
              >
                <Package className="h-4 w-4" />
                <span className="sr-only">{shouldDisableAddToStock ? "Ya en Mi Stock" : "Agregar a Mi Stock"}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>{shouldDisableAddToStock ? "Ya está en Mi Stock" : "Agregar a Mi Stock"}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
