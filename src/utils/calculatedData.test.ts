import { describe, it, expect } from "vitest";
import { normalizeRawPrice } from "./numberParser";

function calculatePriceWithModifiers(
  baseValue: any,
  percentage = 0,
  addVat = false,
  vatRate = 21,
): number | null {
  const parsed = normalizeRawPrice(baseValue);
  if (parsed === null) return null;
  let result = parsed * (1 + (percentage || 0) / 100);
  if (addVat) result = result * (1 + (vatRate || 0) / 100);
  return Number(result.toFixed(2));
}

function applyDollarConversion(basePrice: number | null, dollarRate: number | null) {
  if (basePrice === null || dollarRate === null || dollarRate === 0) return basePrice;
  return Number((basePrice * dollarRate).toFixed(2));
}

describe("calculated_data logic (JS mirror of SQL)", () => {
  it("applies override modifiers without conversion when not in target_columns", () => {
    const base = "100"; // string price
    const override = { percentage: 10, add_vat: true, vat_rate: 21 };

    const afterModifiers = calculatePriceWithModifiers(base, override.percentage, override.add_vat, override.vat_rate);
    expect(afterModifiers).toBeCloseTo(133.1, 2); // 100 * 1.1 * 1.21 = 133.1

    const final = applyDollarConversion(afterModifiers, 0); // no conversion
    expect(final).toBeCloseTo(133.1, 2);
  });

  it("applies override modifiers AND conversion when column is in target_columns", () => {
    const base = "100";
    const override = { percentage: 10, add_vat: true, vat_rate: 21 };
    const dollarRate = 350;

    const afterModifiers = calculatePriceWithModifiers(base, override.percentage, override.add_vat, override.vat_rate);
    expect(afterModifiers).toBeCloseTo(133.1, 2);

    const converted = applyDollarConversion(afterModifiers, dollarRate);
    expect(converted).toBeCloseTo(133.1 * 350, 2); // 46585.00
  });

  it("applies only conversion when column is target but has no override", () => {
    const base = "100";
    const dollarRate = 350;

    const parsed = normalizeRawPrice(base);
    expect(parsed).toBeCloseTo(100, 2);

    const converted = applyDollarConversion(parsed, dollarRate);
    expect(converted).toBeCloseTo(100 * 350, 2);
  });

  it("returns null when base value cannot be parsed", () => {
    const after = calculatePriceWithModifiers("not a number", 10, true, 21);
    expect(after).toBeNull();
    const converted = applyDollarConversion(after, 350);
    expect(converted).toBeNull();
  });
});
