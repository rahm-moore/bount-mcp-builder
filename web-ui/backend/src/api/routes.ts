/**
 * Express API routes for the web-ui backend. Thin layer: real work is
 * delegated to the orchestrator (for audits), industry-news-tracker (for
 * digests), and the Agent SDK client (for chat). This layer never
 * resolves credentials itself — it only ever forwards a `profile` name.
 */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { jobStore } from "../db/job-store.js";
import { ClaudeClient } from "../agent/claude-client.js";
import { callMcpTool } from "../mcp/mcp-client.js";

export const router = Router();

let claudeClient: ClaudeClient | null = null;
function getClaudeClient(): ClaudeClient {
  if (!claudeClient) claudeClient = new ClaudeClient();
  return claudeClient;
}

router.get("/dashboard/summary", async (_req, res) => {
  const recentJobs = jobStore.list(10);
  res.json({
    servers: [
      { name: "aep-core", status: process.env.AEP_CORE_URL ? "configured" : "not configured" },
      { name: "site-crawler", status: process.env.SITE_CRAWLER_URL ? "configured" : "not configured" },
      { name: "orchestrator", status: process.env.ORCHESTRATOR_URL ? "configured" : "not configured" },
    ],
    recentAudits: recentJobs.map((job) => ({
      server: "orchestrator",
      tool: "fullSiteAudit",
      timestamp: job.updatedAt,
      outcome: job.status,
    })),
  });
});

router.post("/audits", async (req, res) => {
  const { profile, domain, edgeConfigId } = req.body as {
    profile?: string;
    domain?: string;
    edgeConfigId?: string;
  };

  if (!profile || !domain || !edgeConfigId) {
    res.status(400).json({ error: "profile, domain, and edgeConfigId are all required" });
    return;
  }

  const job = jobStore.create({ id: randomUUID(), profile, domain, edgeConfigId, status: "queued" });

  const orchestratorUrl = process.env.ORCHESTRATOR_URL;
  if (!orchestratorUrl) {
    jobStore.update(job.id, { status: "failed", result: { error: "ORCHESTRATOR_URL not configured" } });
    res.status(503).json(jobStore.get(job.id));
    return;
  }

  jobStore.update(job.id, { status: "running" });
  // Dispatched synchronously here for simplicity — fullSiteAudit runs to
  // completion (including its own crawl-then-poll steps) before this
  // request resolves. A production version would return 202 immediately
  // and let the client poll jobStore via a separate endpoint instead.
  try {
    const report = await callMcpTool("orchestrator", orchestratorUrl, "fullSiteAudit", {
      profile,
      domain,
      edgeConfigId,
    });
    jobStore.update(job.id, { status: "completed", result: report as Record<string, unknown> });
  } catch (err) {
    jobStore.update(job.id, {
      status: "failed",
      result: { error: err instanceof Error ? err.message : String(err) },
    });
  }
  res.status(202).json(jobStore.get(job.id));
});

router.get("/news/digest", async (req, res) => {
  const industryNewsUrl = process.env.INDUSTRY_NEWS_TRACKER_URL;
  if (!industryNewsUrl) {
    res.status(503).json({ error: "INDUSTRY_NEWS_TRACKER_URL not configured" });
    return;
  }

  const windowDays = Number(req.query.windowDays ?? 7);
  try {
    const digest = await callMcpTool("industry-news-tracker", industryNewsUrl, "getWeeklyDigest", { windowDays });
    res.json(digest);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/chat", async (req, res) => {
  const { message } = req.body as { message?: string };
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  try {
    const result = await getClaudeClient().chat(message);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
