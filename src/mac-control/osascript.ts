import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function runAppleScript(script: string, timeoutMs = 10000): Promise<string> {
  const { stdout } = await execFileAsync('osascript', ['-e', script], {
    timeout: timeoutMs,
  });
  return stdout.trim();
}

export async function runJXA(script: string, timeoutMs = 10000): Promise<string> {
  const { stdout } = await execFileAsync('osascript', ['-l', 'JavaScript', '-e', script], {
    timeout: timeoutMs,
  });
  return stdout.trim();
}

export async function getCalendarEvents(days = 1): Promise<string> {
  const script = `
    tell application "Calendar"
      set today to current date
      set endDate to today + (${days} * days)
      set eventList to ""
      repeat with cal in calendars
        set evts to (every event of cal whose start date >= today and start date <= endDate)
        repeat with evt in evts
          set eventList to eventList & summary of evt & " | " & (start date of evt as string) & linefeed
        end repeat
      end repeat
      return eventList
    end tell
  `;
  return runAppleScript(script);
}

export async function sendNotification(title: string, message: string): Promise<void> {
  await runAppleScript(
    `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`
  );
}

export async function getFrontmostApp(): Promise<string> {
  return runAppleScript(
    'tell application "System Events" to get name of first process whose frontmost is true'
  );
}

export async function setVolume(level: number): Promise<void> {
  await runAppleScript(`set volume output volume ${Math.max(0, Math.min(100, level))}`);
}

export async function getSelectedFinderFile(): Promise<string> {
  return runAppleScript(
    'tell application "Finder" to get POSIX path of (selection as alias)'
  );
}

export async function openURL(url: string): Promise<void> {
  await execFileAsync('open', [url]);
}

export async function activateApp(appName: string): Promise<void> {
  await runAppleScript(`tell application "${appName.replace(/"/g, '\\"')}" to activate`);
}

export async function quitApp(appName: string): Promise<void> {
  await runAppleScript(`tell application "${appName.replace(/"/g, '\\"')}" to quit`);
}
