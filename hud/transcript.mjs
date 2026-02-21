import { readFileSync, statSync, openSync, readSync, closeSync } from 'fs';

const TAIL_SIZE = 512 * 1024; // 512KB

export function parseTranscript(transcriptPath, staleMinutes = 30) {
  if (!transcriptPath) return emptyResult();

  let lines;
  try {
    const stat = statSync(transcriptPath);
    let raw;

    if (stat.size < TAIL_SIZE) {
      raw = readFileSync(transcriptPath, 'utf-8');
    } else {
      // Tail-based: read last 512KB
      const fd = openSync(transcriptPath, 'r');
      const buf = Buffer.alloc(TAIL_SIZE);
      readSync(fd, buf, 0, TAIL_SIZE, stat.size - TAIL_SIZE);
      closeSync(fd);
      raw = buf.toString('utf-8');
      // Discard potentially incomplete first line
      const firstNewline = raw.indexOf('\n');
      if (firstNewline !== -1) {
        raw = raw.slice(firstNewline + 1);
      }
    }

    lines = raw.split('\n').filter(l => l.trim());
  } catch {
    return emptyResult();
  }

  const result = emptyResult();
  const now = Date.now();
  const staleMs = staleMinutes * 60 * 1000;

  // Maps for tracking tool_use -> tool_result pairs
  const pendingTools = new Map(); // id -> { name, input, timestamp }

  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    const timestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : now;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;

    // Record session start from first entry
    if (!result.sessionStart && entry.timestamp) {
      result.sessionStart = entry.timestamp;
    }

    for (const block of content) {
      if (block.type === 'tool_use') {
        result.toolCallCount++;
        pendingTools.set(block.id, { name: block.name, input: block.input || {}, timestamp });

        // Track agents
        if (block.name === 'Task' || block.name === 'proxy_Task') {
          result.agentCallCount++;
          const agentType = block.input?.subagent_type || 'unknown';
          const model = block.input?.model || '';
          const desc = block.input?.description || '';
          const shortName = agentType.replace('superclaw:', '').replace('superclaw/', '');

          result.agents.set(block.id, {
            id: block.id,
            name: shortName,
            model,
            description: desc,
            startTime: timestamp,
            completed: false,
            background: !!block.input?.run_in_background,
          });
        }

        // Track skills
        if (block.name === 'Skill' || block.name === 'proxy_Skill') {
          result.skillCallCount++;
          result.lastSkill = block.input?.skill || '';
        }

        // Track todos
        if (block.name === 'TodoWrite') {
          const todos = block.input?.todos;
          if (Array.isArray(todos)) {
            result.todos = todos;
          }
        }

        // TaskCreate blocks are tracked via TodoWrite

        // Track pending permission
        if (['Edit', 'Write', 'Bash', 'proxy_Edit', 'proxy_Write', 'proxy_Bash'].includes(block.name)) {
          result.pendingPermission = { name: block.name, input: block.input, time: timestamp };
        }
      }

      if (block.type === 'tool_result') {
        const toolId = block.tool_use_id;
        const pending = pendingTools.get(toolId);
        if (pending) {
          pendingTools.delete(toolId);

          // Mark agent as completed
          const agent = result.agents.get(toolId);
          if (agent) {
            agent.completed = true;
            agent.endTime = timestamp;
          }

          // Clear pending permission
          if (result.pendingPermission && pending.name === result.pendingPermission.name) {
            result.pendingPermission = null;
          }

          // Check for background agent launch
          const resultText = typeof block.content === 'string' ? block.content :
            Array.isArray(block.content) ? block.content.map(c => c.text || '').join('') : '';

          if (resultText.includes('Async agent launched') || resultText.includes('run_in_background')) {
            const bgMatch = resultText.match(/agentId:\s*(\w+)/);
            if (bgMatch && agent) {
              agent.background = true;
              result.backgroundAgents.set(bgMatch[1], toolId);
            }
          }
        }
      }

      // Track thinking state
      if (block.type === 'thinking' || block.type === 'reasoning') {
        result.lastThinkingTime = timestamp;
      }

      // Track last block type
      result.lastBlockType = block.type;
    }
  }

  // Mark stale agents
  for (const [, agent] of result.agents) {
    if (!agent.completed && (now - agent.startTime) > staleMs) {
      agent.completed = true;
      agent.stale = true;
    }
  }

  // Check if thinking is active (last block is thinking/reasoning)
  result.isThinking = result.lastBlockType === 'thinking' || result.lastBlockType === 'reasoning';

  // Check if permission is still pending (within last 3 seconds)
  if (result.pendingPermission && (now - result.pendingPermission.time) > 3000) {
    result.pendingPermission = null;
  }

  // Count running agents
  result.runningAgentCount = 0;
  result.completedAgentCount = 0;
  for (const agent of result.agents.values()) {
    if (agent.completed) result.completedAgentCount++;
    else result.runningAgentCount++;
  }

  // Count background tasks
  result.backgroundCount = 0;
  result.backgroundDone = 0;
  for (const agent of result.agents.values()) {
    if (agent.background) {
      result.backgroundCount++;
      if (agent.completed) result.backgroundDone++;
    }
  }

  return result;
}

function emptyResult() {
  return {
    sessionStart: null,
    toolCallCount: 0,
    agentCallCount: 0,
    skillCallCount: 0,
    agents: new Map(),
    todos: [],
    lastSkill: null,
    pendingPermission: null,
    isThinking: false,
    lastThinkingTime: null,
    lastBlockType: null,
    runningAgentCount: 0,
    completedAgentCount: 0,
    backgroundAgents: new Map(),
    backgroundCount: 0,
    backgroundDone: 0,
  };
}
