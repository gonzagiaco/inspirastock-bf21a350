-- Agregar columna client_id a delivery_notes con FK a clients
ALTER TABLE public.delivery_notes
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL;

-- Crear índice para mejorar performance de consultas por cliente
CREATE INDEX IF NOT EXISTS idx_delivery_notes_client_id ON public.delivery_notes(client_id);