import { useState, useMemo, useEffect, useCallback } from "react";
import { Filter, Package, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useMyStockProducts } from "@/hooks/useMyStockProducts";
import { useSuppliers } from "@/hooks/useSuppliers";
import { useProductListsIndex } from "@/hooks/useProductListsIndex";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useIsMobile } from "@/hooks/use-mobile";
import { MyStockSupplierSection } from "@/components/stock/MyStockSupplierSection";
import RequestCart from "@/components/RequestCart";
import { RequestItem } from "@/types";
import { exportOrdersBySupplier } from "@/utils/exportOrdersBySupplier";
import { toast } from "sonner";
import { useRequestCartStore } from "@/stores/requestCartStore";

function parsePriceValue(value: any): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[^0-9.,-]/g, "").replace(",", ".");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function MiStock() {
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [onlyWithStock, setOnlyWithStock] = useState(false);
  const [isCartCollapsed, setIsCartCollapsed] = useState(true);
  const { requestList, addOrIncrement, updateQuantity, removeItem } = useRequestCartStore();

  // Estado local para actualizaciones optimistas
  const [localProducts, setLocalProducts] = useState<any[]>([]);

  // Estado para controlar la hidratación completa
  const [isHydrated, setIsHydrated] = useState(false);

  const { suppliers = [], isLoading: isLoadingSuppliers } = useSuppliers();
  const { data: lists = [], isLoading: isLoadingLists } = useProductListsIndex();
  const isOnline = useOnlineStatus();
  const isMobile = useIsMobile();

  const {
    data: myStockProducts,
    isLoading: isLoadingProducts,
    isFetching: isFetchingProducts,
    isSuccess: isSuccessProducts,
  } = useMyStockProducts({
    supplierId: supplierFilter,
    searchTerm,
    onlyWithStock,
  });

  // Sincronizar estado local con datos de la query
  useEffect(() => {
    if (!isSuccessProducts) return;
    setLocalProducts(myStockProducts ?? []);
  }, [isSuccessProducts, myStockProducts]);

  // Controlar hidratación completa antes de renderizar
  useEffect(() => {
    if (
      isSuccessProducts &&
      !isLoadingLists &&
      !isLoadingSuppliers &&
      lists.length >= 0
    ) {
      setIsHydrated(true);
    }
  }, [isSuccessProducts, isLoadingLists, isLoadingSuppliers, lists]);

  // Handler para actualizar cantidad localmente (optimista)
  const handleUpdateQuantity = useCallback((productId: string, newQuantity: number) => {
    setLocalProducts((prev) => prev.map((p) => (p.product_id === productId ? { ...p, quantity: newQuantity } : p)));
  }, []);

  const handleUpdateThreshold = useCallback((productId: string, newThreshold: number) => {
    setLocalProducts((prev) =>
      prev.map((p) => (p.product_id === productId ? { ...p, stock_threshold: newThreshold } : p)),
    );
  }, []);

  // Handler para eliminar producto localmente (optimista)
  const handleRemoveProduct = useCallback((productId: string) => {
    setLocalProducts((prev) => prev.filter((p) => p.product_id !== productId));
  }, []);

  const handleRemoveProducts = useCallback((productIds: string[]) => {
    if (!productIds.length) return;
    const ids = new Set(productIds);
    setLocalProducts((prev) => prev.filter((p) => !ids.has(p.product_id)));
  }, []);

  // Usar isHydrated para controlar el loading state inicial
  const isLoading = !isHydrated || isLoadingSuppliers || isLoadingLists || isLoadingProducts;
  const isRefreshing = isHydrated && isFetchingProducts;

  // Usar localProducts en lugar de myStockProducts para UI
  const productsToDisplay =
    localProducts.length > 0
      ? localProducts
      : (myStockProducts || []);

  // Group products by supplier and then by list
  const supplierSections = useMemo(() => {
    const sections = new Map<
      string,
      {
        supplierName: string;
        supplierLogo: string | null;
        lists: Map<
          string,
          {
            listId: string;
            listName: string;
            mappingConfig: any;
            columnSchema: any[];
            products: any[];
            lastStockUpdate: number;
          }
        >;
      }
    >();

    const listInfoMap = new Map<string, any>();
    for (const list of lists as any[]) {
      listInfoMap.set(list.id, list);
    }

    const supplierMap = new Map<string, any>();
    for (const supplier of suppliers as any[]) {
      supplierMap.set(supplier.id, supplier);
    }

    for (const product of productsToDisplay as any[]) {
      const listInfo = listInfoMap.get(product.list_id);
      if (!listInfo) continue;

      const supplier = supplierMap.get(listInfo.supplier_id);
      if (!supplier) continue;

      if (!sections.has(supplier.id)) {
        sections.set(supplier.id, {
          supplierName: supplier.name,
          supplierLogo: supplier.logo,
          lists: new Map(),
        });
      }

      const section = sections.get(supplier.id)!;
      if (!section.lists.has(listInfo.id)) {
        section.lists.set(listInfo.id, {
          listId: listInfo.id,
          listName: listInfo.name,
          mappingConfig: listInfo.mapping_config,
          columnSchema: listInfo.column_schema || [],
          products: [],
          lastStockUpdate: 0,
        });
      }

      const listEntry = section.lists.get(listInfo.id)!;
      const updatedAt = Date.parse(product.updated_at || "") || 0;
      listEntry.lastStockUpdate = Math.max(listEntry.lastStockUpdate, updatedAt);

      listEntry.products.push(product);
    }

    return sections;
  }, [productsToDisplay, lists, suppliers]);

  const visibleSupplierSections = useMemo(() => {
    const entries =
      supplierFilter === "all"
        ? Array.from(supplierSections.entries())
        : Array.from(supplierSections.entries()).filter(([supplierId]) => supplierId === supplierFilter);

    return entries.map(([supplierId, section]) => ({
      supplierId,
      supplierName: section.supplierName,
      supplierLogo: section.supplierLogo,
      lists: Array.from(section.lists.values()).sort((a, b) => b.lastStockUpdate - a.lastStockUpdate),
    }));
  }, [supplierSections, supplierFilter]);

  const handleAddToRequest = useCallback((product: any, mappingConfig?: any, options?: { silent?: boolean }) => {
    const existingItem = requestList.find((r) => r.productId === product.id);
    const effectiveSupplierId = product.supplierId || product.supplier_id || "";

    if (existingItem) {
      updateQuantity(existingItem.id, existingItem.quantity + 1);
    } else {
      let finalPrice = parsePriceValue(product.price) ?? 0;
      const cartPriceColumn = mappingConfig?.cart_price_column;
      if (cartPriceColumn && product.calculated_data?.[cartPriceColumn]) {
        const fromCalculated = parsePriceValue(product.calculated_data[cartPriceColumn]);
        if (fromCalculated != null) finalPrice = fromCalculated;
      }

      const newRequest: RequestItem = {
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        productId: product.id,
        code: product.code || "",
        name: product.name || "",
        supplierId: effectiveSupplierId,
        costPrice: finalPrice,
        quantity: 1,
      };
      addOrIncrement(newRequest);
      if (!options?.silent) toast.success("Producto agregado al carrito");
    }
  }, [addOrIncrement, requestList, updateQuantity]);

  const handleUpdateRequestQuantity = useCallback((id: string, quantity: number) => {
    updateQuantity(id, quantity);
  }, [updateQuantity]);

  const handleRemoveFromRequest = useCallback((id: string) => {
    removeItem(id);
    toast.success("Producto eliminado del carrito");
  }, [removeItem]);

  const handleExportToExcel = useCallback(() => {
    if (requestList.length === 0) {
      toast.error("No hay productos para exportar");
      return;
    }
    exportOrdersBySupplier(requestList, suppliers);
    const uniqueSuppliers = new Set(requestList.map((item) => item.supplierId)).size;
    toast.success("Pedidos exportados", {
      description: `Se generaron ${uniqueSuppliers} archivo${uniqueSuppliers > 1 ? "s" : ""} (uno por proveedor)`,
    });
  }, [requestList, suppliers]);

  const totalProducts = productsToDisplay.length;
  const productsWithStock = productsToDisplay.filter((p: any) => (p.quantity || 0) > 0).length;

  return (
    <div className="min-h-screen w-full bg-background overflow-x-hidden">
      <header
        className="sticky top-0 z-10 bg-background border-b"
        style={{ paddingTop: "max(env(safe-area-inset-top), 1.5rem)" }}
      >
        <div className="w-full px-4 pt-5 pb-6 lg:pl-4 max-w-full overflow-hidden">
          <div className="flex items-center gap-3 mb-6">
            <Package className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">Mi Stock</h1>
          </div>

          <div className="flex flex-col md:flex-row gap-4 mb-4">
            <div className="flex flex-1 gap-2">
              <div className="relative w-full">
                <Input
                  placeholder="Buscar en mi stock..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pr-10"
                />
                {searchTerm.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7588eb]"
                    aria-label="Limpiar búsqueda"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                <SelectTrigger className="w-[200px] gap-1">
                  <Filter className="mr-2 h-4 w-4" />
                  <SelectValue placeholder="Proveedor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los proveedores</SelectItem>
                  {suppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-2 px-3 py-2 border rounded-md bg-background">
                <Switch id="only-with-stock" checked={onlyWithStock} onCheckedChange={setOnlyWithStock} />
                <Label htmlFor="only-with-stock" className="text-sm whitespace-nowrap cursor-pointer">
                  Sólo con stock
                </Label>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap text-sm text-muted-foreground">
            <span>{totalProducts} productos en mi stock</span>
            <span>•</span>
            <span>{productsWithStock} con stock disponible</span>
            <span>•</span>
            <span>
              {visibleSupplierSections.length} {visibleSupplierSections.length === 1 ? "proveedor" : "proveedores"}
            </span>
            {!isOnline && <span className="text-amber-500">(modo offline)</span>}
          </div>
          {isRefreshing && (
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-primary"></div>
              Actualizando mi stock...
            </div>
          )}
        </div>
      </header>

      <div className="w-full px-4 py-6 max-w-full overflow-hidden">
        <RequestCart
          requests={requestList}
          onUpdateQuantity={handleUpdateRequestQuantity}
          onRemove={handleRemoveFromRequest}
          onExport={handleExportToExcel}
          suppliers={suppliers}
          isCollapsed={isCartCollapsed}
          onToggleCollapse={() => setIsCartCollapsed(!isCartCollapsed)}
        />

        <div className="w-full">
          {isLoading ? (
            <div className="text-center py-12 space-y-4">
              <div className="flex justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
              </div>
              <p className="text-muted-foreground">Cargando mi stock...</p>
            </div>
          ) : visibleSupplierSections.length === 0 ? (
            <Card className="p-12 text-center">
              <Package className="h-16 w-16 mx-auto mb-4 text-muted-foreground/50" />
              <h3 className="text-lg font-semibold mb-2">No hay productos en tu stock</h3>
              <p className="text-muted-foreground mb-4">
                {searchTerm
                  ? `No se encontraron productos para "${searchTerm}"`
                  : "Agrega productos desde las listas de proveedores o edita la cantidad de stock de cualquier producto."}
              </p>
            </Card>
          ) : (
            <div className="space-y-6">
              {visibleSupplierSections.map((section) => (
                <MyStockSupplierSection
                  key={section.supplierId}
                  supplierName={section.supplierName}
                  supplierLogo={section.supplierLogo}
                  lists={section.lists}
                  onAddToRequest={handleAddToRequest}
                  onQuantityChange={handleUpdateQuantity}
                  onThresholdChange={handleUpdateThreshold}
                  onRemoveProduct={handleRemoveProduct}
                  onRemoveProducts={handleRemoveProducts}
                  isMobile={isMobile}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
