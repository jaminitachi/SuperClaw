import { describe, it, expect } from 'vitest';
import { getSessionAge } from '../scripts/lib/session.mjs';

describe('getSessionAge', () => {
  it('returns "0m" for current time', () => {
    const now = new Date().toISOString();
    expect(getSessionAge(now)).toBe('0m');
  });

  it('returns minutes only for < 1 hour', () => {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    expect(getSessionAge(thirtyMinAgo)).toBe('30m');
  });

  it('returns hours and minutes for 1-24 hours', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000 - 15 * 60 * 1000).toISOString();
    expect(getSessionAge(twoHoursAgo)).toBe('2h 15m');
  });

  it('returns days and hours for > 24 hours', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 - 1 * 60 * 60 * 1000).toISOString();
    expect(getSessionAge(threeDaysAgo)).toBe('3d 1h');
  });

  it('returns "0m" for null/undefined input', () => {
    expect(getSessionAge(null as any)).toBe('0m');
    expect(getSessionAge(undefined as any)).toBe('0m');
  });

  it('returns "0m" for invalid date string', () => {
    expect(getSessionAge('not-a-date')).toBe('0m');
  });

  it('handles exact hour boundary', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(getSessionAge(oneHourAgo)).toBe('1h');
  });
});
