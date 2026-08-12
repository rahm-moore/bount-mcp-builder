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

  // NOTE: dispatching to the orchestrator's `fullSiteAudit` tool over its
  // real MCP transport is left for whoever wires up
  // orchestrator/src/router.ts's sub-server transport — this route
  // reflects the intended shape of that call.
  jobStore.update(job.id, {
    status: "failed",
    result: { error: "NotImplemented: dispatch to orchestrator.fullSiteAudit not wired up yet" },
  });
  res.status(202).json(jobStore.get(job.id));
});

router.get("/news/digest", async (_req, res) => {
  const industryNewsUrl = process.env.INDUSTRY_NEWS_TRACKER_URL;
  if (!industryNewsUrl) {
    res.status(503).json({ error: "INDUSTRY_NEWS_TRACKER_URL not configured" });
    return;
  }
  res.status(501).json({ error: "NotImplemented: proxy to industry-news-tracker.getWeeklyDigest not wired up yet" });
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
