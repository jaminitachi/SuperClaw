import { execSync } from 'child_process';
import * as os from 'os';

export interface SystemMetrics {
  cpu: { usage: number; count: number; model: string };
  memory: { total: number; used: number; free: number; percent: number };
  disk: { total: number; used: number; free: number; percent: number; mount: string }[];
  uptime: number;
  loadAvg: number[];
}

export async function collect(): Promise<SystemMetrics> {
  const cpus = os.cpus();
  const cpuUsage = cpus.reduce((acc, cpu) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
    const idle = cpu.times.idle;
    return acc + ((total - idle) / total) * 100;
  }, 0) / cpus.length;

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  // Parse disk usage from df
  let disks: SystemMetrics['disk'] = [];
  try {
    const dfOutput = execSync('df -k / /System/Volumes/Data 2>/dev/null || df -k /', {
      encoding: 'utf-8',
      timeout: 5000,
    });
    const lines = dfOutput.trim().split('\n').slice(1);
    const seen = new Set<string>();
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length >= 6) {
        const mount = parts[parts.length - 1];
        if (seen.has(mount)) continue;
        seen.add(mount);
        const total = parseInt(parts[1]) * 1024;
        const used = parseInt(parts[2]) * 1024;
        const free = parseInt(parts[3]) * 1024;
        const percent = total > 0 ? (used / total) * 100 : 0;
        disks.push({ total, used, free, percent, mount });
      }
    }
  } catch {}

  return {
    cpu: {
      usage: Math.round(cpuUsage * 10) / 10,
      count: cpus.length,
      model: cpus[0]?.model ?? 'unknown',
    },
    memory: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      percent: Math.round((usedMem / totalMem) * 1000) / 10,
    },
    disk: disks,
    uptime: os.uptime(),
    loadAvg: os.loadavg(),
  };
}
