export interface SentryMetrics {
  unresolvedIssues: number;
  newIssues24h: number;
  topIssue?: { title: string; count: number; url?: string };
}

export async function collect(projectSlug?: string): Promise<SentryMetrics> {
  // Sentry data is collected via MCP tools when available
  // This collector provides a stub that can be enriched by the Sentry MCP integration
  return {
    unresolvedIssues: 0,
    newIssues24h: 0,
    topIssue: undefined,
  };
}
