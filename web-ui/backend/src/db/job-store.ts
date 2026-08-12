/**
 * Placeholder job/audit-result persistence.
 *
 * Backs the /api/audits and /api/dashboard/summary routes. In-memory for
 * now; swap for a real store (Postgres/SQLite/etc.) behind this same
 * interface when persistence needs to survive a container restart.
 */

export interface AuditJobRecord {
  id: string;
  profile: string;
  domain: string;
  edgeConfigId: string;
  status: "queued" | "running" | "completed" | "failed";
  result?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface JobStore {
  create(job: Omit<AuditJobRecord, "createdAt" | "updatedAt">): AuditJobRecord;
  get(id: string): AuditJobRecord | undefined;
  update(id: string, patch: Partial<AuditJobRecord>): AuditJobRecord | undefined;
  list(limit?: number): AuditJobRecord[];
}

class InMemoryJobStore implements JobStore {
  private jobs = new Map<string, AuditJobRecord>();

  create(job: Omit<AuditJobRecord, "createdAt" | "updatedAt">): AuditJobRecord {
    const now = new Date().toISOString();
    const record: AuditJobRecord = { ...job, createdAt: now, updatedAt: now };
    this.jobs.set(record.id, record);
    return record;
  }

  get(id: string): AuditJobRecord | undefined {
    return this.jobs.get(id);
  }

  update(id: string, patch: Partial<AuditJobRecord>): AuditJobRecord | undefined {
    const existing = this.jobs.get(id);
    if (!existing) return undefined;
    const updated: AuditJobRecord = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.jobs.set(id, updated);
    return updated;
  }

  list(limit = 50): AuditJobRecord[] {
    return [...this.jobs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}

// Singleton for the process lifetime — see module docstring re: swapping
// this for real persistence later.
export const jobStore: JobStore = new InMemoryJobStore();
