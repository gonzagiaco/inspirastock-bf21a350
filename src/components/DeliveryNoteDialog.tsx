import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { DeliveryNote, CreateDeliveryNoteInput } from "@/types";
import { useDeliveryNotes } from "@/hooks/useDeliveryNotes";
import { useDeliveryClients } from "@/hooks/useDeliveryClients";
import DeliveryNoteProductSearch from "./DeliveryNoteProductSearch";
import { ChevronLeft, X, Plus, Minus, Loader2 } from "lucide-react";
import { formatARS } from "@/utils/numberParser";
import { applyPercentageAdjustment } from "@/utils/deliveryNotePricing";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { localDB } from "@/lib/localDB";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useProductLists } from "@/hooks/useProductLists";
import { MappingConfig } from "@/components/suppliers/ListConfigurationView";
import { useIsMobile } from "@/hooks/use-mobile";


const deliveryNoteSchema = z.object({
  customerName: z.string().min(1, "Nombre requerido").max(100),
  customerAddress: z.string().max(200).optional(),
  customerPhone: z
    .string()
    .regex(/^\+54\d{10}$/, "Formato inválido. Debe ser +54 seguido de 10 dígitos")
    .optional()
    .or(z.literal("")),
  issueDate: z.string().min(1, "Fecha de emisión requerida"),
  paidAmount: z.number().min(0).optional(),
  notes: z.string().max(500).optional(),
});

interface DeliveryNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  note?: DeliveryNote;
  isLoadingNote?: boolean;
  initialClientId?: string | null;
}

interface CartItem {
  lineId: string;
  productId?: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  adjustmentPct?: number;
  productListId?: string | null;
  priceColumnKeyUsed?: string | null;
}

const createLineId = () => {
  const randomId = (globalThis as any)?.crypto?.randomUUID?.();
  return typeof randomId === "string" ? randomId : `${Date.now()}-${Math.random()}`;
};

const samePrice = (a: number, b: number) => Math.abs(a - b) < 0.0001;
const OLD_PRICE_COLUMN_MESSAGE = "La columna de precio configurada para remitos cambió. Agrega el producto nuevamente para usar la nueva configuración.";

const DeliveryNoteDialog = ({ open, onOpenChange, note, isLoadingNote = false, initialClientId }: DeliveryNoteDialogProps) => {
  const { createDeliveryNote, updateDeliveryNote } = useDeliveryNotes();
  const { productLists } = useProductLists();
  const isOnline = useOnlineStatus();
  const isMobile = useIsMobile();
  const { clients, createClient } = useDeliveryClients();
  const [items, setItems] = useState<CartItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [clientMode, setClientMode] = useState<"new" | "existing">("new");
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [globalAdjustmentPct, setGlobalAdjustmentPct] = useState(0);

  // Helper para obtener la columna de precio efectiva de una lista
  const getEffectivePriceColumn = (listId: string | undefined | null): string => {
    if (!listId) return "price";
    const cfg = mappingConfigByListId.get(listId);
    return cfg?.delivery_note_price_column ?? cfg?.price_primary_key ?? "price";
  };

  // Detecta si el item usa una columna de precio diferente a la configurada actualmente
  const isOldPriceItem = (item: CartItem): boolean => {
    // Si no tenemos metadata, no podemos determinar → NO marcar como antiguo
    if (!item.productListId || !item.priceColumnKeyUsed) return false;
    
    const currentPriceCol = getEffectivePriceColumn(item.productListId);
    
    // Normalizar strings para comparación
    const used = item.priceColumnKeyUsed.trim().toLowerCase();
    const current = currentPriceCol.trim().toLowerCase();
    
    return used !== current;
  };

  const showOldPriceToast = () => {
    toast(OLD_PRICE_COLUMN_MESSAGE, { duration: 5000 });
  };

  const mappingConfigByListId = useMemo(() => {
    const map = new Map<string, MappingConfig | undefined>();
    for (const list of productLists || []) {
      if (!list?.id) continue;
      map.set(String(list.id), list.mapping_config as MappingConfig | undefined);
    }
    return map;
  }, [productLists]);

  const { control, register, handleSubmit, formState: { errors }, reset, setValue } = useForm({
    resolver: zodResolver(deliveryNoteSchema),
    defaultValues: {
      customerName: "",
      customerAddress: "",
      customerPhone: "",
      issueDate: new Date().toISOString().split("T")[0],
      paidAmount: undefined,
      notes: "",
    },
  });

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) || null,
    [clients, selectedClientId],
  );

  const lockCustomerFields = clientMode === "existing" || !!note?.clientId;

  const filteredClients = useMemo(() => {
    const query = clientSearch.trim().toLowerCase();
    if (!query) return clients;

    return clients.filter((client) => {
      const nameMatch = client.name.toLowerCase().includes(query);
      const phoneMatch = (client.phone || "").includes(query);
      return nameMatch || phoneMatch;
    });
  }, [clients, clientSearch]);

  const reservedQuantities = useMemo(() => {
    const map = new Map<string, number>();
    note?.items?.forEach((item) => {
      if (item.productId) {
        map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity);
      }
    });
    return map;
  }, [note]);

  const getReservedQuantity = (productId?: string) => (productId ? reservedQuantities.get(productId) ?? 0 : 0);

  const itemsRef = useRef<CartItem[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const getAvailableForEdit = async (productId: string) => {
    const reservedQuantity = getReservedQuantity(productId);

    const localIndexRecord = await localDB.dynamic_products_index.where("product_id").equals(productId).first();
    if (typeof localIndexRecord?.quantity === "number") {
      return (localIndexRecord.quantity || 0) + reservedQuantity;
    }

    if (!isOnline) return reservedQuantity;

    const { data, error } = await supabase
      .from("dynamic_products_index")
      .select("quantity")
      .eq("product_id", productId)
      .single();

    if (error) return reservedQuantity;
    return (data?.quantity || 0) + reservedQuantity;
  };

  const resolveProductIdByCode = async (productCode: string) => {
    const normalized = String(productCode || "").trim();
    if (!normalized) return null;
    const row = await localDB.dynamic_products_index.where("code").equals(normalized).first();
    return row?.product_id ? String(row.product_id) : null;
  };

  // Removed: resolveCurrentUnitPrice - no longer needed since we use column-based detection (isOldPriceItem)

  // Removed: useEffect for currentUnitPriceByKey - now using column-based detection instead of value-based

  useEffect(() => {
    if (clientMode !== "existing" || !selectedClient) return;

    setValue("customerName", selectedClient.name);
    setValue("customerAddress", selectedClient.address || "");
    setValue("customerPhone", selectedClient.phone || "");
    setPhoneNumber(selectedClient.phone || "");
  }, [clientMode, selectedClient, setValue]);

  useEffect(() => {
    if (!open) return;

    if (note) {
      reset({
        customerName: note.customerName,
        customerAddress: note.customerAddress || "",
        customerPhone: note.customerPhone || "",
        issueDate: note.issueDate.split("T")[0],
        paidAmount: note.paidAmount ?? undefined,
        notes: note.notes || "",
      });

      setPhoneNumber(note.customerPhone || "");
      setValue("issueDate", note.issueDate.split("T")[0]);
      setValue("paidAmount", note.paidAmount);
      setValue("notes", note.notes || "");

      setClientMode(note.clientId ? "existing" : "new");
      setSelectedClientId(note.clientId || null);
      setClientSearch("");

      setItems(
        note.items?.map((item) => ({
          lineId: item.id,
          productId: item.productId,
          productCode: item.productCode,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPriceBase ?? item.unitPrice,
          adjustmentPct: item.adjustmentPct ?? 0,
          productListId: item.productListId,
          priceColumnKeyUsed: item.priceColumnKeyUsed,
        })) || [],
      );
      setGlobalAdjustmentPct(note.globalAdjustmentPct ?? 0);
    } else {
      reset({
        customerName: "",
        customerAddress: "",
        customerPhone: "",
        issueDate: new Date().toISOString().split("T")[0],
        paidAmount: undefined,
        notes: "",
      });
      setPhoneNumber("");
      setItems([]);
      setClientSearch("");
      setGlobalAdjustmentPct(0);

      if (initialClientId) {
        setClientMode("existing");
        setSelectedClientId(initialClientId);
      } else {
        setClientMode("new");
        setSelectedClientId(null);
      }
    }
  }, [note, open, initialClientId, setValue, reset]);

  const handleAddProduct = async (product: { id?: string; listId?: string; code: string; name: string; price: number; priceColumnKeyUsed?: string | null }) => {
    const normalizedCode = String(product.code || "SIN-CODIGO").trim();

    const productId = product.id;
    if (productId) {
      const availableForEdit = await getAvailableForEdit(productId);
      const currentQuantity = itemsRef.current
        .filter((i) => i.productId === productId || (!i.productId && i.productCode === normalizedCode))
        .reduce((sum, i) => sum + i.quantity, 0);

      if (availableForEdit <= 0 || currentQuantity >= availableForEdit) {
        toast.error(`Stock insuficiente: solo hay ${availableForEdit} unidades disponibles`);
        return;
      }
    }

    setItems((prev) => {
      const existingItem = prev.find((i) => {
        const sameProduct = productId
          ? i.productId === productId || (!i.productId && i.productCode === normalizedCode)
          : i.productCode === normalizedCode;
        // También verificar que tenga la misma columna de precio para no mezclar
        const samePriceColumn = i.priceColumnKeyUsed === product.priceColumnKeyUsed;
        return sameProduct && samePrice(i.unitPrice, product.price) && samePriceColumn;
      });

      if (existingItem) {
        return prev.map((i) => (i.lineId === existingItem.lineId ? { ...i, quantity: i.quantity + 1 } : i));
      }

      return [
        ...prev,
        {
          lineId: createLineId(),
          productId,
          productCode: normalizedCode,
          productName: product.name,
          quantity: 1,
          unitPrice: product.price,
          adjustmentPct: 0,
          productListId: product.listId,
          priceColumnKeyUsed: product.priceColumnKeyUsed,
        },
      ];
    });
  };

  const handleRemoveItem = (lineId: string) => {
    if (items.length === 1) {
      toast.warning("Debes mantener al menos un producto en el remito");
      return;
    }
    setItems((prev) => prev.filter((i) => i.lineId !== lineId));
  };

  const handleDecrementQuantity = (lineId: string) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.lineId !== lineId) return i;
        const nextQty = i.quantity - 1;
        if (nextQty < 1) return i;
        return { ...i, quantity: nextQty };
      }),
    );
  };

  const handleIncrementAtCurrentPrice = async (lineId: string) => {
    const currentItems = itemsRef.current;
    const baseLine = currentItems.find((i) => i.lineId === lineId);
    if (!baseLine) return;

    const resolvedProductId = baseLine.productId ?? (await resolveProductIdByCode(baseLine.productCode));

    // Verificar stock disponible
    if (resolvedProductId) {
      const availableForEdit = await getAvailableForEdit(resolvedProductId);
      const currentTotalQuantity = currentItems
        .filter((i) => i.productId === resolvedProductId || (!i.productId && i.productCode === baseLine.productCode))
        .reduce((sum, i) => sum + i.quantity, 0);

      if (currentTotalQuantity + 1 > availableForEdit) {
        toast.error(`Stock insuficiente: solo hay ${availableForEdit} unidades disponibles`);
        return;
      }
    }

    // Simplemente incrementar la cantidad del item existente
    // La detección de "precio antiguo" se maneja con isOldPriceItem (basado en columnas)
    setItems((prev) =>
      prev.map((i) => (i.lineId === lineId ? { ...i, quantity: i.quantity + 1 } : i))
    );
  };

  const getAdjustedUnitPrice = (item: CartItem) => applyPercentageAdjustment(item.unitPrice, item.adjustmentPct);

  const calculateItemsSubtotal = () =>
    items.reduce((sum, item) => sum + item.quantity * getAdjustedUnitPrice(item), 0);

  const calculateTotal = () => applyPercentageAdjustment(calculateItemsSubtotal(), globalAdjustmentPct);

  const onSubmit = async (data: any) => {
    if (items.length === 0) {
      toast.error("Debes agregar al menos un producto");
      return;
    }

    const stockErrors: string[] = [];
    const quantitiesByProductId = new Map<string, { productName: string; quantity: number }>();

    for (const item of items) {
      if (!item.productId) continue;
      const existing = quantitiesByProductId.get(item.productId);
      if (existing) existing.quantity += item.quantity;
      else quantitiesByProductId.set(item.productId, { productName: item.productName, quantity: item.quantity });
    }

    for (const [productId, { productName, quantity }] of quantitiesByProductId) {
      const availableForEdit = await getAvailableForEdit(productId);
      if (quantity > availableForEdit) {
        stockErrors.push(`${productName}: necesitas ${quantity} pero solo hay ${availableForEdit}`);
      }
    }

    if (stockErrors.length > 0) {
      toast.error("Stock insuficiente", { description: stockErrors.join("\n") });
      return;
    }

    const baseInput: CreateDeliveryNoteInput = {
      customerName: data.customerName,
      customerAddress: data.customerAddress,
      customerPhone: data.customerPhone,
      issueDate: data.issueDate || new Date().toISOString(),
      paidAmount: data.paidAmount || 0,
      notes: data.notes,
      globalAdjustmentPct,
      items: items.map((item) => ({
        productId: item.productId,
        productCode: item.productCode,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        unitPriceBase: item.unitPrice,
        adjustmentPct: item.adjustmentPct ?? 0,
        productListId: item.productListId,
        priceColumnKeyUsed: item.priceColumnKeyUsed,
      })),
    };

    const isEditing = !!note;
    let resolvedClientId: string | null = note?.clientId ?? null;
    let resolvedName = data.customerName;
    let resolvedPhone = data.customerPhone;
    let resolvedAddress = data.customerAddress;

    try {
      setIsSubmitting(true);

      if (clientMode === "existing") {
        const fallbackClientId = selectedClient?.id || note?.clientId || null;
        if (!fallbackClientId) {
          toast.error("Debes seleccionar un cliente existente");
          setIsSubmitting(false);
          return;
        }

        resolvedClientId = fallbackClientId;
        resolvedName = selectedClient?.name || resolvedName;
        resolvedPhone = selectedClient?.phone || resolvedPhone;
        resolvedAddress = selectedClient?.address || resolvedAddress;
      } else if (!isEditing) {
        const createdClient = await createClient({
          name: data.customerName,
          phone: data.customerPhone || null,
          address: data.customerAddress || null,
        });

        resolvedClientId = createdClient.id;
        resolvedName = createdClient.name;
        resolvedPhone = createdClient.phone || resolvedPhone;
        resolvedAddress = createdClient.address || resolvedAddress;
      }

      const finalInput: CreateDeliveryNoteInput = {
        ...baseInput,
        clientId: resolvedClientId,
        customerName: resolvedName,
        customerAddress: resolvedAddress,
        customerPhone: resolvedPhone,
        items,
      };

      if (note) await updateDeliveryNote({ id: note.id, ...finalInput });
      else await createDeliveryNote(finalInput);

      onOpenChange(false);
      reset();
      setPhoneNumber("");
      setItems([]);
    } catch (error) {
      console.error("Error saving delivery note:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoadingNote) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={
            isMobile
              ? "w-screen h-[100dvh] max-w-none max-h-none rounded-none p-0 overflow-y-auto"
              : "max-w-6xl min-h-[80vh] max-h-[90vh] overflow-y-auto"
          }
        >
          {isMobile ? (
            <>
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-4 py-3">
                <Button type="button" variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <span className="text-base font-semibold">Cargando remito...</span>
              </div>
              <div className="flex items-center justify-center h-64 px-4">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Cargando remito...</DialogTitle>
              </DialogHeader>
              <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          isMobile
            ? "w-screen h-[100dvh] max-w-none max-h-none rounded-none p-0 overflow-y-auto"
            : "max-w-6xl min-h-[80vh] max-h-[90vh] overflow-y-auto"
        }
      >
        {isMobile ? (
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-4 py-3">
            <Button type="button" variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <span className="text-base font-semibold">{note ? "Editar Remito" : "Nuevo Remito"}</span>
          </div>
        ) : (
          <DialogHeader>
            <DialogTitle>{note ? "Editar Remito" : "Nuevo Remito"}</DialogTitle>
          </DialogHeader>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className={isMobile ? "space-y-6 px-4 pb-6 pt-4" : "space-y-6"}>
          <div className="space-y-3">
            <Label>Cliente</Label>
            <Tabs value={clientMode} onValueChange={(value) => setClientMode(value as "new" | "existing")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="new" disabled={!!note?.clientId}>
                  Nuevo
                </TabsTrigger>
                <TabsTrigger value="existing">Existente</TabsTrigger>
              </TabsList>
            </Tabs>

            {clientMode === "existing" && (
              <div className="space-y-2">
                {selectedClient ? (
                  <div className="flex items-start justify-between gap-4 rounded-md border p-3">
                    <div>
                      <p className="text-sm font-medium">{selectedClient.name}</p>
                      {selectedClient.phone && (
                        <p className="text-xs text-muted-foreground">Tel: {selectedClient.phone}</p>
                      )}
                      {selectedClient.address && (
                        <p className="text-xs text-muted-foreground">Dir: {selectedClient.address}</p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedClientId(null);
                        setClientSearch("");
                      }}
                    >
                      Cambiar
                    </Button>
                  </div>
                ) : (
                  <>
                    <Input
                      placeholder="Buscar cliente por nombre o telefono..."
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                    />
                    {clientSearch.trim().length >= 2 && (
                      <div className="border rounded-md max-h-48 overflow-y-auto divide-y">
                        {filteredClients.length === 0 ? (
                          <p className="p-3 text-sm text-muted-foreground">No se encontraron clientes</p>
                        ) : (
                          filteredClients.map((client) => (
                            <button
                              key={client.id}
                              type="button"
                              onClick={() => {
                                setSelectedClientId(client.id);
                                setClientSearch("");
                              }}
                              className="w-full text-left p-3 hover:bg-accent transition-colors"
                            >
                              <p className="text-sm font-medium">{client.name}</p>
                              {client.phone && (
                                <p className="text-xs text-muted-foreground">Tel: {client.phone}</p>
                              )}
                              {client.address && (
                                <p className="text-xs text-muted-foreground">Dir: {client.address}</p>
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="customerName">Nombre del Cliente *</Label>
  <Input
    id="customerName"
    readOnly={lockCustomerFields}
    className={lockCustomerFields ? "bg-muted" : ""}
    {...register("customerName")}
  />
  {
    errors.customerName && (
      <p className="text-sm text-red-500">{errors.customerName.message as string}</p>
    )
  }
            </div >
  <div>
    <Label htmlFor="customerPhone">Teléfono (WhatsApp)</Label>
    <div className="flex gap-2">
      <div className="flex items-center bg-muted px-3 rounded-md border">
        <span className="text-sm font-medium">+54</span>
      </div>
      <Input
        id="customerPhone"
        placeholder="1112345678"
        type="tel"
        maxLength={10}
        value={phoneNumber.replace("+54", "")}
        readOnly={lockCustomerFields}
        className={lockCustomerFields ? "bg-muted" : ""}
        onChange={(e) => {
          if (lockCustomerFields) return;
          const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
          const fullNumber = digits ? `+54${digits}` : "";
          setPhoneNumber(fullNumber);
          setValue("customerPhone", fullNumber);
        }}
      />
      <input type="hidden" {...register("customerPhone")} />
    </div>
    {errors.customerPhone && <p className="text-sm text-red-500">{errors.customerPhone.message as string}</p>}
  </div>
          </div >

          <div>
            <Label htmlFor="customerAddress">Dirección</Label>
            <Input
              id="customerAddress"
              readOnly={lockCustomerFields}
              className={lockCustomerFields ? "bg-muted" : ""}
              {...register("customerAddress")}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="issueDate">Fecha de Emisión *</Label>
              <Input type="date" id="issueDate" {...register("issueDate")} />
              {errors.issueDate && <p className="text-sm text-red-500">{errors.issueDate.message as string}</p>}
            </div>
            <div>
              <Label htmlFor="paidAmount">Monto Pagado</Label>
              <Controller
                control={control}
                name="paidAmount"
                render={({ field }) => (
                  <Input
                    type="number"
                    step="0.01"
                    id="paidAmount"
                    value={field.value ?? ""}
                    onChange={(e) => {
                      const next = e.target.value;
                      field.onChange(next === "" ? undefined : Number(next));
                    }}
                  />
                )}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="notes">Notas</Label>
            <Textarea id="notes" {...register("notes")} rows={3} />
          </div>

          <div>
            <Label>Agregar Productos</Label>
            <DeliveryNoteProductSearch onSelect={handleAddProduct} />
          </div>

{
  items.length > 0 && (
    <div className="space-y-2">
      <Label>Productos Seleccionados</Label>
      <div className="border rounded-lg divide-y">
        {items.map((item) => {
          const adjustedUnitPrice = getAdjustedUnitPrice(item);
          const lineSubtotal = adjustedUnitPrice * item.quantity;
          return (
            <div key={item.lineId} className="p-3 flex justify-between items-center">
              <div className="flex-1">
                <p className="font-medium">{item.productName}</p>
                <p className="text-sm text-muted-foreground">
                  C?digo: {item.productCode} | {formatARS(adjustedUnitPrice)} c/u
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex flex-col md:flex-row items-center gap-2 md:gap-6">
                  <div className="flex items-center">
                    <span
                      className="inline-flex"
                      onClick={() => {
                        if (isOldPriceItem(item)) showOldPriceToast();
                      }}
                    >
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isOldPriceItem(item)}
                        className={isOldPriceItem(item) ? "pointer-events-none" : undefined}
                        onClick={() => handleDecrementQuantity(item.lineId)}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                    </span>
                    <span className="w-12 text-center">{item.quantity}</span>
                    <span
                      className="inline-flex"
                      onClick={() => {
                        if (isOldPriceItem(item)) showOldPriceToast();
                      }}
                    >
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isOldPriceItem(item)}
                        className={isOldPriceItem(item) ? "pointer-events-none" : undefined}
                        onClick={() => handleIncrementAtCurrentPrice(item.lineId)}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">Ajuste %</Label>
                    <Input
                      type="number"
                      value={item.adjustmentPct ?? 0}
                      onChange={(e) => {
                        const next = Number(e.target.value || 0);
                        setItems((prev) =>
                          prev.map((i) => (i.lineId === item.lineId ? { ...i, adjustmentPct: next } : i)),
                        );
                      }}
                      className="w-16 h-8 text-xs"
                    />
                  </div>
                  <span className="w-28 text-right font-medium whitespace-nowrap">
                    {formatARS(lineSubtotal)}
                  </span>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => handleRemoveItem(item.lineId)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t">
        <div className="flex items-center gap-2">
          <Label className="text-sm">Ajuste global (%)</Label>
          <Input
            type="number"
            value={globalAdjustmentPct}
            onChange={(e) => setGlobalAdjustmentPct(Number(e.target.value || 0))}
            className="w-20 h-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-4">
          <span className="text-lg font-semibold">Total:</span>
          <span className="text-2xl font-bold text-primary">{formatARS(calculateTotal())}</span>
        </div>
      </div>
    </div>
  )
}


<div className="flex justify-end gap-2">
  <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
    Cancelar
  </Button>
  <Button type="submit" disabled={isSubmitting}>
    {isSubmitting ? (
      <>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {note ? "Actualizando..." : "Creando..."}
      </>
    ) : note ? (
      "Actualizar Remito"
    ) : (
      "Crear Remito"
    )}
  </Button>
</div>
        </form >
      </DialogContent >
    </Dialog >
  );
};

export default DeliveryNoteDialog;
