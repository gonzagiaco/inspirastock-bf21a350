import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "../ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { syncFromSupabase } from "@/lib/localDB";

type MappingConfig = {
  code_keys: string[];
  name_keys: string[];
  quantity_key: string | null;
  price_primary_key: string | null;
  price_alt_keys: string[];
  extra_index_keys: string[];
  cart_price_column?: string | null;
  price_modifiers?: {
    general: { percentage: number; add_vat: boolean; vat_rate?: number };
    overrides: Record<string, { percentage: number; add_vat: boolean; vat_rate?: number }>;
  };

  dollar_conversion?: {
    target_columns: string[]; // Columnas donde aplicar conversión
  };
};

type Props = {
  listId: string;
  onSaved?: () => void;
};

export function ColumnMappingWizard({ listId, onSaved }: Props) {
  const queryClient = useQueryClient();
  const [sample, setSample] = useState<any[]>([]);
  const [columnSchema, setColumnSchema] = useState<any[]>([]);
  const [keys, setKeys] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [map, setMap] = useState<MappingConfig>({
    code_keys: [],
    name_keys: [],
    quantity_key: null,
    price_primary_key: null,
    price_alt_keys: [],
    extra_index_keys: [],
    cart_price_column: null,
    price_modifiers: {
      // Default: no percentage change, no agregar IVA y VAT rate por defecto 21%
      general: { percentage: 0, add_vat: false, vat_rate: 21 },
      overrides: {},
    },
    dollar_conversion: {
      target_columns: [],
    },
  });

  const isNumericColumn = (columnKey: string): boolean => {
    const schemaType = columnSchema.find((col) => col?.key === columnKey)?.type;
    if (schemaType === "number") return true;

    // Verificar si al menos el 50% de las muestras contienen valores numéricos
    const numericCount = sample.filter((row) => {
      const value = row.data?.[columnKey];
      if (value == null) return false;

      // Intentar parsear como número
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

  // Cargar 20 filas de ejemplo para listar claves
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
        const k = new Set<string>();
        (sampleData ?? []).forEach((row) => Object.keys(row.data || {}).forEach((kk) => k.add(kk)));
        const schema = (configData?.column_schema as any[]) ?? [];
        setColumnSchema(schema);
        schema.forEach((col) => {
          if (col?.key) k.add(col.key);
        });
        setKeys(Array.from(k).sort());

        if (configData?.mapping_config) {
          const loaded = configData.mapping_config as MappingConfig;
          const { low_stock_threshold: _ignored, ...cleanedLoaded } = loaded as any;
          setMap((prev) => ({
            ...prev,
            ...cleanedLoaded,
            price_modifiers: {
              general: { percentage: 0, add_vat: false, vat_rate: 21 },
              overrides: {},
              ...(cleanedLoaded as any).price_modifiers,
            },
            // Limpiar dollar_conversion.rate si existe (ahora es global)
            dollar_conversion: {
              target_columns: (cleanedLoaded as any).dollar_conversion?.target_columns || [],
            },
          }));
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
    // Validación básica
    if (map.code_keys.length === 0 && map.name_keys.length === 0) {
      toast.error("Debe seleccionar al menos una clave para código o nombre");
      return;
    }

    setIsSaving(true);
    try {
      // Limpiar dollar_conversion para NO guardar 'rate'
      const cleanedMapping: MappingConfig = {
        ...map,
        dollar_conversion:
          map.dollar_conversion?.target_columns?.length > 0
            ? {
                target_columns: map.dollar_conversion.target_columns,
              }
            : undefined,
      };

      console.log("Guardando mapping_config:", cleanedMapping);

      // 1. Guardar mapping_config
      const { error: updateError } = await supabase
        .from("product_lists")
        .update({ mapping_config: cleanedMapping })
        .eq("id", listId);

      if (updateError) {
        console.error("Error al actualizar product_lists:", updateError);
        throw new Error(`Error al guardar configuración: ${updateError.message}`);
      }

      console.log("Mapping guardado, refrescando índice...");

      // 2. Refrescar índice
      const { data: rpcData, error: refreshError } = await supabase.rpc("refresh_list_index", { p_list_id: listId });

      if (refreshError) {
        console.error("Error al refrescar índice:", refreshError);
        throw new Error(`Error al indexar productos: ${refreshError.message}`);
      }

      console.log("Índice refrescado exitosamente:", rpcData);

      // 3. Invalidar caché de React Query
      await queryClient.invalidateQueries({
        queryKey: ["product-lists-index"],
      });

      // Pequeño delay para asegurar que el índice termine de actualizarse
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Resetear caché completamente para forzar nuevo fetch
      await queryClient.resetQueries({
        queryKey: ["list-products", listId],
        exact: false,
      });

      try {
        await syncFromSupabase();
      } catch (error) {
        console.error("Error al sincronizar después de guardar mapeo:", error);
      }

      toast.success("Configuración guardada e índice actualizado correctamente");
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
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Campos de Código (múltiples variantes)</Label>
          <p className="text-xs text-muted-foreground">
            Selecciona todas las columnas que pueden contener el código del
            producto. El sistema usará la primera que tenga datos.
          </p>
          <ScrollArea className="h-[120px] border rounded-md p-2">
            <div className="space-y-2">
              {keys.map((key) => (
                <div key={key} className="flex items-center space-x-2">
                  <Checkbox
                    id={`code-${key}`}
                    checked={map.code_keys.includes(key)}
                    onCheckedChange={(checked) => {
                      setMap((prev) => ({
                        ...prev,
                        code_keys: checked
                          ? [...prev.code_keys, key]
                          : prev.code_keys.filter((k) => k !== key),
                      }));
                    }}
                    disabled={isSaving}
                  />
                  <label
                    htmlFor={`code-${key}`}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {key}
                  </label>
                </div>
              ))}
            </div>
          </ScrollArea>
          <p className="text-xs text-muted-foreground">
            {map.code_keys.length > 0
              ? `✓ ${
                  map.code_keys.length
                } campo(s) seleccionado(s): ${map.code_keys.join(", ")}`
              : "⚠️ No hay campos seleccionados"}
          </p>
        </div>

        <div className="space-y-2">
          <Label>Campos de Nombre/Descripción (múltiples variantes)</Label>
          <p className="text-xs text-muted-foreground">
            Selecciona todas las columnas que pueden contener el nombre o
            descripción. El sistema usará la primera que tenga datos.
          </p>
          <ScrollArea className="h-[120px] border rounded-md p-2">
            <div className="space-y-2">
              {keys.map((key) => (
                <div key={key} className="flex items-center space-x-2">
                  <Checkbox
                    id={`name-${key}`}
                    checked={map.name_keys.includes(key)}
                    onCheckedChange={(checked) => {
                      setMap((prev) => ({
                        ...prev,
                        name_keys: checked
                          ? [...prev.name_keys, key]
                          : prev.name_keys.filter((k) => k !== key),
                      }));
                    }}
                    disabled={isSaving}
                  />
                  <label
                    htmlFor={`name-${key}`}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {key}
                  </label>
                </div>
              ))}
            </div>
          </ScrollArea>
          <p className="text-xs text-muted-foreground">
            {map.name_keys.length > 0
              ? `✓ ${
                  map.name_keys.length
                } campo(s) seleccionado(s): ${map.name_keys.join(", ")}`
              : "⚠️ No hay campos seleccionados"}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="price-key">Clave de PRECIO (principal)</Label>
          <Select
            onValueChange={(v) =>
              setMap((m) => ({
                ...m,
                price_primary_key: v === "__none__" ? null : v,
              }))
            }
            value={map.price_primary_key ?? "__none__"}
            disabled={isSaving}
          >
            <SelectTrigger id="price-key">
              <SelectValue placeholder="Seleccionar clave (opcional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Sin precio</SelectItem>
              {keys.map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="space-y-2">
            <Label>Columnas adicionales de precio</Label>
            <p className="text-xs text-muted-foreground">
              Se formatearán igual que el precio principal (parseo y símbolo $).
            </p>
            <ScrollArea className="h-40 border rounded-md p-3">
              {keys
                .filter(
                  (key) => isNumericColumn(key) && key !== map.price_primary_key
                )
                .map((columnKey) => {
                  const isChecked = map.price_alt_keys.includes(columnKey);
                  return (
                    <div
                      key={columnKey}
                      className="flex items-center gap-2 py-1.5"
                    >
                      <Checkbox
                        id={`price-alt-${columnKey}`}
                        checked={isChecked}
                        onCheckedChange={(checked) => {
                          setMap((prev) => {
                            const next = checked
                              ? Array.from(
                                  new Set([
                                    ...(prev.price_alt_keys ?? []),
                                    columnKey,
                                  ])
                                )
                              : (prev.price_alt_keys ?? []).filter(
                                  (k) => k !== columnKey
                                );
                            return { ...prev, price_alt_keys: next };
                          });
                        }}
                      />
                      <label
                        htmlFor={`price-alt-${columnKey}`}
                        className="text-sm leading-none cursor-pointer"
                      >
                        {columnKey}
                      </label>
                    </div>
                  );
                })}
            </ScrollArea>
            <p className="text-xs text-muted-foreground">
              {map.price_alt_keys.length > 0
                ? `✓ ${map.price_alt_keys.length} columna(s) marcada(s)`
                : "No hay columnas adicionales seleccionadas"}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Descuento/Adición global:</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={map.price_modifiers?.general.percentage ?? 0}
              onChange={(e) => {
                const pct = parseFloat(e.target.value) || 0;
                setMap((m) => ({
                  ...m,
                  price_modifiers: {
                    ...m.price_modifiers!,
                    general: {
                      ...m.price_modifiers!.general,
                      percentage: pct,
                    },
                  },
                }));
              }}
              className="w-20"
            />
            <span>%</span>
            <Checkbox
              checked={map.price_modifiers?.general.add_vat ?? false}
              onCheckedChange={(checked) => {
                setMap((m) => ({
                  ...m,
                  price_modifiers: {
                    ...m.price_modifiers!,
                    general: {
                      ...m.price_modifiers!.general,
                      add_vat: Boolean(checked),
                    },
                  },
                }));
              }}
            />
            {/* Input para tasa de IVA global (porcentaje) */}
            <Input
              type="number"
              value={map.price_modifiers?.general.vat_rate ?? 21}
              onChange={(e) => {
                const rate = parseFloat(e.target.value) || 0;
                setMap((m) => ({
                  ...m,
                  price_modifiers: {
                    ...m.price_modifiers!,
                    general: {
                      ...m.price_modifiers!.general,
                      vat_rate: rate,
                    },
                  },
                }));
              }}
              className="w-20"
            />
            <span className="text-sm">% IVA</span>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Descuento/adición extra por columna:</Label>
        {keys
          .filter((k) => k !== map.price_primary_key)
          .map((columnKey) => (
            <div key={columnKey} className="flex items-center gap-2">
              <Checkbox
                checked={!!map.price_modifiers?.overrides[columnKey]}
                onCheckedChange={(checked) => {
                  setMap((m) => {
                    const overrides = {
                      ...(m.price_modifiers?.overrides || {}),
                    };
                    if (checked) {
                      overrides[columnKey] = overrides[columnKey] || {
                        percentage: 0,
                        add_vat: false,
                      };
                    } else {
                      delete overrides[columnKey];
                    }
                    return {
                      ...m,
                      price_modifiers: {
                        ...m.price_modifiers!,
                        overrides,
                      },
                    };
                  });
                }}
              />
              <Label>{columnKey}</Label>
              {map.price_modifiers?.overrides[columnKey] && (
                <>
                  <Input
                    type="number"
                    value={map.price_modifiers.overrides[columnKey].percentage}
                    onChange={(e) => {
                      const pct = parseFloat(e.target.value) || 0;
                      setMap((m) => ({
                        ...m,
                        price_modifiers: {
                          ...m.price_modifiers!,
                          overrides: {
                            ...m.price_modifiers!.overrides,
                            [columnKey]: {
                              ...m.price_modifiers!.overrides[columnKey],
                              percentage: pct,
                            },
                          },
                        },
                      }));
                    }}
                    className="w-16 text-sm"
                  />
                  <span className="text-sm">%</span>
                  <Checkbox
                    checked={map.price_modifiers.overrides[columnKey].add_vat}
                    onCheckedChange={(checked) => {
                      setMap((m) => ({
                        ...m,
                        price_modifiers: {
                          ...m.price_modifiers!,
                          overrides: {
                            ...m.price_modifiers!.overrides,
                            [columnKey]: {
                              ...m.price_modifiers!.overrides[columnKey],
                              add_vat: Boolean(checked),
                            },
                          },
                        },
                      }));
                    }}
                  />
                  {/* Input para tasa de IVA específica del override (opcional) */}
                  <Input
                    type="number"
                    value={
                      map.price_modifiers.overrides[columnKey].vat_rate ??
                      map.price_modifiers?.general.vat_rate ??
                      21
                    }
                    onChange={(e) => {
                      const rate = parseFloat(e.target.value) || 0;
                      setMap((m) => ({
                        ...m,
                        price_modifiers: {
                          ...m.price_modifiers!,
                          overrides: {
                            ...m.price_modifiers!.overrides,
                            [columnKey]: {
                              ...m.price_modifiers!.overrides[columnKey],
                              vat_rate: rate,
                            },
                          },
                        },
                      }));
                    }}
                    className="w-16 text-sm"
                  />
                  <span className="text-sm">% IVA</span>
                </>
              )}
            </div>
          ))}
      </div>

      {/* Columna de precio para carrito */}
      <div className="space-y-2">
        <Label className="font-semibold text-foreground">
          Columna de precio para carrito de pedidos
        </Label>
        <Select
          value={map.cart_price_column || ""}
          onValueChange={(value) =>
            setMap({ ...map, cart_price_column: value || null })
          }
        >
          <SelectTrigger className="bg-muted/50 border-primary/20 text-foreground">
            <SelectValue placeholder="Selecciona la columna de precio" />
          </SelectTrigger>
          <SelectContent>
            {keys
              .filter((key) => isNumericColumn(key))
              .map((key) => {
                // Determinar etiqueta descriptiva
                let label = key;
                if (key === map.price_primary_key) {
                  label = `${key} (Principal)`;
                } else if (map.price_alt_keys.includes(key)) {
                  label = `${key} (Alternativo)`;
                } else if (key === map.quantity_key) {
                  label = `${key} (Cantidad)`;
                }

                return (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                );
              })}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Esta columna se usará cuando agregues productos a la lista de pedidos
        </p>
      </div>

      <div className="flex justify-end gap-2">
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Guardando...
            </>
          ) : (
            "Guardar configuración y refrescar índice"
          )}
        </Button>
      </div>
    </div>
  );
}
