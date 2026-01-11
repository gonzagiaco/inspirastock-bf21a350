import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2 } from "lucide-react";
import { DeliveryClient } from "@/types";
import { useDeliveryClients } from "@/hooks/useDeliveryClients";

const clientSchema = z.object({
  name: z.string().min(1, "Nombre requerido").max(100),
  phone: z.string().optional(),
  address: z.string().max(200).optional(),
});

interface ClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client?: DeliveryClient;
  mode?: "create" | "edit";
}

const ClientDialog = ({ open, onOpenChange, client, mode }: ClientDialogProps) => {
  const { createClient, updateClient } = useDeliveryClients();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const resolvedMode = mode ?? (client ? "edit" : "create");
  const isEditing = resolvedMode === "edit";

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
  } = useForm({
    resolver: zodResolver(clientSchema),
  });

  useEffect(() => {
    if (!open) return;
    if (isEditing && client) {
      reset({
        name: client.name,
        phone: client.phone || "",
        address: client.address || "",
      });
      setPhoneNumber(client.phone || "");
      return;
    }

    reset({
      name: "",
      phone: "",
      address: "",
    });
    setPhoneNumber("");
  }, [client, isEditing, open, reset]);

  const onSubmit = async (data: any) => {
    try {
      setIsSubmitting(true);
      if (isEditing) {
        if (!client) return;
        await updateClient({
          ...client,
          name: data.name,
          phone: data.phone || "",
          address: data.address || "",
        });
      } else {
        await createClient({
          name: data.name,
          phone: data.phone || "",
          address: data.address || "",
        });
      }
      onOpenChange(false);
      reset({
        name: "",
        phone: "",
        address: "",
      });
      setPhoneNumber("");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isEditing && !client) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Editar cliente" : "Nuevo cliente"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="clientName">Nombre *</Label>
            <Input id="clientName" {...register("name")} />
            {errors.name && <p className="text-sm text-red-500">{errors.name.message as string}</p>}
          </div>

          <div>
            <Label htmlFor="clientPhone">Telefono</Label>
            <div className="flex gap-2">
              <div className="flex items-center bg-muted px-3 rounded-md border">
                <span className="text-sm font-medium">+54</span>
              </div>
              <Input
                id="clientPhone"
                placeholder="1112345678"
                type="tel"
                maxLength={10}
                value={phoneNumber.replace("+54", "")}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                  const fullNumber = digits ? `+54${digits}` : "";
                  setPhoneNumber(fullNumber);
                  setValue("phone", fullNumber);
                }}
              />
            </div>
            {errors.phone && <p className="text-sm text-red-500">{errors.phone.message as string}</p>}
          </div>

          <div>
            <Label htmlFor="clientAddress">Direccion</Label>
            <Input id="clientAddress" {...register("address")} />
            {errors.address && <p className="text-sm text-red-500">{errors.address.message as string}</p>}
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isEditing ? "Guardando..." : "Creando..."}
                </>
              ) : (
                isEditing ? "Guardar cambios" : "Crear cliente"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ClientDialog;
