export type DollarType = "official" | "blue";

export const DEFAULT_DOLLAR_TYPE: DollarType = "official";

export const DOLLAR_TYPE_LABELS: Record<DollarType, string> = {
  official: "Dolar oficial",
  blue: "Dolar blue",
};

export const DOLLAR_SETTING_KEYS: Record<DollarType, string> = {
  official: "dollar_official",
  blue: "dollar_blue",
};

export const DOLLAR_API_PATHS: Record<DollarType, string> = {
  official: "oficial",
  blue: "blue",
};

const DOLLAR_TYPE_STORAGE_KEY = "dollar_type";

export const normalizeDollarType = (value: unknown): DollarType =>
  value === "blue" ? "blue" : "official";

export const getDollarLabel = (type: DollarType): string =>
  DOLLAR_TYPE_LABELS[type];

export const getDollarSettingKey = (type: DollarType): string =>
  DOLLAR_SETTING_KEYS[type];

export const getDollarApiPath = (type: DollarType): string =>
  DOLLAR_API_PATHS[type];

export const resolveDollarRate = (value: any): number => {
  const rate = Number(value?.rate ?? value?.venta ?? 0);
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
};

export const getStoredDollarType = (): DollarType => {
  if (typeof window === "undefined") return DEFAULT_DOLLAR_TYPE;
  const stored = window.localStorage.getItem(DOLLAR_TYPE_STORAGE_KEY);
  return normalizeDollarType(stored);
};

export const setStoredDollarType = (type: DollarType): void => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DOLLAR_TYPE_STORAGE_KEY, type);
};
