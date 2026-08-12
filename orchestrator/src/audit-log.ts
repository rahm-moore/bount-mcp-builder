/**
 * Audit log for every credential-scoped tool invocation the orchestrator
 * dispatches. This is the enforcement point referenced in
 * docs/security-model.md: the orchestrator sits in front of every sub-MCP
 * call, so it is the natural place to record who/when/which
 * profile/which domain — and, critically, never the secret value itself
 * (the orchestrator never even holds one; see router.ts).
 */

export interface AuditEntry {
  timestamp: string;
  caller: string;
  server: string;
  tool: string;
  /** Profile *name* only — never a resolved credential. */
  profile?: string;
  domain?: string;
  outcome: "success" | "error";
  errorMessage?: string;
  durationMs: number;
}

// Simple append-only in-memory + stdout sink for the skeleton. Production
// should ship this to the same structured-log pipeline as everything else
// (e.g. stdout -> log aggregator), which is why the shape below is already
// flat JSON rather than something bespoke.
const entries: AuditEntry[] = [];

export function recordAuditEntry(entry: AuditEntry): void {
  entries.push(entry);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ type: "audit", ...entry }));
}

export function getAuditLog(): readonly AuditEntry[] {
  return entries;
}

/**
 * Wraps a sub-MCP tool call with timing + audit logging. `fn` should
 * perform the actual dispatch (see router.ts::callSubServerTool) — this
 * wrapper never sees or logs anything beyond the profile name/domain
 * already present in `args`.
 */
export async function withAudit<T>(
  params: { caller: string; server: string; tool: string; profile?: string; domain?: string },
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    recordAuditEntry({
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - start,
      outcome: "success",
      ...params,
    });
    return result;
  } catch (err) {
    recordAuditEntry({
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - start,
      outcome: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
      ...params,
    });
    throw err;
  }
}
