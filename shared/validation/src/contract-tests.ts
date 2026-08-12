/**
 * Validates that every mcp-servers/* /mcp.config.json manifest is
 * well-formed: required top-level fields present, every tool has a name/
 * description/inputSchema, and every inputSchema/outputSchema is itself a
 * structurally valid JSON Schema (via ajv's meta-schema compile step).
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";

export interface ContractTestResult {
  server: string;
  configPath: string;
  ok: boolean;
  errors: string[];
}

const ajv = new Ajv({ strict: false });

function validateToolSchema(schema: unknown, label: string, errors: string[]): void {
  if (schema === undefined) return;
  try {
    ajv.compile(schema as object);
  } catch (err) {
    errors.push(`${label}: invalid JSON Schema — ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function validateServerConfig(server: string, configPath: string): ContractTestResult {
  const errors: string[] = [];

  if (!existsSync(configPath)) {
    return { server, configPath, ok: false, errors: [`mcp.config.json not found at ${configPath}`] };
  }

  let config: any;
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (err) {
    return {
      server,
      configPath,
      ok: false,
      errors: [`invalid JSON: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  for (const field of ["name", "description", "version", "tools"]) {
    if (!(field in config)) errors.push(`missing top-level field '${field}'`);
  }

  if (Array.isArray(config.tools)) {
    for (const [i, tool] of config.tools.entries()) {
      const label = `tools[${i}]`;
      if (!tool.name) errors.push(`${label}: missing 'name'`);
      if (!tool.description) errors.push(`${label}: missing 'description'`);
      if (!tool.inputSchema) errors.push(`${label}: missing 'inputSchema'`);
      validateToolSchema(tool.inputSchema, `${label}.inputSchema`, errors);
      validateToolSchema(tool.outputSchema, `${label}.outputSchema`, errors);
    }
  } else {
    errors.push("'tools' must be an array");
  }

  return { server, configPath, ok: errors.length === 0, errors };
}

export function validateAllServers(mcpServersDir: string): ContractTestResult[] {
  const results: ContractTestResult[] = [];
  for (const entry of readdirSync(mcpServersDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const configPath = join(mcpServersDir, entry.name, "mcp.config.json");
    results.push(validateServerConfig(entry.name, configPath));
  }
  return results;
}
