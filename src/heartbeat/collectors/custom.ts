import { execSync } from 'child_process';

export interface CustomMetric {
  name: string;
  value: string | number | boolean;
  unit?: string;
  status?: 'ok' | 'warn' | 'critical';
}

export interface CustomCollectorConfig {
  name: string;
  command: string;
  parseAs?: 'text' | 'number' | 'json';
  warnThreshold?: number;
  criticalThreshold?: number;
}

export async function collect(configs: CustomCollectorConfig[]): Promise<CustomMetric[]> {
  return configs.map((cfg) => {
    try {
      const output = execSync(cfg.command, {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      let value: string | number | boolean = output;
      if (cfg.parseAs === 'number') {
        value = parseFloat(output) || 0;
      } else if (cfg.parseAs === 'json') {
        try { value = JSON.parse(output); } catch { value = output; }
      }

      let status: CustomMetric['status'] = 'ok';
      if (typeof value === 'number') {
        if (cfg.criticalThreshold !== undefined && value >= cfg.criticalThreshold) {
          status = 'critical';
        } else if (cfg.warnThreshold !== undefined && value >= cfg.warnThreshold) {
          status = 'warn';
        }
      }

      return { name: cfg.name, value, status };
    } catch {
      return { name: cfg.name, value: 'error', status: 'critical' as const };
    }
  });
}
