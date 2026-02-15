export interface AlertRule {
  metric: string;
  condition: 'gt' | 'lt' | 'eq' | 'neq';
  threshold: number;
  severity: 'info' | 'warn' | 'critical';
  message: string;
}

export interface Alert {
  rule: AlertRule;
  currentValue: number;
  timestamp: string;
  formatted: string;
}

const DEFAULT_RULES: AlertRule[] = [
  { metric: 'cpu.usage', condition: 'gt', threshold: 90, severity: 'critical', message: 'CPU usage above 90%' },
  { metric: 'memory.percent', condition: 'gt', threshold: 85, severity: 'warn', message: 'Memory usage above 85%' },
  { metric: 'disk.percent', condition: 'gt', threshold: 90, severity: 'critical', message: 'Disk usage above 90%' },
];

function getNestedValue(obj: Record<string, unknown>, path: string): number | undefined {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'number' ? current : undefined;
}

function checkCondition(value: number, condition: AlertRule['condition'], threshold: number): boolean {
  switch (condition) {
    case 'gt': return value > threshold;
    case 'lt': return value < threshold;
    case 'eq': return value === threshold;
    case 'neq': return value !== threshold;
  }
}

export function evaluateAlerts(
  metrics: Record<string, unknown>,
  rules?: AlertRule[]
): Alert[] {
  const activeRules = rules ?? DEFAULT_RULES;
  const alerts: Alert[] = [];

  for (const rule of activeRules) {
    const value = getNestedValue(metrics, rule.metric);
    if (value !== undefined && checkCondition(value, rule.condition, rule.threshold)) {
      const severity = rule.severity === 'critical' ? '🔴' : rule.severity === 'warn' ? '🟡' : 'ℹ️';
      alerts.push({
        rule,
        currentValue: value,
        timestamp: new Date().toISOString(),
        formatted: `${severity} ${rule.message} (current: ${Math.round(value * 10) / 10})`,
      });
    }
  }

  return alerts;
}
