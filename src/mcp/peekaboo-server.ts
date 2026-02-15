import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as peekaboo from '../mac-control/peekaboo.js';
import * as osascriptMod from '../mac-control/osascript.js';
import * as screenshotPipeline from '../mac-control/screenshot.js';
import * as appControl from '../mac-control/app-control.js';
import * as windowMgmt from '../mac-control/window-mgmt.js';
import * as input from '../mac-control/input.js';

const server = new McpServer({
  name: 'sc-peekaboo',
  version: '1.0.0',
});

// --- Screenshot ---

server.tool(
  'sc_screenshot',
  'Take a screenshot of the entire screen or a specific window. Returns the file path.',
  {
    window: z.string().optional().describe('Target window name or app name'),
    format: z.enum(['png', 'jpg']).optional().describe('Image format (default: png)'),
  },
  async ({ window: win, format }) => {
    const result = await screenshotPipeline.captureAndAnalyze({
      window: win,
      includeOCR: true,
    });
    const parts = [
      `Screenshot saved: ${result.path}`,
    ];
    if (result.ocrText) {
      parts.push(`\nOCR Text:\n${result.ocrText}`);
    }
    return { content: [{ type: 'text', text: parts.join('\n') }] };
  }
);

// --- UI Inspection ---

server.tool(
  'sc_see',
  'Inspect UI elements of the current screen or a specific app using Peekaboo. Returns element IDs, roles, titles for interaction.',
  {
    app: z.string().optional().describe('Target application name'),
  },
  async ({ app }) => {
    const result = await peekaboo.see({ app });
    if (result.elements.length === 0) {
      return { content: [{ type: 'text', text: result.raw || 'No elements found' }] };
    }
    const summary = result.elements.map((el) =>
      `[${el.id}] ${el.role}: ${el.title ?? el.value ?? '(no label)'}${el.frame ? ` @ (${el.frame.x},${el.frame.y} ${el.frame.w}x${el.frame.h})` : ''}`
    ).join('\n');
    return { content: [{ type: 'text', text: summary }] };
  }
);

// --- Click ---

server.tool(
  'sc_click',
  'Click a UI element by ID or screen coordinates',
  {
    element: z.string().optional().describe('UI element ID from sc_see'),
    x: z.number().optional().describe('X coordinate'),
    y: z.number().optional().describe('Y coordinate'),
  },
  async ({ element, x, y }) => {
    if (element) {
      await peekaboo.click(element);
      return { content: [{ type: 'text', text: `Clicked element: ${element}` }] };
    }
    if (x !== undefined && y !== undefined) {
      await peekaboo.click({ x, y });
      return { content: [{ type: 'text', text: `Clicked position: (${x}, ${y})` }] };
    }
    return { content: [{ type: 'text', text: 'Provide either element ID or x,y coordinates' }], isError: true };
  }
);

// --- Type ---

server.tool(
  'sc_type',
  'Type text at the current cursor position',
  {
    text: z.string().describe('Text to type'),
  },
  async ({ text }) => {
    await input.typeText(text);
    return { content: [{ type: 'text', text: `Typed: "${text}"` }] };
  }
);

// --- Hotkey ---

server.tool(
  'sc_hotkey',
  'Press a keyboard shortcut (e.g., "cmd+c", "cmd+shift+s")',
  {
    keys: z.string().describe('Key combination (e.g., "cmd+c", "cmd+shift+s")'),
  },
  async ({ keys }) => {
    await input.pressHotkey(keys);
    return { content: [{ type: 'text', text: `Pressed hotkey: ${keys}` }] };
  }
);

// --- OCR ---

server.tool(
  'sc_ocr',
  'Extract text from the screen or a specific window using OCR',
  {
    window: z.string().optional().describe('Target window name'),
  },
  async ({ window: win }) => {
    const text = await peekaboo.ocr({ window: win });
    return { content: [{ type: 'text', text: text || '(no text detected)' }] };
  }
);

// --- App Control ---

server.tool(
  'sc_app_launch',
  'Launch/activate a macOS application',
  {
    app: z.string().describe('Application name (e.g., "Safari", "Terminal")'),
  },
  async ({ app }) => {
    await appControl.launchApp(app);
    return { content: [{ type: 'text', text: `Launched: ${app}` }] };
  }
);

server.tool(
  'sc_app_quit',
  'Quit a macOS application',
  {
    app: z.string().describe('Application name'),
  },
  async ({ app }) => {
    await appControl.quitApp(app);
    return { content: [{ type: 'text', text: `Quit: ${app}` }] };
  }
);

server.tool(
  'sc_app_list',
  'List currently running macOS applications',
  {},
  async () => {
    const apps = await appControl.listRunningApps();
    return { content: [{ type: 'text', text: apps.join('\n') }] };
  }
);

server.tool(
  'sc_app_frontmost',
  'Get the name of the frontmost (focused) application',
  {},
  async () => {
    const app = await appControl.getFrontmostApp();
    return { content: [{ type: 'text', text: app }] };
  }
);

// --- Window Management ---

server.tool(
  'sc_window_list',
  'List windows of a specific application',
  {
    app: z.string().describe('Application name'),
  },
  async ({ app }) => {
    const windows = await windowMgmt.getWindows(app);
    if (windows.length === 0) {
      return { content: [{ type: 'text', text: `No windows found for ${app}` }] };
    }
    const text = windows.map((w, i) =>
      `[${i}] "${w.name}" pos=(${w.position.x},${w.position.y}) size=${w.size.w}x${w.size.h}`
    ).join('\n');
    return { content: [{ type: 'text', text }] };
  }
);

server.tool(
  'sc_window_move',
  'Move a window to a specific position',
  {
    app: z.string().describe('Application name'),
    x: z.number().describe('X position'),
    y: z.number().describe('Y position'),
    windowIndex: z.number().optional().describe('Window index (default: 0)'),
  },
  async ({ app, x, y, windowIndex }) => {
    await windowMgmt.moveWindow(app, x, y, windowIndex);
    return { content: [{ type: 'text', text: `Moved ${app} window to (${x}, ${y})` }] };
  }
);

server.tool(
  'sc_window_resize',
  'Resize a window',
  {
    app: z.string().describe('Application name'),
    width: z.number().describe('New width'),
    height: z.number().describe('New height'),
    windowIndex: z.number().optional().describe('Window index (default: 0)'),
  },
  async ({ app, width, height, windowIndex }) => {
    await windowMgmt.resizeWindow(app, width, height, windowIndex);
    return { content: [{ type: 'text', text: `Resized ${app} window to ${width}x${height}` }] };
  }
);

// --- AppleScript ---

server.tool(
  'sc_osascript',
  'Execute an AppleScript command and return the result',
  {
    script: z.string().describe('AppleScript code to execute'),
    language: z.enum(['applescript', 'jxa']).optional().describe('Script language (default: applescript)'),
  },
  async ({ script, language }) => {
    const result = language === 'jxa'
      ? await osascriptMod.runJXA(script)
      : await osascriptMod.runAppleScript(script);
    return { content: [{ type: 'text', text: result || '(no output)' }] };
  }
);

// --- Notification ---

server.tool(
  'sc_notify',
  'Send a macOS notification',
  {
    title: z.string().describe('Notification title'),
    message: z.string().describe('Notification message'),
  },
  async ({ title, message }) => {
    await osascriptMod.sendNotification(title, message);
    return { content: [{ type: 'text', text: `Notification sent: ${title}` }] };
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('sc-peekaboo fatal:', err);
  process.exit(1);
});
