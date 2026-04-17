/**
 * Simple size-based log rotation.
 * Rotates logs when they exceed MAX_SIZE, keeping up to MAX_BACKUPS.
 */
import { existsSync, statSync, renameSync, unlinkSync } from 'fs';

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_BACKUPS = 3;

/**
 * Rotate a log file if it exceeds MAX_SIZE.
 * file.log → file.log.1 → file.log.2 → file.log.3 (deleted)
 * @param {string} logPath - Absolute path to the log file
 */
export function rotateIfNeeded(logPath) {
  try {
    if (!existsSync(logPath)) return;
    const stats = statSync(logPath);
    if (stats.size < MAX_SIZE) return;

    // Rotate existing backups
    for (let i = MAX_BACKUPS; i >= 1; i--) {
      const src = i === 1 ? logPath : `${logPath}.${i - 1}`;
      const dst = `${logPath}.${i}`;
      if (i === MAX_BACKUPS && existsSync(dst)) {
        unlinkSync(dst);
      }
      if (existsSync(src)) {
        renameSync(src, dst);
      }
    }
  } catch {
    // Best effort — don't crash the caller
  }
}
