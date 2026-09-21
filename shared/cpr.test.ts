import { describe, expect, it } from "vitest";
import { calculateCprEstimate } from "./cpr";

describe("calculateCprEstimate", () => {
  it("calculates eight-day CPR from the page-one middle organic sales window", () => {
    const products = Array.from({ length: 10 }, (_, index) => ({
      rank: index + 21,
      monthlySalesVolume: 300,
    }));

    expect(calculateCprEstimate(products)).toMatchObject({
      cprEstimate: 80,
      monthlySalesAverage: 300,
      sampleCount: 10,
      rangeStart: 21,
      rangeEnd: 30,
    });
  });

  it("fails closed when too few organic sales samples are returned", () => {
    expect(calculateCprEstimate([
      { rank: 21, monthlySalesVolume: 300 },
      { rank: 22, monthlySalesVolume: 200 },
      { rank: 23, monthlySalesVolume: null },
    ])).toMatchObject({ cprEstimate: null, monthlySalesAverage: null, sampleCount: 2 });
  });

  it("ignores results outside positions 21 through 30", () => {
    const products = [
      { rank: 20, monthlySalesVolume: 9999 },
      ...Array.from({ length: 5 }, (_, index) => ({ rank: index + 21, monthlySalesVolume: 150 })),
      { rank: 31, monthlySalesVolume: 9999 },
    ];
    expect(calculateCprEstimate(products)).toMatchObject({ cprEstimate: 40, monthlySalesAverage: 150, sampleCount: 5 });
  });
});
