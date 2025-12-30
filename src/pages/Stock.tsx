import { useState, useMemo } from "react";
import { Filter, FileDown, Plus, NotebookText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import RequestCart from "@/components/RequestCart";
import { RequestItem } from "@/types";
import { Card } from "@/components/ui/card";
import { exportOrdersBySupplier } from "@/utils/exportOrdersBySupplier";
import { SupplierStockSection } from "@/components/stock/SupplierStockSection";
import { toast } from "sonner";
import { useProductListsIndex } from "@/hooks/useProductListsIndex";
import { useSuppliers } from "@/hooks/useSuppliers";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { QuantityCell } from "@/components/stock/QuantityCell";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { getOfflineData } from "@/lib/localDB";
import { GlobalProductSearch } from "@/components/GlobalProductsSearch";
import { useMyStockProducts } from "@/hooks/useMyStockProducts";
import { useIsMobile } from "@/hooks/use-mobile";

// Helper function to extract name from product data for search results
function extractNameFromFullData(data: Record<string, any>, schema: any[], mappingConfig?: any): string {
  // 1. PRIORIDAD: Usar name_keys del mapping_config
  if (mappingConfig?.name_keys && Array.isArray(mappingConfig.name_keys)) {
    for (const key of mappingConfig.name_keys) {
      if (data[key] && String(data[key]).trim()) {
        return String(data[key]).trim();
      }
    }
  }

  // 2. FALLBACK: Buscar en schema (columnas text que no sean code/price)
  for (const col of schema) {
    if (col.key !== "code" && col.key !== "price" && col.type === "text" && data[col.key]) {
      return String(data[col.key]);
    }
  }

  // 3. FALLBACK FINAL: Campos comunes
  const commonNameFields = ["name", "nombre", "descripcion", "description", "producto", "product"];
  for (const field of commonNameFields) {
    if (data[field]) {
      return String(data[field]);
    }
  }

  return "Sin nombre";
}

export default function Stock() {
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [requestList, setRequestList] = useState<RequestItem[]>([]);
  const [isCartCollapsed, setIsCartCollapsed] = useState(true);

  const { data: lists = [], isLoading: isLoadingLists } = useProductListsIndex();
  const { suppliers = [], isLoading: isLoadingSuppliers } = useSuppliers();
  const [searchTerm, setSearchTerm] = useState("");
  const isOnline = useOnlineStatus();
  const isMobile = useIsMobile();
  const isLoading = isLoadingLists || isLoadingSuppliers;

  const supplierSections = useMemo(() => {
    const sections = new Map<
      string,
      {
        supplierName: string;
        supplierLogo: string | null;
        lists: Array<{
          id: string;
          name: string;
          supplierId: string;
          mappingConfig: any;
          productCount: number;
          columnSchema: any[];
        }>;
      }
    >();

    lists.forEach((list: any) => {
      const supplier = suppliers.find((s) => s.id === list.supplier_id);
      if (!supplier) return;

      if (!sections.has(list.supplier_id)) {
        sections.set(list.supplier_id, {
          supplierName: supplier.name,
          supplierLogo: supplier.logo,
          lists: [],
        });
      }

      sections.get(list.supplier_id)!.lists.push({
        id: list.id,
        name: list.name,
        supplierId: list.supplier_id,
        mappingConfig: list.mapping_config,
        productCount: list.product_count,
        columnSchema: list.column_schema || [],
      });
    });

    sections.forEach((section, key) => {
      console.log("Sección:", key);
      console.log("Proveedor:", section.supplierName);
      console.log("Listas:");
      section.lists.forEach((list) => {
        console.log(`  - ID: ${list.id}`);
        console.log(`    Nombre: ${list.name}`);
        console.log(`    Productos: ${list.productCount}`);
      });
    });

    return sections;
  }, [lists, suppliers]);

  const visibleSupplierSections = useMemo(() => {
    if (supplierFilter === "all") {
      return Array.from(supplierSections.entries());
    }
    return Array.from(supplierSections.entries()).filter(([supplierId]) => supplierId === supplierFilter);
  }, [supplierSections, supplierFilter]);

  const totalProducts = useMemo(() => {
    return lists.reduce((sum, list: any) => sum + (list.product_count || 0), 0);
  }, [lists]);

  function parsePriceValue(value: any): number | null {
    if (value == null) return null;

    if (typeof value === "number") {
      return isFinite(value) ? value : null;
    }

    const cleaned = String(value)
      // quitar símbolos de moneda, espacios, etc.
      .replace(/[^0-9.,-]/g, "")
      // pasar coma decimal a punto
      .replace(",", ".");

    const parsed = parseFloat(cleaned);
    return !isNaN(parsed) && isFinite(parsed) ? parsed : null;
  }

  const handleAddToRequest = (product: any, mappingConfig?: any) => {
    const existingItem = requestList.find((r) => r.productId === product.id);

    // Fallback: si el producto no trae supplierId, lo derivamos de la lista
    const effectiveSupplierId =
      product.supplierId || lists.find((l: any) => l.id === product.listId)?.supplier_id || "";

    if (existingItem) {
      setRequestList((prev) => prev.map((r) => (r.productId === product.id ? { ...r, quantity: r.quantity + 1 } : r)));
    } else {
      let finalPrice = parsePriceValue(product.price) ?? 0;
      const cartPriceColumn = mappingConfig?.cart_price_column;
      if (cartPriceColumn) {
        const resolveCustomColumnPrice = (columnKey: string, depth = 0): number | null => {
          if (depth > 8) return null;
          const customFormula = mappingConfig?.custom_columns?.[columnKey];
          if (!customFormula?.base_column) return null;

          const baseKey = customFormula.base_column;

          const baseFromKnown =
            baseKey === "price"
              ? parsePriceValue(product.price)
              : baseKey === "quantity"
                ? parsePriceValue(product.quantity)
                : null;
          const baseFromCalculated =
            product.calculated_data && baseKey in product.calculated_data
              ? parsePriceValue(product.calculated_data[baseKey])
              : null;
          const baseFromRaw =
            product.data && baseKey in product.data ? parsePriceValue(product.data[baseKey]) : null;
          const baseFromNestedCustom = resolveCustomColumnPrice(baseKey, depth + 1);

          const base = baseFromKnown ?? baseFromCalculated ?? baseFromRaw ?? baseFromNestedCustom;
          if (base == null) return null;

          const percentage = Number(customFormula.percentage ?? 0);
          const addVat = Boolean(customFormula.add_vat);
          const vatRate = Number(customFormula.vat_rate ?? 0);

          let computed = base * (1 + percentage / 100);
          if (addVat) computed = computed * (1 + vatRate / 100);
          return computed;
        };

        const fromCalculated =
          product.calculated_data && cartPriceColumn in product.calculated_data
            ? parsePriceValue(product.calculated_data[cartPriceColumn])
            : null;
        const fromRawData =
          !fromCalculated && product.data && cartPriceColumn in product.data
            ? parsePriceValue(product.data[cartPriceColumn])
            : null;
        const fromCustom = fromCalculated == null && fromRawData == null ? resolveCustomColumnPrice(cartPriceColumn) : null;
        if (fromCalculated != null) finalPrice = fromCalculated;
        else if (fromRawData != null) finalPrice = fromRawData;
        else if (fromCustom != null) finalPrice = fromCustom;
      }

      const newRequest: RequestItem = {
        id: Date.now().toString(),
        productId: product.id,
        code: product.code || "",
        name: product.name || "",
        supplierId: effectiveSupplierId,
        costPrice: finalPrice,
        quantity: 1,
      };
      setRequestList((prev) => [...prev, newRequest]);
      toast.success("Producto agregado al carrito");
    }
  };

  const handleUpdateRequestQuantity = (id: string, quantity: number) => {
    setRequestList((prev) => prev.map((item) => (item.id === id ? { ...item, quantity } : item)));
  };

  const handleRemoveFromRequest = (id: string) => {
    setRequestList((prev) => prev.filter((item) => item.id !== id));
    toast.success("Producto eliminado del carrito");
  };

  const handleExportToExcel = () => {
    if (requestList.length === 0) {
      toast.error("No hay productos para exportar");
      return;
    }

    exportOrdersBySupplier(requestList, suppliers);

    const uniqueSuppliers = new Set(requestList.map((item) => item.supplierId)).size;

    toast.success("Pedidos exportados", {
      description: `Se generaron ${uniqueSuppliers} archivo${uniqueSuppliers > 1 ? "s" : ""} (uno por proveedor)`,
    });
  };

  const isSupplierSelectedNoTerm = supplierFilter !== "all" && searchTerm.trim() === "";
  const hasSearchTerm = searchTerm.trim().length >= 1;

  const {
    data: globalSearchData,
    isLoading: loadingSearch,
    fetchNextPage: fetchNextSearchPage,
    hasNextPage: hasNextSearchPage,
    isFetchingNextPage: isFetchingNextSearchPage,
  } = useInfiniteQuery({
    queryKey: ["global-search", searchTerm, supplierFilter, isOnline ? "online" : "offline"],
    queryFn: async ({ pageParam = 0 }) => {
      if (!searchTerm || searchTerm.trim().length < 1) return { data: [], count: 0, nextPage: undefined };

      const PAGE_SIZE = 50;

      // MODO OFFLINE: Buscar en IndexedDB
      if (isOnline === false) {
        const indexedProducts = (await getOfflineData("dynamic_products_index")) as any[];
        const fullProducts = (await getOfflineData("dynamic_products")) as any[];
        const productLists = (await getOfflineData("product_lists")) as any[];
        const myStockRows = (await getOfflineData("my_stock_products")) as any[];
        const searchTermLower = searchTerm.trim().toLowerCase();

        const {
          data: { user },
        } = await supabase.auth.getUser();
        const myStockForUser = user ? myStockRows.filter((r) => r.user_id === user.id) : [];
        const myStockByProductId = new Map<string, any>(myStockForUser.map((r) => [r.product_id, r]));

        // Filtrar por término de búsqueda
        let filtered = indexedProducts.filter((p: any) => {
          // Buscar en índice primero
          if (p.code?.toLowerCase().includes(searchTermLower) || p.name?.toLowerCase().includes(searchTermLower)) {
            return true;
          }

          // Si el índice no tiene datos, buscar en producto completo
          const fullProduct = fullProducts.find((fp: any) => fp.id === p.product_id);
          if (!fullProduct?.data) return false;

          const list = productLists.find((l: any) => l.id === p.list_id);
          const mappingConfig = list?.mapping_config;

          // Buscar en todos los code_keys configurados
          if (mappingConfig?.code_keys && Array.isArray(mappingConfig.code_keys)) {
            for (const key of mappingConfig.code_keys) {
              if (fullProduct.data[key]?.toString().toLowerCase().includes(searchTermLower)) {
                return true;
              }
            }
          }

          // Buscar en todos los name_keys configurados
          if (mappingConfig?.name_keys && Array.isArray(mappingConfig.name_keys)) {
            for (const key of mappingConfig.name_keys) {
              if (fullProduct.data[key]?.toString().toLowerCase().includes(searchTermLower)) {
                return true;
              }
            }
          }

          return false;
        });

        // Filtrar por proveedor si está seleccionado
        if (supplierFilter !== "all") {
          filtered = filtered.filter((p: any) => {
            const list = productLists.find((l: any) => l.id === p.list_id);
            return list?.supplier_id === supplierFilter;
          });
        }

        // Enrich with missing names from full products data
        filtered = filtered.map((p: any) => {
          if (!p.name || p.name.trim() === "") {
            const fullProduct = fullProducts.find((fp: any) => fp.id === p.product_id);
            const list = productLists.find((l: any) => l.id === p.list_id);
            const columnSchema = list?.column_schema || [];
            const mappingConfig = list?.mapping_config;

            if (fullProduct?.data) {
              // Extract name from data using schema and mappingConfig
              const extractedName = extractNameFromFullData(fullProduct.data, columnSchema, mappingConfig);
              return { ...p, name: extractedName };
            }
          }
          return p;
        });

        // Enriquecer con pertenencia a Mi Stock (independiente del quantity)
        filtered = filtered.map((p: any) => {
          const myStock = myStockByProductId.get(p.product_id);
          return {
            ...p,
            in_my_stock: Boolean(myStock),
            quantity: myStock?.quantity ?? p.quantity,
            stock_threshold: myStock?.stock_threshold ?? p.stock_threshold,
          };
        });

        const total = filtered.length;
        const from = pageParam * PAGE_SIZE;
        const to = from + PAGE_SIZE;
        const paginatedData = filtered.slice(from, to);

        return {
          data: paginatedData,
          count: total,
          nextPage: to < total ? pageParam + 1 : undefined,
        };
      }

      // MODO ONLINE: Usar RPC de Supabase con paginación
      const from = pageParam * PAGE_SIZE;
      const { data, error } = await supabase.rpc("search_products", {
        p_term: searchTerm.trim(),
        p_supplier_id: supplierFilter === "all" ? null : supplierFilter,
        p_limit: PAGE_SIZE,
        p_offset: from,
      });

      if (error) throw error;

      const results = data || [];
      return {
        data: results,
        count: results.length,
        nextPage: results.length === PAGE_SIZE ? pageParam + 1 : undefined,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    enabled: hasSearchTerm,
    retry: false,
  });

  const globalResults = useMemo(() => {
    if (!globalSearchData?.pages) return [];
    return globalSearchData.pages.flatMap((page) => page.data || []);
  }, [globalSearchData]);

  const { data: myStockProducts } = useMyStockProducts();
  const myStockByProductId = useMemo(() => {
    return new Set<string>((myStockProducts ?? []).map((p: any) => p.product_id).filter(Boolean));
  }, [myStockProducts]);

  const globalResultsEnriched = useMemo(() => {
    return globalResults.map((item: any) => ({
      ...item,
      in_my_stock: myStockByProductId.has(item.product_id) || Boolean(item.in_my_stock),
    }));
  }, [globalResults, myStockByProductId]);

  return (
    <div className="min-h-screen w-full bg-background overflow-x-hidden">
      <header
        className="sticky top-0 z-10 bg-background border-b"
        style={{ paddingTop: "max(env(safe-area-inset-top), 1.5rem)" }}
      >
        <div className="w-full px-4 pt-5 pb-10 lg:pl-4 max-w-full overflow-hidden">
          <div className="flex items-center gap-3 mb-6">
            <NotebookText className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">Listas de proveedores</h1>
          </div>

          <div className="flex flex-col md:flex-row gap-4 mb-4">
            <div className="flex flex-1 gap-2">
              <div className="relative w-full">
                <Input
                  placeholder="Buscar en todos los productos..."
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
            <div className="flex gap-2 w-[250px] md:w-1/3">
              <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                <SelectTrigger className="gap-1">
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
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-sm text-muted-foreground">
              {totalProducts} productos en total{" • "}
              {visibleSupplierSections.length} {visibleSupplierSections.length === 1 ? "proveedor" : "proveedores"}
            </div>
          </div>
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
            // ------- Estado de carga de listas -------
            <div className="text-center py-12 space-y-4">
              <div className="flex justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
              </div>
              <p className="text-muted-foreground">Cargando listas...</p>
            </div>
          ) : searchTerm.trim().length >= 1 || (searchTerm === "" && supplierFilter !== "all") ? (
            <GlobalProductSearch
              searchTerm={searchTerm}
              globalResults={globalResultsEnriched}
              loadingSearch={loadingSearch}
              isSupplierSelectedNoTerm={isSupplierSelectedNoTerm}
              isOnline={isOnline}
              lists={lists}
              suppliers={suppliers}
              onAddToRequest={handleAddToRequest}
              defaultViewMode={isMobile ? "card" : "table"}
              onLoadMore={() => {
                void fetchNextSearchPage();
              }}
              hasMore={hasNextSearchPage}
              isLoadingMore={isFetchingNextSearchPage}
            />
          ) : visibleSupplierSections.length === 0 ? (
            // ------- Sin proveedores -------
            <Card className="p-12 text-center">
              <p className="text-muted-foreground">No se encontraron proveedores</p>
            </Card>
          ) : (
            // ------- Secciones de proveedores (como antes) -------
            <div className="space-y-6">
              {visibleSupplierSections.map(([supplierId, section]: any) => (
                <SupplierStockSection
                  key={supplierId}
                  supplierName={section.supplierName}
                  supplierLogo={section.supplierLogo}
                  lists={section.lists}
                  onAddToRequest={handleAddToRequest}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
