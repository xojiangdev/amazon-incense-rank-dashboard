import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { applyGitHubCprDocument, getGitHubCprSyncState, recordGitHubCprSyncFailure } from "./server/db";
import {
  GITHUB_CPR_BRANCH,
  GITHUB_CPR_OWNER,
  GITHUB_CPR_PATH,
  GITHUB_CPR_RAW_URL,
  GITHUB_CPR_REPOSITORY,
  GITHUB_CPR_SOURCE_KEY,
  parseGitHubCprDocument,
} from "./shared/githubCpr";

const execFileAsync = promisify(execFile);

// `gh` can inherit terminal colour settings in manual recovery sessions.
// API payloads must be parsed as plain JSON regardless of those settings.
const stripAnsi = (value: string) => value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
const parseGhJson = <T>(value: string): T => JSON.parse(stripAnsi(value).trim()) as T;

type GitHubFileMetadata = {
  sha: string;
  size: number;
  encoding?: string;
  content?: string;
};

type GitHubCommitMetadata = {
  sha: string;
  date: string;
  message: string;
};

export async function runGitHubCprSync(options: { dryRun?: boolean; force?: boolean } = {}) {
  const repoSlug = `${GITHUB_CPR_OWNER}/${GITHUB_CPR_REPOSITORY}`;
  const sourceUrl = GITHUB_CPR_RAW_URL;
  const sourceKey = GITHUB_CPR_SOURCE_KEY;
  const currentState = await getGitHubCprSyncState(sourceKey);

  try {
    const fileApiOutput = await execFileAsync("gh", [
      "api",
      `repos/${repoSlug}/contents/${GITHUB_CPR_PATH}?ref=${GITHUB_CPR_BRANCH}`,
      "--jq",
      "{sha:.sha,size:.size,encoding:.encoding,content:.content}",
    ]).catch(error => {
      if (String(error?.stderr ?? "").includes("404") || String(error?.stdout ?? "").includes('"status": "404"') || String(error?.message ?? "").includes("404")) {
        return null;
      }
      throw error;
    });

    if (!fileApiOutput) {
      await recordGitHubCprSyncFailure({
        sourceKey,
        sourceUrl,
        error: `Remote file ${GITHUB_CPR_PATH} does not exist yet on branch ${GITHUB_CPR_BRANCH}`,
        status: "file_not_found",
      });
      return {
        status: "file_not_found" as const,
        repository: repoSlug,
        branch: GITHUB_CPR_BRANCH,
        path: GITHUB_CPR_PATH,
        message: "Remote file does not exist yet; existing dashboard keywords preserved without changes",
      };
    }

    const fileMeta = parseGhJson<GitHubFileMetadata>(fileApiOutput.stdout);
    const commitOutput = await execFileAsync("gh", [
      "api",
      `repos/${repoSlug}/commits?path=${encodeURIComponent(GITHUB_CPR_PATH)}&sha=${encodeURIComponent(GITHUB_CPR_BRANCH)}&per_page=1`,
      "--jq",
      ".[0] | {sha:.sha,date:.commit.committer.date,message:.commit.message}",
    ]);
    const commitMeta = parseGhJson<GitHubCommitMetadata>(commitOutput.stdout);
    if (!commitMeta?.date) {
      throw new Error(`Unable to determine commit update time for ${GITHUB_CPR_PATH}`);
    }

    const remoteUpdatedAt = new Date(commitMeta.date);
    if (Number.isNaN(remoteUpdatedAt.getTime())) {
      throw new Error(`Invalid commit date returned for ${GITHUB_CPR_PATH}: ${commitMeta.date}`);
    }

    let fileText = "";
    if (fileMeta.content && fileMeta.encoding === "base64") {
      fileText = Buffer.from(fileMeta.content.replace(/\s+/g, ""), "base64").toString("utf8");
    } else {
      const blobOutput = await execFileAsync("gh", [
        "api",
        `repos/${repoSlug}/git/blobs/${fileMeta.sha}`,
        "--jq",
        ".content",
      ]);
      fileText = Buffer.from(stripAnsi(blobOutput.stdout).trim().replace(/\s+/g, ""), "base64").toString("utf8");
    }

    const rawJson = JSON.parse(fileText);
    const document = parseGitHubCprDocument(rawJson);

    if (options.dryRun) {
      return {
        status: "dry_run" as const,
        repository: repoSlug,
        remoteSha: commitMeta.sha,
        remoteUpdatedAt: remoteUpdatedAt.toISOString(),
        documentMeta: {
          generatedAt: document.generatedAtIso,
          records: document.records.length,
        },
      };
    }

    const result = await applyGitHubCprDocument({
      sourceKey,
      sourceUrl,
      remoteSha: commitMeta.sha,
      remoteUpdatedAt,
      document,
      force: options.force,
    });

    return {
      status: result.status,
      repository: repoSlug,
      remoteSha: commitMeta.sha,
      remoteUpdatedAt: remoteUpdatedAt.toISOString(),
      updatedKeywords: result.updated,
      matchedKeywords: result.matched,
      clearedKeywords: result.cleared,
      sourceRecords: result.sourceRecords,
    };
  } catch (error: any) {
    const message = error?.message || "Unknown GitHub CPR sync error";
    await recordGitHubCprSyncFailure({ sourceKey, sourceUrl, error: message });
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runGitHubCprSync({
    dryRun: process.argv.includes("--dry-run"),
    force: process.argv.includes("--force"),
  })
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}
