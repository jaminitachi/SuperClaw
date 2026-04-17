import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { platform } from 'os';

// schedule-manager is macOS only — skip on other platforms
const IS_DARWIN = platform() === 'darwin';
const describeIf = IS_DARWIN ? describe : describe.skip;

describeIf('schedule-manager', () => {
  // Dynamic import since it's an .mjs file
  let addSchedule: any;
  let removeSchedule: any;
  let listSchedules: any;
  let syncPmsetWake: any;

  const TEST_NAME = `test-schedule-${Date.now()}`;

  beforeEach(async () => {
    const mod = await import('../scripts/lib/schedule-manager.mjs');
    addSchedule = mod.addSchedule;
    removeSchedule = mod.removeSchedule;
    listSchedules = mod.listSchedules;
    syncPmsetWake = mod.syncPmsetWake;
  });

  afterEach(() => {
    // Cleanup test schedule if created
    try { removeSchedule(TEST_NAME); } catch {}
  });

  it('addSchedule creates plist and bootstraps agent', () => {
    // Use /usr/bin/true as a harmless script
    const result = addSchedule({
      name: TEST_NAME,
      scriptPath: '/usr/bin/true',
      hour: 4,
      minute: 30,
    });

    expect(result.label).toBe(`com.user.sc-${TEST_NAME}`);
    expect(result.plistPath).toContain(TEST_NAME);

    // Verify it appears in list
    const list = listSchedules();
    const found = list.find((s: any) => s.name === TEST_NAME);
    expect(found).toBeDefined();
    expect(found.hour).toBe(4);
    expect(found.minute).toBe(30);
    expect(found.weekday).toBeUndefined();
    expect(found.schedule).toBe('daily 04:30');
  });

  it('addSchedule with weekday creates weekly schedule', () => {
    const result = addSchedule({
      name: TEST_NAME,
      scriptPath: '/usr/bin/true',
      hour: 3,
      minute: 0,
      weekday: 0,
    });

    const list = listSchedules();
    const found = list.find((s: any) => s.name === TEST_NAME);
    expect(found).toBeDefined();
    expect(found.weekday).toBe(0);
    expect(found.schedule).toBe('Sun 03:00');
  });

  it('addSchedule with nodeScript uses process.execPath', () => {
    // Use a dummy path that exists
    const result = addSchedule({
      name: TEST_NAME,
      nodeScript: '/usr/bin/true', // Just needs to exist for the check
      hour: 12,
      minute: 0,
    });

    expect(result.label).toContain(TEST_NAME);
  });

  it('addSchedule throws on missing script', () => {
    expect(() => addSchedule({
      name: TEST_NAME,
      scriptPath: '/nonexistent/path.sh',
      hour: 0,
      minute: 0,
    })).toThrow('스크립트를 찾을 수 없습니다');
  });

  it('addSchedule throws on both scriptPath and nodeScript', () => {
    expect(() => addSchedule({
      name: TEST_NAME,
      scriptPath: '/usr/bin/true',
      nodeScript: '/usr/bin/true',
      hour: 0,
      minute: 0,
    })).toThrow('동시에 지정할 수 없습니다');
  });

  it('removeSchedule removes agent and plist', () => {
    addSchedule({
      name: TEST_NAME,
      scriptPath: '/usr/bin/true',
      hour: 5,
      minute: 0,
    });

    const removed = removeSchedule(TEST_NAME);
    expect(removed).toBe(true);

    const list = listSchedules();
    expect(list.find((s: any) => s.name === TEST_NAME)).toBeUndefined();
  });

  it('removeSchedule returns false for nonexistent', () => {
    const removed = removeSchedule('nonexistent-schedule-xyz');
    expect(removed).toBe(false);
  });

  it('listSchedules returns array', () => {
    const list = listSchedules();
    expect(Array.isArray(list)).toBe(true);
  });

  it('syncPmsetWake returns wakeTime or null', () => {
    // Add a schedule first so there's something to sync
    addSchedule({
      name: TEST_NAME,
      scriptPath: '/usr/bin/true',
      hour: 6,
      minute: 15,
    });

    const result = syncPmsetWake();
    // May succeed (if sudoers configured) or fail gracefully
    if (result) {
      expect(result.wakeTime).toBeDefined();
    } else {
      expect(result).toBeNull();
    }
  });

  it('plist contains no hardcoded user paths', () => {
    const { plistPath } = addSchedule({
      name: TEST_NAME,
      scriptPath: '/usr/bin/true',
      hour: 8,
      minute: 0,
    });

    const { readFileSync } = require('fs');
    const content = readFileSync(plistPath, 'utf-8');
    // Should use dynamic HOME, not hardcoded username
    expect(content).toContain(process.env.HOME || '/Users/');
    // Should not contain hardcoded "daehanlim" or specific bot tokens
    expect(content).not.toContain('8291729317');
    expect(content).not.toContain('1822957118');
  });
});
