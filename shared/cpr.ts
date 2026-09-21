export type CprOrganicResult = {
  rank: number;
  monthlySalesVolume: number | null | undefined;
};

export type CprEstimate = {
  cprEstimate: number | null;
  monthlySalesAverage: number | null;
  sampleCount: number;
  rangeStart: number;
  rangeEnd: number;
  calibration: number;
};

/**
 * SellerSprite-style CPR/SPR proxy: the estimated 8-day natural order volume
 * of the organic products in the middle of page one.
 *
 * CPR = average monthly sales (positions 21–30) / 30 × 8 × calibration.
 * A minimum of five valid sales samples is required; otherwise it remains null.
 */
export function calculateCprEstimate(
  products: CprOrganicResult[],
  options: { rangeStart?: number; rangeEnd?: number; calibration?: number; minSamples?: number } = {}
): CprEstimate {
  const rangeStart = options.rangeStart ?? 21;
  const rangeEnd = options.rangeEnd ?? 30;
  const calibration = options.calibration ?? 1;
  const minSamples = options.minSamples ?? 5;
  if (!Number.isFinite(calibration) || calibration <= 0) throw new Error("CPR calibration must be positive");

  const samples = products
    .filter(item => item.rank >= rangeStart && item.rank <= rangeEnd)
    .map(item => item.monthlySalesVolume)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);

  if (samples.length < minSamples) {
    return { cprEstimate: null, monthlySalesAverage: null, sampleCount: samples.length, rangeStart, rangeEnd, calibration };
  }

  const monthlySalesAverage = Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length);
  const cprEstimate = Math.max(1, Math.round((monthlySalesAverage / 30) * 8 * calibration));
  return { cprEstimate, monthlySalesAverage, sampleCount: samples.length, rangeStart, rangeEnd, calibration };
}

export function normalizeCprKeyword(value: string) {
  return value.trim().normalize("NFKC").toLowerCase();
}
