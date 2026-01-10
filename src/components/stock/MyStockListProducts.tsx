import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";
import { List, LayoutGrid, ChevronUp, ChevronDown, Trash2, ShoppingCart, Search, X, DollarSign, ArrowUpDown, RotateCcw, MoreVertical, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QuantityCell } from "./QuantityCell";
import { StockThresholdCell } from "./StockThresholdCell";
import { ProductCardView } from "@/components/ProductCardView";
import { CopyableText } from "@/components/ui/copyable-text";
import { ColumnSchema, DynamicProduct } from "@/types/productList";
import { normalizeRawPrice, formatARS } from "@/utils/numberParser";
import { isOnline, localDB, removeFromMyStock } from "@/lib/localDB";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ColumnSettingsDrawer } from "@/components/ColumnSettingsDrawer";
import { CardPreviewSettings } from "@/components/CardPreviewSettings";
import { useProductListStore } from "@/stores/productListStore";
import { useDebounce } from "@/hooks/useDebounce";
import { bulkRemoveFromMyStock, convertUsdToArsForProducts, deleteColumnsFromList, revertUsdToArsForProducts } from "@/services/bulkTableActions";
import { useRequestCartStore } from "@/stores/requestCartStore";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  ColumnDef,
  SortingState,
} from "@tanstack/react-table";

interface MyStockListProductsProps {
  listId: string;
  products: any[];
  columnSchema: ColumnSchema[];
  mappingConfig: any;
  onAddToRequest: (product: any, mappingConfig?: any, options?: { silent?: boolean }) => void;
  onQuantityChange?: (productId: string, newQuantity: number) => void;
  onThresholdChange?: (productId: string, newThreshold: number) => void;
  onRemoveProduct?: (productId: string) => void;
  onRemoveProducts?: (productIds: string[]) => void;
  isMobile: boolean;
}

const STOCK_THRESHOLD_COLUMN: ColumnSchema = {
  key: "stock_threshold",
  label: "Stock Mínimo",
  type: "number",
  visible: true,
  order: 0,
  isStandard: true,
};

const areProductsShallowEqual = (prev: any[], next: any[]) => {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    const prevItem = prev[i];
    const nextItem = next[i];
    if (prevItem === nextItem) continue;
    const prevId = prevItem?.product_id ?? prevItem?.id;
    const nextId = nextItem?.product_id ?? nextItem?.id;
    if (prevId !== nextId) return false;
    if ((prevItem?.updated_at ?? null) !== (nextItem?.updated_at ?? null)) return false;
    if ((prevItem?.quantity ?? null) !== (nextItem?.quantity ?? null)) return false;
    if ((prevItem?.stock_threshold ?? null) !== (nextItem?.stock_threshold ?? null)) return false;
  }
  return true;
};

export const MyStockListProducts = memo(function MyStockListProducts({
  listId,
  products,
  columnSchema,
  mappingConfig,
  onAddToRequest,
  onQuantityChange,
  onThresholdChange,
  onRemoveProduct,
  onRemoveProducts,
  isMobile,
}: MyStockListProductsProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [localFilter, setLocalFilter] = useState("");
  const { columnVisibility, columnOrder, viewMode: storeViewMode, setViewMode } = useProductListStore();
  const queryClient = useQueryClient();
  const { requestList, updateItemPrice } = useRequestCartStore();
  const debouncedFilter = useDebounce(localFilter, 200);

  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [selectedColumnKeys, setSelectedColumnKeys] = useState<Set<string>>(new Set());
  const [allRowsSelected, setAllRowsSelected] = useState(false);
  const [menuState, setMenuState] = useState<
    | {
        type: "rows" | "columns";
        top: number;
        left: number;
      }
    | null
  >(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const mobileActionsRef = useRef<HTMLDivElement | null>(null);
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const selectionBarRef = useRef<HTMLDivElement | null>(null);
  const rowAnchorIdRef = useRef<string | null>(null);
  const columnAnchorKeyRef = useRef<string | null>(null);
  const lastPointerTypeRef = useRef<"mouse" | "touch" | "pen">("mouse");
  const longPressTimerRef = useRef<number | null>(null);
  const [confirmDeleteRowsOpen, setConfirmDeleteRowsOpen] = useState(false);
  const [confirmDeleteColumnsOpen, setConfirmDeleteColumnsOpen] = useState(false);
  const [isBulkWorking, setIsBulkWorking] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [tableDisplayCount, setTableDisplayCount] = useState(50);

  const isDescriptionColumn = useCallback((key: string): boolean => {
    return (
      key === "name" ||
      key === "descripcion" ||
      key.toLowerCase().includes("descripcion") ||
      key.toLowerCase().includes("description") ||
      mappingConfig?.name_keys?.includes(key)
    );
  }, [mappingConfig]);

  // Default view mode
  const defaultViewMode = isMobile ? "cards" : "table";
  const currentViewMode = storeViewMode[listId] || defaultViewMode;
  const effectiveViewMode = isMobile ? "cards" : currentViewMode;
  const isTableView = effectiveViewMode === "table";

  useEffect(() => {
    if (effectiveViewMode === "cards" && selectedColumnKeys.size) {
      setSelectedColumnKeys(new Set());
    }
  }, [effectiveViewMode, selectedColumnKeys.size]);

  // Handler para quitar de Mi Stock - persist to IndexedDB BEFORE UI update
  const handleRemoveFromStock = async (product: any) => {
    const productId = product.product_id || product.id;
    try {
      // 1. FIRST: Persist to IndexedDB (critical for offline persistence)
      await removeFromMyStock(productId);

      // 2. THEN: Update UI optimistically
      onRemoveProduct?.(productId);
      await syncListCacheFromLocal([productId]);

      // 3. Toast feedback
      toast.success("Producto quitado de Mi Stock");
      
      // 4. Invalidate queries in background
      queueMicrotask(() => {
        queryClient.invalidateQueries({ queryKey: ["my-stock"] });
      });
    } catch (error) {
      console.error("Error al quitar de Mi Stock:", error);
      toast.error("Error al quitar producto");
    }
  };

  // Handler para actualizar cantidad (optimista)
  const handleQuantityChange = (productId: string, newQuantity: number) => {
    onQuantityChange?.(productId, newQuantity);
  };

  const handleThresholdChange = (productId: string, newThreshold: number) => {
    onThresholdChange?.(productId, newThreshold);
  };

  const syncListCacheFromLocal = useCallback(
    async (productIds: string[]) => {
      const ids = productIds.filter(Boolean);
      if (!ids.length) return;

      const [indexRows, stockRows] = await Promise.all([
        localDB.dynamic_products_index.where("product_id").anyOf(ids).toArray(),
        localDB.my_stock_products.where("product_id").anyOf(ids).toArray(),
      ]);

      const indexMap = new Map(indexRows.map((row: any) => [row.product_id, row]));
      const stockMap = new Map(stockRows.map((row: any) => [row.product_id, row]));
      const idSet = new Set(ids);

      queryClient.setQueriesData({ queryKey: ["list-products", listId] }, (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            data: (page.data ?? []).map((item: any) => {
              const indexRow = indexMap.get(item.product_id);
              if (!indexRow) return item;
              const stockRow = stockMap.get(item.product_id);
              return {
                ...item,
                price: indexRow.price ?? item.price,
                quantity: indexRow.quantity ?? item.quantity,
                stock_threshold: stockRow?.stock_threshold ?? indexRow.stock_threshold ?? item.stock_threshold,
                calculated_data: indexRow.calculated_data ?? item.calculated_data,
                in_my_stock: Boolean(stockRow),
              };
            }),
          })),
        };
      });

      queryClient.setQueriesData({ queryKey: ["my-stock"] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old
          .filter((item: any) => !idSet.has(item.product_id) || stockMap.has(item.product_id))
          .map((item: any) => {
            const indexRow = indexMap.get(item.product_id);
            if (!indexRow) return item;
            const stockRow = stockMap.get(item.product_id);
            return {
              ...item,
              price: indexRow.price ?? item.price,
              quantity: stockRow?.quantity ?? indexRow.quantity ?? item.quantity,
              stock_threshold: stockRow?.stock_threshold ?? item.stock_threshold,
              calculated_data: indexRow.calculated_data ?? item.calculated_data,
            };
          });
      });
    },
    [listId, queryClient],
  );

  // Process schema: only mark quantity as isStandard (fixed)
  const processedSchema: ColumnSchema[] = useMemo(() => {
    const hasThreshold = columnSchema.some((col) => col.key === STOCK_THRESHOLD_COLUMN.key);
    const baseSchema = hasThreshold
      ? columnSchema
      : (() => {
          const quantityIndex = columnSchema.findIndex((col) => col.key === "quantity");
          const insertAt = quantityIndex >= 0 ? quantityIndex + 1 : columnSchema.length;
          const nextSchema = [...columnSchema];
          nextSchema.splice(insertAt, 0, STOCK_THRESHOLD_COLUMN);
          return nextSchema;
        })();

    return baseSchema.map((col, index) => ({
      ...col,
      isStandard: col.key === "quantity" || col.key === STOCK_THRESHOLD_COLUMN.key,
      order: col.order ?? index,
    }));
  }, [columnSchema]);

  // Column order: default puts quantity second (after actions)
  const schemaKeys = useMemo(() => processedSchema.map((c) => c.key), [processedSchema]);
  
  const currentOrder = useMemo(() => {
    const saved = columnOrder[listId];
    
    if (!saved || saved.length === 0) {
      // Default order: quantity, stock_threshold, then the rest
      const withoutFixed = schemaKeys.filter(
        (key) => key !== "quantity" && key !== STOCK_THRESHOLD_COLUMN.key,
      );
      return ["quantity", STOCK_THRESHOLD_COLUMN.key, ...withoutFixed];
    }
    
    // Add any new columns that aren't in saved order
    const extra = schemaKeys.filter((key) => !saved.includes(key));
    return [...saved, ...extra];
  }, [columnOrder, listId, schemaKeys]);

  const visibilityState = columnVisibility[listId] || {};

  // Sorting state for cards
  const sortColumn = sorting.length > 0 ? sorting[0].id : null;
  const sortDirection = sorting.length > 0 ? (sorting[0].desc ? "desc" : "asc") : null;

  const handleSortChange = (columnKey: string | null, direction: "asc" | "desc" | null) => {
    if (columnKey === null || direction === null) {
      setSorting([]);
    } else {
      setSorting([{ id: columnKey, desc: direction === "desc" }]);
    }
  };

  // Build columns for TanStack Table
  const columns = useMemo<ColumnDef<any>[]>(() => {
    const resolveComputedValue = (row: any, targetKey: string, visited: Set<string>): any => {
      if (visited.has(targetKey)) return null;
      const nextVisited = new Set(visited);
      nextVisited.add(targetKey);

      // Precio principal configurado
      if (mappingConfig?.price_primary_key && targetKey === mappingConfig.price_primary_key) {
        return row.price;
      }

      // Calculated data (incluye columnas personalizadas ya materializadas por backend)
      if (row.calculated_data && targetKey in row.calculated_data) {
        return row.calculated_data[targetKey];
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

      // Standard mappings
      if (targetKey === "code") return row.code;
      if (targetKey === "name") return row.name;
      if (targetKey === "price") return row.price;

      return row.data?.[targetKey];
    };

    const getSortingFn = (schema: ColumnSchema) => {
      const lowerKey = schema.key.toLowerCase();
      const priceKeys = [
        "price",
        "precio",
        mappingConfig?.price_primary_key?.toLowerCase(),
        ...(mappingConfig?.price_alt_keys?.map((k: string) => k.toLowerCase()) || []),
        mappingConfig?.cart_price_column?.toLowerCase(),
        mappingConfig?.delivery_note_price_column?.toLowerCase(),
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
    };

    const orderedSchema = currentOrder
      .map((key) => processedSchema.find((c) => c.key === key))
      .filter(Boolean) as ColumnSchema[];

    const dataColumns: ColumnDef<any>[] = [];

    // Actions column at the start (remove + add to cart)
    dataColumns.push({
      id: "actions",
      header: "Acciones",
      enableSorting: false,
      cell: ({ row }: any) => (
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            onClick={() => handleRemoveFromStock(row.original)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAddToRequest(row.original, mappingConfig)}
          >
            <ShoppingCart className="h-4 w-4 mr-1" />
            Agregar
          </Button>
        </div>
      ),
      meta: { visible: true },
    } as any);

    // Data columns
    orderedSchema.forEach((schema) => {
      const isVisible = visibilityState[schema.key] !== false;

      // Special case: quantity column with editable input
      if (schema.key === "quantity") {
        dataColumns.push({
          id: schema.key,
          accessorKey: "quantity",
          header: schema.label,
          cell: ({ row }: any) => {
            const quantity = row.original.quantity || 0;
            const stockThreshold = row.original.stock_threshold ?? 0;
            const isLowStock = stockThreshold > 0 && quantity < stockThreshold;

            return (
              <div className="flex items-center gap-2">
                {isLowStock && (
                  <Badge variant="destructive" className="text-xs">
                    Bajo Stock
                  </Badge>
                )}
                <QuantityCell
                  productId={row.original.product_id || row.original.id}
                  listId={row.original.list_id || listId}
                  value={row.original.quantity}
                  visibleSpan={false}
                  suppressToasts={true}
                  onOptimisticUpdate={(newQty) => handleQuantityChange(row.original.product_id || row.original.id, newQty)}
                />
              </div>
            );
          },
          sortingFn: getSortingFn(schema),
          meta: { isStandard: true, visible: isVisible },
        } as ColumnDef<any>);
        return;
      }

      if (schema.key === STOCK_THRESHOLD_COLUMN.key) {
        dataColumns.push({
          id: schema.key,
          accessorKey: "stock_threshold",
          header: schema.label,
          cell: ({ row }: any) => (
            <StockThresholdCell
              productId={row.original.product_id || row.original.id}
              listId={row.original.list_id || listId}
              value={row.original.stock_threshold}
              suppressToasts={true}
              onOptimisticUpdate={(newThreshold) =>
                handleThresholdChange(row.original.product_id || row.original.id, newThreshold)
              }
            />
          ),
          sortingFn: getSortingFn(schema),
          meta: { isStandard: true, visible: isVisible },
        } as ColumnDef<any>);
        return;
      }

      // Other columns
      dataColumns.push({
        id: schema.key,
        accessorFn: (row: any) => {
          // Price primary key from mapping
          if (mappingConfig?.price_primary_key && schema.key === mappingConfig.price_primary_key) {
            return row.price;
          }
          // Calculated data overrides
          if (row.calculated_data && schema.key in row.calculated_data) {
            return row.calculated_data[schema.key];
          }
          // Standard mappings
          if (schema.key === "code") return row.code;
          if (schema.key === "name") return row.name;
          if (schema.key === "price") return row.price;
          // Custom columns from data
          return resolveComputedValue(row, schema.key, new Set());
        },
        header: schema.label,
        sortingFn: getSortingFn(schema),
        cell: ({ getValue }: any) => {
          const value = getValue();
          if (value === null || value === undefined) return "-";

          const key = schema.key.toLowerCase();
          const priceKeys = [
            "price",
            "precio",
            mappingConfig?.price_primary_key?.toLowerCase(),
            ...(mappingConfig?.price_alt_keys?.map((k: string) => k.toLowerCase()) || []),
          ].filter(Boolean);
          const isPriceField = priceKeys.includes(key) || key.includes("precio") || key.includes("price");

          if (isPriceField || schema.type === "number") {
            const numericValue = normalizeRawPrice(value);
            if (numericValue !== null) {
              const display = formatARS(numericValue);
              return <CopyableText textToCopy={display}>{display}</CopyableText>;
            }
          }

          const display = String(value);
          return <CopyableText textToCopy={display}>{display}</CopyableText>;
        },
        meta: { isStandard: schema.isStandard, visible: isVisible },
      } as ColumnDef<any>);
    });

    return dataColumns;
  }, [
    processedSchema,
    currentOrder,
    visibilityState,
    mappingConfig,
    onAddToRequest,
    listId,
    isDescriptionColumn,
  ]);

  const visibleColumns = useMemo(() => {
    return columns.filter((col) => {
      const meta = col.meta as any;
      return meta?.visible !== false;
    });
  }, [columns]);

  // Transform products for card view
  const transformedProducts: DynamicProduct[] = useMemo(() => {
    return products.map((p) => ({
      id: p.product_id || p.id,
      product_id: p.product_id || p.id,
      listId: p.list_id || listId,
      list_id: p.list_id || listId,
      code: p.code,
      name: p.name,
      price: p.price,
      quantity: p.quantity,
      stock_threshold: p.stock_threshold ?? 0,
      in_my_stock: true,
      data: p.data || {},
      calculated_data: p.calculated_data || {},
      supplierId: p.supplierId ?? p.supplier_id,
    }));
  }, [products, listId]);

  const filteredProducts = useMemo(() => {
    const term = debouncedFilter.trim().toLowerCase();
    if (!term) return transformedProducts;

    return transformedProducts.filter((product) => {
      const code = String(product.code ?? "").toLowerCase();
      const name = String(product.name ?? "").toLowerCase();
      if (code.includes(term) || name.includes(term)) return true;

      const dataValues = Object.values(product.data ?? {});
      const calculatedValues = Object.values(product.calculated_data ?? {});
      const allValues = [...dataValues, ...calculatedValues];

    return allValues.some((value) => String(value ?? "").toLowerCase().includes(term));
    });
  }, [transformedProducts, debouncedFilter]);

  useEffect(() => {
    setTableDisplayCount(50);
  }, [filteredProducts.length, effectiveViewMode]);

  const tableData = useMemo(
    () => filteredProducts.slice(0, tableDisplayCount),
    [filteredProducts, tableDisplayCount],
  );

  const productById = useMemo(
    () =>
      new Map(
        transformedProducts
          .map((p) => [String((p as any).id ?? (p as any).product_id ?? ""), p] as const)
          .filter(([id]) => id),
      ),
    [transformedProducts],
  );
  const selectedProducts = useMemo(
    () => Array.from(selectedRowIds).map((id) => productById.get(id)).filter(Boolean) as DynamicProduct[],
    [productById, selectedRowIds],
  );
  const selectedFxConvertedCount = useMemo(
    () => selectedProducts.filter((p) => Boolean((p as any)?.calculated_data?.__fx_usd_ars__at)).length,
    [selectedProducts],
  );
  const anySelectedFxConverted = allRowsSelected ? true : selectedFxConvertedCount > 0;

  const isInteractiveTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest("button, a, input, textarea, select, [role='button'], [data-interactive='true']"));
  };

  const isEditableTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest("input, textarea, [contenteditable='true']"));
  };

  const codeColumnKeys = useMemo(() => {
    const keys = new Set<string>(["code"]);
    for (const key of mappingConfig?.code_keys ?? []) {
      keys.add(key);
    }
    return keys;
  }, [mappingConfig]);

  const isSelectableColumn = (columnKey: string) => {
    if (!columnKey) return false;
    if (columnKey === "actions" || columnKey === "quantity" || columnKey === "stock_threshold") return false;
    if (codeColumnKeys.has(columnKey)) return false;
    return true;
  };

  const isConvertibleColumn = (columnKey: string) => {
    if (!isSelectableColumn(columnKey)) return false;
    if (columnKey === "stock_threshold") return false;

    if (mappingConfig?.custom_columns && columnKey in mappingConfig.custom_columns) return true;

    const priceKeys = new Set(
      [
        mappingConfig?.price_primary_key,
        ...(mappingConfig?.price_alt_keys ?? []),
        mappingConfig?.cart_price_column,
        mappingConfig?.delivery_note_price_column,
        "price",
        "precio",
      ].filter(Boolean) as string[],
    );

    if (priceKeys.has(columnKey)) return true;

    const schema = columnSchema.find((c) => c.key === columnKey);
    if (schema?.isCustom) return true;
    const lower = columnKey.toLowerCase();
    return Boolean(schema?.type === "number" && (lower.includes("precio") || lower.includes("price")));
  };

  const openMenuAtPoint = (type: "rows" | "columns", clientX: number, clientY: number) => {
    setMenuState({ type, top: clientY, left: clientX });
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const clearSelection = useCallback(() => {
    setAllRowsSelected(false);
    setSelectedRowIds(new Set());
    setSelectedColumnKeys(new Set());
    setMenuState(null);
  }, []);

  useEffect(() => {
    if (!menuState) {
      setMenuPosition(null);
      return;
    }

    const raf = window.requestAnimationFrame(() => {
      const menuEl = menuRef.current;
      if (!menuEl) return;

      const rect = menuEl.getBoundingClientRect();
      const menuHeight = rect.height || 220;
      const menuWidth = rect.width || 260;
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const margin = 8;

      const shouldOpenUp = menuState.top > viewportHeight / 2;
      let top = shouldOpenUp ? menuState.top - menuHeight : menuState.top;
      top = Math.max(margin, Math.min(top, viewportHeight - menuHeight - margin));

      let left = menuState.left;
      if (left + menuWidth > viewportWidth - margin) {
        left = Math.max(margin, viewportWidth - menuWidth - margin);
      }

      setMenuPosition({ top, left });
    });

    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [menuState]);

  useEffect(() => {
    if (!menuState && !selectedRowIds.size && !selectedColumnKeys.size) return;

    const listRootSelector = `[data-stock-list-root="${listId}"]`;
    const controlsSelector = `[data-stock-controls="${listId}"]`;
    const selectionBarSelector = `[data-stock-selection-bar="${listId}"]`;
    const tableContainerSelector = `[data-stock-table-container="${listId}"]`;
    const menuSelector = `[data-stock-menu="${listId}"]`;
    const mobileActionsSelector = `[data-stock-mobile-actions="${listId}"]`;

    const onPointerDown = (e: PointerEvent) => {
      if (confirmDeleteRowsOpen || confirmDeleteColumnsOpen) return;

      const target = e.target instanceof Element ? e.target : null;
      const path = typeof e.composedPath === "function" ? e.composedPath() : null;

      const isInsideRef = (ref: RefObject<HTMLElement>, selector: string) => {
        const node = ref.current;
        if (node && path?.includes(node)) return true;
        if (!target) return false;
        return Boolean(target.closest(selector));
      };

      const insideMenu = isInsideRef(menuRef, menuSelector);
      const insideTable = isInsideRef(tableContainerRef, tableContainerSelector);
      const insideList = isInsideRef(listContainerRef, listRootSelector);
      const insideControls = isInsideRef(controlsRef, controlsSelector);
      const insideSelectionBar = isInsideRef(selectionBarRef, selectionBarSelector);
      const insideMobileActions = isInsideRef(mobileActionsRef, mobileActionsSelector);

      if (menuState && !insideMenu && !insideTable) {
        setMenuState(null);
      }

      if (selectedRowIds.size || selectedColumnKeys.size) {
        if (
          insideMenu ||
          insideMobileActions ||
          insideList ||
          insideTable ||
          insideSelectionBar ||
          insideControls
        ) {
          return;
        }
        clearSelection();
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (menuState) setMenuState(null);
        if (selectedRowIds.size || selectedColumnKeys.size) clearSelection();
      }
    };

    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [
    menuState,
    selectedRowIds.size,
    selectedColumnKeys.size,
    confirmDeleteRowsOpen,
    confirmDeleteColumnsOpen,
    listId,
    clearSelection,
  ]);

  const getVisibleRowIds = () => table.getRowModel().rows.map((r) => String((r.original as any).id));

  const getVisibleSelectableColumnKeys = () =>
    (table.getHeaderGroups()[0]?.headers ?? []).map((h) => h.column.id).filter((k) => isSelectableColumn(k));

  const selectRowSingle = (productId: string) => {
    setAllRowsSelected(false);
    setSelectedColumnKeys(new Set());
    setSelectedRowIds(new Set([productId]));
    setMenuState(null);
    rowAnchorIdRef.current = productId;
  };

  const toggleRow = (productId: string) => {
    setAllRowsSelected(false);
    setSelectedColumnKeys(new Set());
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
    setMenuState(null);
    rowAnchorIdRef.current = productId;
  };

  const selectRowRange = (toProductId: string, additive: boolean) => {
    setAllRowsSelected(false);
    const order = getVisibleRowIds();
    const anchorId = rowAnchorIdRef.current ?? toProductId;
    const fromIndex = order.indexOf(anchorId);
    const toIndex = order.indexOf(toProductId);

    const rangeIds =
      fromIndex === -1 || toIndex === -1
        ? [toProductId]
        : order.slice(Math.min(fromIndex, toIndex), Math.max(fromIndex, toIndex) + 1);

    setSelectedColumnKeys(new Set());
    setSelectedRowIds((prev) => {
      if (additive) return new Set([...prev, ...rangeIds]);
      return new Set(rangeIds);
    });
    setMenuState(null);
    rowAnchorIdRef.current = toProductId;
  };

  const handleRowPointerDown = (e: ReactPointerEvent, productId: string) => {
    lastPointerTypeRef.current = e.pointerType as any;
    if (e.pointerType !== "touch") return;
    if (isInteractiveTarget(e.target)) return;

    clearLongPressTimer();
    const x = e.clientX;
    const y = e.clientY;
    longPressTimerRef.current = window.setTimeout(() => {
      setAllRowsSelected(false);
      setSelectedColumnKeys(new Set());
      setSelectedRowIds((prev) => (prev.has(productId) ? prev : new Set([productId])));
      if (!isMobile) {
        openMenuAtPoint("rows", x, y);
      }
      rowAnchorIdRef.current = productId;
    }, 550);
  };

  const handleRowClick = (e: ReactMouseEvent, productId: string) => {
    if (isInteractiveTarget(e.target)) return;
    const additive =
      e.ctrlKey || e.metaKey || (lastPointerTypeRef.current === "touch" && selectedRowIds.size > 0);

    if (e.shiftKey) {
      selectRowRange(productId, true);
      return;
    }

    if (selectedRowIds.has(productId) && !additive) {
      toggleRow(productId);
      return;
    }

    if (additive) {
      toggleRow(productId);
      return;
    }

    selectRowSingle(productId);
  };

  const selectColumnSingle = (columnKey: string) => {
    if (!isSelectableColumn(columnKey)) return;
    setAllRowsSelected(false);
    setSelectedRowIds(new Set());
    setSelectedColumnKeys(new Set([columnKey]));
    setMenuState(null);
    columnAnchorKeyRef.current = columnKey;
  };

  const toggleColumn = (columnKey: string) => {
    if (!isSelectableColumn(columnKey)) return;
    setAllRowsSelected(false);
    setSelectedRowIds(new Set());
    setSelectedColumnKeys((prev) => {
      const next = new Set(prev);
      if (next.has(columnKey)) next.delete(columnKey);
      else next.add(columnKey);
      return next;
    });
    setMenuState(null);
    columnAnchorKeyRef.current = columnKey;
  };

  const selectColumnRange = (toColumnKey: string, additive: boolean) => {
    if (!isSelectableColumn(toColumnKey)) return;
    setAllRowsSelected(false);

    const order = getVisibleSelectableColumnKeys();
    const anchorKey = columnAnchorKeyRef.current ?? toColumnKey;
    const fromIndex = order.indexOf(anchorKey);
    const toIndex = order.indexOf(toColumnKey);

    const rangeKeys =
      fromIndex === -1 || toIndex === -1
        ? [toColumnKey]
        : order.slice(Math.min(fromIndex, toIndex), Math.max(fromIndex, toIndex) + 1);

    setSelectedRowIds(new Set());
    setSelectedColumnKeys((prev) => {
      if (additive) return new Set([...prev, ...rangeKeys]);
      return new Set(rangeKeys);
    });
    setMenuState(null);
    columnAnchorKeyRef.current = toColumnKey;
  };

  const nonDeletableColumnKeys = useMemo(() => {
    const keys = new Set<string>(["actions", "stock_threshold"]);
    for (const c of columnSchema) {
      if (c.isStandard) keys.add(c.key);
    }
    for (const key of mappingConfig?.code_keys ?? []) {
      keys.add(key);
    }
    keys.add("code");
    keys.add("name");
    return keys;
  }, [columnSchema, mappingConfig]);

  const handleBulkAddToCart = () => {
    if (!selectedProducts.length && !allRowsSelected) return;
    setIsBulkWorking(true);
    void (async () => {
      try {
        const productsToAdd = allRowsSelected ? transformedProducts : selectedProducts;
        if (!productsToAdd.length) return;
        for (const p of productsToAdd) {
          onAddToRequest(p, mappingConfig, { silent: true });
        }
        toast.success(
          productsToAdd.length === 1
            ? "Producto agregado al carrito"
            : `${productsToAdd.length} productos agregados al carrito`,
        );
        setMenuState(null);
        clearSelection();
      } catch (error: any) {
        console.error("bulk addToCart error:", error);
        toast.error(error?.message || "Error al agregar productos al carrito");
      } finally {
        setIsBulkWorking(false);
      }
    })();
  };

  const selectedMode: "rows" | "columns" | null =
    allRowsSelected || selectedRowIds.size > 0 ? "rows" : selectedColumnKeys.size > 0 ? "columns" : null;
  const isInSelectionMode = selectedMode != null;
  const selectionLabel =
    selectedMode === "rows"
      ? allRowsSelected
        ? "Todos los productos de la lista seleccionados"
        : `${selectedRowIds.size} producto${selectedRowIds.size === 1 ? "" : "s"} seleccionado${
            selectedRowIds.size === 1 ? "" : "s"
          }`
      : `${selectedColumnKeys.size} columna${selectedColumnKeys.size === 1 ? "" : "s"} seleccionada${
          selectedColumnKeys.size === 1 ? "" : "s"
        }`;
  const deleteRowsDescription = allRowsSelected
    ? "Esta acción quitará todos los productos de Mi Stock. No se puede deshacer."
    : `Esta acción quitará ${selectedRowIds.size} producto${
        selectedRowIds.size === 1 ? "" : "s"
      } de Mi Stock. No se puede deshacer.`;
  const showCardSelectionHeader = isInSelectionMode && effectiveViewMode === "cards";
  const mobileSelectionPadding = showCardSelectionHeader
    ? { paddingTop: "calc(3.5rem + env(safe-area-inset-top))" }
    : undefined;

  useEffect(() => {
    if (!isInSelectionMode) {
      setMobileActionsOpen(false);
    }
  }, [isInSelectionMode]);

  // Helper to update cart prices after USD/ARS conversion
  const updateCartPricesAfterConversion = useCallback(
    async (convertedProducts: any[]) => {
      const cartPriceColumn = mappingConfig?.cart_price_column;
      const cartIds = new Set(requestList.map((r) => r.productId));
      const idsToUpdate = convertedProducts
        .map((product) => product.product_id || product.id)
        .filter((id: string | undefined) => Boolean(id && cartIds.has(id)));

      if (!idsToUpdate.length) return;

      try {
        if (isOnline()) {
          const { data, error } = await supabase
            .from("dynamic_products_index")
            .select("product_id, price, calculated_data")
            .in("product_id", idsToUpdate);
          if (error) throw error;

          for (const row of data ?? []) {
            let newPrice: number | null = null;
            if (cartPriceColumn && row.calculated_data?.[cartPriceColumn] != null) {
              newPrice = normalizeRawPrice(row.calculated_data[cartPriceColumn]);
            }
            if (newPrice == null && row.price != null) {
              newPrice = normalizeRawPrice(row.price);
            }
            if (newPrice != null) {
              updateItemPrice(row.product_id, newPrice);
            }
          }
          return;
        }
      } catch (error) {
        console.error("updateCartPricesAfterConversion (online) error:", error);
      }

      for (const product of convertedProducts) {
        const productId = product.product_id || product.id;
        if (!productId || !cartIds.has(productId)) continue;

        let newPrice = product.price;
        if (cartPriceColumn && product.calculated_data?.[cartPriceColumn] != null) {
          newPrice = product.calculated_data[cartPriceColumn];
        }
        if (newPrice != null && typeof newPrice === "number") {
          updateItemPrice(productId, newPrice);
        }
      }
    },
    [requestList, mappingConfig, updateItemPrice],
  );

  const handleBulkConvertUsdToArs = async () => {
    if (!selectedProducts.length && !allRowsSelected) return;
    setIsBulkWorking(true);
    try {
      const productsToProcess = allRowsSelected ? transformedProducts : selectedProducts;
      if (!productsToProcess.length) return;
      const result = await convertUsdToArsForProducts({
        listId,
        products: productsToProcess,
        mappingConfig,
        columnSchema,
        applyToAll: allRowsSelected,
        productIds: allRowsSelected ? undefined : productsToProcess.map((p) => p.id),
      });

      if (!result.dollarRate) {
        toast.error("No hay dólar oficial configurado para convertir");
        return;
      }

      toast.success(result.updated === 1 ? "Precio convertido a ARS" : `${result.updated} productos convertidos a ARS`, {
        description: `Dólar oficial: $${result.dollarRate.toFixed(2)}`,
      });

      queryClient.invalidateQueries({ queryKey: ["my-stock"] });
      queryClient.invalidateQueries({ queryKey: ["list-products", listId], exact: false });
      queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
      queryClient.invalidateQueries({ queryKey: ["delivery-note-with-items"], exact: false });
      
      // Update cart prices for converted products
      await updateCartPricesAfterConversion(productsToProcess);
      await syncListCacheFromLocal(productsToProcess.map((p) => p.id));
      
      setMenuState(null);
      clearSelection();
    } catch (e: any) {
      console.error("bulk convert USD→ARS error:", e);
      toast.error(e?.message || "Error al convertir USD a ARS");
    } finally {
      setIsBulkWorking(false);
    }
  };

  const handleBulkRevertArsToUsd = async () => {
    if (!selectedProducts.length && !allRowsSelected) return;
    setIsBulkWorking(true);
    try {
      const productsToProcess = allRowsSelected ? transformedProducts : selectedProducts;
      if (!productsToProcess.length) return;
      const result = await revertUsdToArsForProducts({
        listId,
        products: productsToProcess,
        mappingConfig,
        applyToAll: allRowsSelected,
        productIds: allRowsSelected ? undefined : productsToProcess.map((p) => p.id),
      });

      toast.success(
        result.reverted === 1 ? "Conversión revertida a USD" : `${result.reverted} productos revertidos a USD`,
      );

      queryClient.invalidateQueries({ queryKey: ["my-stock"] });
      queryClient.invalidateQueries({ queryKey: ["list-products", listId], exact: false });
      queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
      queryClient.invalidateQueries({ queryKey: ["delivery-note-with-items"], exact: false });
      
      // Update cart prices for reverted products
      await updateCartPricesAfterConversion(productsToProcess);
      await syncListCacheFromLocal(productsToProcess.map((p) => p.id));
      
      setMenuState(null);
      clearSelection();
    } catch (e: any) {
      console.error("bulk revert ARS→USD error:", e);
      toast.error(e?.message || "Error al revertir conversión");
    } finally {
      setIsBulkWorking(false);
    }
  };

  const selectedConvertibleColumnKeys = useMemo(
    () => Array.from(selectedColumnKeys).filter((key) => isConvertibleColumn(key)),
    [selectedColumnKeys, columnSchema, mappingConfig],
  );

  const handleConvertSelectedColumns = async () => {
    const targetKeys = selectedConvertibleColumnKeys;
    if (!targetKeys.length) {
      toast.error("Seleccioná columnas de precio para convertir");
      return;
    }

    const products = filteredProducts as any[];
    if (!products.length) return;

    setIsBulkWorking(true);
    try {
      const result = await convertUsdToArsForProducts({
        listId,
        products,
        mappingConfig,
        columnSchema,
        targetKeys,
      });

      if (!result.dollarRate) {
        toast.error("No hay dólar oficial configurado para convertir");
        return;
      }

      const skipped = result.skippedAlreadyConverted;
      toast.success(
        result.updated === 1 ? "Columna convertida a ARS" : `${result.updated} productos convertidos a ARS`,
        skipped
          ? {
              description: `${skipped} producto${skipped === 1 ? "" : "s"} ya convertido${skipped === 1 ? "" : "s"}`,
            }
          : { description: `Dólar oficial: $${result.dollarRate.toFixed(2)}` },
      );

      await updateCartPricesAfterConversion(products);
      await syncListCacheFromLocal(products.map((p) => p.id));

      queryClient.invalidateQueries({ queryKey: ["my-stock"] });
      queryClient.invalidateQueries({ queryKey: ["list-products", listId], exact: false });
      queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
      queryClient.invalidateQueries({ queryKey: ["delivery-note-with-items"], exact: false });
      setMenuState(null);
      clearSelection();
    } catch (e: any) {
      console.error("column convert USD→ARS error:", e);
      toast.error(e?.message || "Error al convertir USD a ARS");
    } finally {
      setIsBulkWorking(false);
    }
  };

  const handleRevertSelectedColumns = async () => {
    const targetKeys = selectedConvertibleColumnKeys;
    if (!targetKeys.length) {
      toast.error("Seleccioná columnas de precio para revertir");
      return;
    }

    const products = filteredProducts as any[];
    if (!products.length) return;

    setIsBulkWorking(true);
    try {
      const result = await revertUsdToArsForProducts({
        listId,
        products,
        mappingConfig,
        targetKeys,
      });

      toast.success(
        result.reverted === 1 ? "Conversión revertida a USD" : `${result.reverted} productos revertidos a USD`,
      );

      await updateCartPricesAfterConversion(products);
      await syncListCacheFromLocal(products.map((p) => p.id));

      queryClient.invalidateQueries({ queryKey: ["my-stock"] });
      queryClient.invalidateQueries({ queryKey: ["list-products", listId], exact: false });
      queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
      queryClient.invalidateQueries({ queryKey: ["delivery-note-with-items"], exact: false });
      setMenuState(null);
      clearSelection();
    } catch (e: any) {
      console.error("column revert ARS→USD error:", e);
      toast.error(e?.message || "Error al revertir conversión");
    } finally {
      setIsBulkWorking(false);
    }
  };

  const handleConfirmDeleteRows = async () => {
    const ids = allRowsSelected
      ? transformedProducts.map((p) => String((p as any).id ?? (p as any).product_id ?? "")).filter(Boolean)
      : Array.from(selectedRowIds);
    if (!ids.length) return;
    setIsBulkWorking(true);
    try {
      onRemoveProducts?.(ids);
      if (!onRemoveProducts) ids.forEach((id) => onRemoveProduct?.(id));

      await bulkRemoveFromMyStock({ productIds: ids });
      await syncListCacheFromLocal(ids);
      toast.success(ids.length === 1 ? "Producto quitado de Mi Stock" : `${ids.length} productos quitados de Mi Stock`);
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ["my-stock"] });
      queryClient.invalidateQueries({ queryKey: ["list-products", listId], exact: false });
    } catch (e: any) {
      console.error("bulk remove from my stock error:", e);
      toast.error(e?.message || "Error al quitar productos de Mi Stock");
    } finally {
      setIsBulkWorking(false);
      setConfirmDeleteRowsOpen(false);
    }
  };

  const handleConfirmDeleteColumns = async () => {
    const keys = Array.from(selectedColumnKeys).filter((k) => !nonDeletableColumnKeys.has(k));
    if (!keys.length) {
      toast.error("No hay columnas eliminables seleccionadas");
      setConfirmDeleteColumnsOpen(false);
      return;
    }

    setIsBulkWorking(true);
    try {
      await deleteColumnsFromList({ listId, columnSchema, mappingConfig, columnKeys: keys });
      toast.success(keys.length === 1 ? "Columna eliminada" : `${keys.length} columnas eliminadas`);
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ["product-lists-index"], refetchType: "all" });
      queryClient.invalidateQueries({ queryKey: ["product-lists"], refetchType: "all" });
      queryClient.invalidateQueries({ queryKey: ["list-products", listId], exact: false });
      queryClient.invalidateQueries({ queryKey: ["my-stock"] });
    } catch (e: any) {
      console.error("delete columns error:", e);
      toast.error(e?.message || "Error al eliminar columnas");
    } finally {
      setIsBulkWorking(false);
      setConfirmDeleteColumnsOpen(false);
    }
  };

  const isFiltering = debouncedFilter.trim().length > 0;

  const table = useReactTable({
    data: tableData,
    columns: visibleColumns,
    getRowId: (row) => String((row as any).id ?? (row as any).product_id ?? ""),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  });

  const anySelectedColumnFxConverted = useMemo(() => {
    if (!selectedConvertibleColumnKeys.length) return false;
    const primaryKey = mappingConfig?.price_primary_key ?? null;
    for (const product of filteredProducts) {
      const calc = ((product as any)?.calculated_data ?? {}) as Record<string, any>;
      for (const key of selectedConvertibleColumnKeys) {
        const markerKey =
          primaryKey && key === primaryKey ? "__fx_usd_ars__orig__price" : `__fx_usd_ars__orig__${key}`;
        if (calc[markerKey] != null) return true;
      }
    }
    return false;
  }, [filteredProducts, selectedConvertibleColumnKeys, mappingConfig]);

  const selectAllRows = useCallback(() => {
    const allIds = transformedProducts
      .map((product) => String((product as any).id ?? (product as any).product_id ?? ""))
      .filter(Boolean);
    if (!allIds.length) return;
    if (allRowsSelected) {
      clearSelection();
      rowAnchorIdRef.current = null;
      return;
    }
    setSelectedColumnKeys(new Set());
    setSelectedRowIds(new Set(allIds));
    setAllRowsSelected(true);
    rowAnchorIdRef.current = allIds[0] ?? null;
  }, [transformedProducts, allRowsSelected, clearSelection]);

  useEffect(() => {
    if (!allRowsSelected) return;
    const allIds = transformedProducts
      .map((product) => String((product as any).id ?? (product as any).product_id ?? ""))
      .filter(Boolean);
    setSelectedRowIds(new Set(allIds));
  }, [allRowsSelected, transformedProducts]);

  const mobileSelectionHeader = showCardSelectionHeader ? (
    <div
      ref={controlsRef}
      data-stock-controls={listId}
      className="fixed top-0 inset-x-0 z-[60] bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b"
      style={{ paddingTop: "max(env(safe-area-inset-top), 0px)" }}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" onClick={clearSelection} className="h-9 w-9">
            <X className="h-5 w-5" />
          </Button>
          <span className="text-sm font-medium truncate">{selectionLabel}</span>
        </div>
        <div className="flex items-center gap-1">
          {selectedMode === "rows" && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={selectAllRows}
              className="h-9 w-9"
            >
              <CheckSquare className="h-5 w-5" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setMobileActionsOpen(true)}
            className="h-9 w-9"
          >
            <MoreVertical className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() !== "a") return;
      if (isEditableTarget(e.target)) return;

      const container = listContainerRef.current;
      if (!container) return;
      const target = e.target as Node | null;
      const activeElement = document.activeElement;
      const isInList = (node: Node | null) => Boolean(node && container.contains(node));
      if (!isInList(target) && !isInList(activeElement)) return;

      e.preventDefault();
      selectAllRows();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [selectAllRows]);

  if (products.length === 0) {
    return (
      <div className="p-6 text-center border-t text-muted-foreground">
        No hay productos con stock en esta lista
      </div>
    );
  }

  const isFilteredEmpty = filteredProducts.length === 0;

  const ViewToggle = () => (
    <div className="flex gap-1.5">
      <Button
        variant={effectiveViewMode === "table" ? "default" : "outline"}
        size="sm"
        onClick={() => setViewMode(listId, "table")}
      >
        <List className="h-4 w-4" />
      </Button>
      <Button
        variant={effectiveViewMode === "cards" ? "default" : "outline"}
        size="sm"
        onClick={() => setViewMode(listId, "cards")}
      >
        <LayoutGrid className="h-4 w-4" />
      </Button>
    </div>
  );

  const filterControls = (
    <div
      ref={controlsRef}
      data-stock-controls={listId}
      className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
    >
      <div className="flex items-center gap-2 w-full md:max-w-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar en esta lista..."
            value={localFilter}
            onChange={(e) => setLocalFilter(e.target.value)}
            className="pl-9 pr-10"
          />
          {localFilter.trim().length > 0 && (
            <button
              type="button"
              onClick={() => setLocalFilter("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7588eb]"
              aria-label="Limpiar búsqueda"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={selectAllRows} className="gap-2 shrink-0">
          <List className="h-4 w-4" />
          <span className="hidden sm:inline">Seleccionar todo</span>
        </Button>
      </div>
      <div className="flex items-center gap-2 flex-wrap justify-between">
        <div className="flex gap-1.5">
          <CardPreviewSettings
            listId={listId}
            columnSchema={processedSchema}
            fixedKeys={["quantity", STOCK_THRESHOLD_COLUMN.key]}
          />
          <ColumnSettingsDrawer listId={listId} columnSchema={processedSchema} mappingConfig={mappingConfig} />
        </div>
        {!isMobile && <ViewToggle />}
      </div>
    </div>
  );

  if (effectiveViewMode === "cards") {
    return (
      <div
        ref={listContainerRef}
        data-stock-list-root={listId}
        className="p-4 border-t space-y-4"
        style={mobileSelectionPadding}
      >
        {showCardSelectionHeader ? mobileSelectionHeader : filterControls}
        {isFilteredEmpty ? (
          <div className="text-center text-muted-foreground py-6">
            No se encontraron productos{isFiltering ? ` para "${debouncedFilter}"` : ""}
          </div>
        ) : (
            <ProductCardView
              listId={listId}
              products={filteredProducts as any}
              columnSchema={processedSchema}
              mappingConfig={mappingConfig}
              onAddToRequest={(product) => onAddToRequest(product, mappingConfig)}
              showActions={true}
            showRemoveFromStock={true}
            onRemoveFromStock={handleRemoveFromStock}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            onSortChange={handleSortChange}
            showLowStockBadge={true}
            showStockThreshold={true}
            onThresholdChange={handleThresholdChange}
            suppressStockToasts={true}
            enableSelection
            selectedIds={selectedRowIds}
            selectionModeActive={selectedRowIds.size > 0 || allRowsSelected}
            onRowClick={handleRowClick}
            onRowPointerDown={handleRowPointerDown}
            onRowPointerUp={clearLongPressTimer}
            onRowPointerCancel={clearLongPressTimer}
          />
        )}
        {effectiveViewMode === "cards" && (
          <Drawer open={mobileActionsOpen} onOpenChange={setMobileActionsOpen}>
            <DrawerContent ref={mobileActionsRef} data-stock-mobile-actions={listId}>
              <DrawerHeader>
                <DrawerTitle>Acciones</DrawerTitle>
              </DrawerHeader>
              <div className="px-4 pb-4 flex flex-col gap-1">
                {selectedMode === "rows" ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!selectedProducts.length && !allRowsSelected}
                      onClick={() => {
                        setMobileActionsOpen(false);
                        handleBulkAddToCart();
                      }}
                      className="w-full justify-start gap-2"
                    >
                      <ShoppingCart className="h-4 w-4" />
                      Agregar al carrito
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={(!selectedProducts.length && !allRowsSelected) || isBulkWorking}
                      onClick={() => {
                        setMobileActionsOpen(false);
                        void handleBulkConvertUsdToArs();
                      }}
                      className="w-full justify-start gap-2"
                    >
                      <DollarSign className="h-4 w-4" />
                      Convertir USD a ARS
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={(!selectedProducts.length && !allRowsSelected) || isBulkWorking || !anySelectedFxConverted}
                      onClick={() => {
                        setMobileActionsOpen(false);
                        void handleBulkRevertArsToUsd();
                      }}
                      className="w-full justify-start gap-2"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Revertir a USD
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={(!selectedRowIds.size && !allRowsSelected) || isBulkWorking}
                      onClick={() => {
                        setMobileActionsOpen(false);
                        setConfirmDeleteRowsOpen(true);
                      }}
                      className="w-full justify-start gap-2 text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                      Quitar de Mi Stock
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!selectedConvertibleColumnKeys.length || isBulkWorking}
                      onClick={() => {
                        setMobileActionsOpen(false);
                        void handleConvertSelectedColumns();
                      }}
                      className="w-full justify-start gap-2"
                    >
                      <DollarSign className="h-4 w-4" />
                      Convertir USD a ARS
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!selectedConvertibleColumnKeys.length || isBulkWorking || !anySelectedColumnFxConverted}
                      onClick={() => {
                        setMobileActionsOpen(false);
                        void handleRevertSelectedColumns();
                      }}
                      className="w-full justify-start gap-2"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Revertir a USD
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!selectedColumnKeys.size || isBulkWorking}
                      onClick={() => {
                        setMobileActionsOpen(false);
                        setConfirmDeleteColumnsOpen(true);
                      }}
                      className="w-full justify-start gap-2 text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                      Eliminar columna
                    </Button>
                  </>
                )}
              </div>
            </DrawerContent>
          </Drawer>
        )}

        <AlertDialog open={confirmDeleteRowsOpen} onOpenChange={setConfirmDeleteRowsOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Quitar de Mi Stock?</AlertDialogTitle>
              <AlertDialogDescription>
                {deleteRowsDescription}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isBulkWorking}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                disabled={isBulkWorking}
                className="bg-destructive hover:bg-destructive/90"
                onClick={() => void handleConfirmDeleteRows()}
              >
                Quitar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={confirmDeleteColumnsOpen} onOpenChange={setConfirmDeleteColumnsOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Eliminar columnas?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta acción eliminará {Array.from(selectedColumnKeys).filter((k) => !nonDeletableColumnKeys.has(k)).length}{" "}
                columna(s) de la configuración de la lista. No se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isBulkWorking}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                disabled={isBulkWorking}
                className="bg-destructive hover:bg-destructive/90"
                onClick={() => void handleConfirmDeleteColumns()}
              >
                Eliminar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <div
      ref={listContainerRef}
      data-stock-list-root={listId}
      className="p-4 border-t space-y-4"
      style={mobileSelectionPadding}
    >
      {showCardSelectionHeader ? mobileSelectionHeader : filterControls}

      {isFilteredEmpty ? (
        <div className="text-center text-muted-foreground py-6">
          No se encontraron productos{isFiltering ? ` para "${debouncedFilter}"` : ""}
        </div>
      ) : (
        <div className="w-full border rounded-lg overflow-hidden">
          {isInSelectionMode && !isMobile && (
            <div
              ref={selectionBarRef}
              data-stock-selection-bar={listId}
              className="border-b bg-muted/40 px-3 py-2 flex items-center justify-between gap-3 flex-wrap"
            >
              <div className="text-sm text-muted-foreground">
                {selectedMode === "rows" ? (
                  <span>
                    {allRowsSelected
                      ? "Todos los productos seleccionados"
                      : `${selectedRowIds.size} producto${selectedRowIds.size === 1 ? "" : "s"} seleccionado${
                          selectedRowIds.size === 1 ? "" : "s"
                        }`}
                  </span>
                ) : (
                  <span>
                    {selectedColumnKeys.size} columna{selectedColumnKeys.size === 1 ? "" : "s"} seleccionada
                    {selectedColumnKeys.size === 1 ? "" : "s"}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {selectedMode === "rows" ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!selectedProducts.length && !allRowsSelected}
                      onClick={handleBulkAddToCart}
                      className="gap-2"
                    >
                      <ShoppingCart className="h-4 w-4" />
                      <span className="hidden sm:inline">Carrito</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={(!selectedProducts.length && !allRowsSelected) || isBulkWorking}
                      onClick={() => void handleBulkConvertUsdToArs()}
                      className="gap-2"
                    >
                      <DollarSign className="h-4 w-4" />
                      <span className="hidden sm:inline">USD→ARS</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={(!selectedProducts.length && !allRowsSelected) || isBulkWorking || !anySelectedFxConverted}
                      onClick={() => void handleBulkRevertArsToUsd()}
                      className="gap-2"
                    >
                      <RotateCcw className="h-4 w-4" />
                      <span className="hidden sm:inline">Revertir</span>
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={(!selectedRowIds.size && !allRowsSelected) || isBulkWorking}
                      onClick={() => setConfirmDeleteRowsOpen(true)}
                      className="gap-2"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="hidden sm:inline">Quitar</span>
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!selectedConvertibleColumnKeys.length || isBulkWorking}
                      onClick={() => void handleConvertSelectedColumns()}
                      className="gap-2"
                    >
                      <DollarSign className="h-4 w-4" />
                      <span className="hidden sm:inline">USD→ARS</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!selectedConvertibleColumnKeys.length || isBulkWorking || !anySelectedColumnFxConverted}
                      onClick={() => void handleRevertSelectedColumns()}
                      className="gap-2"
                    >
                      <RotateCcw className="h-4 w-4" />
                      <span className="hidden sm:inline">Revertir</span>
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={!selectedColumnKeys.size || isBulkWorking}
                      onClick={() => setConfirmDeleteColumnsOpen(true)}
                      className="gap-2"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="hidden sm:inline">Eliminar columna</span>
                    </Button>
                  </>
                )}

                <Button variant="ghost" size="sm" onClick={clearSelection}>
                  Limpiar
                </Button>
              </div>
            </div>
          )}
          <div
            ref={tableContainerRef}
            data-stock-table-container={listId}
            className="max-h-[600px] overflow-auto relative"
          >
            <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  {table.getHeaderGroups()[0]?.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className={cn(
                        "select-none bg-background cursor-pointer",
                        selectedColumnKeys.has(header.column.id) && "bg-primary/20",
                      )}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (isMobile) return;
                        if (!isSelectableColumn(header.column.id)) return;

                        setAllRowsSelected(false);
                        setSelectedRowIds(new Set());
                        setSelectedColumnKeys((prev) => (prev.has(header.column.id) ? prev : new Set([header.column.id])));
                        openMenuAtPoint("columns", e.clientX, e.clientY);
                        columnAnchorKeyRef.current = header.column.id;
                      }}
                      onPointerDown={(e) => {
                        lastPointerTypeRef.current = e.pointerType as any;
                        if (e.pointerType !== "touch") return;
                        if (isInteractiveTarget(e.target)) return;
                        if (!isSelectableColumn(header.column.id)) return;

                        clearLongPressTimer();
                        const columnKey = header.column.id;
                        const x = e.clientX;
                        const y = e.clientY;
                        longPressTimerRef.current = window.setTimeout(() => {
                          setAllRowsSelected(false);
                          setSelectedRowIds(new Set());
                          setSelectedColumnKeys((prev) => (prev.has(columnKey) ? prev : new Set([columnKey])));
                          if (!isMobile) {
                            openMenuAtPoint("columns", x, y);
                          }
                          columnAnchorKeyRef.current = columnKey;
                        }, 550);
                      }}
                      onPointerUp={clearLongPressTimer}
                      onPointerCancel={clearLongPressTimer}
                      onClick={(e) => {
                        if (isInteractiveTarget(e.target)) return;
                        if (!isSelectableColumn(header.column.id)) return;

                        const additive =
                          e.ctrlKey ||
                          e.metaKey ||
                          (lastPointerTypeRef.current === "touch" && selectedColumnKeys.size > 0);
                        if (e.shiftKey) {
                          selectColumnRange(header.column.id, true);
                          return;
                        }

                        if (additive) {
                          toggleColumn(header.column.id);
                          return;
                        }

                        selectColumnSingle(header.column.id);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <div className="text-left flex items-center gap-2 min-w-0">
                          <span className="truncate">
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </span>
                        </div>
                        {header.column.getCanSort() && header.column.id !== "actions" && (
                          <button
                            type="button"
                            className="shrink-0 rounded-sm p-1 hover:bg-muted"
                            aria-label="Ordenar columna"
                            onClick={(e) => {
                              e.stopPropagation();
                              header.column.toggleSorting(undefined, e.shiftKey);
                            }}
                          >
                            {{
                              asc: <ChevronUp className="w-4 h-4" />,
                              desc: <ChevronDown className="w-4 h-4" />,
                            }[header.column.getIsSorted() as string] ?? <ArrowUpDown className="w-4 h-4 opacity-50" />}
                          </button>
                        )}
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.slice(0, tableDisplayCount).map((row) => (
                  <TableRow
                    key={row.id}
                    className={cn(selectedRowIds.has((row.original as any).id) && "bg-primary/20")}
                    onPointerDown={(e) => handleRowPointerDown(e, String((row.original as any).id))}
                    onPointerUp={clearLongPressTimer}
                    onPointerCancel={clearLongPressTimer}
                    onClick={(e) => handleRowClick(e, String((row.original as any).id))}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (isMobile) return;
                      if (isInteractiveTarget(e.target)) return;
                      const id = String((row.original as any).id);
                      setAllRowsSelected(false);
                      setSelectedColumnKeys(new Set());
                      setSelectedRowIds((prev) => (prev.has(id) ? prev : new Set([id])));
                      openMenuAtPoint("rows", e.clientX, e.clientY);
                      rowAnchorIdRef.current = id;
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={cn(selectedColumnKeys.has(cell.column.id) && "bg-primary/10")}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {menuState && (
              <div
                ref={menuRef}
                data-stock-menu={listId}
                className="fixed z-50 min-w-[240px] rounded-md border bg-popover p-1 shadow-md"
                style={{
                  top: menuPosition?.top ?? menuState.top,
                  left: menuPosition?.left ?? menuState.left,
                }}
              >
                {menuState.type === "rows" ? (
                  <>
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      {allRowsSelected
                        ? "Todos los productos seleccionados"
                        : `${selectedRowIds.size} fila${selectedRowIds.size === 1 ? "" : "s"} seleccionada${
                            selectedRowIds.size === 1 ? "" : "s"
                          }`}
                    </div>
                    <button
                      type="button"
                      disabled={!selectedProducts.length && !allRowsSelected}
                      className="w-full flex items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                      onClick={handleBulkAddToCart}
                    >
                      <ShoppingCart className="h-4 w-4" />
                      Agregar al carrito
                    </button>
                    <button
                      type="button"
                      disabled={(!selectedProducts.length && !allRowsSelected) || isBulkWorking}
                      className="w-full flex items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                      onClick={() => void handleBulkConvertUsdToArs()}
                    >
                      <DollarSign className="h-4 w-4" />
                      Convertir USD → ARS
                    </button>
                    <button
                      type="button"
                      disabled={(!selectedProducts.length && !allRowsSelected) || isBulkWorking || !anySelectedFxConverted}
                      className="w-full flex items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                      onClick={() => void handleBulkRevertArsToUsd()}
                    >
                      <RotateCcw className="h-4 w-4" />
                      Revertir ARS → USD
                    </button>
                    <div className="my-1 h-px bg-border" />
                    <button
                      type="button"
                      disabled={(!selectedRowIds.size && !allRowsSelected) || isBulkWorking}
                      className="w-full flex items-center gap-2 rounded-sm px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
                      onClick={() => setConfirmDeleteRowsOpen(true)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Quitar de Mi Stock
                    </button>
                    <button
                      type="button"
                      className="w-full rounded-sm px-3 py-2 text-sm hover:bg-accent"
                      onClick={clearSelection}
                    >
                      Limpiar selección
                    </button>
                  </>
                ) : (
                  <>
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      {selectedColumnKeys.size} columna{selectedColumnKeys.size === 1 ? "" : "s"} seleccionada
                      {selectedColumnKeys.size === 1 ? "" : "s"}
                    </div>
                    <button
                      type="button"
                      disabled={!selectedConvertibleColumnKeys.length || isBulkWorking}
                      className="w-full flex items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                      onClick={() => void handleConvertSelectedColumns()}
                    >
                      <DollarSign className="h-4 w-4" />
                      Convertir USD → ARS
                    </button>
                    <button
                      type="button"
                      disabled={!selectedConvertibleColumnKeys.length || isBulkWorking || !anySelectedColumnFxConverted}
                      className="w-full flex items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                      onClick={() => void handleRevertSelectedColumns()}
                    >
                      <RotateCcw className="h-4 w-4" />
                      Revertir ARS → USD
                    </button>
                    <button
                      type="button"
                      disabled={!selectedColumnKeys.size || isBulkWorking}
                      className="w-full flex items-center gap-2 rounded-sm px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
                      onClick={() => setConfirmDeleteColumnsOpen(true)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Eliminar columna{selectedColumnKeys.size === 1 ? "" : "s"}
                    </button>
                    <button
                      type="button"
                      className="w-full rounded-sm px-3 py-2 text-sm hover:bg-accent"
                      onClick={clearSelection}
                    >
                      Limpiar selección
                    </button>
                    {Array.from(selectedColumnKeys).some((k) => nonDeletableColumnKeys.has(k)) && (
                      <div className="px-3 py-2 text-xs text-muted-foreground">Las columnas fijas no se eliminan.</div>
                    )}
                  </>
                )}
              </div>
            )}

          </div>
          {filteredProducts.length > tableDisplayCount && (
            <div className="mt-3 flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setTableDisplayCount((prev) => prev + 50)}
              >
                Cargar más ({filteredProducts.length - tableDisplayCount} más)
              </Button>
            </div>
          )}
        </div>
      )}

      <AlertDialog open={confirmDeleteRowsOpen} onOpenChange={setConfirmDeleteRowsOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar de Mi Stock?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteRowsDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkWorking}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={isBulkWorking}
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => void handleConfirmDeleteRows()}
            >
              Quitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDeleteColumnsOpen} onOpenChange={setConfirmDeleteColumnsOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar columnas?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará {Array.from(selectedColumnKeys).filter((k) => !nonDeletableColumnKeys.has(k)).length}{" "}
              columna(s) de la configuración de la lista. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkWorking}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={isBulkWorking}
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => void handleConfirmDeleteColumns()}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}, (prev, next) => {
  return (
    prev.listId === next.listId &&
    prev.isMobile === next.isMobile &&
    prev.mappingConfig === next.mappingConfig &&
    prev.columnSchema === next.columnSchema &&
    prev.onAddToRequest === next.onAddToRequest &&
    prev.onQuantityChange === next.onQuantityChange &&
    prev.onThresholdChange === next.onThresholdChange &&
    prev.onRemoveProduct === next.onRemoveProduct &&
    prev.onRemoveProducts === next.onRemoveProducts &&
    areProductsShallowEqual(prev.products, next.products)
  );
});
