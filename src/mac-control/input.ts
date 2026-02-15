import * as peekaboo from './peekaboo.js';
import * as osascript from './osascript.js';

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
  const modPart = modifiers?.length
    ? ` using {${modifiers.map((m) => `${m} down`).join(', ')}}`
    : '';
  await osascript.runAppleScript(
    `tell application "System Events" to keystroke "${key}"${modPart}`
  );
}

export async function keyCode(code: number, modifiers?: string[]): Promise<void> {
  const modPart = modifiers?.length
    ? ` using {${modifiers.map((m) => `${m} down`).join(', ')}}`
    : '';
  await osascript.runAppleScript(
    `tell application "System Events" to key code ${code}${modPart}`
  );
}
