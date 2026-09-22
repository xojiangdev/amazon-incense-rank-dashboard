export const GITHUB_CPR_OWNER = "xojiangdev";
export const GITHUB_CPR_REPOSITORY = "amazon-incense-rank-dashboard";
export const GITHUB_CPR_BRANCH = "main";
export const GITHUB_CPR_PATH = "data/cpr.json";
export const GITHUB_CPR_SOURCE_KEY = `github:${GITHUB_CPR_OWNER}/${GITHUB_CPR_REPOSITORY}/${GITHUB_CPR_BRANCH}/${GITHUB_CPR_PATH}`;
export const GITHUB_CPR_RAW_URL = `https://raw.githubusercontent.com/${GITHUB_CPR_OWNER}/${GITHUB_CPR_REPOSITORY}/${GITHUB_CPR_BRANCH}/${GITHUB_CPR_PATH}`;

export type GitHubCprRecord = {
  keyword: string;
  normalizedKeyword: string;
  cpr: number;
  avgMonthlySales: number;
  samples: number;
};

export type GitHubCprDocument = {
  generatedAt: Date;
  generatedAtIso: string;
  calibration: string | null;
  records: GitHubCprRecord[];
};

const normalizeKeyword = (value: string) => value.trim().normalize("NFKC").toLowerCase();

const asRecord = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
};

const asNonNegativeInteger = (value: unknown, path: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${path} must be a non-negative integer`);
  }
  return value;
};

/**
 * Validates the repository-owned CPR file without inferring missing values.
 * The application stores integers because its existing CPR and monthly-sales
 * columns are integer fields; fractional source values are rejected rather than rounded.
 */
export function parseGitHubCprDocument(input: unknown): GitHubCprDocument {
  const document = asRecord(input, "cpr.json");
  const meta = asRecord(document.meta, "cpr.json.meta");
  if (typeof meta.generated_at !== "string" || !meta.generated_at.trim()) {
    throw new Error("cpr.json.meta.generated_at must be a non-empty ISO timestamp");
  }
  const generatedAt = new Date(meta.generated_at);
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error("cpr.json.meta.generated_at must be a valid timestamp");
  }
  if (!Array.isArray(document.data) || document.data.length === 0) {
    throw new Error("cpr.json.data must contain at least one CPR record");
  }

  const seen = new Set<string>();
  const records = document.data.map((raw, index) => {
    const row = asRecord(raw, `cpr.json.data[${index}]`);
    if (typeof row.keyword !== "string" || !row.keyword.trim()) {
      throw new Error(`cpr.json.data[${index}].keyword must be a non-empty string`);
    }
    const normalizedKeyword = normalizeKeyword(row.keyword);
    if (seen.has(normalizedKeyword)) {
      throw new Error(`cpr.json.data contains duplicate keyword after normalization: ${row.keyword}`);
    }
    seen.add(normalizedKeyword);
    return {
      keyword: row.keyword.trim(),
      normalizedKeyword,
      cpr: asNonNegativeInteger(row.cpr, `cpr.json.data[${index}].cpr`),
      avgMonthlySales: asNonNegativeInteger(row.avg_monthly_sales, `cpr.json.data[${index}].avg_monthly_sales`),
      samples: asNonNegativeInteger(row.samples, `cpr.json.data[${index}].samples`),
    };
  });

  return {
    generatedAt,
    generatedAtIso: generatedAt.toISOString(),
    calibration: meta.calib === undefined ? null : JSON.stringify(meta.calib),
    records,
  };
}

export function githubCprSourceVersion(remoteSha: string): string {
  return `github_cpr_json:${remoteSha.trim().slice(0, 40)}`;
}

export function isGitHubCprSource(source: string | null | undefined): boolean {
  return Boolean(source?.startsWith("github_cpr_json:"));
}

export function isNewerGitHubCprVersion(
  remoteSha: string,
  remoteUpdatedAt: Date,
  local: { remoteSha: string | null; remoteUpdatedAt: Date | null } | undefined
): boolean {
  if (!local) return true;
  if (local.remoteSha === remoteSha) return false;
  if (!local.remoteUpdatedAt) return true;
  return remoteUpdatedAt.getTime() > local.remoteUpdatedAt.getTime();
}
