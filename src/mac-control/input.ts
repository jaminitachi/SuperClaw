import * as peekaboo from './peekaboo.js';
import * as osascript from './osascript.js';

// Allowed AppleScript modifier names (whitelist to prevent injection via modifier strings)
const ALLOWED_MODIFIERS = new Set(['command', 'option', 'control', 'shift']);

/**
 * Validate that each modifier is a known AppleScript modifier keyword.
 * Throws if any unknown modifier is supplied.
 */
function validateModifiers(modifiers: string[]): void {
  for (const mod of modifiers) {
    if (!ALLOWED_MODIFIERS.has(mod)) {
      throw new Error(
        `Invalid modifier "${mod}". Allowed values: ${[...ALLOWED_MODIFIERS].join(', ')}`
      );
    }
  }
}

export async function clickElement(elementId: string): Promise<void> {
  await peekaboo.click(elementId);
}

export async function clickPosition(x: number, y: number): Promise<void> {
  await peekaboo.click({ x, y });
}

export async function typeText(text: string): Promise<void> {
  await peekaboo.typeText(text);
}

export async function pressHotkey(keys: string): Promise<void> {
  await peekaboo.hotkey(keys);
}

export async function keystroke(key: string, modifiers?: string[]): Promise<void> {
  // Escape backslashes first, then double-quotes, to prevent AppleScript injection
  const safeKey = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  if (modifiers?.length) {
    validateModifiers(modifiers);
  }
  const modPart = modifiers?.length
    ? ` using {${modifiers.map((m) => `${m} down`).join(', ')}}`
    : '';
  await osascript.runAppleScript(
    `tell application "System Events" to keystroke "${safeKey}"${modPart}`
  );
}

export async function keyCode(code: number, modifiers?: string[]): Promise<void> {
  // code is typed as number — no string injection risk, but clamp to valid key-code range
  const safeCode = Math.trunc(code);
  if (safeCode < 0 || safeCode > 127) {
    throw new Error(`Invalid key code ${code}. Must be 0–127.`);
  }
  if (modifiers?.length) {
    validateModifiers(modifiers);
  }
  const modPart = modifiers?.length
    ? ` using {${modifiers.map((m) => `${m} down`).join(', ')}}`
    : '';
  await osascript.runAppleScript(
    `tell application "System Events" to key code ${safeCode}${modPart}`
  );
}
