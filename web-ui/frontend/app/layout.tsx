import type { ReactNode } from "react";

export const metadata = {
  title: "Bounteous AEP MCP Dashboard",
  description: "Internal dashboard for AEP MCP tooling, with Claude embedded via the Agent SDK.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <a href="/dashboard">Dashboard</a> | <a href="/audits">Audits</a> | <a href="/news">News</a> |{" "}
          <a href="/chat">Chat</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
