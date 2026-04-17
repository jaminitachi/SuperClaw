import { describe, it, expect } from 'vitest';
import { evaluateAlerts } from '../src/heartbeat/alerting.js';
import type { AlertRule, Alert } from '../src/heartbeat/alerting.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    metric: 'cpu.usage',
    condition: 'gt',
    threshold: 80,
    severity: 'warn',
    message: 'CPU high',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// gt condition
// ---------------------------------------------------------------------------

describe('evaluateAlerts — gt condition', () => {
  it('fires when metric value is strictly greater than threshold', () => {
    const rules = [makeRule({ metric: 'cpu', condition: 'gt', threshold: 80 })];
    const alerts = evaluateAlerts({ cpu: 81 }, rules);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].currentValue).toBe(81);
  });

  it('does not fire when metric value equals threshold', () => {
    const rules = [makeRule({ metric: 'cpu', condition: 'gt', threshold: 80 })];
    const alerts = evaluateAlerts({ cpu: 80 }, rules);
    expect(alerts).toHaveLength(0);
  });

  it('does not fire when metric value is below threshold', () => {
    const rules = [makeRule({ metric: 'cpu', condition: 'gt', threshold: 80 })];
    const alerts = evaluateAlerts({ cpu: 79 }, rules);
    expect(alerts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// lt condition
// ---------------------------------------------------------------------------

describe('evaluateAlerts — lt condition', () => {
  it('fires when metric value is strictly less than threshold', () => {
    const rules = [makeRule({ metric: 'temp', condition: 'lt', threshold: 10 })];
    const alerts = evaluateAlerts({ temp: 9 }, rules);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].currentValue).toBe(9);
  });

  it('does not fire when metric value equals threshold', () => {
    const rules = [makeRule({ metric: 'temp', condition: 'lt', threshold: 10 })];
    const alerts = evaluateAlerts({ temp: 10 }, rules);
    expect(alerts).toHaveLength(0);
  });

  it('does not fire when metric value is above threshold', () => {
    const rules = [makeRule({ metric: 'temp', condition: 'lt', threshold: 10 })];
    const alerts = evaluateAlerts({ temp: 11 }, rules);
    expect(alerts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// eq condition
// ---------------------------------------------------------------------------

describe('evaluateAlerts — eq condition', () => {
  it('fires when metric value equals threshold exactly', () => {
    const rules = [makeRule({ metric: 'code', condition: 'eq', threshold: 0 })];
    const alerts = evaluateAlerts({ code: 0 }, rules);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].currentValue).toBe(0);
  });

  it('does not fire when metric value differs from threshold', () => {
    const rules = [makeRule({ metric: 'code', condition: 'eq', threshold: 0 })];
    const alerts = evaluateAlerts({ code: 1 }, rules);
    expect(alerts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// neq condition
// ---------------------------------------------------------------------------

describe('evaluateAlerts — neq condition', () => {
  it('fires when metric value differs from threshold', () => {
    const rules = [makeRule({ metric: 'status', condition: 'neq', threshold: 200 })];
    const alerts = evaluateAlerts({ status: 500 }, rules);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].currentValue).toBe(500);
  });

  it('does not fire when metric value equals threshold', () => {
    const rules = [makeRule({ metric: 'status', condition: 'neq', threshold: 200 })];
    const alerts = evaluateAlerts({ status: 200 }, rules);
    expect(alerts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Nested metric path
// ---------------------------------------------------------------------------

describe('evaluateAlerts — nested metric path', () => {
  it('resolves a two-level path like "system.cpu"', () => {
    const rules = [makeRule({ metric: 'system.cpu', condition: 'gt', threshold: 90 })];
    const alerts = evaluateAlerts({ system: { cpu: 95 } }, rules);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].currentValue).toBe(95);
  });

  it('resolves a three-level path', () => {
    const rules = [makeRule({ metric: 'a.b.c', condition: 'lt', threshold: 5 })];
    const alerts = evaluateAlerts({ a: { b: { c: 3 } } }, rules);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].currentValue).toBe(3);
  });

  it('does not fire when a nested path does not meet the condition', () => {
    const rules = [makeRule({ metric: 'system.cpu', condition: 'gt', threshold: 90 })];
    const alerts = evaluateAlerts({ system: { cpu: 85 } }, rules);
    expect(alerts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Missing metric (undefined)
// ---------------------------------------------------------------------------

describe('evaluateAlerts — missing metric', () => {
  it('returns no alert when the top-level key is absent', () => {
    const rules = [makeRule({ metric: 'cpu', condition: 'gt', threshold: 0 })];
    const alerts = evaluateAlerts({}, rules);
    expect(alerts).toHaveLength(0);
  });

  it('returns no alert when an intermediate nested key is absent', () => {
    const rules = [makeRule({ metric: 'system.cpu', condition: 'gt', threshold: 0 })];
    const alerts = evaluateAlerts({ system: {} }, rules);
    expect(alerts).toHaveLength(0);
  });

  it('returns no alert when the metric value is a non-number type', () => {
    const rules = [makeRule({ metric: 'status', condition: 'eq', threshold: 1 })];
    // string "1" is not a number — getNestedValue returns undefined for non-numbers
    const alerts = evaluateAlerts({ status: '1' } as Record<string, unknown>, rules);
    expect(alerts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Empty rules array
// ---------------------------------------------------------------------------

describe('evaluateAlerts — empty rules array', () => {
  it('returns an empty array when rules is an empty array', () => {
    const alerts = evaluateAlerts({ cpu: 99 }, []);
    expect(alerts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Multiple rules, some matching some not
// ---------------------------------------------------------------------------

describe('evaluateAlerts — multiple rules', () => {
  it('returns only the alerts whose conditions are met', () => {
    const rules: AlertRule[] = [
      makeRule({ metric: 'cpu', condition: 'gt', threshold: 90, message: 'cpu alert' }),
      makeRule({ metric: 'memory', condition: 'gt', threshold: 85, message: 'memory alert' }),
      makeRule({ metric: 'disk', condition: 'gt', threshold: 95, message: 'disk alert' }),
    ];
    // cpu fires (91 > 90), memory fires (86 > 85), disk does not (94 < 95)
    const alerts = evaluateAlerts({ cpu: 91, memory: 86, disk: 94 }, rules);
    expect(alerts).toHaveLength(2);
    const messages = alerts.map((a) => a.rule.message);
    expect(messages).toContain('cpu alert');
    expect(messages).toContain('memory alert');
    expect(messages).not.toContain('disk alert');
  });

  it('returns an empty array when no rule conditions are met', () => {
    const rules: AlertRule[] = [
      makeRule({ metric: 'cpu', condition: 'gt', threshold: 90 }),
      makeRule({ metric: 'memory', condition: 'gt', threshold: 85 }),
    ];
    const alerts = evaluateAlerts({ cpu: 50, memory: 50 }, rules);
    expect(alerts).toHaveLength(0);
  });

  it('returns alerts for all rules when every condition is met', () => {
    const rules: AlertRule[] = [
      makeRule({ metric: 'a', condition: 'gt', threshold: 0 }),
      makeRule({ metric: 'b', condition: 'lt', threshold: 100 }),
      makeRule({ metric: 'c', condition: 'eq', threshold: 42 }),
    ];
    const alerts = evaluateAlerts({ a: 1, b: 99, c: 42 }, rules);
    expect(alerts).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Alert shape
// ---------------------------------------------------------------------------

describe('evaluateAlerts — returned Alert shape', () => {
  it('includes rule, currentValue, timestamp, and formatted fields', () => {
    const rule = makeRule({ metric: 'cpu', condition: 'gt', threshold: 80 });
    const alerts = evaluateAlerts({ cpu: 85 }, [rule]);
    expect(alerts).toHaveLength(1);
    const alert: Alert = alerts[0];
    expect(alert.rule).toBe(rule);
    expect(alert.currentValue).toBe(85);
    expect(typeof alert.timestamp).toBe('string');
    expect(alert.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof alert.formatted).toBe('string');
    expect(alert.formatted.length).toBeGreaterThan(0);
  });

  it('rounds currentValue to one decimal place in the formatted string', () => {
    const rule = makeRule({ metric: 'cpu', condition: 'gt', threshold: 80 });
    const alerts = evaluateAlerts({ cpu: 85.678 }, [rule]);
    expect(alerts[0].formatted).toContain('85.7');
  });

  it('uses red emoji for critical severity in formatted string', () => {
    const rule = makeRule({ metric: 'cpu', condition: 'gt', threshold: 80, severity: 'critical' });
    const alerts = evaluateAlerts({ cpu: 85 }, [rule]);
    expect(alerts[0].formatted).toContain('🔴');
  });

  it('uses yellow emoji for warn severity in formatted string', () => {
    const rule = makeRule({ metric: 'cpu', condition: 'gt', threshold: 80, severity: 'warn' });
    const alerts = evaluateAlerts({ cpu: 85 }, [rule]);
    expect(alerts[0].formatted).toContain('🟡');
  });

  it('uses info emoji for info severity in formatted string', () => {
    const rule = makeRule({ metric: 'cpu', condition: 'gt', threshold: 80, severity: 'info' });
    const alerts = evaluateAlerts({ cpu: 85 }, [rule]);
    expect(alerts[0].formatted).toContain('ℹ️');
  });
});

// ---------------------------------------------------------------------------
// Default rules (no rules argument)
// ---------------------------------------------------------------------------

describe('evaluateAlerts — default rules fallback', () => {
  it('uses default rules when no rules argument is provided and cpu.usage is high', () => {
    const alerts = evaluateAlerts({ cpu: { usage: 95 } });
    const cpuAlert = alerts.find((a) => a.rule.metric === 'cpu.usage');
    expect(cpuAlert).toBeDefined();
  });

  it('uses default rules when no rules argument is provided and metrics are normal', () => {
    const alerts = evaluateAlerts({ cpu: { usage: 50 }, memory: { percent: 50 }, disk: { percent: 50 } });
    expect(alerts).toHaveLength(0);
  });
});
