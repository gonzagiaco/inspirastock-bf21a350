import { supabase } from "@/integrations/supabase/client";
import { isOnline } from "@/lib/localDB";
import { getDollarLabel, type DollarType } from "@/lib/dollar";
import { notifyDeliveryNotePricesUpdated } from "@/utils/deliveryNoteEvents";

export interface ReconversionResult {
  success: boolean;
  processed: number;
  updated: number;
  skipped: number;
  dollarRate: number;
  dollarType: DollarType;
  error?: string;
}

/**
 * Reconverts all previously converted USD prices using a new dollar type rate.
 * This is called when the user switches between official and blue dollar.
 */
export async function reconvertAllPrices(
  dollarType: DollarType
): Promise<ReconversionResult> {
  if (!isOnline()) {
    return {
      success: false,
      processed: 0,
      updated: 0,
      skipped: 0,
      dollarRate: 0,
      dollarType,
      error: "Reconversión no disponible en modo offline",
    };
  }

  try {
    const { data, error } = await supabase.rpc("bulk_reconvert_usd_ars", {
      p_dollar_type: dollarType,
    });

    if (error) throw error;

    const result = data as any;
    if (result?.success === false) {
      throw new Error(result?.error || "bulk_reconvert_usd_ars failed");
    }

    const updated = Number(result?.updated ?? 0);
    
    // Notify UI components to refresh if any prices were updated
    if (updated > 0) {
      // Emit a global refresh event
      notifyDeliveryNotePricesUpdated({ global: true });
    }

    return {
      success: true,
      processed: Number(result?.processed ?? 0),
      updated,
      skipped: Number(result?.skipped ?? 0),
      dollarRate: Number(result?.dollar_rate ?? 0),
      dollarType: result?.dollar_type === "blue" ? "blue" : "official",
    };
  } catch (error: any) {
    console.error("Error reconverting prices:", error);
    return {
      success: false,
      processed: 0,
      updated: 0,
      skipped: 0,
      dollarRate: 0,
      dollarType,
      error: error?.message || "Error desconocido",
    };
  }
}
