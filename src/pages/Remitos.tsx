import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Tooltip, 
  TooltipContent, 
  TooltipProvider, 
  TooltipTrigger 
} from "@/components/ui/tooltip";
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
import { useDeliveryNotes } from "@/hooks/useDeliveryNotes";
import { useDeliveryNoteWithItems } from "@/hooks/useDeliveryNoteWithItems";
import { useDeliveryClients } from "@/hooks/useDeliveryClients";
import { useToast } from "@/hooks/use-toast";
import DeliveryNoteDialog from "@/components/DeliveryNoteDialog";
import ClientDialog from "@/components/ClientDialog";
import { generateDeliveryNotePDF } from "@/utils/deliveryNotePdfGenerator";
import { uploadDeliveryNotePDF } from "@/services/pdfStorageService";
import { Plus, Download, MessageCircle, Trash2, CheckCircle, Edit, Loader2, Receipt, X, Users, History, UserPlus } from "lucide-react";
import { format } from "date-fns";
import { formatARS } from "@/utils/numberParser";
import { DeliveryClient, DeliveryNote } from "@/types";
import { applyPercentageAdjustment } from "@/utils/deliveryNotePricing";
import Header from "@/components/Header";

const getItemSubtotal = (item: any) => Number(item.quantity) * Number(item.unitPrice);

const getNoteTotal = (note: DeliveryNote) => {
  if (note.items?.length) {
    const itemsSubtotal = note.items.reduce((sum, item) => sum + Number(item.subtotal ?? getItemSubtotal(item)), 0);
    return applyPercentageAdjustment(itemsSubtotal, note.globalAdjustmentPct ?? 0);
  }

  const totalAmount = Number(note.totalAmount || 0);
  if (Number.isFinite(totalAmount) && totalAmount > 0) return totalAmount;

  const paidAmount = Number(note.paidAmount || 0);
  const remainingBalance = Number(note.remainingBalance || 0);
  const derivedTotal = paidAmount + remainingBalance;

  return Number.isFinite(derivedTotal) && derivedTotal > 0 ? derivedTotal : totalAmount;
};

const getRemainingBalance = (note: DeliveryNote) => {
  const totalAmount = getNoteTotal(note);
  const paidAmount = Number(note.paidAmount || 0);
  return Math.max(0, totalAmount - paidAmount);
};

const buildNoteForOutput = (note: DeliveryNote): DeliveryNote => {
  const items = (note.items || []).map((item: any) => ({
    ...item,
    subtotal: getItemSubtotal(item),
  }));

  const itemsSubtotal = items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
  const totalAmount = items.length
    ? applyPercentageAdjustment(itemsSubtotal, note.globalAdjustmentPct ?? 0)
    : getNoteTotal(note);
  const paidAmount = Number(note.paidAmount || 0);
  const remainingBalance = Math.max(0, totalAmount - paidAmount);

  return { ...note, items, totalAmount, paidAmount, remainingBalance };
};

const Remitos = () => {
  const { deliveryNotes, isLoading, deleteDeliveryNote, markAsPaid, isDeleting } = useDeliveryNotes();
  const { clients, isLoading: isLoadingClients, deleteClient } = useDeliveryClients();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [prefillClientId, setPrefillClientId] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);
  const [isSendingWhatsApp, setIsSendingWhatsApp] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"remitos" | "clientes">("remitos");
  const [clientSearchQuery, setClientSearchQuery] = useState("");
  const [clientFilterId, setClientFilterId] = useState<string | null>(null);
  const [clientToEdit, setClientToEdit] = useState<DeliveryClient | null>(null);
  const [isClientDialogOpen, setIsClientDialogOpen] = useState(false);
  const [isCreateClientDialogOpen, setIsCreateClientDialogOpen] = useState(false);
  const [clientToDelete, setClientToDelete] = useState<DeliveryClient | null>(null);
  const [isDeleteClientDialogOpen, setIsDeleteClientDialogOpen] = useState(false);

  const { data: editingNoteData, isLoading: isLoadingEditNote } = useDeliveryNoteWithItems(
    editingNoteId,
    isDialogOpen && !!editingNoteId,
  );

  useEffect(() => {
    if (!isDialogOpen) {
      setEditingNoteId(null);
      setPrefillClientId(null);
    }
  }, [isDialogOpen]);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "paid">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filteredNotes = deliveryNotes.filter((note) => {
    const matchesSearch = note.customerName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || note.status === statusFilter;
    const matchesClient = !clientFilterId || note.clientId === clientFilterId;

      let matchesDate = true;
      if (dateFrom) matchesDate = matchesDate && new Date(note.issueDate) >= new Date(dateFrom);
      if (dateTo) matchesDate = matchesDate && new Date(note.issueDate) <= new Date(dateTo);

    return matchesSearch && matchesStatus && matchesDate && matchesClient;
  });

  const clientNoteCounts = useMemo(() => {
    const map = new Map<string, number>();
    deliveryNotes.forEach((note) => {
      if (!note.clientId) return;
      map.set(note.clientId, (map.get(note.clientId) || 0) + 1);
    });
    return map;
  }, [deliveryNotes]);

  const clientPendingBalances = useMemo(() => {
    const map = new Map<string, number>();
    deliveryNotes.forEach((note) => {
      if (note.status !== "pending" || !note.clientId) return;
      const remainingBalance = getRemainingBalance(note);
      map.set(note.clientId, (map.get(note.clientId) || 0) + remainingBalance);
    });
    return map;
  }, [deliveryNotes]);

  const totalPendingBalance = useMemo(
    () =>
      deliveryNotes.reduce((sum, note) => {
        if (note.status !== "pending") return sum;
        return sum + getRemainingBalance(note);
      }, 0),
    [deliveryNotes],
  );

  const filteredClients = useMemo(() => {
    const query = clientSearchQuery.trim().toLowerCase();
    if (!query) return clients;
    return clients.filter((client) => {
      const nameMatch = client.name.toLowerCase().includes(query);
      const phoneMatch = (client.phone || "").includes(query);
      const addressMatch = (client.address || "").toLowerCase().includes(query);
      return nameMatch || phoneMatch || addressMatch;
    });
  }, [clients, clientSearchQuery]);

  const selectedClientFilter = useMemo(
    () => clients.find((client) => client.id === clientFilterId) || null,
    [clients, clientFilterId],
  );

  const clientDeleteCount = clientToDelete ? clientNoteCounts.get(clientToDelete.id) || 0 : 0;

  const handleExportPDF = (note: DeliveryNote) => {
    generateDeliveryNotePDF(buildNoteForOutput(note));
  };

  const handleWhatsApp = async (note: DeliveryNote) => {
    setIsSendingWhatsApp(note.id);

    try {
      const outputNote = buildNoteForOutput(note);

      const { url: pdfUrl, error } = await uploadDeliveryNotePDF(outputNote);
      if (error) {
        toast({ title: "Error al generar PDF", description: error, variant: "destructive" });
        setIsSendingWhatsApp(null);
        return;
      }

      const productsList =
        outputNote.items
          ?.map((item, index) => `${index + 1}. ${item.productName} x${item.quantity} - ${formatARS(item.subtotal)}`)
          .join("\n") || "";

      let message =
        `*REMITO*\n\n` +
        `Fecha: ${format(new Date(outputNote.issueDate), "dd/MM/yyyy")}\n` +
        `Cliente: ${outputNote.customerName}\n`;

      if (outputNote.customerAddress) message += `Dirección: ${outputNote.customerAddress}\n`;

      message +=
        `\n*Productos:*\n${productsList}\n\n` +
        `------------------\n` +
        `*Total: ${formatARS(outputNote.totalAmount)}*\n` +
        `Pagado: ${formatARS(outputNote.paidAmount)}\n` +
        `Restante: ${formatARS(outputNote.remainingBalance)}\n` +
        `------------------\n` +
        `Estado: ${outputNote.status === "paid" ? "PAGADO" : "PENDIENTE"}`;

      if (outputNote.notes) message += `\n\nNotas: ${outputNote.notes}`;

      message += `\n\n*Descargar PDF:*\n${pdfUrl}`;
      message += `\n\n_Gracias por su compra_`;

      const encodedMessage = encodeURIComponent(message);
      const phone = outputNote.customerPhone?.replace(/\D/g, "");
      const whatsappUrl = phone ? `https://wa.me/${phone}?text=${encodedMessage}` : `https://wa.me/?text=${encodedMessage}`;

      window.open(whatsappUrl, "_blank");
      toast({ title: "PDF generado", description: "El remito se subió correctamente" });
    } catch (err) {
      toast({ title: "Error", description: "No se pudo generar el PDF para compartir", variant: "destructive" });
    } finally {
      setIsSendingWhatsApp(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!noteToDelete) return;
    await deleteDeliveryNote(noteToDelete);
    setNoteToDelete(null);
    setIsDeleteDialogOpen(false);
  };

  const handleMarkAsPaid = async (id: string) => {
    await markAsPaid(id);
  };

  const handleOpenNewNote = (clientId?: string | null) => {
    setEditingNoteId(null);
    setPrefillClientId(clientId || null);
    setIsDialogOpen(true);
  };

  const handleShowClientHistory = (clientId: string) => {
    setClientFilterId(clientId);
    setActiveTab("remitos");
    setSearchQuery("");
  };

  const handleConfirmDeleteClient = async () => {
    if (!clientToDelete) return;
    await deleteClient(clientToDelete.id);
    setClientToDelete(null);
    setIsDeleteClientDialogOpen(false);
  };

  return (
    <div className="p-4 pt-11 lg:px-4 lg:py-10 flex-1 overflow-auto">
      <div>
        <Header
          title="Remitos de Venta"
          subtitle="Gestiona remitos, descuenta stock automáticamente y comunica con clientes"
          showSearch={false}
          icon={<Receipt className="h-8 w-8" />}
        />
      </div>

      <div className="space-y-6">
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as "remitos" | "clientes")}
          className="space-y-6"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <TabsList className="grid w-full grid-cols-2 lg:w-auto">
              <TabsTrigger value="remitos" className="gap-2">
                <Receipt className="h-4 w-4" />
                Remitos
              </TabsTrigger>
              <TabsTrigger value="clientes" className="gap-2">
                <Users className="h-4 w-4" />
                Clientes
              </TabsTrigger>
            </TabsList>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                className="w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto"
                onClick={() => setIsCreateClientDialogOpen(true)}
              >
                <UserPlus className="mr-2 h-4 w-4" />
                Nuevo Cliente
              </Button>
              <Button className="w-full sm:w-auto" onClick={() => handleOpenNewNote()}>
                <Plus className="mr-2 h-4 w-4" />
                Nuevo Remito
              </Button>
            </div>
          </div>

          <TabsContent value="remitos" className="space-y-6">
            <Card className="relative overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-background to-primary/10">
              <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Deuda total de clientes
                  </p>
                  <p className="text-2xl font-semibold text-foreground">{formatARS(totalPendingBalance)}</p>
                </div>
                
              </CardContent>
            </Card>
            <Card>
          <CardHeader>
            <CardTitle>Filtros</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end min-w-0">
            <div className="space-y-1">
              <span className="text-sm font-medium">Cliente</span>
              <div className="relative">
                <Input
                  placeholder="Buscar por cliente..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pr-10"
                />
                {searchQuery.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7588eb]"
                    aria-label="Limpiar búsqueda"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-sm font-medium">Estado</span>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="pending">Pendientes</SelectItem>
                  <SelectItem value="paid">Pagados</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 min-w-0">
              <span className="text-sm font-medium">Desde</span>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full min-w-0"
              />
            </div>
            <div className="space-y-1 min-w-0">
              <span className="text-sm font-medium">Hasta</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full min-w-0"
              />
            </div>
          </CardContent>
        </Card>

        {clientFilterId && selectedClientFilter && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Cliente: {selectedClientFilter.name}</Badge>
            <Button variant="ghost" size="sm" onClick={() => setClientFilterId(null)}>
              <X className="mr-1 h-4 w-4" />
              Limpiar
            </Button>
          </div>
        )}

        {isLoading ? (
          <p>Cargando remitos...</p>
        ) : filteredNotes.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">No se encontraron remitos.</CardContent>
          </Card>
        ) : (
          <TooltipProvider>
            <div className="grid gap-4">
              {filteredNotes.map((note) => {
                const outputNote = buildNoteForOutput(note);

                return (
                  <Card key={note.id}>
                    <CardContent className="pt-6">
                      <div className="flex flex-col lg:flex-row justify-between items-start gap-4">
                        <div className="space-y-2 flex-1 min-w-0">
                          <div className="flex items-center gap-3">
                            <h3 className="text-lg font-semibold">{note.customerName}</h3>
                            <Badge variant={note.status === "paid" ? "default" : "destructive"}>
                              {note.status === "paid" ? "Pagado" : "Pendiente"}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">Fecha: {format(new Date(note.issueDate), "dd/MM/yyyy")}</p>
                          {note.customerAddress && <p className="text-sm">{note.customerAddress}</p>}
                          {note.customerPhone && <p className="text-sm">Tel: {note.customerPhone}</p>}
                          <div className="flex flex-wrap gap-4 text-sm mt-2">
                            <span>
                              Total: <strong>{formatARS(outputNote.totalAmount)}</strong>
                            </span>
                            <span>
                              Pagado: <strong>{formatARS(outputNote.paidAmount)}</strong>
                            </span>
                            <span>
                              Restante: <strong>{formatARS(outputNote.remainingBalance)}</strong>
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">{note.items?.length || 0} producto(s)</p>
                          {note.notes && (
                            <div className="mt-2 p-2 bg-muted/50 rounded-md">
                              <p className="text-xs font-medium text-muted-foreground">Notas:</p>
                              <p className="text-sm">{note.notes}</p>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2 justify-end items-start">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setEditingNoteId(note.id);
                                  setIsDialogOpen(true);
                                }}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Editar remito</p>
                            </TooltipContent>
                          </Tooltip>

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button size="sm" variant="outline" onClick={() => handleExportPDF(note)}>
                                <Download className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Descargar PDF</p>
                            </TooltipContent>
                          </Tooltip>

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleWhatsApp(note)}
                                disabled={isSendingWhatsApp === note.id}
                              >
                                {isSendingWhatsApp === note.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <MessageCircle className="h-4 w-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{isSendingWhatsApp === note.id ? "Subiendo PDF..." : "Enviar por WhatsApp"}</p>
                            </TooltipContent>
                          </Tooltip>

                          {note.status === "pending" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="sm" variant="outline" onClick={() => handleMarkAsPaid(note.id)}>
                                  <CheckCircle className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Marcar como pagado</p>
                              </TooltipContent>
                            </Tooltip>
                          )}

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={isDeleting}
                                onClick={() => {
                                  setNoteToDelete(note.id);
                                  setIsDeleteDialogOpen(true);
                                }}
                              >
                                {isDeleting && noteToDelete === note.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                                <span className="ml-2 hidden sm:inline">
                                  {isDeleting && noteToDelete === note.id ? "Eliminando..." : "Eliminar"}
                                </span>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Eliminar remito y revertir stock</p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TooltipProvider>
        )}
          </TabsContent>

          <TabsContent value="clientes" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Clientes</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                <div className="space-y-1">
                  <span className="text-sm font-medium">Buscar</span>
                  <div className="relative">
                    <Input
                      placeholder="Buscar por nombre, telefono o direccion..."
                      value={clientSearchQuery}
                      onChange={(e) => setClientSearchQuery(e.target.value)}
                      className="pr-10"
                    />
                    {clientSearchQuery.trim().length > 0 && (
                      <button
                        type="button"
                        onClick={() => setClientSearchQuery("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7588eb]"
                        aria-label="Limpiar busqueda"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-sm text-muted-foreground md:text-right space-y-1">
                  <div>
                    Total: <span className="font-medium text-foreground">{clients.length}</span>
                  </div>
                  <div className="inline-flex items-center justify-end gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    Deuda total: {formatARS(totalPendingBalance)}
                  </div>
                </div>
              </CardContent>
            </Card>

            {isLoadingClients ? (
              <p>Cargando clientes...</p>
            ) : filteredClients.length === 0 ? (
              <Card>
                <CardContent className="pt-6 text-center text-muted-foreground">No se encontraron clientes.</CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {filteredClients.map((client) => (
                  <Card key={client.id}>
                    <CardContent className="pt-6">
                      <div className="flex flex-col lg:flex-row justify-between items-start gap-4">
                        <div className="space-y-1 flex-1 min-w-0">
                          <div className="flex items-center gap-3">
                            <h3 className="text-lg font-semibold">{client.name}</h3>
                            {clientNoteCounts.get(client.id) ? (
                              <Badge variant="secondary">{clientNoteCounts.get(client.id)} remito(s)</Badge>
                            ) : null}
                            <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">
                              Debe {formatARS(clientPendingBalances.get(client.id) || 0)}
                            </Badge>
                          </div>
                          {client.phone && <p className="text-sm">Tel: {client.phone}</p>}
                          {client.address && <p className="text-sm">{client.address}</p>}
                        </div>

                        <div className="flex flex-wrap gap-2 justify-end items-start">
                          <Button size="sm" variant="outline" onClick={() => handleOpenNewNote(client.id)}>
                            <Plus className="h-4 w-4" />
                            <span className="ml-2 hidden sm:inline">Nuevo remito</span>
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleShowClientHistory(client.id)}>
                            <History className="h-4 w-4" />
                            <span className="ml-2 hidden sm:inline">Historial</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setClientToEdit(client);
                              setIsClientDialogOpen(true);
                            }}
                          >
                            <Edit className="h-4 w-4" />
                            <span className="ml-2 hidden sm:inline">Editar</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              setClientToDelete(client);
                              setIsDeleteClientDialogOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="ml-2 hidden sm:inline">Eliminar</span>
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta acción eliminará el remito y revertirá el stock de los productos asociados. Esta operación no se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setNoteToDelete(null)} disabled={isDeleting}>
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isDeleting ? "Eliminando..." : "Eliminar"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={isDeleteClientDialogOpen}
          onOpenChange={(open) => {
            setIsDeleteClientDialogOpen(open);
            if (!open) setClientToDelete(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Eliminar cliente?</AlertDialogTitle>
              <AlertDialogDescription>
                {clientDeleteCount > 0
                  ? `Este cliente tiene ${clientDeleteCount} remito(s). Se mantendran los datos en los remitos, pero quedaran sin cliente asociado.`
                  : "Esta accion eliminara el cliente. Esta operacion no se puede deshacer."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setClientToDelete(null)}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmDeleteClient}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Eliminar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <DeliveryNoteDialog 
          open={isDialogOpen} 
          onOpenChange={setIsDialogOpen} 
          note={editingNoteData?.note || undefined}
          isLoadingNote={isLoadingEditNote && !!editingNoteId}
          initialClientId={prefillClientId}
        />

        <ClientDialog
          open={isClientDialogOpen}
          onOpenChange={(open) => {
            setIsClientDialogOpen(open);
            if (!open) setClientToEdit(null);
          }}
          client={clientToEdit || undefined}
        />

        <ClientDialog
          open={isCreateClientDialogOpen}
          onOpenChange={setIsCreateClientDialogOpen}
          mode="create"
        />
      </div>
    </div>
  );
};

export default Remitos;
