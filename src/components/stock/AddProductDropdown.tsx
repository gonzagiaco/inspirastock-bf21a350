import { useEffect, useState } from "react";
import { ShoppingCart, Package, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { addToMyStock, removeFromMyStock } from "@/lib/localDB";
import { useQueryClient } from "@tanstack/react-query";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocation } from "react-router-dom";

interface AddProductDropdownProps {
  product: any;
  mappingConfig?: any;
  onAddToRequest: (product: any, mappingConfig?: any, options?: { silent?: boolean }) => void;
  showAddToStock?: boolean;
  showRemoveFromStock?: boolean;
}

export function AddProductDropdown({
  product,
  mappingConfig,
  onAddToRequest,
  showAddToStock = true,
  showRemoveFromStock = false,
}: AddProductDropdownProps) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const isInMyStockPath = location.pathname === "/";

  const [hasBeenAddedToStock, setHasBeenAddedToStock] = useState(false);

  const productId = product.product_id || product.id;
  const handleAddToStock = async () => {
    setHasBeenAddedToStock(true);
    try {
      await addToMyStock(productId, 1);
      toast.success("Agregado a Mi Stock");
      queryClient.invalidateQueries({ queryKey: ["my-stock"], exact: false });
    } catch (error) {
      console.error("Error al agregar a Mi Stock:", error);
      setHasBeenAddedToStock(false);
      toast.error("Error al agregar a Mi Stock");
    }
  };

  const handleRemoveFromStock = async () => {
    toast.success("Producto quitado de Mi Stock");

    try {
      await removeFromMyStock(productId);
      queryClient.invalidateQueries({ queryKey: ["my-stock"], exact: false });
    } catch (error: any) {
      console.error("Error removing from stock:", error);
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
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setHasBeenAddedToStock(true);
                }}
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
