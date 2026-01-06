import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, Columns, Settings2, Tags } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { localDB, isOnline, queueOperation, syncProductListById } from "@/lib/localDB";
import { useIsMobile } from "@/hooks/use-mobile";
import { ColumnsTab } from "@/components/mapping/tabs/ColumnsTab";
import { PricesTab } from "@/components/mapping/tabs/PricesTab";
import { OptionsTab } from "@/components/mapping/tabs/OptionsTab";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { ColumnSchema } from "@/types/productList";

export type CustomColumnFormula = {
  base_column: string;
  percentage: number;
  add_vat: boolean;
  vat_rate?: number;
};

export type MappingConfig = {
  code_keys: string[];
  name_keys: string[];
  quantity_key: string | null;
  price_primary_key: string | null;
  price_alt_keys: string[];
  extra_index_keys: string[];
  low_stock_threshold?: number;
  cart_price_column?: string | null;
  delivery_note_price_column?: string | null;
  price_modifiers?: {
    general: { percentage: number; add_vat: boolean; vat_rate?: number };
    overrides: Record<string, { percentage: number; add_vat: boolean; vat_rate?: number }>;
  };
  dollar_conversion?: {
    target_columns: string[];
  };
  custom_columns?: Record<string, CustomColumnFormula>;
};

interface ListConfigurationViewProps {
  listId: string;
  onSaved?: () => void;
}

export function ListConfigurationView({ listId, onSaved }: ListConfigurationViewProps) {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const [sample, setSample] = useState<any[]>([]);
  const [columnSchema, setColumnSchema] = useState<ColumnSchema[]>([]);
  const [keys, setKeys] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("columns");
  const [map, setMap] = useState<MappingConfig>({
    code_keys: [],
    name_keys: [],
    quantity_key: null,
    price_primary_key: null,
    price_alt_keys: [],
    extra_index_keys: [],
    low_stock_threshold: 0,
    cart_price_column: null,
    price_modifiers: {
      general: { percentage: 0, add_vat: false, vat_rate: 21 },
      overrides: {},
    },
    dollar_conversion: {
      target_columns: [],
    },
  });

  const isNumericColumn = (columnKey: string): boolean => {
    const schemaType = columnSchema.find((col) => col.key === columnKey)?.type;
    if (schemaType === "number") return true;

    const numericCount = sample.filter((row) => {
      const value = row.data?.[columnKey];
      if (value == null) return false;
      const parsed =
        typeof value === "number"
          ? value
          : parseFloat(
              String(value)
                .replace(/[^0-9.,-]/g, "")
                .replace(",", "."),
            );
      return !isNaN(parsed) && isFinite(parsed);
    }).length;
    return numericCount > 0 && numericCount >= sample.length * 0.5;
  };

  useEffect(() => {
    let isCancelled = false;

    const loadSample = async () => {
      setIsLoading(true);
      try {
        const [{ data: sampleData, error: sampleError }, { data: configData, error: configError }] = await Promise.all([
          supabase.from("dynamic_products").select("data").eq("list_id", listId).limit(20),
          supabase.from("product_lists").select("mapping_config, column_schema").eq("id", listId).single(),
        ]);

        if (sampleError) throw sampleError;
        if (configError) throw configError;
        if (isCancelled) return;

        setSample(sampleData ?? []);
        setColumnSchema((configData?.column_schema as unknown as ColumnSchema[]) ?? []);
        const k = new Set<string>();
        (sampleData ?? []).forEach((row) => Object.keys(row.data || {}).forEach((kk) => k.add(kk)));
        ((configData?.column_schema as unknown as ColumnSchema[]) ?? []).forEach((col) => {
          if (col?.key) k.add(col.key);
        });

        if (configData?.mapping_config) {
          const loaded = configData.mapping_config as MappingConfig;
          
          // Add custom column names to keys set
          if (loaded.custom_columns) {
            Object.keys(loaded.custom_columns).forEach(customColName => k.add(customColName));
          }
          
          setKeys(Array.from(k).sort());
          
          setMap((prev) => ({
            ...prev,
            ...loaded,
            price_modifiers: {
              general: { percentage: 0, add_vat: false, vat_rate: 21 },
              overrides: {},
              ...loaded.price_modifiers,
            },
            dollar_conversion: {
              target_columns: loaded.dollar_conversion?.target_columns || [],
            },
            custom_columns: loaded.custom_columns || undefined,
          }));
        } else {
          setKeys(Array.from(k).sort());
        }
      } catch (error) {
        console.error("Error loading sample or mapping_config:", error);
        toast.error("Error al cargar columnas o configuración previa");
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    };

    loadSample();
    return () => {
      isCancelled = true;
    };
  }, [listId]);

  const handleSave = async () => {
    if (map.code_keys.length === 0 && map.name_keys.length === 0) {
      toast.error("Debe seleccionar al menos una clave para código o nombre");
      return;
    }

    setIsSaving(true);
    try {
      const cleanedMapping: MappingConfig = {
        ...map,
        dollar_conversion:
          map.dollar_conversion?.target_columns?.length > 0
            ? { target_columns: map.dollar_conversion.target_columns }
            : undefined,
        custom_columns:
          map.custom_columns && Object.keys(map.custom_columns).length > 0
            ? map.custom_columns
            : undefined,
      };

      const online = isOnline();
      let currentSchema: ColumnSchema[];

      if (online) {
        // Online: Fetch from Supabase
        const { data: listData, error: fetchError } = await supabase
          .from("product_lists")
          .select("column_schema")
          .eq("id", listId)
          .single();

        if (fetchError) {
          throw new Error(`Error al obtener schema: ${fetchError.message}`);
        }

        currentSchema = (listData?.column_schema as unknown as ColumnSchema[]) || [];
      } else {
        // Offline: Fetch from IndexedDB
        const localList = await localDB.product_lists.get(listId);
        currentSchema = (localList?.column_schema as ColumnSchema[]) || [];
      }

      const customColNames = Object.keys(cleanedMapping.custom_columns || {});
      const existingKeys = currentSchema.map(c => c.key);

      // Add new custom columns to schema
      for (const colName of customColNames) {
        if (!existingKeys.includes(colName)) {
          currentSchema.push({
            key: colName,
            label: colName,
            type: "number",
            visible: true,
            order: currentSchema.length,
            isStandard: false,
            isCustom: true
          });
        }
      }

      // Remove custom columns that no longer exist
      currentSchema = currentSchema.filter(col => 
        !col.isCustom || customColNames.includes(col.key)
      );

      if (online) {
        // Online: Save to Supabase
        const { error: updateError } = await supabase
          .from("product_lists")
          .update({ 
            mapping_config: cleanedMapping,
            column_schema: currentSchema as unknown as import("@/integrations/supabase/types").Json
          })
          .eq("id", listId);

        if (updateError) {
          throw new Error(`Error al guardar configuración: ${updateError.message}`);
        }

        const { error: refreshError } = await supabase.rpc("refresh_list_index", { p_list_id: listId });

        if (refreshError) {
          throw new Error(`Error al indexar productos: ${refreshError.message}`);
        }

        await queryClient.invalidateQueries({ queryKey: ["product-lists-index"] });
        await queryClient.invalidateQueries({ queryKey: ["product-lists"] });

        try {
          await syncProductListById(listId);
        } catch (error) {
          console.error("Error al sincronizar la lista después de guardar mapeo:", error);
        }

        await queryClient.resetQueries({ queryKey: ["list-products", listId], exact: false });
        await queryClient.invalidateQueries({ queryKey: ["my-stock"] });
        await queryClient.invalidateQueries({ queryKey: ["global-product-search"] });

        toast.success("Configuración guardada correctamente");
      } else {
        // Offline: Save to IndexedDB and queue operation
        await localDB.product_lists.update(listId, {
          mapping_config: cleanedMapping,
          column_schema: currentSchema,
          updated_at: new Date().toISOString()
        });

        await queueOperation("product_lists", "UPDATE", listId, {
          mapping_config: cleanedMapping,
          column_schema: currentSchema
        });

        // Invalidate local queries
        await queryClient.invalidateQueries({ queryKey: ["product-lists-index"] });
        await queryClient.invalidateQueries({ queryKey: ["product-lists"] });
        await queryClient.invalidateQueries({ queryKey: ["my-stock"] });

        toast.success("Configuración guardada (offline - se sincronizará al reconectar)");
      }

      onSaved?.();
    } catch (error: any) {
      console.error("Error en handleSave:", error);
      toast.error(error.message || "Error al guardar configuración");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (keys.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No se encontraron columnas en esta lista. Importa productos primero.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <div className="border-b bg-background/50 backdrop-blur-sm sticky top-0 z-10">
          <ScrollArea className="w-full">
            <TabsList className='w-full grid grid-cols-3 h-10 gap-1 overflow-hidden p-0'>
              <TabsTrigger value="columns" className="h-full overflow-hidden gap-2 whitespace-normal data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                <Columns className="w-4 h-4" />
                <span className={isMobile ? 'hidden sm:inline truncate overflow-hidden' : 'truncate overflow-hidden'}>Columnas</span>
              </TabsTrigger>
              <TabsTrigger value="prices" className="h-full overflow-hidden flex items-center justify-center w-full min-w-0 px-2 gap-2 whitespace-normal data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                <Tags className="w-4 h-4" />
                <span className={isMobile ? 'hidden sm:inline truncate overflow-hidden' : 'truncate overflow-hidden'}>Precios</span>
              </TabsTrigger>
              <TabsTrigger value="options" className="h-full overflow-hidden flex items-center justify-center w-full min-w-0 px-2 gap-2 whitespace-normal data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                <Settings2 className="w-4 h-4" />
                <span className={isMobile ? 'hidden sm:inline truncate overflow-hidden' : 'truncate overflow-hidden'}>Opciones</span>
              </TabsTrigger>
            </TabsList>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <TabsContent value="columns" className="mt-0 space-y-6">
            <ColumnsTab 
              keys={keys} 
              map={map} 
              setMap={setMap} 
              isSaving={isSaving} 
            />
          </TabsContent>

          <TabsContent value="prices" className="mt-0 space-y-6">
            <PricesTab 
              keys={keys} 
              map={map} 
              setMap={setMap}
              setKeys={setKeys}
              isSaving={isSaving}
              isNumericColumn={isNumericColumn}
            />
          </TabsContent>

          <TabsContent value="options" className="mt-0 space-y-6">
            <OptionsTab 
              keys={keys} 
              map={map} 
              setMap={setMap}
              isNumericColumn={isNumericColumn}
            />
          </TabsContent>
        </div>
      </Tabs>

      {/* Fixed footer with save button */}
      <div className="border-t bg-background/95 backdrop-blur-sm p-4 sticky bottom-0">
        <Button onClick={handleSave} disabled={isSaving} className="w-full md:w-auto md:float-right">
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Guardando...
            </>
          ) : (
            "Guardar configuración"
          )}
        </Button>
      </div>
    </div>
  );
}
