#!/usr/bin/env node
/**
 * SessionEnd hook — extracts learnings from the session and persists them
 * to both SC memory (via MCP reminder) and OMC notepad working memory.
 */
import { readStdin } from './lib/stdin.mjs';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Sync key insights to OMC's notepad working memory.
 * Appends a timestamped entry to the working section.
 */
function syncToOmcNotepad(insights) {
  if (!insights || insights.length === 0) return;

  try {
    const notepadPath = join(homedir(), '.claude', '.omc', 'notepad.json');
    const notepadDir = join(homedir(), '.claude', '.omc');

    let notepad = { priority: '', working: [], manual: [] };
    if (existsSync(notepadPath)) {
      notepad = JSON.parse(readFileSync(notepadPath, 'utf-8'));
    } else {
      mkdirSync(notepadDir, { recursive: true });
    }

    if (!Array.isArray(notepad.working)) {
      notepad.working = [];
    }

    const entry = {
      timestamp: new Date().toISOString(),
      content: `[SuperClaw Session] ${insights.join('; ')}`,
    };
    notepad.working.push(entry);

    writeFileSync(notepadPath, JSON.stringify(notepad, null, 2), 'utf-8');
  } catch {
    // Notepad write failed — non-critical, skip silently
  }
}

/**
 * Extract session learnings from the hook input data.
 * Returns an array of insight strings.
 */
function extractLearnings(data) {
  const insights = [];

  // Extract from session transcript summary if available
  if (data.transcript) {
    // Look for patterns indicating learnings
    const transcript = typeof data.transcript === 'string'
      ? data.transcript
      : JSON.stringify(data.transcript);

    // Extract error resolutions
    const errorPatterns = transcript.match(/(?:fixed|resolved|solved|debugged)\s+(.{10,80})/gi);
    if (errorPatterns) {
      for (const match of errorPatterns.slice(0, 3)) {
        insights.push(match.trim());
      }
    }

    // Extract configuration changes
    const configPatterns = transcript.match(/(?:configured|set up|installed|enabled)\s+(.{10,60})/gi);
    if (configPatterns) {
      for (const match of configPatterns.slice(0, 2)) {
        insights.push(match.trim());
      }
    }
  }

  return insights;
}

async function main() {
  const input = await readStdin();
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    data = {};
  }

  const insights = extractLearnings(data);

  // Sync extracted insights to OMC notepad
  syncToOmcNotepad(insights);

  const contextLines = [
    '[SuperClaw] Session ending.',
    'Use sc_memory_store to save any important learnings before session closes.',
  ];

  if (insights.length > 0) {
    contextLines.push(`Auto-extracted ${insights.length} insight(s) to OMC notepad working memory.`);
  }

  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'SessionEnd',
      additionalContext: contextLines.join(' '),
    },
  }));
}

main().catch(() => {
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
});
