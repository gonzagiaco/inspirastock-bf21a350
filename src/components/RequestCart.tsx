import { X, Minus, Plus, ShoppingCart, FileDown } from "lucide-react";
import { formatARS } from "@/utils/numberParser";
import { RequestItem, Supplier } from "@/types";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface RequestCartProps {
  requests: RequestItem[];
  onUpdateQuantity: (id: string, quantity: number) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onExport: () => void;
  suppliers: Supplier[];
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

const RequestCart = ({
  requests,
  onUpdateQuantity,
  onRemove,
  onClear,
  onExport,
  suppliers,
  isCollapsed,
  onToggleCollapse,
}: RequestCartProps) => {
  const total = requests.reduce((sum, item) => sum + item.costPrice * item.quantity, 0);

  const getSupplierName = (supplierId: string) => {
    return suppliers.find((s) => s.id === supplierId)?.name || "Unknown";
  };

  // Collapsed view - floating button
  if (isCollapsed) {
    return (
      <button
        onClick={onToggleCollapse}
        className="fixed bottom-6 right-6 z-20 bg-primary hover:bg-primary/90 rounded-full p-4 shadow-2xl transition-transform hover:scale-110"
      >
        <ShoppingCart className="h-6 w-6 text-primary-foreground" />
        {requests.length > 0 && (
          <Badge className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground">
            {requests.length}
          </Badge>
        )}
      </button>
    );
  }

  // Expanded view - floating panel
  return (
    <div className="fixed bottom-4 right-4 z-50 w-[calc(100vw-2rem)] sm:w-96 max-w-md max-h-[80vh] sm:max-h-[600px] glassmorphism rounded-xl shadow-2xl overflow-hidden flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-border bg-muted/50">
        <h2 className="text-xl font-bold text-foreground">Lista de Pedidos</h2>
        <button onClick={onToggleCollapse} className="p-2 hover:bg-muted rounded-lg transition-colors">
          <X className="h-5 w-5" />
        </button>
      </div>

      {requests.length === 0 ? (
        <div className="p-8 text-center text-muted-foreground">No hay productos en la lista</div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {requests.map((item) => (
              <div key={item.id} className="bg-muted/30 rounded-lg p-4 flex items-center justify-between">
                <div className="flex-1">
                  <div className="font-semibold text-foreground">{item.name}</div>
                  <div className="text-sm text-muted-foreground">
                    Código: {item.code} | Proveedor: {getSupplierName(item.supplierId)}
                  </div>
                  <div className="text-sm font-medium text-foreground mt-1">
                    Subtotal: {formatARS(item.costPrice * item.quantity)}
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="flex items-center space-x-2 bg-background/50 rounded-lg px-2">
                    <button
                      onClick={() => onUpdateQuantity(item.id, Math.max(1, item.quantity - 1))}
                      className="p-1 hover:bg-primary/20 rounded transition-colors"
                    >
                      <Minus className="h-4 w-4 text-primary" />
                    </button>
                    <span className="font-semibold text-foreground min-w-[2rem] text-center">{item.quantity}</span>
                    <button
                      onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                      className="p-1 hover:bg-primary/20 rounded transition-colors"
                    >
                      <Plus className="h-4 w-4 text-primary" />
                    </button>
                  </div>
                  <button
                    onClick={() => onRemove(item.id)}
                    className="p-2 hover:bg-red-500/20 rounded-full transition-colors text-red-500"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-border p-4 bg-muted/30 space-y-3">
            <Button 
              onClick={onExport} 
              className="w-full"
              variant="default"
              disabled={requests.length === 0}
            >
              <FileDown className="mr-2 h-4 w-4" />
              Exportar Pedidos ({requests.length} productos)
            </Button>
            <Button
              onClick={onClear}
              className="w-full"
              variant="destructive"
              disabled={requests.length === 0}
            >
              Limpiar carrito
            </Button>
            <div className="flex justify-between items-center">
              <span className="text-lg font-bold text-foreground">Total:</span>
              <span className="text-2xl font-bold text-primary">{formatARS(total)}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default RequestCart;
