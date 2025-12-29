import { useState, useMemo, useEffect, useCallback } from "react";
import { formatARS, normalizeRawPrice } from "@/utils/numberParser";
import { List, LayoutGrid, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { QuantityCell } from "@/components/stock/QuantityCell";
import { AddProductDropdown } from "@/components/stock/AddProductDropdown";
import { ProductCardView } from "@/components/ProductCardView";
import { ColumnSchema, DynamicProduct } from "@/types/productList";
import { useProductListStore } from "@/stores/productListStore";
import { useIsMobile } from "@/hooks/use-mobile";

interface GlobalProductSearchProps {
  searchTerm: string;
  globalResults: any[];
  loadingSearch: boolean;
  isSupplierSelectedNoTerm: boolean;
  isOnline: boolean;
  lists: any[];
  suppliers: any[];
  onAddToRequest: (product: any, mappingConfig?: any) => void;
  defaultViewMode?: "table" | "card";
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
}

export function GlobalProductSearch({
  searchTerm,
  globalResults,
  loadingSearch,
  isSupplierSelectedNoTerm,
  isOnline,
  lists,
  suppliers,
  onAddToRequest,
  defaultViewMode = "card",
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
}: GlobalProductSearchProps) {
  const [viewMode, setViewMode] = useState(() => defaultViewMode);
  const { setCardPreviewFields, cardPreviewFields } = useProductListStore();
  
  // Estado local para sincronizar cambios de cantidad/in_my_stock
  const [localResults, setLocalResults] = useState<any[]>([]);

  const isMobile = useIsMobile();

  // Sincronizar con globalResults cuando cambie
  useEffect(() => {
    setLocalResults(globalResults);
  }, [globalResults]);

  useEffect(() => {
    const globalSearchId = "global-search-results";

    if (!cardPreviewFields[globalSearchId]) {
      setCardPreviewFields(globalSearchId, ["code", "name", "price", "quantity", "supplier_name" /*, "list_name"*/]);
    }
  }, []);

  // Callback para actualizar estado local cuando cambia la cantidad
  const handleLocalUpdate = useCallback((productId: string, newQty: number) => {
    setLocalResults(prev => 
      prev.map(p => 
        p.product_id === productId 
          ? { ...p, quantity: newQty, in_my_stock: newQty > 0 }
          : p
      )
    );
  }, []);

  // Schema genérico para resultados de búsqueda global
  const globalSearchSchema: ColumnSchema[] = useMemo(
    () => [
      { key: "code", label: "Código", type: "text", visible: true, order: 0 },
      { key: "name", label: "Nombre", type: "text", visible: true, order: 1 },
      {
        key: "price",
        label: "Precio",
        type: "number",
        visible: true,
        order: 2,
      },
      {
        key: "quantity",
        label: "Stock",
        type: "number",
        visible: true,
        order: 3,
      },
      {
        key: "supplier_name",
        label: "Proveedor",
        type: "text",
        visible: true,
        order: 4,
      },
      {
        key: "list_name",
        label: "Lista",
        type: "text",
        visible: true,
        order: 5,
      },
    ],
    [],
  );

  // Schema para vista de tarjetas (sin campo "Lista")
  const globalSearchSchemaForCards: ColumnSchema[] = useMemo(
    () => globalSearchSchema.filter((col) => col.key !== "list_name" && col.key !== "supplier_name"),
    [globalSearchSchema],
  );

  // Agrupar resultados por lista para renderizar con configuraciones específicas
  const resultsByList = useMemo(() => {
    const grouped = new Map<
      string,
      {
        listId: string;
        listName: string;
        supplierId: string;
        supplierName: string;
        supplierLogo: string | null;
        columnSchema: ColumnSchema[];
        mappingConfig: any;
        products: DynamicProduct[];
      }
    >();

    // Usar localResults en lugar de globalResults
    localResults.forEach((item: any) => {
      const listInfo = lists.find((l: any) => l.id === item.list_id);
      const supplierInfo = suppliers.find((s: any) => s.id === listInfo?.supplier_id);

      if (!listInfo) return;

      if (!grouped.has(item.list_id)) {
        grouped.set(item.list_id, {
          listId: item.list_id,
          listName: listInfo.name,
          supplierId: supplierInfo?.id || "",
          supplierName: supplierInfo?.name || "-",
          supplierLogo: supplierInfo?.logo || null,
          columnSchema: listInfo.column_schema || [],
          mappingConfig: listInfo.mapping_config,
          products: [],
        });
      }

      grouped.get(item.list_id)!.products.push({
        id: item.product_id,
        listId: item.list_id,
        code: item.code || "-",
        name: item.name || "-",
        price: Number(item.price) || 0,
        quantity: item.quantity || 0,
        in_my_stock: item.in_my_stock === true,
        supplierId: supplierInfo?.id || "",
        supplierName: supplierInfo?.name || "-",
        listName: listInfo.name,
        mappingConfig: listInfo?.mapping_config,
        data: item.dynamic_products?.data || {},
        calculated_data: item.calculated_data || {},
      } as DynamicProduct);
    });

    return Array.from(grouped.values());
  }, [localResults, lists, suppliers]);

  // Estado: Proveedor seleccionado sin término de búsqueda
  if (isSupplierSelectedNoTerm) {
    return (
      <Card className="p-4">
        <h2 className="text-lg font-semibold mb-2">Búsqueda por proveedor</h2>
        <p className="text-center text-muted-foreground">
          Seleccionaste un proveedor. Ahora comienza tu búsqueda por código, descripción o nombre de producto.
        </p>
      </Card>
    );
  }

  // Estado: Cargando
  if (loadingSearch) {
    return (
      <Card className="p-4">
        <p className="text-center text-muted-foreground">Buscando productos...</p>
      </Card>
    );
  }

  // Estado: Instrucción cuando no hay resultados y el término es corto
  if (!loadingSearch && globalResults.length === 0 && searchTerm.trim().length < 1) {
    return (
      <Card className="p-4">
        <h2 className="text-lg font-semibold mb-2">Búsqueda</h2>
        <p className="text-center text-muted-foreground">
          Comienza a escribir para buscar productos.
        </p>
      </Card>
    );
  }

  // Estado: Sin resultados
  if (globalResults.length === 0) {
    return (
      <Card className="p-4">
        <h2 className="text-lg font-semibold mb-2">
          Resultados de búsqueda para "{searchTerm.trim()}"
          {isOnline === false && <span className="ml-2 text-sm text-muted-foreground">(modo offline)</span>}
        </h2>
        <p className="text-center text-muted-foreground">No se encontraron productos.</p>
      </Card>
    );
  }

  // Estado: Con resultados
  return (
    <div className="space-y-4">
      {/* Header con título y botones de vista - Sticky */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-semibold">
            Resultados de búsqueda para "{searchTerm.trim()}"
            {isOnline === false && <span className="ml-2 text-sm text-muted-foreground">(modo offline)</span>}
          </h2>

          {/* Botones de toggle vista */}
          <div className="flex gap-1.5">
            { !isMobile && 
              <Button
                variant={viewMode === "table" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("table")}
                className="flex-shrink-0"
              >
                <List className="h-4 w-4" />
              </Button>
            }
            <Button
              variant={viewMode === "card" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("card")}
              className="flex-shrink-0"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Contenido condicional: tabla o tarjetas */}
      {viewMode === "card" ? (
        <div className="space-y-6">
          {resultsByList.map((listGroup) => (
            <div key={listGroup.listId} className="space-y-4">
              {/* Header de la lista */}
              <div className="flex items-center gap-3">
                {listGroup.supplierLogo && (
                  <img
                    src={listGroup.supplierLogo}
                    alt={listGroup.supplierName}
                    className="h-8 w-8 flex-shrink-0 object-contain rounded"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold break-words">{listGroup.listName}</h3>
                  <p className="text-sm text-muted-foreground break-words">
                    {listGroup.supplierName} • {listGroup.products.length} productos
                  </p>
                </div>
              </div>

              {/* Tarjetas de productos */}
              <ProductCardView
                listId="global-search-results"
                products={listGroup.products}
                columnSchema={globalSearchSchemaForCards}
                mappingConfig={listGroup.mappingConfig}
                onAddToRequest={(product) =>
                  onAddToRequest({
                    id: product.id,
                    code: product.code,
                    name: product.name,
                    price: product.price,
                    supplierId: listGroup.supplierId,
                    data: product.data,
                    calculated_data: product.calculated_data,
                  }, listGroup.mappingConfig)
                }
                showActions={true}
              />
            </div>
          ))}

          {/* Botón para cargar más productos */}
          {hasMore && onLoadMore && (
            <div className="text-center my-4">
              <Button variant="outline" onClick={onLoadMore} disabled={isLoadingMore}>
                {isLoadingMore ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Cargando más...
                  </>
                ) : (
                  "Ver más productos"
                )}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-full text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">Acciones</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>Lista</TableHead>
                <TableHead>Precio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {localResults.map((item: any) => {
                const listInfo = lists.find((l: any) => l.id === item.list_id);
                const supplierInfo = suppliers.find((s: any) => s.id === listInfo?.supplier_id);

                return (
                  <TableRow key={item.product_id}>
                    <TableCell className="text-right">
                      <AddProductDropdown
                        product={{
                          id: item.product_id,
                          listId: item.list_id,
                          code: item.code,
                          name: item.name,
                          price: Number(item.price) || 0,
                          quantity: item.quantity || 0,
                          in_my_stock: item.in_my_stock === true,
                          supplierId: supplierInfo ? supplierInfo.id : "",
                          data: item.dynamic_products?.data || {},
                          calculated_data: item.calculated_data || {},
                        }}
                        mappingConfig={listInfo?.mapping_config}
                        onAddToRequest={onAddToRequest}
                        showAddToStock={true}
                      />
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-2">
                        <QuantityCell
                          productId={item.product_id}
                          listId={item.list_id}
                          value={item.quantity}
                          onLocalUpdate={(newQty) => handleLocalUpdate(item.product_id, newQty)}
                          visibleSpan={false}
                        />
                      </div>
                    </TableCell>

                    <TableCell>{item.code || "-"}</TableCell>
                    <TableCell>{item.name || "-"}</TableCell>
                    <TableCell>{supplierInfo ? supplierInfo.name : "-"}</TableCell>
                    <TableCell>{listInfo ? listInfo.name : "-"}</TableCell>
                    <TableCell>
                      {(() => {
                        const parsed = normalizeRawPrice(item.price);
                        return parsed != null ? formatARS(parsed) : "-";
                      })()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {/* Botón para cargar más productos en vista tabla */}
          {hasMore && onLoadMore && (
            <div className="text-center my-4">
              <Button variant="outline" onClick={onLoadMore} disabled={isLoadingMore}>
                {isLoadingMore ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Cargando más...
                  </>
                ) : (
                  "Ver más productos"
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
