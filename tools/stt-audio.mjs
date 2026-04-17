#!/usr/bin/env node
/**
 * stt-audio.mjs — Speech-to-Text tool for SC-Arena
 *
 * Uses ElevenLabs Scribe v2 (industry-leading STT accuracy).
 * Beats Whisper v3, Gemini, Deepgram Nova-3 across benchmarks.
 * Supports 99 languages including Korean.
 *
 * Usage:
 *   node stt-audio.mjs /path/to/audio.mp3
 *   node stt-audio.mjs /path/to/audio.wav --language ko
 *   node stt-audio.mjs /path/to/video.mp4 --timestamps
 *   node stt-audio.mjs /path/to/audio.mp3 --engine whisper   # fallback to Whisper
 *   node stt-audio.mjs /path/to/audio.mp3 --cross-validate   # Scribe + Whisper
 *
 * Environment:
 *   ELEVENLABS_API_KEY (primary — Scribe v2)
 *   OPENAI_API_KEY (fallback — Whisper)
 */

import { existsSync, readFileSync } from 'fs';
import { parseArgs } from 'util';
import { basename, extname, join } from 'path';
import { homedir } from 'os';

function getElevenLabsAuth() {
  return process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY || null;
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

// --- ElevenLabs Scribe v2 ---

async function sttWithScribe(audioPath, options = {}) {
  const apiKey = getElevenLabsAuth();
  if (!apiKey) {
    return {
      engine: 'elevenlabs/scribe_v2',
      error: 'ELEVENLABS_API_KEY not set. Get one at https://elevenlabs.io/app/settings/api-keys',
    };
  }

  try {
    const buffer = readFileSync(audioPath);
    const ext = extname(audioPath).toLowerCase().replace('.', '');
    const mimeMap = {
      mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/m4a', ogg: 'audio/ogg',
      flac: 'audio/flac', webm: 'audio/webm', mp4: 'video/mp4', mkv: 'video/x-matroska',
      avi: 'video/x-msvideo', mov: 'video/quicktime',
    };
    const mimeType = mimeMap[ext] || 'audio/mpeg';

    const form = new FormData();
    form.append('file', new File([buffer], basename(audioPath), { type: mimeType }));
    form.append('model_id', 'scribe_v2');

    if (options.language) {
      form.append('language_code', options.language);
    }
    if (options.timestamps) {
      form.append('timestamps_granularity', 'word');
    }
    if (options.keyterms) {
      for (const term of options.keyterms) {
        form.append('keyterms[]', term);
      }
    }

    const resp = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();

    return {
      engine: 'elevenlabs/scribe_v2',
      text: data.text || '',
      language: data.language_code || options.language || 'auto',
      words: data.words || null,
      duration: data.duration || null,
    };
  } catch (err) {
    return { engine: 'elevenlabs/scribe_v2', error: err.message };
  }
}

// --- OpenAI Whisper (fallback) ---

async function sttWithWhisper(audioPath, options = {}) {
  const apiKey = getOpenAIAuth();
  if (!apiKey) {
    return {
      engine: 'openai/whisper-1',
      error: 'OPENAI_API_KEY not set.',
    };
  }

  try {
    const buffer = readFileSync(audioPath);
    const ext = extname(audioPath).toLowerCase().replace('.', '');
    const mimeMap = {
      mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/m4a', ogg: 'audio/ogg',
      flac: 'audio/flac', webm: 'audio/webm', mp4: 'video/mp4',
    };
    const mimeType = mimeMap[ext] || 'audio/mpeg';

    const form = new FormData();
    form.append('file', new File([buffer], basename(audioPath), { type: mimeType }));
    form.append('model', 'whisper-1');

    if (options.language) {
      form.append('language', options.language);
    }
    if (options.timestamps) {
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'word');
    }

    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: form,
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();

    return {
      engine: 'openai/whisper-1',
      text: data.text || '',
      language: data.language || options.language || 'auto',
      words: data.words || null,
      duration: data.duration || null,
    };
  } catch (err) {
    return { engine: 'openai/whisper-1', error: err.message };
  }
}

// --- Main ---

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      engine: { type: 'string', short: 'e', default: 'scribe' },
      language: { type: 'string', short: 'l' },
      timestamps: { type: 'boolean', default: false },
      keyterms: { type: 'string', short: 'k' },
      'cross-validate': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(`Usage: node stt-audio.mjs <audio-path> [options]

STT Engines (ranked by accuracy):
  scribe   ElevenLabs Scribe v2 — BEST accuracy, 99 languages (default)
  whisper  OpenAI Whisper — good fallback

Options:
  --engine, -e       STT engine: scribe|whisper (default: scribe)
  --language, -l     Language code: ko, en, ja, etc. (default: auto-detect)
  --timestamps       Include word-level timestamps
  --keyterms, -k     Comma-separated key terms to bias transcription (Scribe v2 only)
  --cross-validate   Run both Scribe + Whisper and compare
  --json             Output as JSON

Environment:
  ELEVENLABS_API_KEY   Required for Scribe (https://elevenlabs.io/app/settings/api-keys)
  OPENAI_API_KEY       Required for Whisper

Note: ElevenLabs Scribe v2 is the most accurate STT engine available.
      96.7% English accuracy, beats Whisper v3 and Gemini across all benchmarks.`);
    return;
  }

  const audioPath = positionals[0];
  if (!existsSync(audioPath)) {
    console.error(`Error: File not found: ${audioPath}`);
    process.exit(1);
  }

  const options = {
    language: values.language,
    timestamps: values.timestamps,
    keyterms: values.keyterms ? values.keyterms.split(',').map(s => s.trim()) : null,
  };

  console.error(`STT: ${audioPath} | engine: ${values.engine} | language: ${options.language || 'auto'}`);

  if (values['cross-validate']) {
    // Run both engines in parallel
    const [scribeResult, whisperResult] = await Promise.all([
      sttWithScribe(audioPath, options),
      sttWithWhisper(audioPath, options),
    ]);

    const results = [scribeResult, whisperResult];

    if (values.json) {
      console.log(JSON.stringify({ audio: audioPath, mode: 'cross-validate', results }, null, 2));
      return;
    }

    for (const r of results) {
      if (r.error) {
        console.log(`\n=== ${r.engine} === ERROR: ${r.error}`);
      } else {
        console.log(`\n=== ${r.engine} (lang: ${r.language}) ===`);
        console.log(r.text);
      }
    }

    // Compare
    const successful = results.filter(r => !r.error);
    if (successful.length >= 2) {
      console.log('\n=== Cross-Validation ===');
      const match = successful[0].text.trim() === successful[1].text.trim();
      if (match) {
        console.log('RESULT: Both engines AGREE');
      } else {
        console.log('RESULT: Engines DISAGREE — review differences');
        for (const r of successful) {
          console.log(`  ${r.engine}: ${r.text.length} chars`);
        }
      }
    }
    return;
  }

  // Single engine
  let result;
  switch (values.engine) {
    case 'scribe':
    case 'elevenlabs':
      result = await sttWithScribe(audioPath, options);
      break;
    case 'whisper':
    case 'openai':
      result = await sttWithWhisper(audioPath, options);
      break;
    default:
      console.error(`Unknown engine: ${values.engine}. Use: scribe, whisper`);
      process.exit(1);
  }

  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.error) {
    console.error(`Error (${result.engine}): ${result.error}`);
    process.exit(1);
  }

  console.log(`\n=== ${result.engine} (lang: ${result.language}) ===`);
  console.log(result.text);

  if (result.words && values.timestamps) {
    console.log('\n--- Timestamps ---');
    for (const w of result.words) {
      const start = w.start?.toFixed(2) || '?';
      const end = w.end?.toFixed(2) || '?';
      console.log(`  [${start}s - ${end}s] ${w.text || w.word}`);
    }
  }
}

main();
