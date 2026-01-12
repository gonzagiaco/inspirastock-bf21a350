import Header from "@/components/Header";
import { Settings } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useConfigStore } from "@/stores/configStore";

const Configuracion = () => {
  const { autoAddLowStockToCart, setAutoAddLowStockToCart } = useConfigStore();

  return (
    <div className="flex-1 p-4 pt-11 lg:px-4 lg:py-10">
      <Header
        title="Configuración"
        subtitle="Ajustá las preferencias de la aplicación"
        showSearch={false}
        icon={<Settings className="h-8 w-8 text-primary" />}
      />

      <div className="space-y-6">
        <div className="glassmorphism rounded-xl shadow-lg p-6 space-y-4">
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Settings className="h-6 w-6" />
            Opciones del carrito
          </h2>

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="auto-add-low-stock" className="text-sm font-medium">
                Agregar automáticamente al carrito si hay bajo stock
              </Label>
              <p className="text-xs text-muted-foreground">
                Cuando un producto esté por debajo del umbral de stock mínimo, se agregará automáticamente al carrito de
                pedidos.
              </p>
            </div>
            <Switch
              id="auto-add-low-stock"
              checked={autoAddLowStockToCart}
              onCheckedChange={setAutoAddLowStockToCart}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Configuracion;
