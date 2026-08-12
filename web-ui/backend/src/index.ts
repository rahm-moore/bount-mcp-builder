#!/usr/bin/env node
/**
 * web-ui backend entrypoint: Express API layer fronting the orchestrator,
 * industry-news-tracker, and the embedded Claude Agent SDK client.
 */

import express from "express";
import { router } from "./api/routes.js";

const app = express();
app.use(express.json());
app.use("/api", router);

app.get("/healthz", (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`web-ui backend listening on :${port}`);
});
