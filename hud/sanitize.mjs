// Strip non-SGR ANSI sequences (keep color codes like \x1b[31m, strip cursor/erase codes)
export function sanitizeOutput(text) {
  // Keep SGR sequences (\x1b[...m) but remove other ANSI sequences
  return text
    .replace(/\x1b\[[0-9;]*[A-HJKSTfn]/g, '')  // Strip cursor movement, erase, etc.
    .replace(/\x1b\[\?[0-9;]*[hl]/g, '')         // Strip mode set/reset
    .replace(/\x1b\][^\x07]*\x07/g, '')           // Strip OSC sequences
    .replace(/\u2588/g, '#')                       // Replace full block with #
    .replace(/\u2591/g, '-');                      // Replace light block with -
}

// Replace regular spaces with non-breaking spaces for terminal alignment
export function replaceSpaces(text) {
  return text.replace(/ /g, '\u00A0');
}

// Limit output to maxLines
export function limitLines(text, maxLines) {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  const kept = lines.slice(0, maxLines);
  const extra = lines.length - maxLines;
  kept.push(`... (+${extra} lines)`);
  return kept.join('\n');
}
