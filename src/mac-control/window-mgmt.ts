import * as osascript from './osascript.js';

export interface WindowInfo {
  name: string;
  position: { x: number; y: number };
  size: { w: number; h: number };
}

export async function getWindows(appName: string): Promise<WindowInfo[]> {
  const result = await osascript.runJXA(`
    (function() {
      const app = Application("${appName.replace(/"/g, '\\"')}");
      const wins = app.windows();
      return JSON.stringify(wins.map(w => ({
        name: w.name(),
        position: { x: w.position()[0], y: w.position()[1] },
        size: { w: w.size()[0], h: w.size()[1] }
      })));
    })();
  `);
  try {
    return JSON.parse(result);
  } catch {
    return [];
  }
}

export async function moveWindow(appName: string, x: number, y: number, windowIndex = 0): Promise<void> {
  await osascript.runAppleScript(
    `tell application "${appName.replace(/"/g, '\\"')}" to set position of window ${windowIndex + 1} to {${x}, ${y}}`
  );
}

export async function resizeWindow(appName: string, w: number, h: number, windowIndex = 0): Promise<void> {
  await osascript.runAppleScript(
    `tell application "${appName.replace(/"/g, '\\"')}" to set size of window ${windowIndex + 1} to {${w}, ${h}}`
  );
}

export async function minimizeWindow(appName: string, windowIndex = 0): Promise<void> {
  await osascript.runAppleScript(
    `tell application "${appName.replace(/"/g, '\\"')}" to set miniaturized of window ${windowIndex + 1} to true`
  );
}

export async function focusWindow(appName: string, windowIndex = 0): Promise<void> {
  await osascript.runAppleScript(`
    tell application "${appName.replace(/"/g, '\\"')}"
      activate
      set index of window ${windowIndex + 1} to 1
    end tell
  `);
}
