import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const execFileAsync = promisify(execFile);

const PEEKABOO_PATH = process.env.PEEKABOO_PATH ?? '/opt/homebrew/bin/peekaboo';

// Minimum idle seconds before UI-interactive commands are allowed.
// Commands like click, type, hotkey move the mouse/keyboard — block if user is active.
const IDLE_THRESHOLD_SECS = Number(process.env.SC_IDLE_THRESHOLD ?? 120);

// Commands that interfere with user input (move mouse, press keys, steal focus)
const INTERACTIVE_COMMANDS = new Set(['click', 'type', 'hotkey']);

async function getUserIdleSeconds(): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ioreg', ['-c', 'IOHIDSystem', '-d', '4'], {
      timeout: 3000,
    });
    const match = stdout.match(/"HIDIdleTime"\s*=\s*(\d+)/);
    if (match) return Number(match[1]) / 1_000_000_000;
  } catch { /* fall through */ }
  return Infinity; // if we can't read, assume idle (don't block)
}

async function assertUserIdle(command: string): Promise<void> {
  if (!INTERACTIVE_COMMANDS.has(command)) return;
  const idle = await getUserIdleSeconds();
  if (idle < IDLE_THRESHOLD_SECS) {
    throw new Error(
      `[SC_USER_ACTIVE] User is actively using the Mac (idle ${Math.round(idle)}s < ${IDLE_THRESHOLD_SECS}s threshold). ` +
      `Refusing to run "${command}" — try again later or wait until the user is idle.`
    );
  }
}

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
    killSignal: 'SIGKILL',
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
  const args = ['image', '--path', outPath];

  if (options?.window) {
    args.push('--app', options.window);
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
  await assertUserIdle('click');
  const args = ['click'];
  if (typeof target === 'string') {
    args.push('--element', target);
  } else {
    args.push('--position', `${target.x},${target.y}`);
  }
  await runPeekaboo(args);
}

export async function typeText(text: string): Promise<void> {
  await assertUserIdle('type');
  await runPeekaboo(['type', '--text', text]);
}

export async function hotkey(keys: string): Promise<void> {
  await assertUserIdle('hotkey');
  await runPeekaboo(['hotkey', '--keys', keys]);
}

export async function ocr(options?: { window?: string }): Promise<string> {
  // Peekaboo does not expose a standalone 'ocr' subcommand.
  // Use 'see --json' to capture UI elements and extract visible text from titles/values.
  const args = ['see', '--json'];
  if (options?.window) args.push('--app', options.window);
  const raw = await runPeekaboo(args);
  try {
    const parsed = JSON.parse(raw);
    const elements: Array<{ title?: string; value?: string }> = parsed.elements ?? parsed ?? [];
    const texts = elements
      .flatMap((el) => [el.title, el.value])
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
    return texts.join('\n');
  } catch {
    return raw;
  }
}
