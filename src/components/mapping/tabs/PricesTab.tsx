import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MappingConfig, CustomColumnFormula } from "@/components/suppliers/ListConfigurationView";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";

interface PricesTabProps {
  keys: string[];
  map: MappingConfig;
  setMap: React.Dispatch<React.SetStateAction<MappingConfig>>;
  setKeys: React.Dispatch<React.SetStateAction<string[]>>;
  isSaving: boolean;
  isNumericColumn: (key: string) => boolean;
}

export function PricesTab({ keys, map, setMap, setKeys, isSaving, isNumericColumn }: PricesTabProps) {
  // State for new custom column form
  const [newColName, setNewColName] = useState("");
  const [baseColumn, setBaseColumn] = useState("");
  const [percentage, setPercentage] = useState(0);
  const [addVat, setAddVat] = useState(false);
  const [vatRate, setVatRate] = useState(21);

  // State for editing existing custom columns
  const [editingColumn, setEditingColumn] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<CustomColumnFormula | null>(null);
  const [editName, setEditName] = useState("");

  const handleAddCustomColumn = () => {
    if (!newColName.trim() || !baseColumn) return;

    const trimmedName = newColName.trim();

    // Check if column name already exists
    if (keys.includes(trimmedName)) {
      return;
    }

    // Update mapping config state with new custom column
    setMap((prev) => ({
      ...prev,
      custom_columns: {
        ...(prev.custom_columns || {}),
        [trimmedName]: {
          base_column: baseColumn,
          percentage,
          add_vat: addVat,
          vat_rate: vatRate,
        },
      },
    }));

    // Add to keys so it appears in column lists
    setKeys((prevKeys) => [...prevKeys, trimmedName]);

    // Reset form inputs
    setNewColName("");
    setBaseColumn("");
    setPercentage(0);
    setAddVat(false);
    setVatRate(21);
  };

  const handleRemoveCustomColumn = (colName: string) => {
    setMap((prev) => {
      const updated = { ...(prev.custom_columns || {}) };
      delete updated[colName];
      return { ...prev, custom_columns: Object.keys(updated).length > 0 ? updated : undefined };
    });
    setKeys((prev) => prev.filter((k) => k !== colName));
  };

  const handleEditColumn = (colName: string) => {
    const formula = map.custom_columns?.[colName];
    if (formula) {
      setEditingColumn(colName);
      setEditValues({ ...formula });
      setEditName(colName);
    }
  };

  const handleCancelEdit = () => {
    setEditingColumn(null);
    setEditValues(null);
    setEditName("");
  };

  const handleSaveEdit = () => {
    if (!editingColumn || !editValues) return;
    const trimmedName = editName.trim();
    if (!trimmedName) return;
    if (trimmedName !== editingColumn && keys.includes(trimmedName)) return;

    setMap((prev) => {
      const customColumns = { ...(prev.custom_columns || {}) };
      delete customColumns[editingColumn];
      customColumns[trimmedName] = editValues;

      const replaceColumn = (value?: string | null) => (value === editingColumn ? trimmedName : value ?? null);
      const replaceInList = (values: string[]) =>
        values.map((value) => (value === editingColumn ? trimmedName : value));

      return {
        ...prev,
        custom_columns: customColumns,
        cart_price_column: replaceColumn(prev.cart_price_column ?? null),
        delivery_note_price_column: replaceColumn(prev.delivery_note_price_column ?? null),
        price_alt_keys: replaceInList(prev.price_alt_keys ?? []),
      };
    });

    if (trimmedName !== editingColumn) {
      setKeys((prev) => prev.map((key) => (key === editingColumn ? trimmedName : key)));
    }

    setEditingColumn(null);
    setEditValues(null);
    setEditName("");
  };

  // Get existing custom column names
  const customColumnNames = Object.keys(map.custom_columns || {});
  // Allow custom columns to be used as base for new columns (they are always numeric)
  const availableBaseColumns = keys.filter((k) => isNumericColumn(k) || customColumnNames.includes(k));

  return (
    <div className="space-y-6">
      {/* Primary Price Key */}
      <div className="space-y-3">
        <div>
          <Label className="text-base font-semibold">Columna de Precio Principal</Label>
          <p className="text-sm text-muted-foreground mt-1">
            Selecciona la columna que contiene el precio principal del producto.
          </p>
        </div>
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
          <SelectTrigger>
            <SelectValue placeholder="Seleccionar columna (opcional)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Sin precio</SelectItem>
            {keys
              .filter((k) => !customColumnNames.includes(k))
              .map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      {/* Alternative Price Columns */}
      <div className="space-y-3">
        <div>
          <Label className="text-base font-semibold">Columnas Adicionales de Precio</Label>
          <p className="text-sm text-muted-foreground mt-1">
            Se formatearán igual que el precio principal (parseo y símbolo $).
          </p>
        </div>
        <ScrollArea className="h-[150px] border rounded-lg p-3 bg-muted/30">
          {keys
            .filter((key) => isNumericColumn(key) && key !== map.price_primary_key && !customColumnNames.includes(key))
            .map((columnKey) => {
              const isChecked = map.price_alt_keys.includes(columnKey);
              return (
                <div key={columnKey} className="flex items-center gap-3 py-2">
                  <Checkbox
                    id={`price-alt-${columnKey}`}
                    checked={isChecked}
                    onCheckedChange={(checked) => {
                      setMap((prev) => {
                        const next = checked
                          ? Array.from(new Set([...(prev.price_alt_keys ?? []), columnKey]))
                          : (prev.price_alt_keys ?? []).filter((k) => k !== columnKey);
                        return { ...prev, price_alt_keys: next };
                      });
                    }}
                  />
                  <label htmlFor={`price-alt-${columnKey}`} className="text-sm cursor-pointer">
                    {columnKey}
                  </label>
                </div>
              );
            })}
        </ScrollArea>
        <p className="text-xs text-muted-foreground">
          {map.price_alt_keys.length > 0
            ? `✓ ${map.price_alt_keys.length} columna(s) seleccionada(s)`
            : "Sin columnas adicionales"}
        </p>
      </div>

      {/* Global Price Modifiers */}
      <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
        <Label className="text-base font-semibold">Modificadores de Precio Globales</Label>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label className="text-sm">Descuento/Adición:</Label>
            <Input
              type="number"
              value={map.price_modifiers?.general.percentage ?? 0}
              onChange={(e) => {
                const pct = parseFloat(e.target.value) || 0;
                setMap((m) => ({
                  ...m,
                  price_modifiers: {
                    ...m.price_modifiers!,
                    general: { ...m.price_modifiers!.general, percentage: pct },
                  },
                }));
              }}
              className="w-20"
            />
            <span className="text-sm">%</span>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={map.price_modifiers?.general.add_vat ?? false}
              onCheckedChange={(checked) => {
                setMap((m) => ({
                  ...m,
                  price_modifiers: {
                    ...m.price_modifiers!,
                    general: { ...m.price_modifiers!.general, add_vat: Boolean(checked) },
                  },
                }));
              }}
            />
            <Label className="text-sm">Agregar IVA:</Label>
            <Input
              type="number"
              value={map.price_modifiers?.general.vat_rate ?? 21}
              onChange={(e) => {
                const rate = parseFloat(e.target.value) || 0;
                setMap((m) => ({
                  ...m,
                  price_modifiers: {
                    ...m.price_modifiers!,
                    general: { ...m.price_modifiers!.general, vat_rate: rate },
                  },
                }));
              }}
              className="w-20"
            />
            <span className="text-sm">%</span>
          </div>
        </div>
      </div>

      {/* Per-Column Overrides */}
      <div className="space-y-3">
        <div>
          <Label className="text-base font-semibold">Modificadores por Columna</Label>
          <p className="text-sm text-muted-foreground mt-1">
            Aplica modificadores específicos para columnas individuales.
          </p>
        </div>
        <ScrollArea className="h-[200px] border rounded-lg p-3 bg-muted/30">
          {keys
            .filter((k) => k !== map.price_primary_key && !customColumnNames.includes(k))
            .map((columnKey) => (
              <div key={columnKey} className="flex flex-wrap items-center gap-2 py-2 border-b last:border-0">
                <Checkbox
                  checked={!!map.price_modifiers?.overrides[columnKey]}
                  onCheckedChange={(checked) => {
                    setMap((m) => {
                      const overrides = { ...(m.price_modifiers?.overrides || {}) };
                      if (checked) {
                        overrides[columnKey] = overrides[columnKey] || { percentage: 0, add_vat: false };
                      } else {
                        delete overrides[columnKey];
                      }
                      return {
                        ...m,
                        price_modifiers: { ...m.price_modifiers!, overrides },
                      };
                    });
                  }}
                />
                <Label className="text-sm min-w-[100px]">{columnKey}</Label>
                {map.price_modifiers?.overrides[columnKey] && (
                  <div className="flex flex-wrap items-center gap-2">
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
                              [columnKey]: { ...m.price_modifiers!.overrides[columnKey], percentage: pct },
                            },
                          },
                        }));
                      }}
                      className="w-16"
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
                              [columnKey]: { ...m.price_modifiers!.overrides[columnKey], add_vat: Boolean(checked) },
                            },
                          },
                        }));
                      }}
                    />
                    <Input
                      type="number"
                      value={
                        map.price_modifiers.overrides[columnKey].vat_rate ?? map.price_modifiers?.general.vat_rate ?? 21
                      }
                      onChange={(e) => {
                        const rate = parseFloat(e.target.value) || 0;
                        setMap((m) => ({
                          ...m,
                          price_modifiers: {
                            ...m.price_modifiers!,
                            overrides: {
                              ...m.price_modifiers!.overrides,
                              [columnKey]: { ...m.price_modifiers!.overrides[columnKey], vat_rate: rate },
                            },
                          },
                        }));
                      }}
                      className="w-16"
                    />
                    <span className="text-sm">% IVA</span>
                  </div>
                )}
              </div>
            ))}
        </ScrollArea>
      </div>
      {/* Custom Price Columns */}
      <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
        <Label className="text-base font-semibold">Columnas Personalizadas de Precio</Label>
        <p className="text-sm text-muted-foreground">Define columnas calculadas basadas en otra columna de precio.</p>

        {/* Form inputs for new custom column */}
        <div className="flex flex-wrap items-end gap-3 pt-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Nombre</Label>
            <Input
              placeholder="Ej: Precio+IVA"
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              className="w-32"
              disabled={isSaving}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Columna base</Label>
            <Select onValueChange={(val) => setBaseColumn(val)} value={baseColumn || ""} disabled={isSaving}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Seleccionar" />
              </SelectTrigger>
              <SelectContent>
                {availableBaseColumns.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Variación %</Label>
            <Input
              type="number"
              value={percentage}
              onChange={(e) => setPercentage(parseFloat(e.target.value) || 0)}
              className="w-20"
              disabled={isSaving}
            />
          </div>
          <div className="flex items-center gap-2 pb-0.5">
            <Checkbox checked={addVat} onCheckedChange={(checked) => setAddVat(Boolean(checked))} disabled={isSaving} />
            <Label className="text-sm">IVA</Label>
            <Input
              type="number"
              value={vatRate}
              onChange={(e) => setVatRate(parseFloat(e.target.value) || 0)}
              className="w-16"
              disabled={!addVat || isSaving}
            />
            <span className="text-sm">%</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleAddCustomColumn}
            disabled={!newColName.trim() || !baseColumn || keys.includes(newColName.trim()) || isSaving}
          >
            <Plus className="w-4 h-4 mr-1" />
            Agregar
          </Button>
        </div>

        {/* List existing custom columns */}
        {map.custom_columns && Object.keys(map.custom_columns).length > 0 && (
          <div className="mt-4 space-y-2">
            <Label className="text-sm text-muted-foreground">Columnas creadas:</Label>
            <ScrollArea className="max-h-[200px]">
              {Object.entries(map.custom_columns).map(([colName, formula]) => (
                <div
                  key={colName}
                  className="flex flex-col gap-2 py-2 px-2 border-b last:border-0 bg-background/50 rounded mb-1"
                >
                  {editingColumn === colName && editValues ? (
                    // Edit mode
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-32"
                        disabled={isSaving}
                      />
                      <Select
                        value={editValues.base_column}
                        onValueChange={(val) => setEditValues({ ...editValues, base_column: val })}
                        disabled={isSaving}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {availableBaseColumns.map((k) => (
                            <SelectItem key={k} value={k}>
                              {k}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        value={editValues.percentage}
                        onChange={(e) => setEditValues({ ...editValues, percentage: parseFloat(e.target.value) || 0 })}
                        className="w-16"
                        disabled={isSaving}
                      />
                      <span className="text-sm">%</span>
                      <Checkbox
                        checked={editValues.add_vat}
                        onCheckedChange={(checked) => setEditValues({ ...editValues, add_vat: Boolean(checked) })}
                        disabled={isSaving}
                      />
                      <span className="text-sm">IVA</span>
                      <Input
                        type="number"
                        value={editValues.vat_rate ?? 21}
                        onChange={(e) => setEditValues({ ...editValues, vat_rate: parseFloat(e.target.value) || 21 })}
                        className="w-14"
                        disabled={!editValues.add_vat || isSaving}
                      />
                      <span className="text-sm">%</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleSaveEdit}
                        disabled={
                          isSaving ||
                          !editName.trim() ||
                          (editName.trim() !== colName && keys.includes(editName.trim()))
                        }
                        className="text-primary"
                      >
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={handleCancelEdit} disabled={isSaving}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    // View mode
                    <div className="flex items-center justify-between">
                      <div className="text-sm">
                        <span className="font-medium">{colName}</span>
                        <span className="text-muted-foreground ml-2">(base: {formula.base_column})</span>
                        <span className="text-muted-foreground ml-2">
                          {formula.percentage >= 0 ? "+" : ""}
                          {formula.percentage}%{formula.add_vat ? ` + IVA ${formula.vat_rate || 21}%` : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditColumn(colName)}
                          disabled={isSaving}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveCustomColumn(colName)}
                          disabled={isSaving}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
}
