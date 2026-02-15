import { execSync } from 'child_process';

export interface CalendarMetrics {
  eventsToday: number;
  nextEvent?: { title: string; start: string; end?: string };
  events: { title: string; start: string }[];
}

export async function collect(days = 1): Promise<CalendarMetrics> {
  const metrics: CalendarMetrics = { eventsToday: 0, events: [] };

  try {
    const script = `
      tell application "Calendar"
        set today to current date
        set endDate to today + (${days} * days)
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
    const output = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();

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
