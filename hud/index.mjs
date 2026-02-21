#!/usr/bin/env node

import { readStdin, getContextPercent, getModelName, getTokens } from './stdin.mjs';
import { loadConfig } from './config.mjs';
import { parseTranscript } from './transcript.mjs';
import { calculateCost } from './cost.mjs';
import { getUsage } from './usage-api.mjs';
import { render } from './render.mjs';
import { sanitizeOutput, replaceSpaces, limitLines } from './sanitize.mjs';

async function main() {
  try {
    // 1. Read stdin from Claude Code
    const stdin = await readStdin();
    if (!stdin) {
      console.log('[SuperClaw] No stdin');
      return;
    }

    // 2. Load config
    const config = loadConfig();

    // 3. Parse transcript
    const transcript = parseTranscript(
      stdin.transcript_path,
      config.staleTaskThresholdMinutes
    );

    // 4. Calculate metrics
    const modelName = getModelName(stdin);
    const contextPercent = getContextPercent(stdin);
    const tokens = getTokens(stdin);
    const cost = calculateCost(modelName, tokens);

    // 5. Fetch rate limits (non-blocking, cached)
    const usage = await getUsage();

    // 6. Build render context
    const ctx = {
      stdin,
      config,
      transcript,
      modelName,
      contextPercent,
      tokens,
      cost,
      usage,
    };

    // 7. Render
    let output = render(ctx);

    // 8. Post-process
    output = limitLines(output, config.maxOutputLines);

    if (config.safeMode) {
      output = sanitizeOutput(output);
    } else {
      output = replaceSpaces(output);
    }

    console.log(output);
  } catch (err) {
    // Graceful fallback — never crash
    console.log(`[SuperClaw] HUD error: ${err.message}`);
  }
}

main();
