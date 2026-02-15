import * as peekaboo from './peekaboo.js';
import { readFileSync } from 'fs';

export interface ScreenshotPipelineResult {
  path: string;
  base64?: string;
  ocrText?: string;
}

export async function captureAndAnalyze(options?: {
  window?: string;
  includeOCR?: boolean;
  includeBase64?: boolean;
}): Promise<ScreenshotPipelineResult> {
  const shot = await peekaboo.screenshot({ window: options?.window });
  const result: ScreenshotPipelineResult = { path: shot.path };

  if (options?.includeBase64) {
    const buf = readFileSync(shot.path);
    result.base64 = buf.toString('base64');
  }

  if (options?.includeOCR) {
    result.ocrText = await peekaboo.ocr({ window: options?.window });
  }

  return result;
}

export async function captureForTelegram(options?: {
  window?: string;
}): Promise<{ path: string; caption: string }> {
  const shot = await peekaboo.screenshot({ window: options?.window, format: 'jpg' });
  const ocrText = await peekaboo.ocr({ window: options?.window });
  const caption = ocrText.length > 200 ? ocrText.slice(0, 200) + '...' : ocrText;
  return { path: shot.path, caption };
}
