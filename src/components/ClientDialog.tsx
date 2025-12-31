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
}

const ClientDialog = ({ open, onOpenChange, client }: ClientDialogProps) => {
  const { updateClient } = useDeliveryClients();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");

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
    if (!open || !client) return;
    reset({
      name: client.name,
      phone: client.phone || "",
      address: client.address || "",
    });
    setPhoneNumber(client.phone || "");
  }, [client, open, reset]);

  const onSubmit = async (data: any) => {
    if (!client) return;

    try {
      setIsSubmitting(true);
      await updateClient({
        ...client,
        name: data.name,
        phone: data.phone || "",
        address: data.address || "",
      });
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!client) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar cliente</DialogTitle>
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
                  Guardando...
                </>
              ) : (
                "Guardar cambios"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ClientDialog;
