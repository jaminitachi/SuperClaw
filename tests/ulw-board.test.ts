import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { join } from 'path';
import { homedir } from 'os';
import { rmSync } from 'fs';
import { randomUUID } from 'crypto';
import { postToBoard, readBoard, clearBoard } from '../scripts/lib/ulw-board.mjs';

const STATE_DIR = join(homedir(), '.claude', '.sc', 'state');
const TEST_SID = `test-${Date.now()}-${randomUUID().slice(0, 8)}`;
const SESSION_DIR = join(STATE_DIR, 'sessions', TEST_SID);
const BOARD_PATH = join(SESSION_DIR, 'ulw-board.jsonl');

function cleanup() {
  try { rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
}

describe('ulw-board', () => {
  afterEach(() => {
    clearBoard(TEST_SID);
  });
  afterAll(() => cleanup());

  it('readBoard returns empty array when board is cleared', () => {
    clearBoard(TEST_SID);
    const entries = readBoard(TEST_SID);
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBe(0);
  });

  it('postToBoard then readBoard returns the posted entry', () => {
    clearBoard(TEST_SID);
    postToBoard(TEST_SID, { type: 'finding', agent: 'test', id: 'f1' });
    const entries = readBoard(TEST_SID);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const last = entries[entries.length - 1];
    expect(last.agent).toBe('test');
    expect(last.type).toBe('finding');
    expect(last.id).toBe('f1');
  });

  it('postToBoard adds a timestamp automatically', () => {
    clearBoard(TEST_SID);
    postToBoard(TEST_SID, { type: 'info', agent: 'agent-a' });
    const entries = readBoard(TEST_SID);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const last = entries[entries.length - 1];
    expect(typeof last.timestamp).toBe('string');
    expect(last.timestamp.length).toBeGreaterThan(0);
  });

  it('clearBoard empties the board', () => {
    postToBoard(TEST_SID, { type: 'test', agent: 'x' });
    postToBoard(TEST_SID, { type: 'test', agent: 'y' });
    clearBoard(TEST_SID);
    const entries = readBoard(TEST_SID);
    expect(entries.length).toBe(0);
  });

  it('multiple posts accumulate in order', () => {
    clearBoard(TEST_SID);
    postToBoard(TEST_SID, { type: 'step', agent: 'a', seq: 1 });
    postToBoard(TEST_SID, { type: 'step', agent: 'b', seq: 2 });
    postToBoard(TEST_SID, { type: 'step', agent: 'c', seq: 3 });
    const entries = readBoard(TEST_SID);
    expect(entries.length).toBe(3);
    expect(entries[0].agent).toBe('a');
    expect(entries[1].agent).toBe('b');
    expect(entries[2].agent).toBe('c');
  });

  it('readBoard handles empty board file without throwing', () => {
    clearBoard(TEST_SID);
    // clearBoard writes empty string — readBoard must not throw
    expect(() => readBoard(TEST_SID)).not.toThrow();
  });

  it('missing sessionId → postToBoard is a no-op and readBoard returns []', () => {
    // Cross-session isolation guard: no session = no state
    // @ts-expect-error — deliberately passing null to exercise the guard
    postToBoard(null, { type: 'orphan', agent: 'x' });
    // @ts-expect-error — deliberately passing null
    const entries = readBoard(null);
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBe(0);
  });
});
