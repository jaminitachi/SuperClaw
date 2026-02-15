import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const execFileAsync = promisify(execFile);

const PEEKABOO_PATH = process.env.PEEKABOO_PATH ?? '/opt/homebrew/bin/peekaboo';

export interface ScreenshotResult {
  path: string;
  width?: number;
  height?: number;
}

export interface UIElement {
  id: string;
  role: string;
  title?: string;
  value?: string;
  frame?: { x: number; y: number; w: number; h: number };
}

export interface SeeResult {
  elements: UIElement[];
  raw: string;
}

async function runPeekaboo(args: string[], timeoutMs = 15000): Promise<string> {
  const { stdout } = await execFileAsync(PEEKABOO_PATH, args, {
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

export async function screenshot(options?: {
  window?: string;
  region?: { x: number; y: number; w: number; h: number };
  format?: 'png' | 'jpg';
}): Promise<ScreenshotResult> {
  const outPath = join(tmpdir(), `sc-screenshot-${randomUUID()}.${options?.format ?? 'png'}`);
  const args = ['screenshot', '--output', outPath];

  if (options?.window) {
    args.push('--window', options.window);
  }
  if (options?.region) {
    const { x, y, w, h } = options.region;
    args.push('--region', `${x},${y},${w},${h}`);
  }

  await runPeekaboo(args);
  return { path: outPath };
}

export async function see(options?: {
  app?: string;
  window?: string;
}): Promise<SeeResult> {
  const args = ['see'];
  if (options?.app) args.push('--app', options.app);
  if (options?.window) args.push('--window', options.window);
  args.push('--format', 'json');

  const raw = await runPeekaboo(args);
  try {
    const parsed = JSON.parse(raw);
    const elements: UIElement[] = (parsed.elements ?? parsed ?? []).map((el: any) => ({
      id: el.id ?? el.identifier ?? '',
      role: el.role ?? el.type ?? '',
      title: el.title,
      value: el.value,
      frame: el.frame,
    }));
    return { elements, raw };
  } catch {
    return { elements: [], raw };
  }
}

export async function click(target: string | { x: number; y: number }): Promise<void> {
  const args = ['click'];
  if (typeof target === 'string') {
    args.push('--element', target);
  } else {
    args.push('--position', `${target.x},${target.y}`);
  }
  await runPeekaboo(args);
}

export async function typeText(text: string): Promise<void> {
  await runPeekaboo(['type', '--text', text]);
}

export async function hotkey(keys: string): Promise<void> {
  await runPeekaboo(['hotkey', '--keys', keys]);
}

export async function ocr(options?: { window?: string }): Promise<string> {
  const args = ['ocr'];
  if (options?.window) args.push('--window', options.window);
  const result = await runPeekaboo(args);
  return result;
}
