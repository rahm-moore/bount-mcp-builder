/**
 * Example composed workflow: crawl a domain with site-crawler, then check
 * the observed alloy.js config against the expected datastream
 * configuration from aep-core, and produce a single report.
 */

import { callSubServerTool } from "../router.js";

export interface FullSiteAuditParams {
  profile: string;
  domain: string;
  edgeConfigId: string;
  caller: string;
}

export interface FullSiteAuditReport {
  domain: string;
  edgeConfigId: string;
  generatedAt: string;
  crawlJobId: string;
  crawlFindings: unknown;
  expectedDatastreamServices: unknown;
  discrepancies: string[];
}

export async function runFullSiteAudit(params: FullSiteAuditParams): Promise<FullSiteAuditReport> {
  const { profile, domain, edgeConfigId, caller } = params;

  // Step 1: crawl the domain.
  const crawlResult = (await callSubServerTool(
    "site-crawler",
    "crawl",
    { profile, domain },
    { caller }
  )) as { jobId: string };

  // Step 2: pull the expected datastream service mapping from aep-core so
  // the crawl findings can be checked against what's actually configured
  // server-side, not just what's observed client-side.
  const expectedDatastreamServices = await callSubServerTool(
    "aep-core",
    "get_datastream_services",
    { profile, domain, edge_config_id: edgeConfigId },
    { caller }
  );

  // Step 3: poll for crawl completion and compare. Left as a documented
  // gap rather than a fake result — a real implementation needs a
  // polling loop with backoff and a timeout policy.
  const crawlFindings = await callSubServerTool(
    "site-crawler",
    "getFindings",
    { jobId: crawlResult.jobId },
    { caller }
  );

  const discrepancies: string[] = [];
  // TODO: diff crawlFindings (observed edgeConfigId / services) against
  // expectedDatastreamServices and populate discrepancies[] with anything
  // that doesn't match (e.g. crawl found a different/older edgeConfigId
  // than the one configured in aep-core for this domain).

  return {
    domain,
    edgeConfigId,
    generatedAt: new Date().toISOString(),
    crawlJobId: crawlResult.jobId,
    crawlFindings,
    expectedDatastreamServices,
    discrepancies,
  };
}
