import { useState, useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getOfflineData } from "@/lib/localDB";

interface GlobalProductSearchOptions {
  searchTerm: string;
  supplierFilter?: string;
  minSearchLength?: number;
  pageSize?: number;
  myStockOnly?: boolean;
}

export function useGlobalProductSearch({
  searchTerm,
  supplierFilter = "all",
  minSearchLength = 1,
  pageSize = 50,
  myStockOnly = false,
}: GlobalProductSearchOptions) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const shouldSearch = searchTerm.trim().length >= minSearchLength;

  const query = useInfiniteQuery({
    queryKey: ["global-product-search", searchTerm, supplierFilter, myStockOnly ? "my-stock" : "all-stock", isOnline ? "online" : "offline"],
    queryFn: async ({ pageParam = 0 }) => {
      if (!shouldSearch) return { data: [], count: 0, nextPage: undefined };

      // MODO OFFLINE
      if (!isOnline) {
        return searchOffline(searchTerm, supplierFilter, pageParam, pageSize, myStockOnly);
      }

      // MODO ONLINE
      return searchOnline(searchTerm, supplierFilter, pageParam, pageSize, myStockOnly);
    },
    getNextPageParam: (lastPage) => lastPage.nextPage,
    enabled: shouldSearch,
    retry: false,
    initialPageParam: 0,
  });

  return {
    ...query,
    isOnline,
  };
}

/**
 * Búsqueda online usando search_products RPC
 */
async function searchOnline(
  searchTerm: string,
  supplierFilter: string,
  pageParam: number,
  pageSize: number,
  myStockOnly: boolean
) {
  const fetchSearchPage = async (pageIndex: number) => {
    const offset = pageIndex * pageSize;

    const { data, error, count } = await supabase.rpc("search_products", {
      p_term: searchTerm.trim(),
      p_limit: pageSize,
      p_offset: offset,
      p_list_id: null,
      p_supplier_id: supplierFilter !== "all" ? supplierFilter : null,
    });

    if (error) {
      console.error("Error en busqueda online:", error);
      throw error;
    }

    return { data: data || [], count: count || 0 };
  };

  if (!myStockOnly) {
    const { data, count } = await fetchSearchPage(pageParam);
    const hasMore = data.length === pageSize;
    const nextPage = hasMore ? pageParam + 1 : undefined;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    let enrichedData = data;
    if (user && data.length > 0) {
      const productIds = data.map((item: any) => item.product_id);
      const { data: myStockRows, error: myStockError } = await supabase
        .from("my_stock_products")
        .select("product_id")
        .eq("user_id", user.id)
        .in("product_id", productIds);

      if (myStockError) throw myStockError;

      const stockIds = new Set((myStockRows || []).map((row: any) => row.product_id));
      enrichedData = data.map((item: any) => ({
        ...item,
        in_my_stock: stockIds.has(item.product_id),
      }));
    }

    return {
      data: enrichedData,
      count,
      nextPage,
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { data: [], count: 0, nextPage: undefined };
  }

  let pageIndex = pageParam;
  let hasMore = true;
  const aggregated: any[] = [];

  while (hasMore && aggregated.length < pageSize) {
    const { data } = await fetchSearchPage(pageIndex);
    hasMore = data.length === pageSize;
    pageIndex += 1;

    if (data.length === 0) break;

    const productIds = data.map((item: any) => item.product_id);
    const { data: myStockRows, error: myStockError } = await supabase
      .from("my_stock_products")
      .select("product_id, quantity, stock_threshold")
      .eq("user_id", user.id)
      .in("product_id", productIds);

    if (myStockError) throw myStockError;

    const myStockByProductId = new Map((myStockRows || []).map((row: any) => [row.product_id, row]));
    const filtered = data
      .filter((item: any) => myStockByProductId.has(item.product_id))
      .map((item: any) => {
        const myStock = myStockByProductId.get(item.product_id);
        return {
          ...item,
          in_my_stock: true,
          quantity: myStock?.quantity ?? item.quantity,
          stock_threshold: myStock?.stock_threshold ?? item.stock_threshold,
        };
      });

    aggregated.push(...filtered);
  }

  return {
    data: aggregated,
    count: aggregated.length,
    nextPage: hasMore ? pageIndex : undefined,
  };
}


/**
 * Búsqueda offline en IndexedDB
 */
async function searchOffline(
  searchTerm: string,
  supplierFilter: string,
  pageParam: number,
  pageSize: number,
  myStockOnly: boolean
) {
  const indexedProducts = (await getOfflineData("dynamic_products_index")) as any[];
  const fullProducts = (await getOfflineData("dynamic_products")) as any[];
  const productLists = (await getOfflineData("product_lists")) as any[];
  const myStockEntries = (await getOfflineData("my_stock_products")) as any[];
  const myStockByProductId = new Map(myStockEntries.map((entry: any) => [entry.product_id, entry]));
  const myStockIds = new Set(myStockByProductId.keys());

  const searchTermLower = searchTerm.trim().toLowerCase();
  const fullProductsById = new Map(fullProducts.map((product: any) => [product.id, product]));
  const listsById = new Map(productLists.map((list: any) => [list.id, list]));
  const supplierListIds =
    supplierFilter === "all"
      ? null
      : new Set(productLists.filter((list: any) => list.supplier_id === supplierFilter).map((list: any) => list.id));

  // Filtrar por termino de busqueda
  let filtered = indexedProducts;
  if (myStockOnly) {
    filtered = filtered.filter((p: any) => myStockIds.has(p.product_id));
  }

  filtered = filtered.filter((p: any) => {
    // Buscar en indice
    if (p.code?.toLowerCase().includes(searchTermLower) || p.name?.toLowerCase().includes(searchTermLower)) {
      return true;
    }

    // Buscar en producto completo usando mapping_config
    const fullProduct = fullProductsById.get(p.product_id);
    if (!fullProduct?.data) return false;

    const list = listsById.get(p.list_id);
    const mappingConfig = list?.mapping_config;

    // Buscar en code_keys
    if (mappingConfig?.code_keys && Array.isArray(mappingConfig.code_keys)) {
      for (const key of mappingConfig.code_keys) {
        if (fullProduct.data[key]?.toString().toLowerCase().includes(searchTermLower)) {
          return true;
        }
      }
    }

    // Buscar en name_keys
    if (mappingConfig?.name_keys && Array.isArray(mappingConfig.name_keys)) {
      for (const key of mappingConfig.name_keys) {
        if (fullProduct.data[key]?.toString().toLowerCase().includes(searchTermLower)) {
          return true;
        }
      }
    }

    return false;
  });

  // Filtrar por proveedor
  if (supplierFilter !== "all" && supplierListIds) {
    filtered = filtered.filter((p: any) => supplierListIds.has(p.list_id));
  }

  // Paginacion
  const start = pageParam * pageSize;
  const end = start + pageSize;
  const paginatedData = filtered.slice(start, end).map((item: any) => {
    const stockEntry = myStockByProductId.get(item.product_id);
    return {
      ...item,
      in_my_stock: myStockIds.has(item.product_id),
      quantity: myStockOnly ? stockEntry?.quantity ?? item.quantity : item.quantity,
      stock_threshold: myStockOnly ? stockEntry?.stock_threshold ?? item.stock_threshold : item.stock_threshold,
    };
  });

  return {
    data: paginatedData,
    count: filtered.length,
    nextPage: end < filtered.length ? pageParam + 1 : undefined,
  };
}

