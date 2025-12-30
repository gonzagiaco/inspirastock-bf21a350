import { useState, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  flexRender,
  ColumnDef,
  SortingState,
} from "@tanstack/react-table";
import { DynamicProduct, ColumnSchema, ProductList } from "@/types/productList";
import { Input } from "@/components/ui/input";
import { Search, ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useProductListStore } from "@/stores/productListStore";
import { ColumnSettingsDrawer } from "./ColumnSettingsDrawer";
import { cn } from "@/lib/utils";
import { ProductCardView } from "./ProductCardView";
import { Button } from "@/components/ui/button";
import { CardPreviewSettings } from "./CardPreviewSettings";
import { List, LayoutGrid, Loader2 } from "lucide-react";
import { QuantityCell } from "./stock/QuantityCell";
import { Badge } from "@/components/ui/badge";
import { AddProductDropdown } from "./stock/AddProductDropdown";
import { normalizeRawPrice, formatARS } from "@/utils/numberParser";
import { useIsMobile } from "@/hooks/use-mobile";
import { useListProducts } from "@/hooks/useListProducts";
import { useDebounce } from "@/hooks/useDebounce";

interface DynamicProductTableProps {
  listId: string;
  products: DynamicProduct[];
  columnSchema: ColumnSchema[];
  mappingConfig?: ProductList["mapping_config"];
  onAddToRequest?: (product: DynamicProduct, mappingConfig?: ProductList["mapping_config"]) => void;
  showStockActions?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
}

export const DynamicProductTable = ({
  listId,
  products,
  columnSchema,
  mappingConfig,
  onAddToRequest,
  showStockActions = false,
  onLoadMore,
  hasMore,
  isLoadingMore,
}: DynamicProductTableProps) => {
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);

  // Debounce del término de búsqueda para evitar demasiadas consultas
  const debouncedSearchTerm = useDebounce(globalFilter, 300);

  // Determinar si estamos en modo búsqueda activa (mínimo 2 caracteres)
  const isSearchActive = debouncedSearchTerm.trim().length >= 2;

  // Hook para búsqueda server-side cuando hay término de búsqueda
  const {
    data: searchData,
    isLoading: isSearchLoading,
    fetchNextPage: fetchNextSearchPage,
    hasNextPage: hasNextSearchPage,
    isFetchingNextPage: isFetchingNextSearchPage,
  } = useListProducts(listId, isSearchActive ? debouncedSearchTerm : undefined);

  // Productos de búsqueda server-side
  const searchProducts = useMemo(() => {
    if (!isSearchActive || !searchData?.pages) return [];
    return searchData.pages.flatMap((page: any) =>
      (page.data || []).map(
        (item: any) =>
          ({
            id: item.product_id,
            listId: item.list_id,
            code: item.code,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            in_my_stock: item.in_my_stock,
            data: item?.dynamic_products?.data ?? item?.data ?? {},
            calculated_data: item.calculated_data ?? {},
          }) as DynamicProduct,
      ),
    );
  }, [searchData, isSearchActive]);

  // Usar productos de búsqueda o productos iniciales según el estado
  const effectiveProducts = isSearchActive ? searchProducts : products;
  const effectiveHasMore = isSearchActive ? hasNextSearchPage : hasMore;
  const effectiveIsLoadingMore = isSearchActive ? isFetchingNextSearchPage : isLoadingMore;
  const effectiveOnLoadMore = isSearchActive
    ? () => {
        void fetchNextSearchPage();
      }
    : onLoadMore;

  // Estado compartido de ordenamiento para cards
  const sortColumn = sorting.length > 0 ? sorting[0].id : null;
  const sortDirection = sorting.length > 0 ? (sorting[0].desc ? "desc" : "asc") : null;

  const handleSortChange = (columnKey: string | null, direction: "asc" | "desc" | null) => {
    if (columnKey === null || direction === null) {
      setSorting([]);
    } else {
      setSorting([{ id: columnKey, desc: direction === "desc" }]);
    }
  };

  const isMobile = useIsMobile();

  // Store (orden/visibilidad + modo de vista)
  const { columnVisibility, columnOrder, columnPinning, viewMode: storeViewMode, setViewMode } = useProductListStore();

  // Vista por defecto
  const shouldUseCardView = true;
  const defaultViewMode = isMobile ? "cards" : columnSchema.length > 8 ? "cards" : "table";
  const currentViewMode = storeViewMode[listId] || defaultViewMode;
  const effectiveViewMode = currentViewMode;

  const schemaKeys = useMemo(() => columnSchema.map((c) => c.key), [columnSchema]);

  // Orden efectivo: respeta lo guardado, pero agrega al final las nuevas keys
  const currentOrder = useMemo(() => {
    const saved = columnOrder[listId];

    // Si no hay orden guardado, usar directamente el schema actual
    if (!saved || saved.length === 0) {
      return schemaKeys;
    }

    // Agregar cualquier columna nueva que no esté en el orden guardado
    const extra = schemaKeys.filter((key) => !saved.includes(key));

    return [...saved, ...extra];
  }, [columnOrder, listId, schemaKeys]);

  const visibilityState = columnVisibility[listId] || {};

  // Helper para detectar columnas de descripción
  const isDescriptionColumn = (key: string) => {
    return key === 'name' || 
           key === 'descripcion' ||
           key.toLowerCase().includes('descripcion') ||
           key.toLowerCase().includes('description') ||
           mappingConfig?.name_keys?.includes(key);
  };

  const columns = useMemo<ColumnDef<DynamicProduct>[]>(() => {
    const resolveComputedValue = (row: DynamicProduct, targetKey: string, visited: Set<string>): any => {
      if (visited.has(targetKey)) return null;
      const nextVisited = new Set(visited);
      nextVisited.add(targetKey);

      // Precio principal configurado
      if (mappingConfig?.price_primary_key && targetKey === mappingConfig.price_primary_key) {
        return row.price;
      }

      // Calculated data (incluye columnas personalizadas ya materializadas por backend)
      if (row.calculated_data && targetKey in row.calculated_data) {
        return (row.calculated_data as any)[targetKey];
      }

      // Columna custom calculada (permite base_column que también sea custom)
      const customFormula = mappingConfig?.custom_columns?.[targetKey];
      if (customFormula?.base_column) {
        const baseValue = resolveComputedValue(row, customFormula.base_column, nextVisited);
        const baseNumeric = normalizeRawPrice(baseValue);
        if (baseNumeric == null) return null;

        const percentage = Number(customFormula.percentage ?? 0);
        const addVat = Boolean(customFormula.add_vat);
        const vatRate = Number(customFormula.vat_rate ?? 0);

        let computed = baseNumeric * (1 + percentage / 100);
        if (addVat) computed = computed * (1 + vatRate / 100);
        return computed;
      }

      // Campos normalizados
      if (targetKey === "code") return row.code;
      if (targetKey === "name") return row.name;
      if (targetKey === "price") return row.price;
      if (targetKey === "quantity") return row.quantity;
      if (targetKey === "stock_threshold") return row.stock_threshold;
      if (targetKey === "precio") return row.price;
      if (targetKey === "descripcion") return row.name;

      return (row as any).data?.[targetKey];
    };

    const orderedSchema = currentOrder
      .map((key) => columnSchema.find((c) => c.key === key))
      .filter(Boolean) as ColumnSchema[];

    const dataColumns = orderedSchema.map((schema) => {
      const isVisible = visibilityState[schema.key] !== false;

      // Caso especial: columna de stock editable (reutiliza QuantityCell)
      if (schema.key === "quantity") {
        return {
          id: schema.key,
          accessorKey: "quantity",
          header: schema.label,
          cell: ({ row }) => {
            const quantity = row.original.quantity || 0;
            const stockThreshold = row.original.stock_threshold ?? 0;
            const isLowStock =
              Boolean(row.original.in_my_stock) &&
              stockThreshold > 0 &&
              quantity < stockThreshold;

            return (
              <div className="flex items-center gap-2">
                {isLowStock && (
                  <Badge variant="destructive" className="text-xs">
                    Bajo Stock
                  </Badge>
                )}
                <QuantityCell
                  productId={row.original.id}
                  listId={listId}
                  value={row.original.quantity}
                  onLocalUpdate={(newQty) => {
                    row.original.quantity = newQty;
                    row.original.in_my_stock = true;
                  }}
                  visibleSpan={false}
                />
              </div>
            );
          },
          meta: { isStandard: schema.isStandard, visible: isVisible },
        } as ColumnDef<DynamicProduct>;
      }

      // 🔹 Resto de columnas (tu lógica original)
      return {
        id: schema.key,
        accessorFn: (row: DynamicProduct) => {
          // PRIMERO: Si esta columna es la columna de precio principal configurada
          if (mappingConfig?.price_primary_key && schema.key === mappingConfig.price_primary_key) {
            return row.price; // Precio calculado del índice con modificadores generales
          }

          // SEGUNDO: Si esta columna tiene un override específico
          if (row.calculated_data && schema.key in row.calculated_data) {
            return row.calculated_data[schema.key]; // Precio con override específico
          }

          // TERCERO: Mapeos estándar de campos conocidos
          if (schema.key === "code") return row.code;
          if (schema.key === "name") return row.name;
          if (schema.key === "price") return row.price; // Fallback para "price" estándar
          if (schema.key === "quantity") return row.quantity;
          if (schema.key === "stock_threshold") return row.stock_threshold;
          if (schema.key === "precio") return row.price;
          if (schema.key === "descripcion") return row.name;

          // CUARTO: Para columnas custom sin mapeo especial, leer de data original
          return resolveComputedValue(row, schema.key, new Set());
        },
        header: schema.label,
        // Agregar sortingFn personalizado para columnas de descripción
        sortingFn: (() => {
          const lowerKey = schema.key.toLowerCase();
          const priceKeys = [
            "price",
            "precio",
            mappingConfig?.price_primary_key?.toLowerCase(),
            ...(mappingConfig?.price_alt_keys?.map((k) => k.toLowerCase()) || []),
            mappingConfig?.cart_price_column?.toLowerCase(),
          ].filter(Boolean);

          const isPriceField = priceKeys.includes(lowerKey) || lowerKey.includes("precio") || lowerKey.includes("price");
          const isNumericField = schema.type === "number" || isPriceField;

          if (isDescriptionColumn(schema.key)) {
            return (rowA: any, rowB: any, columnId: string) => {
              const aValue = String(rowA.getValue(columnId) ?? "").trim().toLowerCase();
              const bValue = String(rowB.getValue(columnId) ?? "").trim().toLowerCase();
              return aValue.localeCompare(bValue, "es", { numeric: false, sensitivity: "base" });
            };
          }

          if (isNumericField) {
            return (rowA: any, rowB: any, columnId: string) => {
              const aRaw = rowA.getValue(columnId);
              const bRaw = rowB.getValue(columnId);

              const aNum = normalizeRawPrice(aRaw);
              const bNum = normalizeRawPrice(bRaw);

              if (aNum == null && bNum == null) return 0;
              if (aNum == null) return 1;
              if (bNum == null) return -1;
              return aNum - bNum;
            };
          }

          return (rowA: any, rowB: any, columnId: string) => {
            const aValue = String(rowA.getValue(columnId) ?? "").trim().toLowerCase();
            const bValue = String(rowB.getValue(columnId) ?? "").trim().toLowerCase();
            return aValue.localeCompare(bValue, "es", { numeric: true, sensitivity: "base" });
          };
        })(),
        cell: ({ getValue, row }) => {
          const value = getValue();
          if (value === null || value === undefined) return "-";

          const key = schema.key.toLowerCase();
          const priceKeys = [
            "price",
            "precio",
            mappingConfig?.price_primary_key?.toLowerCase(),
            ...(mappingConfig?.price_alt_keys?.map((k) => k.toLowerCase()) || []),
            mappingConfig?.cart_price_column?.toLowerCase(),
          ].filter(Boolean);
          const isPriceField = priceKeys.includes(key) || key.includes("precio") || key.includes("price");
          const isNumericField = schema.type === "number" || isPriceField;

          if (isNumericField) {
            const numericValue = normalizeRawPrice(value);
            if (numericValue !== null) {
              return <div className="flex items-center gap-1.5">{formatARS(numericValue)}</div>;
            }
          }

          // fallback para columnas no numéricas o valores no convertibles
          return String(value);
        },
        meta: {
          isStandard: schema.isStandard,
          visible: isVisible,
        },
      };
    });

    // Columna de acciones (agregar a pedido / Mi Stock)
    if (showStockActions && onAddToRequest) {
      dataColumns.unshift({
        id: "actions",
        header: "Acciones",
        cell: ({ row }) => (
          <AddProductDropdown
            product={{ ...row.original, listId, in_my_stock: row.original.in_my_stock }}
            mappingConfig={mappingConfig}
            onAddToRequest={onAddToRequest}
            showAddToStock={true}
          />
        ),
        meta: { visible: true },
      } as any);
    }

    return dataColumns;
  }, [columnSchema, listId, currentOrder, visibilityState, showStockActions, onAddToRequest, mappingConfig]);

  const visibleColumns = useMemo(() => {
    return columns.filter((col) => {
      const meta = col.meta as any;
      return meta?.visible !== false;
    });
  }, [columns]);

  const table = useReactTable({
    data: effectiveProducts,
    columns: visibleColumns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    // NO usar globalFilter del table cuando hay búsqueda server-side activa
    onGlobalFilterChange: setGlobalFilter,
    state: {
      sorting,
      // Solo aplicar filtro local cuando NO hay búsqueda server-side
      globalFilter: isSearchActive ? "" : globalFilter,
      columnPinning: columnPinning[listId] || {},
    },
  });

  return (
    <div className="space-y-4">
      {/* Buscador + ajustes - Sticky cuando se hace scroll */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b pb-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar en todos los productos... (mín. 2 caracteres)"
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className="pl-10 pr-14"
            />
            {globalFilter.trim().length > 0 && (
              <button
                type="button"
                onClick={() => setGlobalFilter("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7588eb]"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            {isSearchLoading && isSearchActive && (
              <Loader2 className="absolute right-9 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
            )}
          </div>
          {/* Indicador de resultados de búsqueda */}
          {isSearchActive && !isSearchLoading && (
            <div className="text-sm text-muted-foreground flex items-center gap-1 whitespace-nowrap">
              {searchProducts.length} resultado{searchProducts.length !== 1 ? "s" : ""}
            </div>
          )}
          <div className="flex gap-1.5 flex-wrap justify-end">
            {shouldUseCardView && (
              <>
                {!isMobile && (
                  <Button
                    variant={effectiveViewMode === "table" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setViewMode(listId, "table")}
                    className="flex-shrink-0"
                  >
                    <List className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant={effectiveViewMode === "cards" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode(listId, "cards")}
                  className="flex-shrink-0"
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
                <CardPreviewSettings listId={listId} columnSchema={columnSchema} />
              </>
            )}
            <ColumnSettingsDrawer listId={listId} columnSchema={columnSchema} mappingConfig={mappingConfig} />
          </div>
        </div>
      </div>

      {/* Contenido: tarjetas o tabla */}
      {effectiveViewMode === "cards" ? (
        <ProductCardView
          listId={listId}
          products={table.getRowModel().rows.map((row) => row.original)}
          columnSchema={columnSchema}
          mappingConfig={mappingConfig}
          onAddToRequest={onAddToRequest}
          showActions={showStockActions}
          onLoadMore={effectiveOnLoadMore}
          hasMore={effectiveHasMore}
          isLoadingMore={effectiveIsLoadingMore || (isSearchLoading && isSearchActive)}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          onSortChange={handleSortChange}
          showLowStockBadge={true}
        />
      ) : (
        <div className="w-full border rounded-lg overflow-hidden">
          {/* Contenedor scrolleable: acá vive el sticky */}
          <div className="max-h-[600px] overflow-auto relative">
            <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  {table.getHeaderGroups()[0]?.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className="cursor-pointer select-none bg-background"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <div className="flex items-center gap-2">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {{
                          asc: <ChevronUp className="w-4 h-4" />,
                          desc: <ChevronDown className="w-4 h-4" />,
                        }[header.column.getIsSorted() as string] ?? null}
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>

              <TableBody>
                {isSearchLoading && isSearchActive ? (
                  <TableRow>
                    <TableCell colSpan={visibleColumns.length} className="text-center py-8">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Buscando productos...
                      </div>
                    </TableCell>
                  </TableRow>
                ) : table.getRowModel().rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={visibleColumns.length} className="text-center text-muted-foreground py-8">
                      {isSearchActive
                        ? `No se encontraron productos para "${debouncedSearchTerm}"`
                        : "No se encontraron productos"}
                    </TableCell>
                  </TableRow>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id}>
                      {row.getVisibleCells().map((cell) => {
                        const column = cell.column;
                        const meta = column.columnDef.meta as any;
                        const isHiddenButVisible = meta?.visible === false;

                        return (
                          <TableCell key={cell.id} className={cn(isHiddenButVisible && "opacity-30 bg-stripes")}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>

            {effectiveViewMode === "table" && effectiveHasMore && (
              <div className="text-center my-4">
                <Button variant="outline" onClick={effectiveOnLoadMore} disabled={effectiveIsLoadingMore}>
                  {effectiveIsLoadingMore ? (
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
        </div>
      )}
    </div>
  );
};
