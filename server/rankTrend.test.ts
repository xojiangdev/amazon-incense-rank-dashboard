import { describe, expect, it } from "vitest";
import { buildDateWindow, buildSevenDayRankTrend, chartRank, dateKeyInTimeZone } from "../shared/rankTrend";

describe("seven-day organic rank trends", () => {
  it("builds a seven-calendar-day window ending on the anchor date", () => {
    expect(buildDateWindow("2026-09-21", 7)).toEqual([
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
      "2026-09-21",
    ]);
  });

  it("keeps missing days empty and averages only real snapshots", () => {
    const trend = buildSevenDayRankTrend({
      anchorDate: "2026-09-21",
      keywordIds: [1, 2],
      snapshots: [
        { keywordId: 1, snapshotDate: "2026-09-20", rank: 10 },
        { keywordId: 2, snapshotDate: "2026-09-20", rank: 20 },
        { keywordId: 1, snapshotDate: "2026-09-21", rank: 999 },
        { keywordId: 2, snapshotDate: "2026-09-21", rank: 30 },
      ],
    });
    expect(trend.slice(-3)).toEqual([
      { date: "2026-09-19", label: "09/19", rank: null, observedCount: 0 },
      { date: "2026-09-20", label: "09/20", rank: 15, observedCount: 2 },
      { date: "2026-09-21", label: "09/21", rank: 45.5, observedCount: 2 },
    ]);
  });

  it("supports an individual keyword series and maps outside top three pages to 61", () => {
    const trend = buildSevenDayRankTrend({
      anchorDate: "2026-09-21",
      keywordIds: [1, 2],
      selectedKeywordId: 1,
      snapshots: [
        { keywordId: 1, snapshotDate: "2026-09-20", rank: 18 },
        { keywordId: 1, snapshotDate: "2026-09-21", rank: 999 },
        { keywordId: 2, snapshotDate: "2026-09-21", rank: 4 },
      ],
    });
    expect(trend.at(-2)?.rank).toBe(18);
    expect(trend.at(-1)?.rank).toBe(61);
    expect(chartRank(999)).toBe(61);
  });

  it("derives a Beijing calendar date without relying on the browser locale", () => {
    expect(dateKeyInTimeZone(new Date("2026-09-20T16:30:00Z"), "Asia/Shanghai")).toBe("2026-09-21");
  });
});
