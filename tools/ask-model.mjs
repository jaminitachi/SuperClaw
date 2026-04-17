#!/usr/bin/env node
/**
 * ask-model.mjs — Multi-model query tool for SC-Arena
 *
 * Auth priority (per provider):
 *   1. Environment variable (OPENAI_API_KEY, GEMINI_API_KEY)
 *   2. OAuth token from CLI tools (~/.codex/auth.json, ~/.gemini/oauth_creds.json)
 *   3. Auto-refresh expired OAuth tokens
 *
 * Usage:
 *   node ask-model.mjs -m gpt-5.4 -p "What is 2+2?"
 *   node ask-model.mjs -m gemini-3-pro -p "OCR this" -i /path/to/image.png
 *   node ask-model.mjs --high -p "Solve this" -m gemini-3-flash   # upgrades to gemini-3.1-pro
 *   node ask-model.mjs --cross-validate --high -p "Verify answer"
 *   node ask-model.mjs --auth-info                                 # show auth status
 *   node ask-model.mjs --list
 *
 * --high mode: Forces premium model tiers for all calls
 *   gemini-* → gemini-3.1-pro
 *   gpt-5.4  → gpt-5.4 (max tokens)
 *   gpt-5.3-codex → gpt-5.3-codex (max tokens)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { basename, extname, join } from 'path';
import { homedir } from 'os';
import { parseArgs } from 'util';
import { execFileSync } from 'child_process';

// --- Configuration ---
const MODEL_CONFIGS = {
  // OpenAI models
  'gpt-5.3-codex':       { provider: 'openai', apiModel: 'gpt-5.3-codex', vision: true },
  'gpt-5.3-codex-spark': { provider: 'openai', apiModel: 'gpt-5.3-codex-spark', vision: true },
  'gpt-5.4':             { provider: 'openai', apiModel: 'gpt-5.4', vision: true },
  'gpt-5.3-instant':     { provider: 'openai', apiModel: 'gpt-5.3-instant', vision: false },
  'o4-mini':             { provider: 'openai', apiModel: 'o4-mini', vision: true },
  // Google Gemini models
  'gemini-3-pro':        { provider: 'google', apiModel: 'gemini-3.0-pro', vision: true },
  'gemini-3-flash':      { provider: 'google', apiModel: 'gemini-3.0-flash', vision: true },
  'gemini-3.1-pro':      { provider: 'google', apiModel: 'gemini-3.1-pro', vision: true },
  'gemini-2.5-flash':    { provider: 'google', apiModel: 'gemini-2.5-flash-preview-05-20', vision: true },
  // Anthropic models (for completeness — usually called natively from Claude Code)
  'claude-opus-4-6':     { provider: 'anthropic', apiModel: 'claude-opus-4-6', vision: true },
  'claude-sonnet-4-6':   { provider: 'anthropic', apiModel: 'claude-sonnet-4-6', vision: true },
  'claude-haiku-4-5':    { provider: 'anthropic', apiModel: 'claude-haiku-4-5-20251001', vision: true },
};

// --high mode: upgrade map (model name → premium model name)
const HIGH_MODEL_UPGRADE = {
  'gemini-3-flash':      'gemini-3.1-pro',
  'gemini-3-pro':        'gemini-3.1-pro',
  'gemini-2.5-flash':    'gemini-3.1-pro',
  'gpt-5.3-instant':     'gpt-5.4',
  'gpt-5.3-codex-spark': 'gpt-5.3-codex',
  'o4-mini':             'gpt-5.4',
  'claude-haiku-4-5':    'claude-sonnet-4-6',
  'claude-sonnet-4-6':   'claude-opus-4-6',
};

const HIGH_CROSS_VALIDATE_DEFAULTS = 'gpt-5.4,gemini-3.1-pro';
const NORMAL_CROSS_VALIDATE_DEFAULTS = 'gpt-5.4,gemini-3-flash';

const PROVIDER_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  google: (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
  anthropic: 'https://api.anthropic.com/v1/messages',
};

// --- Gemini CLI OAuth credentials (public, embedded in open-source gemini-cli) ---
// Source: https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/oauth2.ts

// --- Auth resolution ---

function hasCodexCLI() {
  try {
    execFileSync('codex', ['--version'], { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch { return false; }
}

async function getOpenAIAuth() {
  // Priority 1: API key → direct API calls
  if (process.env.OPENAI_API_KEY) {
    return { type: 'api-key', method: 'direct', header: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } };
  }

  // Priority 2: Codex CLI installed with ChatGPT OAuth → use codex exec as proxy
  const authFile = join(homedir(), '.codex', 'auth.json');
  if (existsSync(authFile) && hasCodexCLI()) {
    return { type: 'oauth-codex', method: 'codex-proxy' };
  }

  throw new Error(
    'No OpenAI auth found.\n' +
    '  Option 1: export OPENAI_API_KEY="sk-..." (https://platform.openai.com/api-keys)\n' +
    '  Option 2: Login via Codex CLI: npx codex (uses ChatGPT OAuth)'
  );
}

// Call OpenAI models via codex exec (uses ChatGPT OAuth, no API key needed)
function callViaCodexProxy(prompt, imagePath) {
  const args = ['exec', '--skip-git-repo-check'];
  if (imagePath) args.push('-i', imagePath);
  args.push(prompt);

  try {
    const output = execFileSync('codex', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300000,  // 5 min — codex agent needs time for complex prompts
      maxBuffer: 1024 * 1024 * 10,
      env: { ...process.env },
    });
    return output.toString().trim();
  } catch (err) {
    if (err.killed) throw new Error(`codex exec timed out (5min). Try a shorter prompt.`);
    throw new Error(`codex exec failed: ${err.stderr?.toString()?.trim() || err.message}`);
  }
}

function hasGeminiCLI() {
  try {
    execFileSync('gemini', ['--version'], { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch { return false; }
}

// Call Gemini models via gemini -p (uses Google OAuth, no API key needed)
function callViaGeminiProxy(prompt) {
  try {
    const output = execFileSync('gemini', ['-p', prompt], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300000,  // 5 min
      maxBuffer: 1024 * 1024 * 10,
      env: { ...process.env, GOOGLE_GENAI_USE_GCA: 'true' },
      input: 'Y\n',
    });
    return output.toString().trim();
  } catch (err) {
    if (err.killed) throw new Error(`gemini -p timed out (5min). Try a shorter prompt.`);
    throw new Error(`gemini -p failed: ${err.stderr?.toString()?.trim() || err.message}`);
  }
}

async function getGeminiAuth() {
  // Priority 1: API key → direct API calls
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (apiKey) {
    return { type: 'api-key', method: 'direct', key: apiKey };
  }

  // Priority 2: Gemini CLI installed → use gemini -p as proxy
  if (hasGeminiCLI()) {
    return { type: 'oauth-gemini', method: 'gemini-proxy' };
  }

  throw new Error(
    'No Gemini auth found.\n' +
    '  Option 1: export GEMINI_API_KEY="..." (https://aistudio.google.com/apikey)\n' +
    '  Option 2: Login via Gemini CLI: npx @google/gemini-cli'
  );
}

// --- Image encoding ---
function encodeImage(imagePath) {
  const buffer = readFileSync(imagePath);
  const base64 = buffer.toString('base64');
  const ext = extname(imagePath).toLowerCase().replace('.', '');
  const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
  return { base64, mimeType: mimeMap[ext] || 'image/png' };
}

// --- Provider-specific API calls ---

async function callOpenAI(model, prompt, imagePath, maxTokens = 4096) {
  const auth = await getOpenAIAuth();

  // Codex proxy mode: use `codex exec` (ChatGPT OAuth, no API key needed)
  if (auth.method === 'codex-proxy') {
    console.error(`[OpenAI] Using codex exec proxy (ChatGPT OAuth)`);
    const response = callViaCodexProxy(prompt, imagePath, maxTokens);
    return {
      provider: 'openai',
      model: 'gpt-5.3-codex',
      authType: 'codex-proxy',
      response,
      usage: null,
    };
  }

  // Direct API mode: use API key
  const content = [];
  content.push({ type: 'text', text: prompt });

  if (imagePath) {
    const { base64, mimeType } = encodeImage(imagePath);
    content.push({
      type: 'image_url',
      image_url: { url: `data:${mimeType};base64,${base64}` },
    });
  }

  const resp = await fetch(PROVIDER_ENDPOINTS.openai, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth.header },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      max_completion_tokens: maxTokens,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI API error (${resp.status}): ${err}`);
  }

  const data = await resp.json();
  return {
    provider: 'openai',
    model,
    authType: auth.type,
    response: data.choices?.[0]?.message?.content || '',
    usage: data.usage,
  };
}

async function callGoogle(model, prompt, imagePath, maxTokens = 4096) {
  const auth = await getGeminiAuth();

  // Gemini proxy mode: use `gemini -p` (Google OAuth, no API key needed)
  if (auth.method === 'gemini-proxy') {
    if (imagePath) {
      console.error(`[Gemini] Warning: gemini -p proxy does not support image input. Use API key for vision.`);
    }
    console.error(`[Gemini] Using gemini -p proxy (Google OAuth)`);
    const response = callViaGeminiProxy(prompt);
    return {
      provider: 'google',
      model: 'gemini-cli',
      authType: 'gemini-proxy',
      response,
      usage: null,
    };
  }

  // Direct API mode: use API key
  const parts = [{ text: prompt }];

  if (imagePath) {
    const { base64, mimeType } = encodeImage(imagePath);
    parts.push({ inline_data: { mime_type: mimeType, data: base64 } });
  }

  const endpoint = PROVIDER_ENDPOINTS.google(model) + `?key=${auth.key}`;
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Google API error (${resp.status}): ${err}`);
  }

  const data = await resp.json();
  return {
    provider: 'google',
    model,
    authType: auth.type,
    response: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
    usage: data.usageMetadata,
  };
}

async function callAnthropic(model, prompt, imagePath, maxTokens = 4096) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set. Run: export ANTHROPIC_API_KEY="sk-ant-..."');

  const content = [];
  if (imagePath) {
    const { base64, mimeType } = encodeImage(imagePath);
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: mimeType, data: base64 },
    });
  }
  content.push({ type: 'text', text: prompt });

  const resp = await fetch(PROVIDER_ENDPOINTS.anthropic, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content }] }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Anthropic API error (${resp.status}): ${err}`);
  }

  const data = await resp.json();
  return {
    provider: 'anthropic',
    model,
    authType: 'api-key',
    response: data.content?.[0]?.text || '',
    usage: data.usage,
  };
}

// --- Main dispatch ---

function resolveModel(modelName, highMode) {
  if (highMode && HIGH_MODEL_UPGRADE[modelName]) {
    const upgraded = HIGH_MODEL_UPGRADE[modelName];
    console.error(`[HIGH] ${modelName} → ${upgraded}`);
    return upgraded;
  }
  return modelName;
}

async function askModel(modelName, prompt, imagePath, maxTokens = 4096, highMode = false) {
  const resolved = resolveModel(modelName, highMode);
  const config = MODEL_CONFIGS[resolved];
  if (!config) {
    const available = Object.keys(MODEL_CONFIGS).join(', ');
    throw new Error(`Unknown model: ${resolved}. Available: ${available}`);
  }

  if (imagePath && !config.vision) {
    throw new Error(`Model ${resolved} does not support vision/image input`);
  }

  if (imagePath && !existsSync(imagePath)) {
    throw new Error(`Image file not found: ${imagePath}`);
  }

  // In high mode, increase max tokens for premium models
  const effectiveMaxTokens = highMode ? Math.max(maxTokens, 16384) : maxTokens;

  switch (config.provider) {
    case 'openai': return callOpenAI(config.apiModel, prompt, imagePath, effectiveMaxTokens);
    case 'google': return callGoogle(config.apiModel, prompt, imagePath, effectiveMaxTokens);
    case 'anthropic': return callAnthropic(config.apiModel, prompt, imagePath, effectiveMaxTokens);
    default: throw new Error(`Unknown provider: ${config.provider}`);
  }
}

// --- Cross-validation mode ---

async function crossValidate(models, prompt, imagePath, maxTokens = 4096, highMode = false) {
  const results = [];
  const errors = [];

  const promises = models.map(async (modelName) => {
    try {
      const result = await askModel(modelName, prompt, imagePath, maxTokens, highMode);
      results.push(result);
    } catch (err) {
      errors.push({ model: modelName, error: err.message });
    }
  });

  await Promise.all(promises);

  return {
    mode: 'cross-validate',
    high: highMode,
    prompt: prompt.substring(0, 200) + (prompt.length > 200 ? '...' : ''),
    image: imagePath ? basename(imagePath) : null,
    results,
    errors,
    summary: {
      success: results.length,
      failed: errors.length,
      total: models.length,
    },
  };
}

// --- Debate mode: multi-round consensus ---

async function debate(models, prompt, imagePath, maxTokens = 4096, highMode = false, rounds = 2) {
  console.error(`\n[DEBATE] Starting ${rounds}-round debate with ${models.length} models\n`);

  // Round 1: Independent answers
  console.error(`[Round 1] Independent answers...`);
  const round1 = [];
  const round1Promises = models.map(async (modelName) => {
    try {
      const result = await askModel(modelName, prompt, imagePath, maxTokens, highMode);
      round1.push(result);
    } catch (err) {
      round1.push({ provider: 'error', model: modelName, response: `ERROR: ${err.message}`, authType: 'none' });
    }
  });
  await Promise.all(round1Promises);

  // Check for immediate consensus after round 1
  const r1Answers = round1.filter(r => !r.response.startsWith('ERROR:')).map(r => r.response.trim());
  if (r1Answers.length >= 2 && r1Answers.every(a => a === r1Answers[0])) {
    console.error(`[Round 1] UNANIMOUS CONSENSUS — all models agree.\n`);
    return {
      mode: 'debate',
      high: highMode,
      prompt: prompt.substring(0, 200) + (prompt.length > 200 ? '...' : ''),
      rounds: 1,
      consensus: 'unanimous',
      confidence: 'HIGH',
      finalAnswer: r1Answers[0],
      history: [{ round: 1, responses: round1.map(r => ({ model: r.model, provider: r.provider, response: r.response })) }],
    };
  }

  const history = [{ round: 1, responses: round1.map(r => ({ model: r.model, provider: r.provider, response: r.response })) }];

  // Subsequent rounds: each model sees others' answers and can revise
  let currentAnswers = round1;
  for (let round = 2; round <= rounds; round++) {
    console.error(`[Round ${round}] Models review each other's answers...`);

    const othersContext = currentAnswers.map(r =>
      `[${r.provider}/${r.model}]: ${r.response}`
    ).join('\n\n');

    const debatePrompt = `Original question: ${prompt}

Other models answered as follows:
${othersContext}

Review the above answers. If you agree with the consensus, state your final answer.
If you disagree, explain WHY and provide your corrected answer.
Be specific about errors you found in other models' responses.
End your response with a line: FINAL ANSWER: <your answer>`;

    const roundResults = [];
    const roundPromises = models.map(async (modelName) => {
      try {
        const result = await askModel(modelName, debatePrompt, null, maxTokens, highMode);
        roundResults.push(result);
      } catch (err) {
        roundResults.push({ provider: 'error', model: modelName, response: `ERROR: ${err.message}`, authType: 'none' });
      }
    });
    await Promise.all(roundPromises);

    history.push({ round, responses: roundResults.map(r => ({ model: r.model, provider: r.provider, response: r.response })) });
    currentAnswers = roundResults;

    // Extract FINAL ANSWER lines for consensus check
    // Robust extraction: try multiple patterns, fallback to last non-empty line
    const finalAnswers = roundResults
      .filter(r => !r.response.startsWith('ERROR:'))
      .map(r => {
        const text = r.response;
        // Try explicit FINAL ANSWER tag
        const match = text.match(/FINAL\s*ANSWER\s*[:：]\s*(.+)/i);
        if (match) return match[1].trim();
        // Try 최종 답 (Korean)
        const krMatch = text.match(/최종\s*답\s*[:：]\s*(.+)/i);
        if (krMatch) return krMatch[1].trim();
        // Fallback: last non-empty line
        const lines = text.trim().split('\n').filter(l => l.trim());
        return lines[lines.length - 1]?.trim() || text.trim();
      });

    // Normalize for comparison: lowercase, remove commas/spaces/punctuation
    const normalize = (s) => s.toLowerCase().replace(/[,.\s]/g, '');
    if (finalAnswers.length >= 2 && finalAnswers.every(a => normalize(a) === normalize(finalAnswers[0]))) {
      console.error(`[Round ${round}] CONSENSUS REACHED — all models agree.\n`);
      return {
        mode: 'debate',
        high: highMode,
        prompt: prompt.substring(0, 200) + (prompt.length > 200 ? '...' : ''),
        rounds: round,
        consensus: 'unanimous',
        confidence: 'HIGH',
        finalAnswer: finalAnswers[0],
        history,
      };
    }
  }

  // No full consensus — majority vote
  const normalize = (s) => s.toLowerCase().replace(/[,.\s]/g, '');
  const allFinalAnswers = currentAnswers
    .filter(r => !r.response.startsWith('ERROR:'))
    .map(r => {
      const text = r.response;
      const match = text.match(/FINAL\s*ANSWER\s*[:：]\s*(.+)/i);
      if (match) return { model: r.model, answer: match[1].trim() };
      const krMatch = text.match(/최종\s*답\s*[:：]\s*(.+)/i);
      if (krMatch) return { model: r.model, answer: krMatch[1].trim() };
      const lines = text.trim().split('\n').filter(l => l.trim());
      return { model: r.model, answer: lines[lines.length - 1]?.trim() || text.trim() };
    });

  // Simple majority: group by normalized answer, pick most common
  const votes = {};
  for (const { model, answer } of allFinalAnswers) {
    const key = normalize(answer);
    if (!votes[key]) votes[key] = { answer, models: [] };
    votes[key].models.push(model);
  }
  const sorted = Object.values(votes).sort((a, b) => b.models.length - a.models.length);
  const majority = sorted[0];
  const totalVoters = allFinalAnswers.length;
  const majorityCount = majority?.models.length || 0;

  let confidence, consensus;
  if (majorityCount === totalVoters) {
    confidence = 'HIGH'; consensus = 'unanimous';
  } else if (majorityCount > totalVoters / 2) {
    confidence = 'MEDIUM'; consensus = 'majority';
  } else {
    confidence = 'LOW'; consensus = 'no-consensus';
  }

  console.error(`[Debate] ${consensus.toUpperCase()} (${majorityCount}/${totalVoters} agree) — Confidence: ${confidence}\n`);

  return {
    mode: 'debate',
    high: highMode,
    prompt: prompt.substring(0, 200) + (prompt.length > 200 ? '...' : ''),
    rounds,
    consensus,
    confidence,
    finalAnswer: majority?.answer || 'NO CONSENSUS',
    votes: sorted.map(v => ({ answer: v.answer, models: v.models, count: v.models.length })),
    history,
  };
}

// --- Auth info ---

async function showAuthInfo() {
  console.log('=== ask-model.mjs Auth Status ===\n');

  // OpenAI
  console.log('[OpenAI]');
  if (process.env.OPENAI_API_KEY) {
    const k = process.env.OPENAI_API_KEY;
    console.log(`  API Key: ${k.substring(0, 8)}...${k.substring(k.length - 4)} (env)`);
  } else {
    const codexAuth = join(homedir(), '.codex', 'auth.json');
    if (existsSync(codexAuth)) {
      try {
        const auth = JSON.parse(readFileSync(codexAuth, 'utf-8'));
        const last = auth.last_refresh || 'unknown';
        const codexInstalled = hasCodexCLI();
        console.log(`  Codex CLI OAuth: found (last refresh: ${last})`);
        console.log(`  Codex CLI binary: ${codexInstalled ? 'installed (codex exec proxy available)' : 'NOT FOUND'}`);
        if (codexInstalled) {
          console.log(`  Mode: codex exec proxy (ChatGPT OAuth → gpt-5.3-codex)`);
        } else {
          console.log(`  NOTE: Install codex CLI for proxy mode: npm i -g @openai/codex`);
        }
      } catch { console.log('  Codex CLI OAuth: found but unreadable'); }
    } else {
      console.log('  NOT CONFIGURED');
    }
  }

  // Gemini
  console.log('\n[Gemini]');
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (geminiKey) {
    console.log(`  API Key: ${geminiKey.substring(0, 8)}...${geminiKey.substring(geminiKey.length - 4)} (env)`);
  } else {
    const geminiInstalled = hasGeminiCLI();
    if (geminiInstalled) {
      console.log(`  Gemini CLI: installed (gemini -p proxy available)`);
      console.log(`  Mode: gemini -p proxy (Google OAuth)`);
    } else {
      console.log('  NOT CONFIGURED');
    }
  }

  // Anthropic
  console.log('\n[Anthropic]');
  if (process.env.ANTHROPIC_API_KEY) {
    const k = process.env.ANTHROPIC_API_KEY;
    console.log(`  API Key: ${k.substring(0, 8)}...${k.substring(k.length - 4)} (env)`);
  } else {
    console.log('  NOT CONFIGURED (usually called from Claude Code directly)');
  }

  // Setup guide
  console.log('\n[Setup Guide]');
  console.log('  Gemini (free): https://aistudio.google.com/apikey');
  console.log('  OpenAI (paid): https://platform.openai.com/api-keys');
  console.log('  Gemini OAuth:  npx @google/gemini-cli (login with Google)');

  // High mode info
  console.log('\n[--high Mode Upgrades]');
  for (const [from, to] of Object.entries(HIGH_MODEL_UPGRADE)) {
    console.log(`  ${from.padEnd(24)} → ${to}`);
  }
}

// --- CLI ---

async function main() {
  const { values } = parseArgs({
    options: {
      model:            { type: 'string', short: 'm' },
      prompt:           { type: 'string', short: 'p' },
      image:            { type: 'string', short: 'i' },
      'max-tokens':     { type: 'string', default: '4096' },
      'cross-validate': { type: 'boolean', default: false },
      debate:           { type: 'boolean', default: false },
      rounds:           { type: 'string', default: '2' },
      models:           { type: 'string' },
      list:             { type: 'boolean', default: false },
      json:             { type: 'boolean', default: false },
      high:             { type: 'boolean', default: false },
      'auth-info':      { type: 'boolean', default: false },
    },
  });

  // Auth info
  if (values['auth-info']) {
    await showAuthInfo();
    return;
  }

  // List available models
  if (values.list) {
    console.log('Available models:');
    for (const [name, config] of Object.entries(MODEL_CONFIGS)) {
      const vision = config.vision ? '+ vision' : '';
      const highTag = HIGH_MODEL_UPGRADE[name] ? `  [--high → ${HIGH_MODEL_UPGRADE[name]}]` : '';
      console.log(`  ${name.padEnd(24)} ${config.provider.padEnd(10)} ${vision}${highTag}`);
    }
    return;
  }

  if (!values.prompt) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    values.prompt = Buffer.concat(chunks).toString().trim();
  }

  if (!values.prompt) {
    console.error('Error: --prompt is required (or pipe via stdin)');
    process.exit(1);
  }

  const highMode = values.high;

  try {
    let output;

    if (values.debate) {
      const defaultModels = highMode ? HIGH_CROSS_VALIDATE_DEFAULTS : NORMAL_CROSS_VALIDATE_DEFAULTS;
      const models = (values.models || defaultModels).split(',').map(s => s.trim());
      output = await debate(models, values.prompt, values.image, parseInt(values['max-tokens']), highMode, parseInt(values.rounds));
    } else if (values['cross-validate']) {
      const defaultModels = highMode ? HIGH_CROSS_VALIDATE_DEFAULTS : NORMAL_CROSS_VALIDATE_DEFAULTS;
      const models = (values.models || defaultModels).split(',').map(s => s.trim());
      output = await crossValidate(models, values.prompt, values.image, parseInt(values['max-tokens']), highMode);
    } else {
      const model = values.model || 'gpt-5.4';
      output = await askModel(model, values.prompt, values.image, parseInt(values['max-tokens']), highMode);
    }

    if (values.json) {
      console.log(JSON.stringify(output, null, 2));
    } else if (output.mode === 'debate') {
      const highLabel = output.high ? ' [HIGH]' : '';
      console.log(`\n=== DEBATE RESULT${highLabel} ===`);
      console.log(`Rounds: ${output.rounds} | Consensus: ${output.consensus} | Confidence: ${output.confidence}`);
      console.log(`\nFINAL ANSWER: ${output.finalAnswer}\n`);

      if (output.votes) {
        console.log('--- Votes ---');
        for (const v of output.votes) {
          console.log(`  [${v.count} vote(s)] ${v.answer} (${v.models.join(', ')})`);
        }
        console.log();
      }

      // Show debate history
      for (const round of output.history) {
        console.log(`--- Round ${round.round} ---`);
        for (const r of round.responses) {
          console.log(`[${r.provider}/${r.model}]:`);
          // For round 1 show full, for later rounds show last part
          const text = round.round === 1 ? r.response : r.response.substring(r.response.length - 500);
          console.log(text);
          console.log();
        }
      }
    } else if (output.mode === 'cross-validate') {
      const highLabel = output.high ? ' [HIGH]' : '';
      console.log(`\n=== Cross-Validation Results (${output.summary.success}/${output.summary.total} models)${highLabel} ===\n`);
      for (const r of output.results) {
        console.log(`--- ${r.provider}/${r.model} (${r.authType}) ---`);
        console.log(r.response);
        console.log();
      }
      if (output.errors.length > 0) {
        console.log('--- Errors ---');
        for (const e of output.errors) {
          console.log(`${e.model}: ${e.error}`);
        }
      }
    } else {
      console.log(output.response);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
