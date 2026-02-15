import { execSync } from 'child_process';

export interface GithubMetrics {
  prs: { total: number; mine: number; reviewRequested: number };
  issues: { total: number; assigned: number };
  ci?: { status: string; conclusion?: string; url?: string };
}

function tryExec(cmd: string, timeoutMs = 10000): string | null {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: timeoutMs, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

export async function collect(repo?: string): Promise<GithubMetrics> {
  const repoFlag = repo ? `-R ${repo}` : '';
  const metrics: GithubMetrics = {
    prs: { total: 0, mine: 0, reviewRequested: 0 },
    issues: { total: 0, assigned: 0 },
  };

  // PRs
  const prList = tryExec(`gh pr list ${repoFlag} --state open --json number,author --limit 100`);
  if (prList) {
    try {
      const prs = JSON.parse(prList);
      metrics.prs.total = prs.length;
      const me = tryExec('gh api user --jq .login');
      if (me) {
        metrics.prs.mine = prs.filter((p: any) => p.author?.login === me).length;
      }
    } catch {}
  }

  // Review requested
  const reviewPrs = tryExec(`gh pr list ${repoFlag} --search "review-requested:@me" --json number --limit 100`);
  if (reviewPrs) {
    try {
      metrics.prs.reviewRequested = JSON.parse(reviewPrs).length;
    } catch {}
  }

  // Issues
  const issueList = tryExec(`gh issue list ${repoFlag} --assignee @me --state open --json number --limit 100`);
  if (issueList) {
    try {
      const issues = JSON.parse(issueList);
      metrics.issues.assigned = issues.length;
    } catch {}
  }

  const allIssues = tryExec(`gh issue list ${repoFlag} --state open --json number --limit 100`);
  if (allIssues) {
    try {
      metrics.issues.total = JSON.parse(allIssues).length;
    } catch {}
  }

  // CI status for current branch
  const ciStatus = tryExec(`gh run list ${repoFlag} --limit 1 --json status,conclusion,url`);
  if (ciStatus) {
    try {
      const runs = JSON.parse(ciStatus);
      if (runs.length > 0) {
        metrics.ci = {
          status: runs[0].status,
          conclusion: runs[0].conclusion,
          url: runs[0].url,
        };
      }
    } catch {}
  }

  return metrics;
}
