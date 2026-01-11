import { useState, useEffect, useMemo } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronUp, ShoppingCart, ArrowUpDown, ArrowUp, ArrowDown, Trash2, Check } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DynamicProduct, ColumnSchema, ProductList } from "@/types/productList";
import { Loader2 } from "lucide-react";
import { useProductListStore } from "@/stores/productListStore";
import { QuantityCell } from "./stock/QuantityCell";
import { StockThresholdCell } from "./stock/StockThresholdCell";
import { AddProductDropdown } from "./stock/AddProductDropdown";
import { normalizeRawPrice, formatARS } from "@/utils/numberParser";
import { cn } from "@/lib/utils";
import { CopyableText } from "@/components/ui/copyable-text";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ProductCardViewProps {
  listId: string;
  products: DynamicProduct[] | any[];
  columnSchema: ColumnSchema[];
  mappingConfig?: ProductList["mapping_config"];
  onAddToRequest?: (product: any, mappingConfig?: ProductList["mapping_config"]) => void;
  showActions?: boolean;
  showRemoveFromStock?: boolean;
  onRemoveFromStock?: (product: any) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  sortColumn?: string | null;
  sortDirection?: 'asc' | 'desc' | null;
  onSortChange?: (columnKey: string | null, direction: 'asc' | 'desc' | null) => void;
  showLowStockBadge?: boolean;
  showStockThreshold?: boolean;
  onThresholdChange?: (productId: string, newThreshold: number) => void;
  suppressStockToasts?: boolean;
  enableSelection?: boolean;
  selectedIds?: Set<string>;
  selectionModeActive?: boolean;
  onRowClick?: (event: ReactMouseEvent, productId: string) => void;
  onRowPointerDown?: (event: ReactPointerEvent, productId: string) => void;
  onRowPointerUp?: (event: ReactPointerEvent) => void;
  onRowPointerCancel?: (event: ReactPointerEvent) => void;
}

type SortDirection = 'asc' | 'desc' | null;

const customColumnCalcGuard = new Set<string>();

export function ProductCardView({
  listId,
  products,
  columnSchema,
  mappingConfig,
  onAddToRequest,
  showActions = false,
  showRemoveFromStock = false,
  onRemoveFromStock,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
  sortColumn: externalSortColumn,
  sortDirection: externalSortDirection,
  onSortChange,
  showLowStockBadge = false,
  showStockThreshold = false,
  onThresholdChange,
  suppressStockToasts = false,
  enableSelection = false,
  selectedIds,
  selectionModeActive = false,
  onRowClick,
  onRowPointerDown,
  onRowPointerUp,
  onRowPointerCancel,
}: ProductCardViewProps) {
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [displayCount, setDisplayCount] = useState(10);
  const [localProducts, setLocalProducts] = useState(() => products);
  const { cardPreviewFields } = useProductListStore();

  // Ocultar la opción de "Agregar a mi stock" cuando estamos en la ruta /mi-stock
  const isMiStockRoute = typeof window !== "undefined" && window.location.pathname.includes("/mi-stock");
  const shouldShowAddToStock = !isMiStockRoute;

  // Usar estado externo si está disponible, sino usar estado local
  const sortColumn = externalSortColumn !== undefined ? externalSortColumn : null;
  const sortDirection = externalSortDirection !== undefined ? externalSortDirection : null;

  const basePreviewFields = cardPreviewFields[listId] || columnSchema.slice(0, 4).map((c) => c.key);
  const sanitizedPreviewFields = showStockThreshold
    ? basePreviewFields
    : basePreviewFields.filter((key) => key !== "stock_threshold");
  const fixedPreviewKeys = [
    "quantity",
    ...(showStockThreshold ? ["stock_threshold"] : []),
  ];
  const previewFieldKeys = fixedPreviewKeys.reduce(
    (result, key) => (result.includes(key) ? result : [key, ...result]),
    sanitizedPreviewFields,
  );

  // Resetear la paginación local cuando cambian los productos
  useEffect(() => {
    setDisplayCount(10);
  }, [products.length]);

  useEffect(() => {
    setLocalProducts((prev) => {
      if (prev.length !== products.length) return products;

      let changed = false;
      const next = products.map((nextItem, index) => {
        const prevItem = prev[index] as any;
        const prevId = prevItem?.id ?? prevItem?.product_id;
        const nextId = (nextItem as any)?.id ?? (nextItem as any)?.product_id;

        if (prevId !== nextId) {
          changed = true;
          return nextItem;
        }

        const priceChanged = prevItem?.price !== (nextItem as any)?.price;
        const calcChanged = prevItem?.calculated_data !== (nextItem as any)?.calculated_data;
        const dataChanged = prevItem?.data !== (nextItem as any)?.data;
        const inStockChanged = prevItem?.in_my_stock !== (nextItem as any)?.in_my_stock;
        const quantityChanged = prevItem?.quantity !== (nextItem as any)?.quantity;
        const thresholdChanged = prevItem?.stock_threshold !== (nextItem as any)?.stock_threshold;

        if (!priceChanged && !calcChanged && !dataChanged && !inStockChanged && !quantityChanged && !thresholdChanged) {
          return prevItem;
        }

        changed = true;
        return {
          ...nextItem,
          quantity: (nextItem as any)?.quantity ?? prevItem?.quantity,
          stock_threshold: (nextItem as any)?.stock_threshold ?? prevItem?.stock_threshold,
        };
      });

      return changed ? next : prev;
    });
  }, [products]);

  const toggleCard = (productId: string) => {
    const newExpanded = new Set(expandedCards);
    if (newExpanded.has(productId)) {
      newExpanded.delete(productId);
    } else {
      newExpanded.add(productId);
    }
    setExpandedCards(newExpanded);
  };

  const getFieldValue = (product: any, key: string) => {
    const effectiveMappingConfig = product.mappingConfig || mappingConfig;

    // 1) Columna de precio principal configurada
    if (effectiveMappingConfig?.price_primary_key && key === effectiveMappingConfig.price_primary_key) {
      return product.price;
    }

    // 2) Override específico para esta columna
    if (product.calculated_data && key in product.calculated_data) {
      return product.calculated_data[key];
    }

    // 2.5) Columna custom calculada (permite que base_column también sea custom)
    const customFormula = effectiveMappingConfig?.custom_columns?.[key];
    if (customFormula?.base_column) {
      const guardKey = `${String(product?.id ?? "")}:${key}`;
      if (customColumnCalcGuard.has(guardKey)) return null;
      customColumnCalcGuard.add(guardKey);

      try {
        const baseValue = getFieldValue(product, customFormula.base_column);
        const baseNumeric = normalizeRawPrice(baseValue);
        if (baseNumeric == null) return null;

        const percentage = Number(customFormula.percentage ?? 0);
        const addVat = Boolean(customFormula.add_vat);
        const vatRate = Number(customFormula.vat_rate ?? 0);

        let computed = baseNumeric * (1 + percentage / 100);
        if (addVat) computed = computed * (1 + vatRate / 100);
        return computed;
      } finally {
        customColumnCalcGuard.delete(guardKey);
      }
    }

    // 3) Campos normalizados
    if (key === "code") return product.code;
    if (key === "name") return product.name;
    if (key === "price") return product.price;
    if (key === "quantity") return product.quantity;
    if (key === "stock_threshold") return product.stock_threshold ?? 0;
    if (key === "supplier_name") return product.supplierName;
    if (key === "list_name") return product.listName;

    // 4) Datos originales
    return product.data?.[key];
  };

  const formatValue = (
    value: any,
    type: ColumnSchema["type"],
    key: string,
    product: any,
    mappingConfig?: ProductList["mapping_config"],
  ) => {
    if (value == null) return "-";
    const effectiveMappingConfig = product.mappingConfig || mappingConfig;
    const isPriceColumn =
      key === "price" ||
      key === effectiveMappingConfig?.price_primary_key ||
      (effectiveMappingConfig?.price_alt_keys && effectiveMappingConfig.price_alt_keys.includes(key));

    const isNumericField = type === "number" || isPriceColumn;

    // (La lógica de “modificación aplicada” queda por si la usás más adelante)
    const hasGeneralModifier = isPriceColumn && effectiveMappingConfig?.price_primary_key === key;
    const hasOverride = product.calculated_data && key in product.calculated_data;
    const hasModification = hasGeneralModifier || hasOverride;
    void hasModification;

    if (isNumericField) {
      const parsed = normalizeRawPrice(value);
      if (parsed != null) {
        const display = formatARS(parsed);
        return <CopyableText textToCopy={display}><span className="flex items-center gap-1.5">{display}</span></CopyableText>;
      }
      return "-";
    }
    if (type === "date" && value instanceof Date) {
      const display = value.toLocaleDateString("es-AR");
      return <CopyableText textToCopy={display}>{display}</CopyableText>;
    }
    const display = String(value);
    return <CopyableText textToCopy={display}>{display}</CopyableText>;
  };

  // Función para alternar el orden de una columna
  const toggleSort = (columnKey: string) => {
    if (!onSortChange) return;

    if (sortColumn === columnKey) {
      // Ciclar: asc -> desc -> null
      if (sortDirection === 'asc') {
        onSortChange(columnKey, 'desc');
      } else if (sortDirection === 'desc') {
        onSortChange(null, null);
      }
    } else {
      onSortChange(columnKey, 'asc');
    }
  };

  // Aplicar ordenamiento a los productos
  const sortedProducts = useMemo(() => {
    if (!sortColumn || !sortDirection) {
      return localProducts;
    }

    // Determinar si la columna es de precio para aplicar ordenamiento numérico
    const columnConfig = columnSchema.find(col => col.key === sortColumn);
    const isPriceColumn = sortColumn === "price" || 
                          sortColumn === mappingConfig?.price_primary_key ||
                          (mappingConfig?.price_alt_keys && mappingConfig.price_alt_keys.includes(sortColumn)) ||
                          sortColumn.toLowerCase().includes('precio') ||
                          sortColumn.toLowerCase().includes('price');
    const isNumericColumn = columnConfig?.type === 'number' || isPriceColumn;
    
    // Detectar si es columna de descripción para ordenamiento alfabético puro
    const isDescriptionColumn = 
      sortColumn === 'name' || 
      sortColumn === 'descripcion' ||
      sortColumn.toLowerCase().includes('descripcion') ||
      sortColumn.toLowerCase().includes('description') ||
      mappingConfig?.name_keys?.includes(sortColumn);

    const sorted = [...localProducts].sort((a, b) => {
      const aValue = getFieldValue(a, sortColumn);
      const bValue = getFieldValue(b, sortColumn);

      // Manejar valores nulos
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;

      // Ordenamiento ALFABETICO PURO para columnas de descripción (sin números)
      if (isDescriptionColumn) {
        const aText = String(aValue).trim().toLowerCase();
        const bText = String(bValue).trim().toLowerCase();
        return sortDirection === 'asc' 
          ? aText.localeCompare(bText, 'es', { numeric: false, sensitivity: 'base' })
          : bText.localeCompare(aText, 'es', { numeric: false, sensitivity: 'base' });
      }

      // Solo intentar comparar como números si es una columna numérica
      if (isNumericColumn) {
        const aNum = normalizeRawPrice(aValue);
        const bNum = normalizeRawPrice(bValue);

        if (aNum !== null && bNum !== null) {
          return sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
        }
      }

      // Comparar como strings (orden alfanumérico natural)
      const aStr = String(aValue).trim().toLowerCase();
      const bStr = String(bValue).trim().toLowerCase();

      const cmp = aStr.localeCompare(bStr, "es", { numeric: true, sensitivity: "base" });
      return sortDirection === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [localProducts, sortColumn, sortDirection, columnSchema, mappingConfig]);

  // Campos que se muestran arriba (según configuración del usuario)
  const keyFields = previewFieldKeys
    .map((key) => columnSchema.find((col) => col.key === key))
    .filter((col): col is ColumnSchema => col !== undefined);

  const otherFields = columnSchema.filter((col) => !previewFieldKeys.includes(col.key));

  // Paginación local de tarjetas - usar productos ordenados
  const visibleProducts = sortedProducts.slice(0, displayCount);
  const hasLocalMore = displayCount < sortedProducts.length;

  const handleLoadMore = () => {
    if (hasLocalMore) {
      setDisplayCount((prev) => prev + 10);
    } else if (onLoadMore && hasMore) {
      onLoadMore();
    }
  };

  return (
    <>
      {/* Controles de ordenamiento - Solo mostrar si se proporciona onSortChange */}
      {onSortChange && (
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b pb-3 mb-4">
          <div className="flex flex-col gap-2 from-516:flex-row from-516:items-center from-516:gap-3">
            <span className="text-sm text-muted-foreground max-[515px]:text-xs">
              Ordenar por:
            </span>
            <div className="flex items-center gap-1 flex-1 max-[768px]:flex-initial max-[768px]:flex-nowrap">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={`max-[768px]:!w-28 max-[768px]:flex-shrink-0 min-[769px]:min-w-[180px] justify-between overflow-hidden ${
                      !sortColumn ? "rounded-md" : "rounded-r-none"
                    }`}
                  >
                    <span className="truncate block">
                      {sortColumn
                        ? columnSchema.find((c) => c.key === sortColumn)?.label ||
                          "Seleccionar..."
                        : "Seleccionar..."}
                    </span>
                    {!sortColumn && <ArrowUpDown className="h-4 w-4 ml-2 flex-shrink-0" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-[200px] max-[515px]:w-[calc(100vw-2rem)]"
                >
                  {columnSchema.map((field) => {
                    const isActive = sortColumn === field.key;
                    return (
                      <DropdownMenuItem
                        key={field.key}
                        onClick={() => toggleSort(field.key)}
                        className="flex items-center justify-between"
                      >
                        <span>{field.label}</span>
                        {isActive && sortDirection === "asc" && (
                          <ArrowUp className="h-3 w-3" />
                        )}
                        {isActive && sortDirection === "desc" && (
                          <ArrowDown className="h-3 w-3" />
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
              {sortColumn && (
                <Button
                  variant="outline"
                  size="sm"
                  className="px-2 rounded-l-none border-l-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (sortDirection === "asc") {
                      onSortChange(sortColumn, "desc");
                    } else {
                      onSortChange(sortColumn, "asc");
                    }
                  }}
                >
                  {sortDirection === "asc" ? (
                    <ArrowUp className="h-4 w-4" />
                  ) : (
                    <ArrowDown className="h-4 w-4" />
                  )}
                </Button>
              )}
              {sortColumn && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onSortChange(null, null);
                  }}
                  className="text-xs max-[515px]:flex-shrink-0"
                >
                  Restablecer
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Grid de cards sin contenedor de scroll */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {visibleProducts.map((product) => {
          const productId = String(product.id ?? product.product_id ?? "");
          const isExpanded = expandedCards.has(productId);
          const isSelected = Boolean(enableSelection && productId && selectedIds?.has(productId));
          const handleCardClick = (event: ReactMouseEvent) => {
            if (!enableSelection || !onRowClick || !productId) return;
            onRowClick(event, productId);
          };
          const handleCardPointerDown = (event: ReactPointerEvent) => {
            if (!enableSelection || !onRowPointerDown || !productId) return;
            onRowPointerDown(event, productId);
          };
          const handleCardPointerUp = (event: ReactPointerEvent) => {
            if (!enableSelection || !onRowPointerUp) return;
            onRowPointerUp(event);
          };
          const handleCardPointerCancel = (event: ReactPointerEvent) => {
            if (!enableSelection || !onRowPointerCancel) return;
            onRowPointerCancel(event);
          };
          const inMyStockCard = Boolean(product.in_my_stock);

          const isLowStockCard =
            showLowStockBadge &&
            inMyStockCard &&
            (product.stock_threshold ?? 0) > 0 &&
            (product.quantity ?? 0) < (product.stock_threshold ?? 0);

          return (
            <Card
              key={productId}
              className={cn(
                "flex flex-col relative group",
                enableSelection && "cursor-pointer",
                selectionModeActive && "transition-shadow",
                isSelected && "ring-2 ring-primary/60 border-primary/60",
              )}
              data-selected={isSelected ? "true" : "false"}
              onClick={enableSelection ? handleCardClick : undefined}
              onPointerDown={enableSelection ? handleCardPointerDown : undefined}
              onPointerUp={enableSelection ? handleCardPointerUp : undefined}
              onPointerCancel={enableSelection ? handleCardPointerCancel : undefined}
            >
              {isSelected && (
                <div className="absolute left-2 top-2 z-10">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary">
                    <Check className="h-4 w-4 text-white" />
                  </span>
                </div>
              )}
              <CardHeader className="pb-3">
                <div className="space-y-2">
                  {keyFields.map((field) => {
                    const value = getFieldValue(product, field.key);
                    const displayValue = formatValue(
                      value,
                      field.type,
                      field.key,
                      product,
                      mappingConfig
                    );

                    // Campo especial para Stock con QuantityCell, igual que en /stock
                    if (field.key === "quantity") {
                      const quantityField = field;
                      const q = product.quantity || 0;
                      const stockThresholdField = product.stock_threshold ?? 0;
          const inMyStock = Boolean(product.in_my_stock);

                      const isLowStockField =
                        showLowStockBadge &&
                        inMyStock &&
                        stockThresholdField > 0 &&
                        q < stockThresholdField;

                      return (
                        <div
                          key={field.key}
                          className="text-sm border-b pb-1 flex flex-col gap-2"
                        >
                          <div
                            className={`w-full flex items-center justify-between ${
                              isLowStockField ? "mb-0" : "mb-3"
                            }`}
                          >
                            {/* Left slot — mantiene espacio y muestra badge si corresponde */}
                            <div className="flex items-center">
                              {isLowStockCard && (
                                <Badge variant="destructive" className="text-xs">
                                  Bajo Stock
                                </Badge>
                              )}
                            </div>

                            {/* Right slot — botón Trash siempre en el extremo derecho */}
                            <div className="flex items-center">
                              {showRemoveFromStock && onRemoveFromStock && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-70 group-hover:opacity-100"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onRemoveFromStock(product);
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                          {isLowStockField && !isLowStockCard && (
                            <div className="w-22 from-1440:w-4/12">
                              <Badge variant="destructive" className="text-xs">
                                Bajo Stock
                              </Badge>
                            </div>
                          )}
                          <div className="flex items-center justify-between w-full from-1440:justify-normal from-1440:gap-2">
                            <span className="text-muted-foreground">
                              {quantityField.label}:
                            </span>{" "}
                            <QuantityCell
                              productId={product.id}
                              listId={product.listId ?? listId}
                              value={product.quantity}
                              onLocalUpdate={(newQty) => {
                                setLocalProducts((prev) =>
                                  prev.map((p: any) =>
                                    p?.id === product.id ? { ...p, quantity: newQty, in_my_stock: true } : p,
                                  ),
                                );
                              }}
                              suppressToasts={suppressStockToasts}
                              visibleSpan={true}
                            />
                          </div>
                        </div>
                      );
                    }

                    if (field.key === "stock_threshold" && showStockThreshold) {
                      return (
                        <div
                          key={field.key}
                          className="text-sm border-b pb-1 flex items-center justify-between w-full from-1440:justify-normal from-1440:gap-2"
                        >
                          <span className="text-muted-foreground">
                            {field.label}:
                          </span>{" "}
                          <StockThresholdCell
                            productId={product.id}
                            listId={product.listId ?? listId}
                            value={product.stock_threshold}
                            onOptimisticUpdate={(newThreshold) =>
                              onThresholdChange?.(product.id, newThreshold)
                            }
                            onLocalUpdate={(newThreshold) => {
                              setLocalProducts((prev) =>
                                prev.map((p: any) =>
                                  p?.id === product.id ? { ...p, stock_threshold: newThreshold } : p,
                                ),
                              );
                            }}
                            suppressToasts={suppressStockToasts}
                          />
                        </div>
                      );
                    }

                    // Resto de campos: mismo diseño genérico que en /stock
                    return (
                      <div
                        key={field.key}
                        className="text-sm border-b pb-1 flex gap-1"
                      >
                        <span className="text-muted-foreground">
                          {field.label}:
                        </span>{" "}
                        <span className="font-medium">{displayValue}</span>
                      </div>
                    );
                  })}
                </div>
              </CardHeader>

              <CardContent className="pt-0 flex-1 flex flex-col">
                {otherFields.length > 0 && (
                  <Collapsible
                    open={isExpanded}
                    onOpenChange={() => toggleCard(productId)}
                  >
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="w-full mb-2">
                        {isExpanded ? (
                          <>
                            <ChevronUp className="h-4 w-4 mr-2" />
                            Ocultar detalles
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-4 w-4 mr-2" />
                            Ver más campos ({otherFields.length})
                          </>
                        )}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-2 mb-3">
                      {otherFields.map((field) => {
                        const value = getFieldValue(product, field.key);
                        const displayValue = formatValue(
                          value,
                          field.type,
                          field.key,
                          product,
                          mappingConfig
                        );

                        return (
                          <div
                            key={field.key}
                            className="text-sm border-b pb-1"
                          >
                            <span className="text-muted-foreground">
                              {field.label}:
                            </span>{" "}
                            <span className="font-medium">{displayValue}</span>
                          </div>
                        );
                      })}
                    </CollapsibleContent>
                  </Collapsible>
                )}

                {showActions && onAddToRequest && (
                  <div className="mt-auto w-full">
                    <AddProductDropdown
                      product={{ ...product, listId }}
                      mappingConfig={mappingConfig}
                      onAddToRequest={onAddToRequest}
                      onStockChange={(productId, patch) => {
                        setLocalProducts((prev: any[]) =>
                          prev.map((p: any) =>
                            (p?.id ?? p?.product_id) === productId ? { ...p, ...patch } : p,
                          ),
                        );
                      }}
                      showAddToStock={shouldShowAddToStock}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {(hasLocalMore || hasMore) && (
        <div className="text-center mt-6">
          <Button
            variant="outline"
            onClick={handleLoadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Cargando más...
              </>
            ) : (
              <>
                Ver más productos
                {hasLocalMore &&
                  ` (${sortedProducts.length - displayCount} más disponibles)`}
              </>
            )}
          </Button>
        </div>
      )}
    </>
  );
}

