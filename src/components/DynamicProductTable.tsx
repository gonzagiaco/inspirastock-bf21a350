import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
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
import { Search, ChevronDown, ChevronUp, Plus, X, ArrowUpDown, MoreVertical, CheckSquare } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useProductListStore } from "@/stores/productListStore";
import { ColumnSettingsDrawer } from "./ColumnSettingsDrawer";
import { cn } from "@/lib/utils";
import { ProductCardView } from "./ProductCardView";
import { Button } from "@/components/ui/button";
import { CardPreviewSettings } from "./CardPreviewSettings";
import { List, LayoutGrid, Loader2, ShoppingCart, Package, DollarSign, Trash2, RotateCcw } from "lucide-react";
import { QuantityCell } from "./stock/QuantityCell";
import { Badge } from "@/components/ui/badge";
import { AddProductDropdown } from "./stock/AddProductDropdown";
import { normalizeRawPrice, formatARS } from "@/utils/numberParser";
import { useIsMobile } from "@/hooks/use-mobile";
import { useListProducts } from "@/hooks/useListProducts";
import { useDebounce } from "@/hooks/useDebounce";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { isOnline, localDB } from "@/lib/localDB";
import { supabase } from "@/integrations/supabase/client";
import {
  bulkAddToMyStock,
  convertUsdToArsForProducts,
  deleteColumnsFromList,
  deleteProductsEverywhere,
  revertUsdToArsForProducts,
} from "@/services/bulkTableActions";
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
import { useRequestCartStore } from "@/stores/requestCartStore";
import { CopyableText } from "@/components/ui/copyable-text";

interface DynamicProductTableProps {
  listId: string;
  products: DynamicProduct[];
  columnSchema: ColumnSchema[];
  mappingConfig?: ProductList["mapping_config"];
  onAddToRequest?: (
    product: DynamicProduct,
    mappingConfig?: ProductList["mapping_config"],
    options?: { silent?: boolean },
  ) => void;
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
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const { columnVisibility, columnOrder, columnPinning, viewMode: storeViewMode, setViewMode } = useProductListStore();
  const { requestList, updateItemPrice } = useRequestCartStore();

  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [selectedColumnKeys, setSelectedColumnKeys] = useState<Set<string>>(new Set());
  const [menuState, setMenuState] = useState<
    | {
        type: "rows" | "columns";
        top: number;
        left: number;
      }
    | null
  >(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const mobileActionsRef = useRef<HTMLDivElement | null>(null);
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const selectionBarRef = useRef<HTMLDivElement | null>(null);
  const listActiveRef = useRef(false);
  const rowAnchorIdRef = useRef<string | null>(null);
  const columnAnchorKeyRef = useRef<string | null>(null);
  const lastPointerTypeRef = useRef<"mouse" | "touch" | "pen">("mouse");
  const longPressTimerRef = useRef<number | null>(null);
  const [confirmDeleteRowsOpen, setConfirmDeleteRowsOpen] = useState(false);
  const [confirmDeleteColumnsOpen, setConfirmDeleteColumnsOpen] = useState(false);
  const [isBulkWorking, setIsBulkWorking] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);

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

  const visibilityState = columnVisibility[listId] || {};

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

  const productById = useMemo(
    () =>
      new Map(
        effectiveProducts
          .map((p) => [String((p as any).id ?? (p as any).product_id ?? ""), p] as const)
          .filter(([id]) => id),
      ),
    [effectiveProducts],
  );
  const selectedProducts = useMemo(
    () => Array.from(selectedRowIds).map((id) => productById.get(id)).filter(Boolean) as DynamicProduct[],
    [productById, selectedRowIds],
  );
  const selectedFxConvertedCount = useMemo(
    () => selectedProducts.filter((p) => Boolean((p as any)?.calculated_data?.__fx_usd_ars__at)).length,
    [selectedProducts],
  );
  const anySelectedFxConverted = selectedFxConvertedCount > 0;

  const isInteractiveTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest("button, a, input, textarea, select, [role='button'], [data-interactive='true']"));
  };

  const isEditableTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest("input, textarea, [contenteditable='true']"));
  };

  const isSelectableColumn = (columnKey: string) => {
    return Boolean(columnKey) && columnKey !== "actions" && columnKey !== "quantity";
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

  useEffect(() => {
    if (!menuState) return;

    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current) return;
      if (menuRef.current.contains(e.target as Node)) return;
      if (tableContainerRef.current?.contains(e.target as Node)) return;
      setMenuState(null);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuState(null);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuState]);

  const clearSelection = () => {
    setSelectedRowIds(new Set());
    setSelectedColumnKeys(new Set());
    setMenuState(null);
  };

  useEffect(() => {
    if (!selectedRowIds.size && !selectedColumnKeys.size) return;

    const onPointerDown = (e: PointerEvent) => {
      if (confirmDeleteRowsOpen || confirmDeleteColumnsOpen) return;
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (mobileActionsRef.current?.contains(target)) return;
      if (listContainerRef.current?.contains(target)) return;
      if (tableContainerRef.current?.contains(target)) return;
      if (selectionBarRef.current?.contains(target)) return;
      if (controlsRef.current?.contains(target)) return;
      clearSelection();
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [selectedRowIds.size, selectedColumnKeys.size, confirmDeleteRowsOpen, confirmDeleteColumnsOpen]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const container = listContainerRef.current;
      if (!container) return;
      listActiveRef.current = container.contains(e.target as Node);
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  const getVisibleRowIds = () =>
    table
      .getRowModel()
      .rows.map((r) => String((r.original as any).id ?? (r.original as any).product_id ?? ""))
      .filter(Boolean);

  const getVisibleSelectableColumnKeys = () =>
    (table.getHeaderGroups()[0]?.headers ?? []).map((h) => h.column.id).filter((k) => isSelectableColumn(k));

  const selectRowSingle = (productId: string) => {
    setSelectedColumnKeys(new Set());
    setSelectedRowIds(new Set([productId]));
    setMenuState(null);
    rowAnchorIdRef.current = productId;
  };

  const toggleRow = (productId: string) => {
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
    setSelectedRowIds(new Set());
    setSelectedColumnKeys(new Set([columnKey]));
    setMenuState(null);
    columnAnchorKeyRef.current = columnKey;
  };

  const toggleColumn = (columnKey: string) => {
    if (!isSelectableColumn(columnKey)) return;
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
    keys.add("code");
    keys.add("name");
    return keys;
  }, [columnSchema]);

  const handleBulkAddToCart = () => {
    if (!onAddToRequest) return;
    if (!selectedProducts.length) return;

    for (const p of selectedProducts) {
      onAddToRequest(p, mappingConfig, { silent: true });
    }

    toast.success(
      selectedProducts.length === 1 ? "Producto agregado al carrito" : `${selectedProducts.length} productos agregados al carrito`,
    );
    setMenuState(null);
    clearSelection();
  };

  const selectedMode: "rows" | "columns" | null =
    selectedRowIds.size > 0 ? "rows" : selectedColumnKeys.size > 0 ? "columns" : null;
  const isInSelectionMode = selectedMode != null;
  const selectionLabel =
    selectedMode === "rows"
      ? `${selectedRowIds.size} producto${selectedRowIds.size === 1 ? "" : "s"} seleccionado${
          selectedRowIds.size === 1 ? "" : "s"
        }`
      : `${selectedColumnKeys.size} columna${selectedColumnKeys.size === 1 ? "" : "s"} seleccionada${
          selectedColumnKeys.size === 1 ? "" : "s"
        }`;

  useEffect(() => {
    if (!isInSelectionMode) {
      setMobileActionsOpen(false);
    }
  }, [isInSelectionMode]);

  const handleBulkAddToMyStock = async () => {
    if (!selectedProducts.length) return;
    setIsBulkWorking(true);
    try {
      await bulkAddToMyStock({ productIds: selectedProducts.map((p) => p.id), quantity: 1 });
      toast.success(
        selectedProducts.length === 1 ? "Agregado a Mi Stock" : `${selectedProducts.length} productos agregados a Mi Stock`,
      );
      queryClient.invalidateQueries({ queryKey: ["my-stock"], exact: false });
      setMenuState(null);
      clearSelection();
    } catch (e: any) {
      console.error("bulk addToMyStock error:", e);
      toast.error(e?.message || "Error al agregar a Mi Stock");
    } finally {
      setIsBulkWorking(false);
    }
  };

  // Helper function to update cart prices after USD/ARS conversion
  const updateCartPricesAfterConversion = async (productIds: string[]) => {
    const cartPriceCol = mappingConfig?.cart_price_column;
    const cartIds = new Set(requestList.map((item) => item.productId));
    const idsToUpdate = productIds.filter((id) => cartIds.has(id));
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
          if (cartPriceCol && row.calculated_data && cartPriceCol in (row.calculated_data as any)) {
            newPrice = normalizeRawPrice((row.calculated_data as any)[cartPriceCol]);
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

    for (const productId of idsToUpdate) {
      const indexRecord = await localDB.dynamic_products_index.where({ product_id: productId }).first();
      if (!indexRecord) continue;

      let newPrice: number | null = null;
      if (cartPriceCol && indexRecord.calculated_data && cartPriceCol in (indexRecord.calculated_data as any)) {
        newPrice = normalizeRawPrice((indexRecord.calculated_data as any)[cartPriceCol]);
      }
      if (newPrice == null && indexRecord.price != null) {
        newPrice = normalizeRawPrice(indexRecord.price);
      }
      if (newPrice != null) {
        updateItemPrice(productId, newPrice);
      }
    }
  };

  const handleBulkConvertUsdToArs = async () => {
    if (!selectedProducts.length) return;
    setIsBulkWorking(true);
    try {
      const result = await convertUsdToArsForProducts({
        listId,
        products: selectedProducts,
        mappingConfig,
        columnSchema,
      });

      if (!result.dollarRate) {
        toast.error("No hay dólar oficial configurado para convertir");
        return;
      }

      // Update cart prices for converted products
      await updateCartPricesAfterConversion(selectedProducts.map((p) => p.id));

      toast.success(result.updated === 1 ? "Precio convertido a ARS" : `${result.updated} productos convertidos a ARS`, {
        description: `Dólar oficial: $${result.dollarRate.toFixed(2)}`,
      });

      queryClient.invalidateQueries({ queryKey: ["list-products", listId], exact: false });
      queryClient.invalidateQueries({ queryKey: ["my-stock"] });
      queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
      queryClient.invalidateQueries({ queryKey: ["delivery-note-with-items"], exact: false });
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
    if (!selectedProducts.length) return;
    setIsBulkWorking(true);
    try {
      const result = await revertUsdToArsForProducts({
        listId,
        products: selectedProducts,
        mappingConfig,
      });

      // Update cart prices for reverted products
      await updateCartPricesAfterConversion(selectedProducts.map((p) => p.id));

      toast.success(
        result.reverted === 1 ? "Conversión revertida a USD" : `${result.reverted} productos revertidos a USD`,
      );

      queryClient.invalidateQueries({ queryKey: ["list-products", listId], exact: false });
      queryClient.invalidateQueries({ queryKey: ["my-stock"] });
      queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
      queryClient.invalidateQueries({ queryKey: ["delivery-note-with-items"], exact: false });
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

    const products = table.getRowModel().rows.map((row) => row.original as DynamicProduct);
    if (!products.length) return;

    setIsBulkWorking(true);
    try {
      const result = await convertUsdToArsForProducts({
        listId,
        products,
        mappingConfig,
        columnSchema,
        targetKeys,
        applyToAll: true,
      });

      if (!result.dollarRate) {
        toast.error("No hay dólar oficial configurado para convertir");
        return;
      }

      // Update cart prices for converted products
      await updateCartPricesAfterConversion(Array.from(new Set(requestList.map((item) => item.productId))));

      const skipped = result.skippedAlreadyConverted;
      toast.success(
        result.updated === 1 ? "Columna convertida a ARS" : `${result.updated} productos convertidos a ARS`,
        skipped
          ? {
              description: `${skipped} producto${skipped === 1 ? "" : "s"} ya convertido${skipped === 1 ? "" : "s"}`,
            }
          : { description: `Dólar oficial: $${result.dollarRate.toFixed(2)}` },
      );

      queryClient.invalidateQueries({ queryKey: ["list-products", listId], exact: false });
      queryClient.invalidateQueries({ queryKey: ["global-product-search"] });
      queryClient.invalidateQueries({ queryKey: ["my-stock"] });
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

    const products = table.getRowModel().rows.map((row) => row.original as DynamicProduct);
    if (!products.length) return;

    setIsBulkWorking(true);
    try {
      const result = await revertUsdToArsForProducts({
        listId,
        products,
        mappingConfig,
        targetKeys,
        applyToAll: true,
      });

      // Update cart prices for reverted products
      await updateCartPricesAfterConversion(Array.from(new Set(requestList.map((item) => item.productId))));

      toast.success(
        result.reverted === 1 ? "Conversión revertida a USD" : `${result.reverted} productos revertidos a USD`,
      );

      queryClient.invalidateQueries({ queryKey: ["list-products", listId], exact: false });
      queryClient.invalidateQueries({ queryKey: ["global-product-search"] });
      queryClient.invalidateQueries({ queryKey: ["my-stock"] });
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
    const ids = Array.from(selectedRowIds);
    if (!ids.length) return;
    setIsBulkWorking(true);
    try {
      await deleteProductsEverywhere({ productIds: ids });
      toast.success(ids.length === 1 ? "Fila eliminada" : `${ids.length} filas eliminadas`);
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ["list-products", listId], exact: false });
      queryClient.invalidateQueries({ queryKey: ["product-lists-index"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["product-lists"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["my-stock"] });
    } catch (e: any) {
      console.error("bulk delete rows error:", e);
      toast.error(e?.message || "Error al eliminar filas");
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

  // Vista por defecto
  const shouldUseCardView = true;
  const defaultViewMode = isMobile ? "cards" : columnSchema.length > 8 ? "cards" : "table";
  const currentViewMode = storeViewMode[listId] || defaultViewMode;
  const effectiveViewMode = isMobile ? "cards" : currentViewMode;
  const showCardSelectionHeader = isInSelectionMode && effectiveViewMode === "cards";

  useEffect(() => {
    if (effectiveViewMode === "cards" && selectedColumnKeys.size) {
      setSelectedColumnKeys(new Set());
    }
  }, [effectiveViewMode, selectedColumnKeys.size]);

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
              const display = formatARS(numericValue);
              return <CopyableText textToCopy={display}>{display}</CopyableText>;
            }
          }

          // fallback para columnas no numéricas o valores no convertibles
          const display = String(value);
          return <CopyableText textToCopy={display}>{display}</CopyableText>;
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
        enableSorting: false,
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
    getRowId: (row) => String(row.id ?? (row as any).product_id ?? ""),
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

  const anySelectedColumnFxConverted = useMemo(() => {
    if (!selectedConvertibleColumnKeys.length) return false;
    const primaryKey = mappingConfig?.price_primary_key ?? null;
    const rows = table.getRowModel().rows;
    for (const row of rows) {
      const calc = (row.original as any)?.calculated_data ?? {};
      for (const key of selectedConvertibleColumnKeys) {
        const markerKey =
          primaryKey && key === primaryKey ? "__fx_usd_ars__orig__price" : `__fx_usd_ars__orig__${key}`;
        if (calc[markerKey] != null) return true;
      }
    }
    return false;
  }, [table, selectedConvertibleColumnKeys, mappingConfig]);

  const selectAllRows = () => {
    const allIds = table.getRowModel().rows.map((row) => String((row.original as any).id ?? (row.original as any).product_id ?? ""));
    if (!allIds.length) return;
    const isAllSelected = allIds.every((id) => selectedRowIds.has(id));
    if (isAllSelected) {
      setSelectedRowIds(new Set());
      setSelectedColumnKeys(new Set());
      setMenuState(null);
      rowAnchorIdRef.current = null;
      return;
    }
    setSelectedColumnKeys(new Set());
    setSelectedRowIds(new Set(allIds));
    rowAnchorIdRef.current = allIds[0] ?? null;
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() !== "a") return;
      if (isEditableTarget(e.target)) return;

      const container = listContainerRef.current;
      if (!container) return;
      const target = e.target as Node | null;
      const activeElement = document.activeElement;
      if (
        !listActiveRef.current &&
        (!target || !container.contains(target)) &&
        (!activeElement || !container.contains(activeElement))
      )
        return;

      e.preventDefault();
      selectAllRows();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [table, listContainerRef]);

  const selectionHeaderPadding = showCardSelectionHeader
    ? { paddingTop: "calc(3.5rem + env(safe-area-inset-top))" }
    : undefined;

  return (
    <div className={cn("space-y-4", showCardSelectionHeader && "pt-0")} style={selectionHeaderPadding}>
      {/* Buscador + ajustes - Sticky cuando se hace scroll */}
      {showCardSelectionHeader && (
        <div
          ref={controlsRef}
          className="fixed top-0 inset-x-0 z-[60] bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b"
          style={{ paddingTop: "max(env(safe-area-inset-top), 0px)" }}
        >
          <div className="flex items-center justify-between px-3 py-3 z-50">
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
      )}
      {!showCardSelectionHeader && (
        <div
          ref={controlsRef}
          className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b pb-3"
        >
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="flex flex-1 gap-2 items-center">
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={selectAllRows}
              className="gap-2 shrink-0"
            >
              <List className="h-4 w-4" />
              <span className="hidden sm:inline">Seleccionar todo</span>
            </Button>
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
      )}

      {/* Contenido: tarjetas o tabla */}
      {effectiveViewMode === "cards" ? (
        <div ref={listContainerRef}>
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
            enableSelection
            selectedIds={selectedRowIds}
            selectionModeActive={selectedRowIds.size > 0}
            onRowClick={handleRowClick}
            onRowPointerDown={handleRowPointerDown}
            onRowPointerUp={clearLongPressTimer}
            onRowPointerCancel={clearLongPressTimer}
          />
        </div>
      ) : (
        <div ref={listContainerRef} className="w-full border rounded-lg overflow-hidden">
          {isInSelectionMode && !isMobile && (
            <div
              ref={selectionBarRef}
              className="border-b bg-muted/40 px-3 py-2 flex items-center justify-between gap-3 flex-wrap"
            >
              <div className="text-sm text-muted-foreground">
                {selectedMode === "rows" ? (
                  <span>
                    {selectedRowIds.size} producto{selectedRowIds.size === 1 ? "" : "s"} seleccionado
                    {selectedRowIds.size === 1 ? "" : "s"}
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
                      disabled={!selectedProducts.length || !onAddToRequest}
                      onClick={handleBulkAddToCart}
                      className="gap-2"
                    >
                      <ShoppingCart className="h-4 w-4" />
                      <span className="hidden sm:inline">Carrito</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!selectedProducts.length || isBulkWorking}
                      onClick={() => void handleBulkAddToMyStock()}
                      className="gap-2"
                    >
                      <Package className="h-4 w-4" />
                      <span className="hidden sm:inline">Mi Stock</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!selectedProducts.length || isBulkWorking}
                      onClick={() => void handleBulkConvertUsdToArs()}
                      className="gap-2"
                    >
                      <DollarSign className="h-4 w-4" />
                      <span className="hidden sm:inline">USD→ARS</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!selectedProducts.length || isBulkWorking || !anySelectedFxConverted}
                      onClick={() => void handleBulkRevertArsToUsd()}
                      className="gap-2"
                    >
                      <RotateCcw className="h-4 w-4" />
                      <span className="hidden sm:inline">Revertir</span>
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={!selectedRowIds.size || isBulkWorking}
                      onClick={() => setConfirmDeleteRowsOpen(true)}
                      className="gap-2"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="hidden sm:inline">Eliminar</span>
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
          {/* Contenedor scrolleable: acá vive el sticky */}
          <div ref={tableContainerRef} className="max-h-[600px] overflow-auto relative">
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
                    <TableRow
                      key={row.id}
                      className={cn(selectedRowIds.has(row.original.id) && "bg-primary/20")}
                      onPointerDown={(e) => handleRowPointerDown(e, String(row.original.id))}
                      onPointerUp={clearLongPressTimer}
                      onPointerCancel={clearLongPressTimer}
                      onClick={(e) => handleRowClick(e, String(row.original.id))}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (isMobile) return;
                        if (isInteractiveTarget(e.target)) return;
                        const id = String(row.original.id);
                        setSelectedColumnKeys(new Set());
                        setSelectedRowIds((prev) => (prev.has(id) ? prev : new Set([id])));
                        openMenuAtPoint("rows", e.clientX, e.clientY);
                        rowAnchorIdRef.current = id;
                      }}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const column = cell.column;
                        const meta = column.columnDef.meta as any;
                        const isHiddenButVisible = meta?.visible === false;
                        const isColSelected = selectedColumnKeys.has(cell.column.id);

                        return (
                          <TableCell
                            key={cell.id}
                            className={cn(isHiddenButVisible && "opacity-30 bg-stripes", isColSelected && "bg-primary/10")}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>

            {menuState && (
              <div
                ref={menuRef}
                className="fixed z-50 min-w-[240px] rounded-md border bg-popover p-1 shadow-md"
                style={{
                  top:
                    typeof window !== "undefined"
                      ? Math.min(menuState.top, window.innerHeight - 220)
                      : menuState.top,
                  left:
                    typeof window !== "undefined"
                      ? Math.min(menuState.left, window.innerWidth - 260)
                      : menuState.left,
                }}
              >
                {menuState.type === "rows" ? (
                  <>
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      {selectedRowIds.size} fila{selectedRowIds.size === 1 ? "" : "s"} seleccionada
                      {selectedRowIds.size === 1 ? "" : "s"}
                    </div>
                    <button
                      type="button"
                      disabled={!selectedProducts.length || !onAddToRequest}
                      className="w-full flex items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                      onClick={handleBulkAddToCart}
                    >
                      <ShoppingCart className="h-4 w-4" />
                      Agregar al carrito
                    </button>
                    <button
                      type="button"
                      disabled={!selectedProducts.length || isBulkWorking}
                      className="w-full flex items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                      onClick={() => void handleBulkAddToMyStock()}
                    >
                      <Package className="h-4 w-4" />
                      Agregar a Mi Stock
                    </button>
                    <button
                      type="button"
                      disabled={!selectedProducts.length || isBulkWorking}
                      className="w-full flex items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                      onClick={() => void handleBulkConvertUsdToArs()}
                    >
                      <DollarSign className="h-4 w-4" />
                      Convertir USD → ARS
                    </button>
                    <button
                      type="button"
                      disabled={!selectedProducts.length || isBulkWorking || !anySelectedFxConverted}
                      className="w-full flex items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                      onClick={() => void handleBulkRevertArsToUsd()}
                    >
                      <RotateCcw className="h-4 w-4" />
                      Revertir ARS → USD
                    </button>
                    <div className="my-1 h-px bg-border" />
                    <button
                      type="button"
                      disabled={!selectedRowIds.size || isBulkWorking}
                      className="w-full flex items-center gap-2 rounded-sm px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
                      onClick={() => setConfirmDeleteRowsOpen(true)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Eliminar fila{selectedRowIds.size === 1 ? "" : "s"}
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

      {effectiveViewMode === "cards" && (
      <Drawer open={mobileActionsOpen} onOpenChange={setMobileActionsOpen}>
        <DrawerContent ref={mobileActionsRef}>
          <DrawerHeader>
            <DrawerTitle>Acciones</DrawerTitle>
          </DrawerHeader>
            <div className="px-4 pb-4 flex flex-col gap-1">
              {selectedMode === "rows" ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!selectedProducts.length || !onAddToRequest}
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
                    disabled={!selectedProducts.length || isBulkWorking}
                    onClick={() => {
                      setMobileActionsOpen(false);
                      void handleBulkAddToMyStock();
                    }}
                    className="w-full justify-start gap-2"
                  >
                    <Package className="h-4 w-4" />
                    Agregar a Mi Stock
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!selectedProducts.length || isBulkWorking}
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
                    disabled={!selectedProducts.length || isBulkWorking || !anySelectedFxConverted}
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
                    disabled={!selectedRowIds.size || isBulkWorking}
                    onClick={() => {
                      setMobileActionsOpen(false);
                      setConfirmDeleteRowsOpen(true);
                    }}
                    className="w-full justify-start gap-2 text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                    Eliminar
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
            <AlertDialogTitle>¿Eliminar filas?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará {selectedRowIds.size} producto{selectedRowIds.size === 1 ? "" : "s"} (y se quitarán de
              Mi Stock y del carrito si estaban presentes). No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkWorking}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={isBulkWorking}
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => void handleConfirmDeleteRows()}
            >
              Eliminar
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
};
