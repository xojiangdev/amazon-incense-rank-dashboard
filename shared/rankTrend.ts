export type RankTrendSnapshot = {
  keywordId: number;
  snapshotDate: string;
  rank: number;
};

export type RankTrendPoint = {
  date: string;
  label: string;
  rank: number | null;
  observedCount: number;
};

export function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function buildDateWindow(anchorDate: string, days: number): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) throw new Error("anchorDate must use YYYY-MM-DD");
  if (!Number.isInteger(days) || days < 1) throw new Error("days must be a positive integer");
  const anchor = new Date(`${anchorDate}T12:00:00Z`);
  if (Number.isNaN(anchor.getTime())) throw new Error("anchorDate is invalid");
  return Array.from({ length: days }, (_, index) => {
    const value = new Date(anchor);
    value.setUTCDate(anchor.getUTCDate() - (days - 1 - index));
    return value.toISOString().slice(0, 10);
  });
}

export function chartRank(rank: number): number {
  return rank === 999 ? 61 : rank;
}

export function buildSevenDayRankTrend(input: {
  snapshots: RankTrendSnapshot[];
  keywordIds: number[];
  selectedKeywordId?: number;
  anchorDate: string;
}): RankTrendPoint[] {
  const dates = buildDateWindow(input.anchorDate, 7);
  const keywordSet = new Set(input.keywordIds);
  return dates.map(date => {
    const rows = input.snapshots.filter(snapshot => {
      if (snapshot.snapshotDate !== date) return false;
      if (!keywordSet.has(snapshot.keywordId)) return false;
      return input.selectedKeywordId === undefined || snapshot.keywordId === input.selectedKeywordId;
    });
    const ranks = rows.map(row => chartRank(row.rank));
    const rank = ranks.length ? Number((ranks.reduce((sum, value) => sum + value, 0) / ranks.length).toFixed(1)) : null;
    return {
      date,
      label: date.slice(5).replace("-", "/"),
      rank,
      observedCount: rows.length,
    };
  });
}
