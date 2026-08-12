/**
 * Tool implementations for the site-crawler MCP server.
 *
 *  - crawl(profile, domain): launches a Playwright crawl of `domain`,
 *    running all checks in ./checks against the loaded page(s), and
 *    returns a jobId immediately (crawls run async in the background).
 *  - getFindings(jobId): polls for the crawl's findings/status.
 *
 * `profile` is only ever used to resolve auth for gated staging domains
 * via credential-resolver.ts — it is never itself returned to the caller.
 */

import { randomUUID } from "node:crypto";
import { chromium, type Browser } from "playwright";
import { resolveProfile, DomainNotAllowedError, ProfileNotFoundError } from "./auth/credential-resolver.js";
import { checkAlloyVersion, type AlloyVersionFinding } from "./checks/alloy-version.js";
import { checkDuplicateTags, type DuplicateTagFinding } from "./checks/duplicate-tags.js";

export type CrawlStatus = "queued" | "running" | "completed" | "failed";

export interface CrawlJob {
  jobId: string;
  domain: string;
  profile: string;
  status: CrawlStatus;
  findings: (AlloyVersionFinding | DuplicateTagFinding)[];
  error?: string;
  startedAt: string;
  completedAt?: string;
}

// In-memory job store — fine for a single-container dev/CI deployment.
// A production deployment should back this with job-store persistence
// (see web-ui/backend/src/db/job-store.ts for the shape this should adopt).
const jobs = new Map<string, CrawlJob>();

export async function crawl(profile: string, domain: string): Promise<{ jobId: string }> {
  // Validate the profile/domain pairing up front so bad requests fail fast,
  // even though the resolved credentials themselves are only used lazily
  // if/when the crawl actually needs authenticated access.
  try {
    await resolveProfile(profile, domain);
  } catch (err) {
    if (err instanceof ProfileNotFoundError || err instanceof DomainNotAllowedError) {
      throw err;
    }
    // SecretBackendError (e.g. missing local env vars) is tolerated here —
    // many domains are crawled unauthenticated and don't need real creds.
  }

  const jobId = randomUUID();
  const job: CrawlJob = {
    jobId,
    domain,
    profile,
    status: "queued",
    findings: [],
    startedAt: new Date().toISOString(),
  };
  jobs.set(jobId, job);

  void runCrawl(job);

  return { jobId };
}

export function getFindings(jobId: string): CrawlJob {
  const job = jobs.get(jobId);
  if (!job) {
    throw new Error(`Unknown jobId: ${jobId}`);
  }
  return job;
}

async function runCrawl(job: CrawlJob): Promise<void> {
  job.status = "running";
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`https://${job.domain}`, { waitUntil: "networkidle", timeout: 30000 });

    job.findings.push(await checkAlloyVersion(page));
    job.findings.push(await checkDuplicateTags(page));

    job.status = "completed";
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
  } finally {
    job.completedAt = new Date().toISOString();
    await browser?.close();
  }
}
