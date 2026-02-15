import * as osascript from './osascript.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function launchApp(appName: string): Promise<void> {
  await osascript.activateApp(appName);
}

export async function quitApp(appName: string): Promise<void> {
  await osascript.quitApp(appName);
}

export async function isAppRunning(appName: string): Promise<boolean> {
  const result = await osascript.runAppleScript(
    `tell application "System Events" to (name of processes) contains "${appName.replace(/"/g, '\\"')}"`
  );
  return result === 'true';
}

export async function listRunningApps(): Promise<string[]> {
  const result = await osascript.runAppleScript(
    'tell application "System Events" to get name of every process whose background only is false'
  );
  return result.split(', ');
}

export async function openFile(filePath: string): Promise<void> {
  await execFileAsync('open', [filePath]);
}

export async function openWithApp(filePath: string, appName: string): Promise<void> {
  await execFileAsync('open', ['-a', appName, filePath]);
}

export async function getFrontmostApp(): Promise<string> {
  return osascript.getFrontmostApp();
}
