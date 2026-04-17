#!/usr/bin/env node
/**
 * ocr-image.mjs — Multi-engine OCR tool for SC-Arena
 *
 * Sends an image to multiple vision APIs for OCR cross-validation.
 * Uses the same ask-model.mjs infrastructure.
 *
 * Usage:
 *   node ocr-image.mjs /path/to/image.png
 *   node ocr-image.mjs /path/to/image.png --engines gpt-5.4,gemini-3-flash
 *   node ocr-image.mjs /path/to/image.png --mode table   # Extract table structure
 *   node ocr-image.mjs /path/to/image.png --mode math    # Extract math equations
 *   node ocr-image.mjs /path/to/image.png --mode chart   # Extract chart data points
 *
 * Environment:
 *   OPENAI_API_KEY, GEMINI_API_KEY (at least one required)
 */

import { existsSync, readFileSync } from 'fs';
import { parseArgs } from 'util';
import { extname, join } from 'path';
import { homedir } from 'os';

// Note: OCR requires image input which CLI proxies don't support.
// For OCR, API keys are needed (or use Claude Vision directly from Claude Code).

function getGeminiAuth() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (apiKey) return { type: 'api-key', key: apiKey };
  return null;
}

function getOpenAIAuth() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const authFile = join(homedir(), '.codex', 'auth.json');
  if (existsSync(authFile)) {
    try {
      const auth = JSON.parse(readFileSync(authFile, 'utf-8'));
      if (auth.tokens?.access_token) return auth.tokens.access_token;
    } catch {}
  }
  return null;
}

function getUpstageAuth() {
  return process.env.UPSTAGE_API_KEY || null;
}

function encodeImage(imagePath) {
  const buffer = readFileSync(imagePath);
  const base64 = buffer.toString('base64');
  const ext = extname(imagePath).toLowerCase().replace('.', '');
  const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
  return { base64, mimeType: mimeMap[ext] || 'image/png' };
}

const OCR_PROMPTS = {
  general: `Extract ALL text from this image. Return the text exactly as it appears, preserving formatting, line breaks, and structure. If there are multiple columns, process left to right, top to bottom. Do NOT interpret or summarize — just extract raw text.`,

  table: `Extract the table from this image into a structured format. Return it as a markdown table with exact values. Preserve all numbers, headers, and cell content exactly as shown. If merged cells exist, note them.`,

  math: `Extract all mathematical equations and expressions from this image. Use LaTeX notation for formulas. List each equation on a separate line. Preserve subscripts, superscripts, Greek letters, and operators exactly.`,

  chart: `Extract all data points from this chart/graph image. Return as a structured table with columns for each axis/series. Include:
- Chart title (if visible)
- Axis labels and scales
- All data points with their exact values
- Legend entries
Format as a markdown table.`,

  korean: `이 이미지에서 모든 텍스트를 추출하세요. 한국어와 영어를 모두 정확하게 추출하세요. 원본의 형식, 줄바꿈, 구조를 보존하세요. 해석하거나 요약하지 말고, 원문 텍스트만 추출하세요.`,

  document: `Extract all text from this document image. Preserve the document structure:
- Headers/titles
- Paragraphs
- Bullet points/numbered lists
- Any tabular data
- Footnotes
Return clean, structured text maintaining the original hierarchy.`,
};

async function ocrWithOpenAI(model, imagePath, prompt) {
  const token = getOpenAIAuth();
  if (!token) return { engine: `openai/${model}`, error: 'No OpenAI auth (set OPENAI_API_KEY or login with codex)' };

  const { base64, mimeType } = encodeImage(imagePath);

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        }],
        max_completion_tokens: 4096,
      }),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    return {
      engine: `openai/${model}`,
      text: data.choices?.[0]?.message?.content || '',
      tokens: data.usage,
    };
  } catch (err) {
    return { engine: `openai/${model}`, error: err.message };
  }
}

async function ocrWithUpstage(imagePath, mode) {
  const apiKey = getUpstageAuth();
  if (!apiKey) return { engine: 'upstage/solar-ocr', error: 'UPSTAGE_API_KEY not set. Get one at https://console.upstage.ai/' };

  try {
    const { FormData, File } = await import('undici').catch(() => ({ FormData: globalThis.FormData, File: globalThis.File }));
    const buffer = readFileSync(imagePath);
    const ext = extname(imagePath).toLowerCase().replace('.', '');
    const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', pdf: 'application/pdf' };
    const mimeType = mimeMap[ext] || 'image/png';

    const form = new FormData();
    form.append('model', 'ocr');
    form.append('document', new File([buffer], `image.${ext}`, { type: mimeType }));
    if (mode === 'table' || mode === 'chart') {
      form.append('chart_recognition', 'true');
    }

    const resp = await fetch('https://api.upstage.ai/v1/document-digitization', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: form,
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();

    // Extract text from response - Upstage returns pages with text
    let text = '';
    if (data.text) {
      text = data.text;
    } else if (data.pages) {
      text = data.pages.map(p => p.text || '').join('\n\n');
    } else if (data.content) {
      text = typeof data.content === 'string' ? data.content : JSON.stringify(data.content, null, 2);
    } else {
      text = JSON.stringify(data, null, 2);
    }

    return {
      engine: 'upstage/solar-ocr',
      text,
      tokens: data.usage || null,
    };
  } catch (err) {
    return { engine: 'upstage/solar-ocr', error: err.message };
  }
}

async function ocrWithGemini(model, imagePath, prompt) {
  const auth = getGeminiAuth();
  if (!auth) return { engine: `google/${model}`, error: 'GEMINI_API_KEY not set (required for vision/OCR). Get one free: https://aistudio.google.com/apikey' };

  const { base64, mimeType } = encodeImage(imagePath);

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${auth.key}`;
    const headers = { 'Content-Type': 'application/json' };

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        }],
        generationConfig: { maxOutputTokens: 4096 },
      }),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    return {
      engine: `google/${model}`,
      text: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
      tokens: data.usageMetadata,
    };
  } catch (err) {
    return { engine: `google/${model}`, error: err.message };
  }
}

// --- Main ---

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      engines: { type: 'string', default: 'upstage,gpt-5.4,gemini-3.0-flash' },
      mode: { type: 'string', short: 'm', default: 'general' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(`Usage: node ocr-image.mjs <image-path> [options]
Options:
  --engines   Comma-separated models (default: upstage,gpt-5.4,gemini-3.0-flash)
              Available: upstage (Solar OCR, best for Korean), gpt-5.4, gemini-3.0-flash
  --mode      OCR mode: general|table|math|chart|korean|document (default: general)
  --json      Output as JSON
Modes: ${Object.keys(OCR_PROMPTS).join(', ')}

Note: For Korean OCR, Upstage Solar OCR is the most accurate engine.
      Set UPSTAGE_API_KEY from https://console.upstage.ai/`);
    return;
  }

  const imagePath = positionals[0];
  if (!existsSync(imagePath)) {
    console.error(`Error: File not found: ${imagePath}`);
    process.exit(1);
  }

  const prompt = OCR_PROMPTS[values.mode] || OCR_PROMPTS.general;
  const engines = values.engines.split(',').map(s => s.trim());

  console.error(`OCR: ${imagePath} | mode: ${values.mode} | engines: ${engines.join(', ')}`);

  // Run all engines in parallel
  const results = await Promise.all(engines.map(async (engine) => {
    if (engine === 'upstage' || engine === 'solar') {
      return ocrWithUpstage(imagePath, values.mode);
    } else if (engine.startsWith('gpt-') || engine.startsWith('o4-')) {
      return ocrWithOpenAI(engine, imagePath, prompt);
    } else if (engine.startsWith('gemini-')) {
      return ocrWithGemini(engine, imagePath, prompt);
    } else {
      return { engine, error: `Unknown engine: ${engine}` };
    }
  }));

  if (values.json) {
    console.log(JSON.stringify({ image: imagePath, mode: values.mode, results }, null, 2));
    return;
  }

  // Display results
  const successful = results.filter(r => !r.error);
  const failed = results.filter(r => r.error);

  for (const r of successful) {
    console.log(`\n=== ${r.engine} ===`);
    console.log(r.text);
  }

  if (failed.length > 0) {
    console.log('\n--- Errors ---');
    for (const r of failed) {
      console.log(`${r.engine}: ${r.error}`);
    }
  }

  // Cross-validation summary
  if (successful.length >= 2) {
    console.log('\n=== Cross-Validation ===');
    const texts = successful.map(r => r.text.trim());
    const match = texts.every(t => t === texts[0]);
    if (match) {
      console.log('RESULT: All engines AGREE');
    } else {
      console.log('RESULT: Engines DISAGREE — review differences manually');
      // Simple diff: compare lengths and first divergence
      for (let i = 0; i < texts.length; i++) {
        console.log(`  ${successful[i].engine}: ${texts[i].length} chars`);
      }
    }
  }
}

main();
