#!/usr/bin/env ts-node
/**
 * CI entrypoint: runs the mcp.config.json contract tests across every
 * server in mcp-servers/, and exits non-zero if any fail. Wired into
 * .github/workflows/ci.yml as the "shared-validation" job.
 */

import { resolve } from "node:path";
import { validateAllServers } from "./contract-tests.js";

function main(): void {
  const mcpServersDir = resolve(__dirname, "..", "..", "..", "mcp-servers");
  const results = validateAllServers(mcpServersDir);

  let anyFailed = false;
  for (const result of results) {
    if (result.ok) {
      console.log(`PASS  ${result.server}`);
    } else {
      anyFailed = true;
      console.log(`FAIL  ${result.server}`);
      for (const error of result.errors) {
        console.log(`      - ${error}`);
      }
    }
  }

  if (anyFailed) {
    process.exit(1);
  }
}

main();
