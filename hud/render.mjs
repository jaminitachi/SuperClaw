import { bold, dim, red, yellow, cyan, RESET, DIM } from './colors.mjs';
import { formatCost, formatTokenCount } from './cost.mjs';
import { renderCwd } from './elements/cwd.mjs';
import { renderGitRepo, renderGitBranch } from './elements/git.mjs';
import { renderModel } from './elements/model.mjs';
import { renderSession } from './elements/session.mjs';
import { renderContext } from './elements/context.mjs';
import { renderContextWarning } from './elements/context-warning.mjs';
import { renderRateLimits } from './elements/limits.mjs';
import { renderCallCounts } from './elements/call-counts.mjs';
import { renderAgents } from './elements/agents.mjs';
import { renderTodos } from './elements/todos.mjs';
import { renderSkills } from './elements/skills.mjs';
import { renderThinking } from './elements/thinking.mjs';
import { renderPermission } from './elements/permission.mjs';
import { renderBackground } from './elements/background.mjs';

const SEP = ` ${DIM}|${RESET} `;
const VERSION = '2.0.0';

export function render(ctx) {
  const { stdin, config, transcript, tokens, cost, contextPercent, usage } = ctx;
  const el = config.elements;

  const output = [];

  // LINE 0: Git info line (cwd | repo | branch | model)
  const gitParts = [];
  if (el.cwd) {
    const cwd = renderCwd(stdin?.cwd, el.cwdFormat);
    if (cwd) gitParts.push(cwd);
  }
  if (el.gitRepo) {
    const repo = renderGitRepo(stdin?.cwd);
    if (repo) gitParts.push(repo);
  }
  if (el.gitBranch) {
    const branch = renderGitBranch(stdin?.cwd);
    if (branch) gitParts.push(branch);
  }
  if (el.model) {
    const model = renderModel(ctx.modelName, el.modelFormat);
    if (model) gitParts.push(model);
  }

  if (gitParts.length > 0) {
    output.push(gitParts.join(SEP));
  }

  // LINE 1: Header line ([SuperClaw#2.0] | rate limits | session | health | context | counts)
  const headerParts = [];

  // SuperClaw label
  if (el.scLabel) {
    headerParts.push(bold(cyan(`[SuperClaw#${VERSION}]`)));
  }

  // Rate limits
  if (el.rateLimits) {
    const limits = renderRateLimits(usage);
    if (limits) headerParts.push(limits);
  }

  // Permission pending
  if (el.permissionStatus) {
    const perm = renderPermission(transcript.pendingPermission);
    if (perm) headerParts.push(perm);
  }

  // Thinking indicator
  if (el.thinking) {
    const thinking = renderThinking(transcript.isThinking, el.thinkingFormat);
    if (thinking) headerParts.push(thinking);
  }

  // Session duration
  if (el.sessionHealth && el.showSessionDuration) {
    const session = renderSession(transcript.sessionStart);
    if (session) headerParts.push(session);
  }

  // Health indicator + cost
  if (el.sessionHealth && el.showHealthIndicator) {
    const healthIcon = getHealthIcon(contextPercent, cost, config);

    const costParts = [];
    if (el.showCost && cost != null) {
      costParts.push(`~${formatCost(cost)}`);
    }
    if (el.showTokens && tokens) {
      costParts.push(formatTokenCount(tokens.total));
    }
    if (el.showCache && tokens && tokens.total > 0) {
      const cacheRate = Math.round((tokens.cacheRead / tokens.total) * 100);
      costParts.push(`Cache:${dim(cacheRate + '%')}`);
    }

    if (costParts.length > 0) {
      headerParts.push(`${healthIcon} ${costParts.join(dim(' | '))}`);
    }
  }

  // Active skill
  if (el.activeSkills) {
    const skill = renderSkills(transcript.lastSkill);
    if (skill) headerParts.push(skill);
  }

  // Context bar
  if (el.contextBar) {
    const ctx2 = renderContext(contextPercent, config);
    if (ctx2) headerParts.push(ctx2);
  }

  // Agents header (count or codes)
  const agentResult = el.agents
    ? renderAgents(transcript.agents, el.agentsFormat, el.agentsMaxLines)
    : { header: null, details: [] };

  if (agentResult.header) {
    headerParts.push(agentResult.header);
  }

  // Background tasks
  if (el.backgroundTasks && transcript.backgroundCount > 0) {
    const bg = renderBackground(transcript.backgroundCount, transcript.backgroundDone);
    if (bg) headerParts.push(bg);
  }

  // Call counts (always last on the right)
  if (el.showCallCounts) {
    const counts = renderCallCounts(transcript.toolCallCount, transcript.agentCallCount, transcript.skillCallCount);
    if (counts) headerParts.push(counts);
  }

  if (headerParts.length > 0) {
    output.push(headerParts.join(SEP));
  }

  // DETAIL LINES: Todos, Agents multiline, Context warning
  const detailLines = [];

  // Todos
  if (el.todos) {
    const todos = renderTodos(transcript.todos);
    if (todos) detailLines.push(todos);
  }

  // Agent detail lines (multiline format)
  if (agentResult.details.length > 0) {
    detailLines.push(...agentResult.details);
  }

  // Context warning
  const ctxWarning = renderContextWarning(contextPercent, config);
  if (ctxWarning) detailLines.push(ctxWarning);

  // Budget warning
  if (el.showBudgetWarning && cost != null && cost >= (config.thresholds?.budgetWarning || 2)) {
    const budgetWarn = cost >= (config.thresholds?.budgetCritical || 5)
      ? bold(red(`⚡ Budget CRITICAL: ~$${cost.toFixed(2)}`))
      : yellow(`⚡ Budget notice: ~$${cost.toFixed(2)}`);
    detailLines.push(budgetWarn);
  }

  output.push(...detailLines);

  return output.join('\n');
}

function getHealthIcon(contextPercent, cost, config) {
  const ctxCrit = config.thresholds?.contextCritical || 85;
  const ctxWarn = config.thresholds?.contextWarning || 70;
  const costCrit = config.thresholds?.budgetCritical || 5;
  const costWarn = config.thresholds?.budgetWarning || 2;

  if (contextPercent >= ctxCrit || (cost != null && cost >= costCrit)) return '🔴';
  if (contextPercent >= ctxWarn || (cost != null && cost >= costWarn)) return '🟡';
  return '🟢';
}
