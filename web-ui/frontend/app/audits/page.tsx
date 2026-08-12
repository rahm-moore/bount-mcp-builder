/**
 * Audits page — kick off a site-crawler audit (via orchestrator's
 * fullSiteAudit workflow) and view findings for past jobs.
 */

"use client";

import { useState } from "react";

interface AuditFormState {
  profile: string;
  domain: string;
  edgeConfigId: string;
}

export default function AuditsPage() {
  const [form, setForm] = useState<AuditFormState>({ profile: "", domain: "", edgeConfigId: "" });
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";
      const res = await fetch(`${backendUrl}/api/audits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(`Backend returned ${res.status}`);
      setResult(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>Site Audits</h1>
      <form onSubmit={handleSubmit}>
        <label>
          Profile (name only, never a secret)
          <input
            value={form.profile}
            onChange={(e) => setForm({ ...form, profile: e.target.value })}
            placeholder="cit_bank_test_user"
          />
        </label>
        <label>
          Domain
          <input
            value={form.domain}
            onChange={(e) => setForm({ ...form, domain: e.target.value })}
            placeholder="www.citbank.com"
          />
        </label>
        <label>
          Expected Edge Config ID
          <input
            value={form.edgeConfigId}
            onChange={(e) => setForm({ ...form, edgeConfigId: e.target.value })}
            placeholder="<edge-config-id>"
          />
        </label>
        <button type="submit" disabled={loading}>
          {loading ? "Running..." : "Run Audit"}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {result !== null && <pre>{JSON.stringify(result, null, 2)}</pre>}
    </main>
  );
}
