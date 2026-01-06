import type { MappingConfig } from "@/types/productList";

export const parsePriceValue = (rawValue: unknown): number | null => {
  if (rawValue == null) return null;
  if (typeof rawValue === "number") return Number.isFinite(rawValue) ? rawValue : null;

  const normalized = String(rawValue).trim();
  if (!normalized) return null;

  const cleaned = normalized.replace(/[^0-9.,-]/g, "");
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  let numeric = cleaned;
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      numeric = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      numeric = cleaned.replace(/,/g, "");
    }
  } else if (lastComma !== -1) {
    numeric = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot !== -1) {
    numeric = cleaned.replace(/,/g, "");
  }

  const parsed = parseFloat(numeric);
  return Number.isNaN(parsed) ? null : parsed;
};

type ProductSources = {
  indexRow?: any | null;
  localProductRow?: any | null;
  rpcProduct?: any | null;
};

const resolveBaseValue = (baseKey: string, product: any, sources: ProductSources): number | null => {
  if (baseKey === "price") return parsePriceValue(product?.price ?? sources.indexRow?.price ?? sources.localProductRow?.price);
  if (baseKey === "quantity") return parsePriceValue(product?.quantity ?? sources.indexRow?.quantity ?? sources.localProductRow?.quantity);

  const fromRpcCalculated =
    sources.rpcProduct?.calculated_data?.[baseKey] != null ? parsePriceValue(sources.rpcProduct.calculated_data[baseKey]) : null;
  const fromIndexCalculated =
    sources.indexRow?.calculated_data?.[baseKey] != null ? parsePriceValue(sources.indexRow.calculated_data[baseKey]) : null;
  const fromRpcRaw =
    sources.rpcProduct?.dynamic_products?.data?.[baseKey] != null
      ? parsePriceValue(sources.rpcProduct.dynamic_products.data[baseKey])
      : sources.rpcProduct?.data?.[baseKey] != null
        ? parsePriceValue(sources.rpcProduct.data[baseKey])
        : null;
  const fromLocalData =
    sources.localProductRow?.data?.[baseKey] != null ? parsePriceValue(sources.localProductRow.data[baseKey]) : null;

  return fromRpcCalculated ?? fromIndexCalculated ?? fromRpcRaw ?? fromLocalData ?? null;
};

/**
 * Obtiene el precio sin conversión FX para comparación de "precio antiguo".
 * Si hay conversión activa, devuelve el valor original (USD).
 */
const getUnconvertedPrice = (
  priceColumnKey: string,
  mappingConfig: MappingConfig | undefined,
  sources: ProductSources,
): number | null => {
  const isPrimary =
    priceColumnKey === "price" || priceColumnKey === mappingConfig?.price_primary_key;

  const fxOrigKey = isPrimary
    ? "__fx_usd_ars__orig__price"
    : `__fx_usd_ars__orig__${priceColumnKey}`;

  const fromIndexOrig = sources.indexRow?.calculated_data?.[fxOrigKey];
  if (fromIndexOrig != null) return parsePriceValue(fromIndexOrig);

  return null;
};

export interface ResolvedDeliveryNotePrice {
  /** Precio actual (puede estar en ARS si hay conversión activa) */
  current: number | null;
  /** Precio para comparación de "precio antiguo" (USD original si hay conversión) */
  forComparison: number | null;
}

export const resolveDeliveryNoteUnitPrice = async (
  priceColumnKey: string | null | undefined,
  mappingConfig: MappingConfig | undefined,
  product: any,
  sources: ProductSources,
): Promise<ResolvedDeliveryNotePrice> => {
  const primaryFallback = parsePriceValue(product?.price ?? sources.indexRow?.price ?? sources.localProductRow?.price);
  
  const resolveCurrentPrice = async (): Promise<number | null> => {
    if (!mappingConfig) return primaryFallback;
    if (!priceColumnKey) return primaryFallback;

    const direct =
      (sources.rpcProduct?.calculated_data?.[priceColumnKey] != null
        ? parsePriceValue(sources.rpcProduct.calculated_data[priceColumnKey])
        : null) ??
      (sources.indexRow?.calculated_data?.[priceColumnKey] != null
        ? parsePriceValue(sources.indexRow.calculated_data[priceColumnKey])
        : null) ??
      (sources.rpcProduct?.dynamic_products?.data?.[priceColumnKey] != null
        ? parsePriceValue(sources.rpcProduct.dynamic_products.data[priceColumnKey])
        : sources.rpcProduct?.data?.[priceColumnKey] != null
          ? parsePriceValue(sources.rpcProduct.data[priceColumnKey])
          : null) ??
      (sources.localProductRow?.data?.[priceColumnKey] != null ? parsePriceValue(sources.localProductRow.data[priceColumnKey]) : null);

    if (direct != null) return direct;

    if (priceColumnKey === "price" || priceColumnKey === mappingConfig.price_primary_key) {
      return primaryFallback;
    }

    const baseDirect = resolveBaseValue(priceColumnKey, product, sources);
    if (baseDirect != null) return baseDirect;

    if (!mappingConfig.custom_columns?.[priceColumnKey]) return primaryFallback;

    const resolveCustomColumnPrice = async (columnKey: string, depth = 0): Promise<number | null> => {
      if (depth > 8) return null;
      const customFormula = mappingConfig.custom_columns?.[columnKey];
      if (!customFormula?.base_column) return null;

      const baseKey = customFormula.base_column;
      const base = resolveBaseValue(baseKey, product, sources) ?? (await resolveCustomColumnPrice(baseKey, depth + 1));
      if (base == null) return null;

      const percentage = Number(customFormula.percentage ?? 0);
      const addVat = Boolean(customFormula.add_vat);
      const vatRate = Number(customFormula.vat_rate ?? 0);

      let computed = base * (1 + percentage / 100);
      if (addVat) computed = computed * (1 + vatRate / 100);
      return computed;
    };

    return (await resolveCustomColumnPrice(priceColumnKey)) ?? primaryFallback;
  };

  const current = await resolveCurrentPrice();
  const unconverted = getUnconvertedPrice(priceColumnKey || "price", mappingConfig, sources);

  return {
    current,
    forComparison: unconverted ?? current,
  };
};
