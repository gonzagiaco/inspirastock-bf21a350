import { useState, useMemo } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Settings2,
  GripVertical,
  Eye,
  EyeOff,
  RotateCcw,
  Edit2,
  Check,
  X,
} from "lucide-react";
import { ColumnSchema } from "@/types/productList";
import { useProductListStore } from "@/stores/productListStore";
import { useProductLists } from "@/hooks/useProductLists";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { renameColumnKeyOffline } from "@/lib/localDB";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { useQueryClient } from "@tanstack/react-query";

interface ColumnSettingsDrawerProps {
  listId: string;
  columnSchema: ColumnSchema[];
  mappingConfig?: any;
}

interface SortableItemProps {
  id: string;
  column: ColumnSchema;
  isVisible: boolean;
  isDisabled: boolean;
  isLocked: boolean;
  isSearchable: boolean;
  onToggle: (key: string, visible: boolean) => void;
  onRename: (key: string, newLabel: string) => void;
  onSearchableToggle: (key: string, searchable: boolean) => void;
}

function SortableItem({
  id,
  column,
  isVisible,
  isDisabled,
  isLocked,
  isSearchable,
  onToggle,
  onRename,
  onSearchableToggle,
}: SortableItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(column.label);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleSaveLabel = () => {
    if (isLocked) {
      setIsEditing(false);
      setEditLabel(column.label);
      return;
    }
    if (editLabel.trim() && editLabel !== column.label) {
      onRename(column.key, editLabel.trim());
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditLabel(column.label);
    setIsEditing(false);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 p-2 rounded-md bg-card border border-border hover:bg-accent/50 transition-colors ${
        !isEditing ? "select-none" : ""
      }`}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing select-none"
      >
        <GripVertical className="w-4 h-4 text-muted-foreground" />
      </div>
      <Checkbox
        id={`col-${column.key}`}
        checked={isVisible}
        onCheckedChange={(checked) => onToggle(column.key, checked as boolean)}
        disabled={isDisabled}
        className="select-none"
      />

      {isEditing ? (
        <div className="flex-1 flex items-center gap-1">
          <Input
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            className="h-7 text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveLabel();
              if (e.key === "Escape") handleCancelEdit();
            }}
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={handleSaveLabel}
          >
            <Check className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={handleCancelEdit}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <>
          <Label
            htmlFor={`col-${column.key}`}
            className="flex-1 cursor-pointer text-sm select-none"
          >
            {column.label}
            {column.isStandard && (
              <span className="text-xs text-muted-foreground ml-1">(fija)</span>
            )}
          </Label>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => {
              if (!isLocked) setIsEditing(true);
            }}
            title="Renombrar columna"
            disabled={isLocked}
          >
            <Edit2 className="h-3 w-3" />
          </Button>
        </>
      )}

      <div className="flex items-center gap-1 select-none">
        {isVisible ? (
          <Eye className="w-4 h-4 text-muted-foreground" />
        ) : (
          <EyeOff className="w-4 h-4 text-muted-foreground" />
        )}
      </div>
    </div>
  );
}

export const ColumnSettingsDrawer = ({
  listId,
  columnSchema,
  mappingConfig,
}: ColumnSettingsDrawerProps) => {
  const {
    columnVisibility,
    columnOrder,
    savedViews,
    activeView,
    searchableColumns,
    setColumnVisibility,
    setColumnOrder,
    setSearchableColumns,
    resetColumnSettings,
    saveView,
    applyView,
    renameView,
    deleteView,
    updateColumnLabel,
  } = useProductListStore();

  const { updateColumnSchema, renameColumnKey } = useProductLists();
  const isOnline = useOnlineStatus();
  const queryClient = useQueryClient();

  const lockedKeys = useMemo(() => {
    const keys = new Set<string>(["code"]);
    for (const key of mappingConfig?.code_keys ?? []) {
      keys.add(key);
    }
    return keys;
  }, [mappingConfig]);

  const [open, setOpen] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [editingViewName, setEditingViewName] = useState("");

  // Key rename dialog state
  const [keyRenameDialog, setKeyRenameDialog] = useState<{
    open: boolean;
    oldKey: string;
    newKey: string;
    column: ColumnSchema | null;
  }>({ open: false, oldKey: "", newKey: "", column: null });
  const [isRenaming, setIsRenaming] = useState(false);

  const isMobile = useIsMobile();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const currentOrder = columnOrder[listId] || columnSchema.map((c) => c.key);
  const orderedColumns = currentOrder
    .map((key) => columnSchema.find((c) => c.key === key))
    .filter(Boolean) as ColumnSchema[];

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = currentOrder.indexOf(active.id as string);
      const newIndex = currentOrder.indexOf(over.id as string);
      const newOrder = arrayMove(currentOrder, oldIndex, newIndex);
      setColumnOrder(listId, newOrder);
    }
  };

  const handleToggleColumn = (key: string, visible: boolean) => {
    setColumnVisibility(listId, key, visible);
  };

  const handleSearchableToggle = (key: string, searchable: boolean) => {
    const current = searchableColumns[listId]
      ? [...searchableColumns[listId]]
      : ["code", "name"];

    let updated;
    if (searchable) {
      updated = Array.from(new Set([...current, key]));
    } else {
      updated = current.filter((k) => k !== key);
    }

    setSearchableColumns(listId, [...updated]);
  };

  const handleShowAll = () => {
    columnSchema.forEach((col) => {
      if (!col.isStandard) {
        setColumnVisibility(listId, col.key, true);
      }
    });
    toast.success("Todas las columnas visibles");
  };

  const handleHideAll = () => {
    columnSchema.forEach((col) => {
      if (!col.isStandard) {
        setColumnVisibility(listId, col.key, false);
      }
    });
    toast.success("Columnas no esenciales ocultas");
  };

  const handleReset = () => {
    resetColumnSettings(listId);
    toast.success("Configuración restablecida");
  };

  const handleSaveView = () => {
    if (!newViewName.trim()) {
      toast.error("Ingresa un nombre para la vista");
      return;
    }
    saveView(listId, newViewName.trim());
    setNewViewName("");
    toast.success(`Vista "${newViewName}" guardada`);
  };

  const handleApplyView = (viewId: string) => {
    applyView(listId, viewId);
    toast.success("Vista aplicada");
  };

  const handleRenameView = (viewId: string) => {
    if (!editingViewName.trim()) {
      toast.error("El nombre no puede estar vacío");
      return;
    }
    renameView(listId, viewId, editingViewName.trim());
    setEditingViewId(null);
    setEditingViewName("");
    toast.success("Vista actualizada");
  };

  const handleDeleteView = (viewId: string) => {
    deleteView(listId, viewId);
    toast.success("Vista eliminada");
  };

  // Handle rename - opens confirmation dialog, then renames both label and key
  const handleRename = (columnKey: string, newLabel: string) => {
    const column = columnSchema.find((c) => c.key === columnKey);
    if (!column) return;

    // Normalize new key from label
    const normalizedNewKey = newLabel
      .toLowerCase()
      .replace(/[^a-z0-9áéíóúñü_]/gi, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");

    setKeyRenameDialog({
      open: true,
      oldKey: columnKey,
      newKey: normalizedNewKey,
      column: { ...column, label: newLabel }, // Store new label
    });
  };

  // Confirm and execute key rename (affects JSONB data)
  const handleConfirmKeyRename = async () => {
    const { oldKey, newKey, column } = keyRenameDialog;

    if (!column || !newKey.trim() || oldKey === newKey) {
      setKeyRenameDialog({ open: false, oldKey: "", newKey: "", column: null });
      return;
    }

    // Normalize new key
    const normalizedNewKey = newKey
      .toLowerCase()
      .replace(/[^a-z0-9áéíóúñü_]/gi, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");

    if (normalizedNewKey === oldKey) {
      toast.info("La clave normalizada es igual a la actual");
      setKeyRenameDialog({ open: false, oldKey: "", newKey: "", column: null });
      return;
    }

    setIsRenaming(true);

    try {
      if (isOnline) {
        // Build updated mapping config with key references
        let updatedMappingConfig = mappingConfig ? { ...mappingConfig } : {};

        // Update array references
        const arrayKeys = ["code_keys", "name_keys", "extra_index_keys"];
        for (const arrayKey of arrayKeys) {
          if (Array.isArray(updatedMappingConfig[arrayKey])) {
            updatedMappingConfig[arrayKey] = updatedMappingConfig[arrayKey].map(
              (k: string) => (k === oldKey ? normalizedNewKey : k)
            );
          }
        }

        // Update single value references
        const singleKeys = [
          "price_primary_key",
          "cart_price_column",
          "delivery_note_price_column",
          "quantity_key",
        ];
        for (const singleKey of singleKeys) {
          if (updatedMappingConfig[singleKey] === oldKey) {
            updatedMappingConfig[singleKey] = normalizedNewKey;
          }
        }

        // Update dollar_conversion target_columns
        if (updatedMappingConfig.dollar_conversion?.target_columns) {
          updatedMappingConfig.dollar_conversion.target_columns =
            updatedMappingConfig.dollar_conversion.target_columns.map(
              (k: string) => (k === oldKey ? normalizedNewKey : k)
            );
        }

        // Update price_modifiers overrides
        if (updatedMappingConfig.price_modifiers?.overrides?.[oldKey]) {
          updatedMappingConfig.price_modifiers.overrides[normalizedNewKey] =
            updatedMappingConfig.price_modifiers.overrides[oldKey];
          delete updatedMappingConfig.price_modifiers.overrides[oldKey];
        }

        // Update custom_columns base_column references
        if (updatedMappingConfig.custom_columns) {
          for (const customKey in updatedMappingConfig.custom_columns) {
            if (
              updatedMappingConfig.custom_columns[customKey].base_column ===
              oldKey
            ) {
              updatedMappingConfig.custom_columns[customKey].base_column =
                normalizedNewKey;
            }
          }
        }

        // Prepare updated schema (key + label change)
        const updatedSchema = columnSchema.map((col) =>
          col.key === oldKey
            ? { ...col, key: normalizedNewKey, label: column.label }
            : col
        );

        // 🚫 Remove stock_threshold column to avoid persisting it in general lists
        const sanitizedSchema = updatedSchema.filter(
          (c) => c.key !== "stock_threshold"
        );

        // Call the mutation - it returns updatedCount
        const result = await renameColumnKey({
          listId,
          oldKey,
          newKey: normalizedNewKey,
          updatedSchema: sanitizedSchema,
          updatedMappingConfig,
        });

        const updatedCount = result?.updatedCount ?? 0;

        toast.success(
          updatedCount > 0
            ? `Columna renombrada (${updatedCount} productos actualizados)`
            : `Columna renombrada a "${column.label}"`
        );

        // Update local store with new key
        updateColumnLabel(listId, normalizedNewKey, column.label);

        // Update product-lists-index cache
        queryClient.setQueryData(
          ["product-lists-index", isOnline ? "online" : "offline"],
          (old: any[] | undefined) => {
            if (!old) return old;
            return old.map((list) =>
              list.id === listId
                ? {
                    ...list,
                    column_schema: sanitizedSchema,
                    mapping_config: updatedMappingConfig,
                  }
                : list
            );
          }
        );

        // Invalidate list-products to reload with new keys
        queryClient.invalidateQueries({ queryKey: ["list-products", listId] });
      } else {
        // Offline rename
        const updatedCount = await renameColumnKeyOffline(
          listId,
          oldKey,
          normalizedNewKey
        );

        // Update schema locally
        const updatedSchema = columnSchema.map((col) =>
          col.key === oldKey
            ? { ...col, key: normalizedNewKey, label: column.label }
            : col
        );
        // 🚫 Remove stock_threshold column for offline update
        const sanitizedSchema = updatedSchema.filter(
          (c) => c.key !== "stock_threshold"
        );
        await updateColumnSchema({
          listId,
          columnSchema: sanitizedSchema,
          silent: true,
        });

        updateColumnLabel(listId, normalizedNewKey, column.label);

        toast.success(
          updatedCount > 0
            ? `Columna renombrada (${updatedCount} productos)`
            : `Columna renombrada a "${column.label}"`
        );
      }

      console.log(`✅ Clave renombrada: "${oldKey}" → "${normalizedNewKey}"`);
    } catch (error) {
      console.error("Error renombrando clave:", error);
      toast.error("Error al renombrar clave");
    } finally {
      setIsRenaming(false);
      setKeyRenameDialog({ open: false, oldKey: "", newKey: "", column: null });
    }
  };

  const currentActiveView = activeView[listId];
  const activeViewName = savedViews[listId]?.find(
    (v) => v.id === currentActiveView
  )?.name;

  return (
    <>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>
          {!isMobile && (
            <Button variant="outline" size="sm" className="gap-2">
              <Settings2 className="w-4 h-4" />
              Columnas
              {activeViewName && (
                <span className="text-xs text-muted-foreground">
                  ({activeViewName})
                </span>
              )}
            </Button>
          )}
        </DrawerTrigger>
        <DrawerContent className="max-h-[90vh] select-none">
          <DrawerHeader>
            <DrawerTitle>Configuración de Columnas</DrawerTitle>
            <DrawerDescription>
              Personaliza la visibilidad y orden de las columnas. Arrastra para
              reordenar.
            </DrawerDescription>
            {activeViewName && (
              <div className="text-sm text-muted-foreground mt-2">
                Vista activa:{" "}
                <span className="font-medium text-foreground">
                  {activeViewName}
                </span>
              </div>
            )}
          </DrawerHeader>

          <ScrollArea className="h-[50vh] px-4">
            <div className="space-y-6">
              {/* Quick Actions */}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Acciones Rápidas</h4>
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={handleShowAll}>
                    <Eye className="w-4 h-4 mr-2" />
                    Mostrar todas
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleHideAll}>
                    <EyeOff className="w-4 h-4 mr-2" />
                    Ocultar opcionales
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleReset}>
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Reset
                  </Button>
                </div>
              </div>

              <Separator />

              {/* Column List */}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Columnas</h4>
                <p className="text-xs text-muted-foreground">
                  <Edit2 className="w-3 h-3 inline mr-1" /> Renombrar columna
                </p>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={currentOrder}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2">
                      {orderedColumns.map((column) => {
                        const isVisible =
                          columnVisibility[listId]?.[column.key] !== false;
                        const currentSearchable = searchableColumns[listId] || [
                          "code",
                          "name",
                        ];
                        const isSearchable = currentSearchable.includes(
                          column.key
                        );
                        return (
                          <SortableItem
                            key={column.key}
                            id={column.key}
                            column={column}
                            isVisible={isVisible}
                            isDisabled={column.isStandard || false}
                            isLocked={lockedKeys.has(column.key)}
                            isSearchable={isSearchable}
                            onToggle={handleToggleColumn}
                            onRename={handleRename}
                            onSearchableToggle={handleSearchableToggle}
                          />
                        );
                      })}
                    </div>
                  </SortableContext>
                </DndContext>
              </div>
            </div>
          </ScrollArea>

          <DrawerFooter>
            <DrawerClose asChild>
              <Button variant="outline">Cerrar</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Rename Confirmation Dialog */}
      <AlertDialog
        open={keyRenameDialog.open}
        onOpenChange={(open) =>
          !isRenaming && setKeyRenameDialog((prev) => ({ ...prev, open }))
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Renombrar columna?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Esta acción actualizará el nombre de la columna en todos los
                  productos.
                </p>
                <div className="p-3 bg-muted rounded-md space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">Nombre actual:</span>
                    <span className="text-foreground">
                      {
                        columnSchema.find(
                          (c) => c.key === keyRenameDialog.oldKey
                        )?.label
                      }
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">Nuevo nombre:</span>
                    <span className="text-foreground font-semibold">
                      {keyRenameDialog.column?.label}
                    </span>
                  </div>
                  <div className="border-t pt-2 mt-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Clave interna:</span>
                      <code className="px-1 py-0.5 bg-background rounded">
                        {keyRenameDialog.oldKey}
                      </code>
                      <span>→</span>
                      <code className="px-1 py-0.5 bg-background rounded">
                        {keyRenameDialog.newKey}
                      </code>
                    </div>
                  </div>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRenaming}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmKeyRename}
              disabled={isRenaming}
            >
              {isRenaming ? "Renombrando..." : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
