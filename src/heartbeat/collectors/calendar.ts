import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface CalendarMetrics {
  eventsToday: number;
  nextEvent?: { title: string; start: string; end?: string };
  events: { title: string; start: string }[];
}

export async function collect(days = 1): Promise<CalendarMetrics> {
  const metrics: CalendarMetrics = { eventsToday: 0, events: [] };

  try {
    // Clamp `days` to a safe integer to prevent any numeric injection
    const safeDays = Math.max(1, Math.min(365, Math.trunc(days)));
    const script = `
      tell application "Calendar"
        set today to current date
        set endDate to today + (${safeDays} * days)
        set eventList to ""
        repeat with cal in calendars
          set evts to (every event of cal whose start date >= today and start date <= endDate)
          repeat with evt in evts
            set eventList to eventList & summary of evt & "|" & (start date of evt as string) & linefeed
          end repeat
        end repeat
        return eventList
      end tell
    `;
    // Use execFile with argument array — avoids shell interpolation entirely
    const { stdout } = await execFileAsync('osascript', ['-e', script], {
      timeout: 10000,
    });
    const output = stdout.trim();

    if (output) {
      const lines = output.split('\n').filter(Boolean);
      metrics.events = lines.map((line) => {
        const [title, start] = line.split('|');
        return { title: title?.trim() ?? '', start: start?.trim() ?? '' };
      });
      metrics.eventsToday = metrics.events.length;
      if (metrics.events.length > 0) {
        metrics.nextEvent = {
          title: metrics.events[0].title,
          start: metrics.events[0].start,
        };
      }
    }
  } catch {
    // Calendar access might be denied
  }

  return metrics;
}
