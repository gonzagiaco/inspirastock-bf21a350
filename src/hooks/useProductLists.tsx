import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ProductList, DynamicProduct, ColumnSchema, MappingConfig } from "@/types/productList";
import { fetchAllFromTable } from "@/utils/fetchAllProducts";
import { useOnlineStatus } from "./useOnlineStatus";
import {
  getOfflineData,
  createProductListOffline,
  updateProductListOffline,
  deleteProductListOffline,
  deleteProductListLocalRecord,
  syncProductListById,
} from "@/lib/localDB";

// Helper function to extract name from product data when index is missing it
function extractNameFromData(data: Record<string, any>, schema: ColumnSchema[], mappingConfig?: any): string {
  // 1. PRIORIDAD: Usar name_keys del mapping_config
  if (mappingConfig?.name_keys && Array.isArray(mappingConfig.name_keys)) {
    for (const key of mappingConfig.name_keys) {
      if (data[key] && String(data[key]).trim()) {
        return String(data[key]).trim();
      }
    }
  }

  // 2. FALLBACK: Buscar en schema
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

export const useProductLists = (supplierId?: string) => {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();

  const { data: productLists = [], isLoading } = useQuery({
    queryKey: ["product-lists", supplierId ?? "all", isOnline ? "online" : "offline"],
    queryFn: async () => {
      // OFFLINE: Cargar desde IndexedDB
      if (isOnline === false) {
        const offlineLists = (await getOfflineData("product_lists")) as any[];
        return (offlineLists || [])
          .filter((list) => !supplierId || list.supplier_id === supplierId)
          .map((list) => ({
            id: list.id,
            supplierId: list.supplier_id,
            name: list.name,
            fileName: list.file_name,
            fileType: list.file_type,
            createdAt: list.created_at,
            updatedAt: list.updated_at,
            productCount: list.product_count,
            columnSchema: Array.isArray(list.column_schema) ? list.column_schema : [],
            mapping_config: list.mapping_config || undefined,
          })) as ProductList[];
      }

      // ONLINE: Consultar Supabase
      let query = supabase.from("product_lists").select("*").order("created_at", { ascending: false });

      if (supplierId) {
        query = query.eq("supplier_id", supplierId);
      }

      const { data, error } = await query;
      if (error) throw error;

      return (data || []).map((list) => {
        const schema = list.column_schema;
        const columnSchema: ColumnSchema[] = Array.isArray(schema) ? (schema as unknown as ColumnSchema[]) : [];

        return {
          id: list.id,
          supplierId: list.supplier_id,
          name: list.name,
          fileName: list.file_name,
          fileType: list.file_type,
          createdAt: list.created_at,
          updatedAt: list.updated_at,
          productCount: list.product_count,
          columnSchema,
          mapping_config: (list.mapping_config as unknown as MappingConfig) || undefined,
        };
      });
    },
    // Siempre habilitado: si supplierId está definido, filtra; si no, trae todas las listas
    enabled: true,
  });

  const { data: productsMap = {} } = useQuery({
    queryKey: ["dynamic-products", supplierId, isOnline ? "online" : "offline"],
    queryFn: async () => {
      const listIds = productLists.map((list) => list.id);
      if (listIds.length === 0) return {};

      // OFFLINE: JOIN entre índice y productos completos
      if (isOnline === false) {
        const indexedProducts = (await getOfflineData("dynamic_products_index")) as any[];
        const fullProducts = (await getOfflineData("dynamic_products")) as any[];

        // Crear mapa de productos completos por ID para acceso rápido
        const fullProductsMap = new Map(fullProducts.map((p: any) => [p.id, p]));

        // Filtrar por listIds
        const filtered = indexedProducts.filter((p: any) => listIds.includes(p.list_id));

        const grouped: Record<string, DynamicProduct[]> = {};
        filtered.forEach((indexProduct: any) => {
          if (!grouped[indexProduct.list_id]) {
            grouped[indexProduct.list_id] = [];
          }

          // Find the list to get its column schema and mapping config for fallback
          const list = productLists.find((l) => l.id === indexProduct.list_id);
          const columnSchema = list?.columnSchema || [];
          const mappingConfig = list?.mapping_config;

          // Obtener datos completos del producto original
          const fullProduct = fullProductsMap.get(indexProduct.product_id);

          grouped[indexProduct.list_id].push({
            id: indexProduct.product_id, // ID del producto original
            listId: indexProduct.list_id,
            code: indexProduct.code, // Del índice (ya normalizado)
            name: indexProduct.name || extractNameFromData(fullProduct?.data || {}, columnSchema, mappingConfig), // Del índice con fallback usando mappingConfig
            price: indexProduct.price !== null ? Number(indexProduct.price) : undefined, // Del índice (ya calculado)
            quantity: indexProduct.quantity, // Del índice
            stock_threshold: indexProduct.stock_threshold ?? 0,
            data: (fullProduct?.data as Record<string, any>) || {}, // Del producto completo para columnas dinámicas
          });
        });

        return grouped;
      }

      // ONLINE: Use optimized fetch to get ALL products (no 1000 limit)
      const allProducts = await fetchAllFromTable<any>("dynamic_products", listIds);

      const grouped: Record<string, DynamicProduct[]> = {};
      allProducts.forEach((product) => {
        const listId = product.list_id;
        if (!grouped[listId]) {
          grouped[listId] = [];
        }
        grouped[listId].push({
          id: product.id,
          listId: product.list_id,
          code: product.code,
          name: product.name,
          price: product.price ? Number(product.price) : undefined,
          quantity: product.quantity,
          stock_threshold: product.stock_threshold ?? 0,
          data: product.data as Record<string, any>,
        });
      });

      return grouped;
    },
    // Solo cargar productos cuando hay supplierId definido (pantallas de proveedor)
    // Esto evita cargar TODOS los productos cuando se usa desde DeliveryNoteProductSearch
    enabled: productLists.length > 0 && !!supplierId,
    staleTime: 3 * 60 * 1000, // 3 minutes
    gcTime: 8 * 60 * 1000, // 8 minutes in cache
  });

  const createListMutation = useMutation({
    mutationFn: async ({
      supplierId,
      name,
      fileName,
      fileType,
      columnSchema,
      products,
    }: {
      supplierId: string;
      name: string;
      fileName: string;
      fileType: string;
      columnSchema: ColumnSchema[];
      products: DynamicProduct[];
    }) => {
      // OFFLINE: Crear en IndexedDB
      if (isOnline === false) {
        return await createProductListOffline({
          supplierId,
          name,
          fileName,
          fileType,
          columnSchema,
          products,
        });
      }

      // ONLINE: Crear en Supabase
      const { data: userData, error: authError } = await supabase.auth.getUser();

      if (authError || !userData.user) {
        throw new Error("Usuario no autenticado");
      }

      const { data: listData, error: listError } = await supabase
        .from("product_lists")
        .insert([
          {
            user_id: userData.user.id,
            supplier_id: supplierId,
            name,
            file_name: fileName,
            file_type: fileType,
            product_count: products.length,
            column_schema: JSON.parse(JSON.stringify(columnSchema)),
          },
        ])
        .select()
        .maybeSingle();

      if (listError) throw listError;
      if (!listData) throw new Error("No se pudo crear la lista de productos");

      const productsToInsert = products.map((product) => ({
        user_id: userData.user.id,
        list_id: listData.id,
        code: product.code,
        name: product.name,
        price: product.price,
        quantity: product.quantity,
        data: product.data,
      }));

      const { error: productsError } = await supabase.from("dynamic_products").insert(productsToInsert);

      if (productsError) throw productsError;

      return listData;
    },
    onSuccess: async (result) => {
      queryClient.invalidateQueries({ queryKey: ["product-lists"] });
      queryClient.invalidateQueries({ queryKey: ["dynamic-products"] });
      if (isOnline && result?.id) {
        try {
          await syncProductListById(result.id);
        } catch (error) {
          console.error("Error al sincronizar lista recién creada:", error);
        }
      }
      toast.success(
        isOnline ? "Lista de productos importada exitosamente" : "Lista creada (se sincronizará al conectar)",
      );
    },
    onError: (error: any) => {
      toast.error(error.message || "Error al importar lista de productos");
    },
  });

  const deleteListMutation = useMutation({
    mutationFn: async (listId: string) => {
      try {
        // OFFLINE: Eliminar de IndexedDB
        if (isOnline === false) {
          await deleteProductListOffline(listId);
          return;
        }

        // ONLINE: Eliminar de Supabase
        const { error } = await supabase.from("product_lists").delete().eq("id", listId);
        if (error) throw error;

        await deleteProductListLocalRecord(listId);
      } catch (error: any) {
        console.error("❌ Error al eliminar lista:", error);
        throw error;
      }
    },
    onSuccess: async (_, listId) => {
      // Resetear queries específicas de esta lista (fuerza limpieza completa)
      queryClient.resetQueries({
        queryKey: ["list-products", listId],
        exact: false,
      });

      // Invalidar queries generales con refetchType: 'all' para incluir queries inactivas
      queryClient.invalidateQueries({
        queryKey: ["product-lists"],
        refetchType: "all",
      });

      queryClient.invalidateQueries({
        queryKey: ["dynamic-products"],
        refetchType: "all",
      });

      // Invalidar índices globales
      queryClient.invalidateQueries({
        queryKey: ["product-lists-index"],
        refetchType: "all",
      });

      toast.success(isOnline ? "Lista eliminada exitosamente" : "Lista eliminada (se sincronizará al conectar)");
    },
    onError: (error: any) => {
      toast.error(error.message || "Error al eliminar lista");
    },
  });

  const updateColumnSchemaMutation = useMutation({
    mutationFn: async ({ listId, columnSchema, silent = false }: { listId: string; columnSchema: ColumnSchema[]; silent?: boolean }) => {
      const { error } = await supabase
        .from("product_lists")
        .update({ column_schema: JSON.parse(JSON.stringify(columnSchema)) })
        .eq("id", listId);

      if (error) throw error;
      return { listId, columnSchema, silent };
    },
    onSuccess: async (result, variables) => {
      const { listId, columnSchema, silent } = result;

      // Usar setQueryData para actualización inmediata sin refetch (evita cerrar drawer)
      queryClient.setQueryData(["product-lists", supplierId ?? "all", isOnline ? "online" : "offline"], (old: ProductList[] | undefined) => {
        if (!old) return old;
        return old.map((list) => 
          list.id === listId ? { ...list, columnSchema } : list
        );
      });

      // Invalidar solo si no es silencioso
      if (!silent) {
        queryClient.invalidateQueries({
          queryKey: ["product-lists"],
          refetchType: "none", // No refetch automático
        });
      }

      if (isOnline) {
        try {
          await syncProductListById(listId);
        } catch (error) {
          console.error("Error al sincronizar la lista tras actualizar el esquema:", error);
        }
      }

      // No mostrar toast aquí - el llamador lo manejará
    },
    onError: (error: any) => {
      toast.error(error.message || "Error al actualizar columnas");
    },
  });

  const updateListMutation = useMutation({
    mutationFn: async ({
      listId,
      fileName,
      columnSchema,
      products,
    }: {
      listId: string;
      fileName: string;
      columnSchema: ColumnSchema[];
      products: DynamicProduct[];
    }) => {
      // OFFLINE: Actualizar en IndexedDB
      if (isOnline === false) {
        await updateProductListOffline(listId, {
          fileName,
          columnSchema,
          products,
        });
        return;
      }

      // ONLINE: Actualizar en Supabase
      const { data: userData, error: authError } = await supabase.auth.getUser();

      if (authError || !userData.user) {
        throw new Error("Usuario no autenticado");
      }

      // 1. Actualizar metadatos de la lista
      const { error: updateError } = await supabase
        .from("product_lists")
        .update({
          name: fileName,
          file_name: fileName,
          updated_at: new Date().toISOString(),
          product_count: products.length,
          column_schema: JSON.parse(JSON.stringify(columnSchema)),
        })
        .eq("id", listId);

      if (updateError) throw updateError;

      // 2. ✅ VALIDAR Y FILTRAR productos antes del UPSERT
      const validProducts = products.filter((p) => {
        const code = p.code?.trim();
        if (!code || code === "") {
          console.warn("⚠️ Producto sin código válido, omitiendo:", p);
          return false;
        }
        return true;
      });

      if (validProducts.length === 0) {
        throw new Error("No hay productos con código válido para actualizar");
      }

      console.log(
        `🚀 Ejecutando UPSERT dual batch con ${validProducts.length}/${products.length} productos válidos...`,
      );
      const startTime = Date.now();

      const { data: result, error: upsertError } = await supabase.rpc("upsert_products_batch", {
        p_list_id: listId,
        p_user_id: userData.user.id,
        p_products: validProducts.map((p) => ({
          code: p.code.trim(),
          name: p.name,
          price: p.price,
          quantity: p.quantity,
          data: p.data,
        })),
      });

      const duration = Date.now() - startTime;

      if (upsertError) throw upsertError;

      // ✅ VERIFICAR que el UPSERT insertó o actualizó productos
      const totalOps = (result?.[0]?.inserted_count || 0) + (result?.[0]?.updated_count || 0);
      console.log(`✅ UPSERT dual completado en ${duration}ms:`, {
        insertados: result?.[0]?.inserted_count,
        actualizados: result?.[0]?.updated_count,
        eliminados: result?.[0]?.deleted_count,
        enviados: validProducts.length,
      });

      if (totalOps === 0) {
        console.error("⚠️ No se insertaron ni actualizaron productos");
        throw new Error("No se pudieron guardar los productos. Verifica que los códigos sean válidos.");
      }

      // ✅ CONFIRMAR que hay datos en Supabase ANTES de borrar IndexedDB
      const { count: productsCount, error: checkError } = await supabase
        .from("dynamic_products")
        .select("*", { count: "exact", head: true })
        .eq("list_id", listId);

      if (checkError || !productsCount || productsCount === 0) {
        console.error("⚠️ No hay productos en Supabase después del UPSERT");
        throw new Error("Error al verificar productos guardados");
      }
    },
    onSuccess: async (_, variables) => {
      const { listId } = variables;

      // Resetear queries específicas de esta lista
      queryClient.resetQueries({
        queryKey: ["list-products", listId],
        exact: false,
      });

      // Invalidar queries generales con refetchType: 'all'
      queryClient.invalidateQueries({
        queryKey: ["product-lists"],
        refetchType: "all",
      });

      queryClient.invalidateQueries({
        queryKey: ["dynamic-products"],
        refetchType: "all",
      });

      // Invalidar índices globales
      queryClient.invalidateQueries({
        queryKey: ["product-lists-index"],
        refetchType: "all",
      });

      if (isOnline) {
        try {
          await syncProductListById(listId);
        } catch (error) {
          console.error("Error al sincronizar la lista actualizada:", error);
        }
      }

      toast.success(isOnline ? "Lista actualizada exitosamente" : "Lista actualizada (se sincronizará al conectar)");
    },
    onError: (error: any) => {
      toast.error(error.message || "Error al actualizar lista");
    },
  });

  // Mutation to rename a column key in JSONB data
  const renameColumnKeyMutation = useMutation({
    mutationFn: async ({ 
      listId, 
      oldKey, 
      newKey, 
      updatedSchema, 
      updatedMappingConfig 
    }: { 
      listId: string; 
      oldKey: string; 
      newKey: string;
      updatedSchema: ColumnSchema[];
      updatedMappingConfig?: any;
    }) => {
      // 1. Rename keys in JSONB data using RPC
      const { data: updatedCount, error: renameError } = await supabase.rpc("rename_jsonb_key_in_products", {
        p_list_id: listId,
        p_old_key: oldKey,
        p_new_key: newKey,
      });

      if (renameError) throw renameError;

      // 2. Update column_schema and mapping_config in product_lists
      const updatePayload: any = {
        column_schema: JSON.parse(JSON.stringify(updatedSchema)),
        updated_at: new Date().toISOString(),
      };

      if (updatedMappingConfig) {
        updatePayload.mapping_config = updatedMappingConfig;
      }

      const { error: updateError } = await supabase
        .from("product_lists")
        .update(updatePayload)
        .eq("id", listId);

      if (updateError) throw updateError;

      return { listId, updatedCount: updatedCount ?? 0, updatedSchema, updatedMappingConfig };
    },
    onSuccess: async (result) => {
      const { listId, updatedCount, updatedSchema, updatedMappingConfig } = result;

      // Update product-lists cache directly
      queryClient.setQueryData(["product-lists", supplierId ?? "all", isOnline ? "online" : "offline"], (old: ProductList[] | undefined) => {
        if (!old) return old;
        return old.map((list) => 
          list.id === listId ? { ...list, columnSchema: updatedSchema, mapping_config: updatedMappingConfig } : list
        );
      });

      // ALSO update product-lists-index cache for /listas page
      queryClient.setQueryData(["product-lists-index", isOnline ? "online" : "offline"], (old: any[] | undefined) => {
        if (!old) return old;
        return old.map((list) => 
          list.id === listId ? { ...list, column_schema: updatedSchema, mapping_config: updatedMappingConfig } : list
        );
      });

      // Invalidate list-products to reload with new keys
      queryClient.invalidateQueries({ queryKey: ["list-products", listId] });

      if (isOnline) {
        try {
          await syncProductListById(listId);
        } catch (error) {
          console.error("Error al sincronizar la lista tras renombrar columna:", error);
        }
      }

      console.log(`✅ Columna renombrada: ${updatedCount} productos actualizados`);
    },
    onError: (error: any) => {
      toast.error(error.message || "Error al renombrar columna");
    },
  });

  // @deprecated - Helper function to find similar list
  // No longer used - user now selects from all available lists
  const findSimilarList = (fileName: string, columnSchema: ColumnSchema[]) => {
    // 1. Exact match by file name
    const exactMatch = productLists.find((list) => list.fileName === fileName);
    if (exactMatch) return exactMatch;

    // 2. Match by column similarity (>75%)
    const newKeys = columnSchema.map((c) => c.key).sort();

    for (const list of productLists) {
      const existingKeys = list.columnSchema.map((c) => c.key).sort();
      const commonKeys = newKeys.filter((k) => existingKeys.includes(k));
      const similarity = (commonKeys.length / Math.max(newKeys.length, existingKeys.length)) * 100;

      if (similarity > 75) {
        return list;
      }
    }

    return null;
  };

  return {
    productLists,
    productsMap,
    isLoading,
    createList: createListMutation.mutateAsync,
    deleteList: deleteListMutation.mutate,
    deleteListAsync: deleteListMutation.mutateAsync,
    isDeleting: deleteListMutation.isPending,
    updateColumnSchema: updateColumnSchemaMutation.mutateAsync,
    updateList: updateListMutation.mutateAsync,
    renameColumnKey: renameColumnKeyMutation.mutateAsync,
    findSimilarList,
  };
};
