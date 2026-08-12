/**
 * Dashboard landing page — high-level status across all MCP servers and
 * recent orchestrator activity (from audit-log.ts via the backend API).
 */

async function getDashboardSummary() {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";
  try {
    const res = await fetch(`${backendUrl}/api/dashboard/summary`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as {
      servers: { name: string; status: string }[];
      recentAudits: { server: string; tool: string; timestamp: string; outcome: string }[];
    };
  } catch {
    return null;
  }
}

export default async function DashboardPage() {
  const summary = await getDashboardSummary();

  return (
    <main>
      <h1>Bounteous AEP MCP Dashboard</h1>
      <section>
        <h2>Server Status</h2>
        {summary ? (
          <ul>
            {summary.servers.map((s) => (
              <li key={s.name}>
                {s.name}: {s.status}
              </li>
            ))}
          </ul>
        ) : (
          <p>Unable to reach web-ui backend. Is docker-compose running?</p>
        )}
      </section>
      <section>
        <h2>Recent Activity</h2>
        {summary ? (
          <ul>
            {summary.recentAudits.map((a, i) => (
              <li key={i}>
                [{a.timestamp}] {a.server}.{a.tool} — {a.outcome}
              </li>
            ))}
          </ul>
        ) : (
          <p>No activity available.</p>
        )}
      </section>
    </main>
  );
}
