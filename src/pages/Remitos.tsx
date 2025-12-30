import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import { useToast } from "@/hooks/use-toast";
import DeliveryNoteDialog from "@/components/DeliveryNoteDialog";
import { generateDeliveryNotePDF } from "@/utils/deliveryNotePdfGenerator";
import { uploadDeliveryNotePDF } from "@/services/pdfStorageService";
import { Plus, Download, MessageCircle, Trash2, CheckCircle, Edit, Loader2, Receipt, X } from "lucide-react";
import { format } from "date-fns";
import { formatARS } from "@/utils/numberParser";
import { DeliveryNote } from "@/types";
import Header from "@/components/Header";

const getItemSubtotal = (item: any) => Number(item.quantity) * Number(item.unitPrice);

const buildNoteForOutput = (note: DeliveryNote): DeliveryNote => {
  const items = (note.items || []).map((item: any) => ({
    ...item,
    subtotal: getItemSubtotal(item),
  }));

  const totalAmount = items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
  const paidAmount = Number(note.paidAmount || 0);
  const remainingBalance = Math.max(0, totalAmount - paidAmount);

  return { ...note, items, totalAmount, paidAmount, remainingBalance };
};

const Remitos = () => {
  const { deliveryNotes, isLoading, deleteDeliveryNote, markAsPaid, isDeleting } = useDeliveryNotes();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);
  const [isSendingWhatsApp, setIsSendingWhatsApp] = useState<string | null>(null);

  const { data: editingNoteData, isLoading: isLoadingEditNote } = useDeliveryNoteWithItems(
    editingNoteId,
    isDialogOpen && !!editingNoteId,
  );

  useEffect(() => {
    if (!isDialogOpen) setEditingNoteId(null);
  }, [isDialogOpen]);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "paid">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filteredNotes = useMemo(() => {
    return deliveryNotes.filter((note) => {
      const matchesSearch = note.customerName.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === "all" || note.status === statusFilter;

      let matchesDate = true;
      if (dateFrom) matchesDate = matchesDate && new Date(note.issueDate) >= new Date(dateFrom);
      if (dateTo) matchesDate = matchesDate && new Date(note.issueDate) <= new Date(dateTo);

      return matchesSearch && matchesStatus && matchesDate;
    });
  }, [deliveryNotes, searchQuery, statusFilter, dateFrom, dateTo]);

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

  return (
    <div className="p-4 lg:px-4 lg:py-10 flex-1 overflow-auto">
      <div>
        <Header
          title="Remitos de Venta"
          subtitle="Gestiona remitos, descuenta stock automáticamente y comunica con clientes"
          showSearch={false}
          icon={<Receipt className="h-8 w-8" />}
        />
      </div>

      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <Button
            onClick={() => {
              setEditingNoteId(null);
              setIsDialogOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Nuevo Remito
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filtros</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
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
            <div className="space-y-1">
              <span className="text-sm font-medium">Desde</span>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <span className="text-sm font-medium">Hasta</span>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </CardContent>
        </Card>

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

        <DeliveryNoteDialog
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          note={editingNoteData?.note || undefined}
          isLoadingNote={isLoadingEditNote && !!editingNoteId}
        />
      </div>
    </div>
  );
};

export default Remitos;
