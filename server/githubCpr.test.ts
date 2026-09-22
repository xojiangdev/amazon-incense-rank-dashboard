import { describe, expect, it } from "vitest";
import { parseGitHubCprDocument, isNewerGitHubCprVersion, githubCprSourceVersion } from "../shared/githubCpr";

describe("GitHub CPR feed parser", () => {
  it("parses valid cpr.json documents strictly", () => {
    const parsed = parseGitHubCprDocument({
      meta: {
        generated_at: "2026-09-22T07:15:00.000Z",
        calib: { window_days: 8, model: "serp_sales_sample_v1" },
      },
      data: [
        { keyword: "mugwort incense", cpr: 42, avg_monthly_sales: 157, samples: 8 },
        { keyword: "japanese incense", cpr: 18, avg_monthly_sales: 68, samples: 6 },
      ],
    });

    expect(parsed.generatedAtIso).toBe("2026-09-22T07:15:00.000Z");
    expect(parsed.records).toHaveLength(2);
    expect(parsed.records[0]).toEqual({
      keyword: "mugwort incense",
      normalizedKeyword: "mugwort incense",
      cpr: 42,
      avgMonthlySales: 157,
      samples: 8,
    });
  });

  it("rejects duplicate normalized keywords and fractional values", () => {
    expect(() => parseGitHubCprDocument({
      meta: { generated_at: "2026-09-22T07:15:00.000Z" },
      data: [
        { keyword: "incense burner", cpr: 10, avg_monthly_sales: 40, samples: 5 },
        { keyword: "INCENSE BURNER", cpr: 11, avg_monthly_sales: 44, samples: 5 },
      ],
    })).toThrow(/duplicate keyword/i);

    expect(() => parseGitHubCprDocument({
      meta: { generated_at: "2026-09-22T07:15:00.000Z" },
      data: [
        { keyword: "incense burner", cpr: 10.5, avg_monthly_sales: 40, samples: 5 },
      ],
    })).toThrow(/non-negative integer/i);
  });

  it("determines whether a remote file update time is newer than local state", () => {
    const older = new Date("2026-09-21T23:30:00.000Z");
    const newer = new Date("2026-09-22T00:00:00.000Z");
    const sameSha = "1111111111111111111111111111111111111111";
    const nextSha = "2222222222222222222222222222222222222222";

    expect(isNewerGitHubCprVersion(sameSha, newer, { remoteSha: sameSha, remoteUpdatedAt: older })).toBe(false);
    expect(isNewerGitHubCprVersion(nextSha, older, { remoteSha: sameSha, remoteUpdatedAt: newer })).toBe(false);
    expect(isNewerGitHubCprVersion(nextSha, newer, { remoteSha: sameSha, remoteUpdatedAt: older })).toBe(true);
    expect(isNewerGitHubCprVersion(nextSha, newer, undefined)).toBe(true);
    expect(githubCprSourceVersion(nextSha)).toBe("github_cpr_json:2222222222222222222222222222222222222222");
  });
});
